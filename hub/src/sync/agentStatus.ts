import { randomUUID } from 'node:crypto'
import { AGENT_MESSAGE_PAYLOAD_TYPE, getFlavorLabel } from '@hapi/protocol'
import type { AgentStatusReport } from '@hapi/protocol'
import type { Session } from '@hapi/protocol/types'
import type { SlashCommand } from '@hapi/protocol/apiTypes'
import type { Store } from '../store'
import type { EventPublisher } from './eventPublisher'

type ProbeResult = { success: boolean; stdout?: string; error?: string }
type StatusPayload = { text: string; localId?: string | null; sentFrom?: 'telegram-bot' | 'webapp' }
type QuotaResult = Pick<AgentStatusReport, 'limits' | 'unavailableMessage'>

function record(value: unknown): Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {}
}

function label(value: unknown, fallback = 'not reported'): string {
    return typeof value === 'string' && value.trim()
        ? value.replace(/[\r\n|`<>\[\]\\]/g, ' ').slice(0, 160) : fallback
}

function percent(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function resetTime(value: unknown): number | null {
    const timestamp = typeof value === 'number' ? value * 1000 : typeof value === 'string' ? Date.parse(value) : NaN
    return Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= 8.64e15
        ? timestamp : null
}

export function isAgentStatusCommand(text: string, flavor: string | null | undefined): boolean {
    return /^\/status$/i.test(text.trim()) || (flavor === 'agy' && /^\/(?:quota|usage)$/i.test(text.trim()))
}

export function getAgentStatusCommands(flavor: string): SlashCommand[] {
    const commands: SlashCommand[] = [{ name: 'status', description: 'Show session status and available account limits', source: 'builtin' }]
    if (flavor === 'agy') {
        commands.push(
            { name: 'quota', description: 'Show Antigravity account quotas and reset times', source: 'builtin' },
            { name: 'usage', description: 'Alias for /quota', source: 'builtin' },
        )
    }
    return commands
}

export function parseAgentQuota(flavor: string, stdout: string): QuotaResult {
    const result = record(JSON.parse(stdout))
    if (result.success !== true) return { limits: [], unavailableMessage: 'Account limits unavailable. Check login and the installed agent version.' }
    const data = record(result.data)
    const limits: AgentStatusReport['limits'] = []
    if (flavor === 'agy' && Array.isArray(data.groups)) {
        for (const entry of data.groups.slice(0, 30)) {
            const group = record(entry)
            if (!Array.isArray(group.buckets)) continue
            for (const item of group.buckets.slice(0, 20)) {
                const bucket = record(item)
                const fraction = bucket.remaining_fraction
                if (typeof fraction !== 'number' || !percent(fraction * 100)) continue
                limits.push({ label: `${label(group.name)} — ${label(bucket.name)}`,
                    remainingPercent: Math.round(fraction * 100), resetsAt: resetTime(bucket.reset_time) })
            }
        }
    } else if (flavor === 'codex') {
        const byId = record(data.rateLimitsByLimitId)
        const buckets = Object.keys(byId).length > 0 ? Object.values(byId) : [data.rateLimits]
        for (const item of buckets.slice(0, 30)) {
            const bucket = record(item)
            for (const windowName of ['primary', 'secondary']) {
                const window = record(bucket[windowName])
                if (!percent(window.usedPercent)) continue
                const minutes = window.windowDurationMins
                const duration = typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0
                    ? `${minutes} min` : windowName
                const name = label(bucket.limitName, label(bucket.limitId, 'Codex'))
                limits.push({ label: `${name} — ${duration}`,
                    remainingPercent: Math.round(100 - window.usedPercent), resetsAt: resetTime(window.resetsAt) })
            }
        }
    }
    return { limits, unavailableMessage: limits.length > 0 ? null
        : 'Account limits unavailable for this account or agent version. No quota values were reported.' }
}

export class AgentStatusService {
    private readonly requests = new Map<string, Promise<void>>()
    private readonly probes = new Map<string, Promise<QuotaResult>>()

    constructor(
        private readonly store: Store,
        private readonly publisher: EventPublisher,
        private readonly probe: (sessionId: string, flavor: 'codex' | 'agy') => Promise<ProbeResult>,
    ) {}

    async send(session: Session, payload: StatusPayload): Promise<void> {
        const localId = payload.localId ?? randomUUID()
        const key = `${session.id}:${localId}`
        const pending = this.requests.get(key)
        if (pending) return pending
        const work = this.sendReport(session, { ...payload, localId })
        this.requests.set(key, work)
        try { await work } finally { this.requests.delete(key) }
    }

    private publish(sessionId: string, content: unknown, localId: string) {
        const result = this.store.messages.addImportedMessage(sessionId, content, localId, Date.now())
        if (result.inserted) {
            this.publisher.emit({ type: 'message-received', sessionId, message: result.message })
        }
        return result.message
    }

    private async sendReport(session: Session, payload: StatusPayload & { localId: string }): Promise<void> {
        const request = this.publish(session.id, {
            role: 'user', content: { type: 'text', text: payload.text },
            meta: { sentFrom: payload.sentFrom ?? 'webapp' },
        }, payload.localId)
        this.publisher.emit({ type: 'messages-consumed', sessionId: session.id,
            localIds: [payload.localId], invokedAt: request.invokedAt ?? request.createdAt })
        const replyId = `agent-status:${request.id}`
        if (this.store.messages.lookupQueuedMessage(session.id, replyId).status !== 'absent') return

        let quota = this.probes.get(session.id)
        if (!quota) {
            quota = this.readQuota(session)
            this.probes.set(session.id, quota)
        }
        let limits: QuotaResult
        try { limits = await quota } finally { this.probes.delete(session.id) }
        // A deleted session must not receive an orphaned report after the probe.
        if (!this.store.sessions.getSession(session.id)) return
        const report: AgentStatusReport = {
            version: 1, agent: getFlavorLabel(session.metadata?.flavor),
            model: label(session.model, 'automatic'),
            reasoning: label(session.modelReasoningEffort ?? session.effort, 'default'),
            permissions: label(session.permissionMode), directory: label(session.metadata?.path),
            sessionState: session.thinking ? 'working' : 'idle', checkedAt: Date.now(), ...limits,
        }
        const text = `\`\`\`hapi-status\n${JSON.stringify(report)}\n\`\`\``
        // Another idempotent request may have completed while awaiting the probe.
        if (this.store.messages.lookupQueuedMessage(session.id, replyId).status !== 'absent') return
        this.publish(session.id, {
            role: 'agent', content: { type: AGENT_MESSAGE_PAYLOAD_TYPE, data: { type: 'message', message: text } },
        }, replyId)
    }

    private async readQuota(session: Session): Promise<QuotaResult> {
        const flavor = session.metadata?.flavor
        if (flavor !== 'codex' && flavor !== 'agy') {
            return { limits: [], unavailableMessage: 'Account limits are not exposed by the current HAPI integration for this agent; account quota is unknown.' }
        }
        try {
            const result = await this.probe(session.id, flavor)
            if (!result.success || !result.stdout) return { limits: [], unavailableMessage: 'Account limits unavailable. Check the session machine connection and agent login (Node.js is required on that machine).' }
            return parseAgentQuota(flavor, result.stdout)
        } catch {
            return { limits: [], unavailableMessage: 'Account limits unavailable. Check the session machine connection and agent login, then try again.' }
        }
    }
}
