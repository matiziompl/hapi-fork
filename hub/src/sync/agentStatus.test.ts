import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'
import { createMessagesRoutes } from '../web/routes/messages'
import type { WebAppEnv } from '../web/middleware/auth'
import { AGENT_FLAVORS } from '@hapi/protocol'
import { createSessionsRoutes } from '../web/routes/sessions'

describe('agent status in chat', () => {
    let store: Store
    let engine: SyncEngine
    let emitted: ReturnType<typeof mock>
    let probe: ReturnType<typeof mock>
    let sessionId: string

    beforeEach(() => {
        store = new Store(':memory:')
        emitted = mock(() => {})
        const io = { of: () => ({ to: () => ({ emit: emitted }) }) }
        engine = new SyncEngine(store, io as never, new RpcRegistry(), { broadcast() {} } as never)
        const cache = (engine as any).sessionCache
        sessionId = cache.getOrCreateSession('status', {
            flavor: 'agy', path: '/workspace/project', host: 'runner', machineId: 'machine',
        }, {}, 'default').id
        cache.markSessionActive(sessionId)
        probe = mock(async () => ({ success: true, stdout: JSON.stringify({
            success: true, data: { groups: [{ name: 'Gemini Models', buckets: [{
                name: 'Weekly limit', remaining_fraction: 0.75, reset_time: '2026-11-04T13:15:13Z',
            }] }] },
        }) }))
        ;(engine as any).rpcGateway.getAgentStatus = probe
    })
    afterEach(() => { engine.stop(); store.close() })

    it('stores /status and its real quota report as consumed chat messages without starting a turn', async () => {
        await engine.sendMessage(sessionId, { text: '/status', localId: 'request-1' })
        const messages = store.messages.getAllMessages(sessionId)
        expect(messages).toHaveLength(2)
        expect(messages[0].invokedAt).not.toBeNull()
        // The shared agent-message envelope selects the Markdown chat renderer;
        // a session event would flatten the report into a one-line status label.
        expect(messages[1].content).toMatchObject({ role: 'agent', content: { type: 'codex', data: { type: 'message' } } })
        const text = (messages[1].content as any).content.data.message as string
        expect(text).toStartWith('```hapi-status\n')
        const report = JSON.parse(text.split('\n')[1])
        expect(report.limits[0]).toMatchObject({ remainingPercent: 75, resetsAt: Date.parse('2026-11-04T13:15:13Z') })
        expect(emitted).not.toHaveBeenCalled()
        expect(engine.getSession(sessionId)?.thinking).toBe(false)
    })

    it('accepts AGY quota aliases and deduplicates retried requests', async () => {
        await Promise.all([
            engine.sendMessage(sessionId, { text: '/quota', localId: 'quota-1' }),
            engine.sendMessage(sessionId, { text: '/quota', localId: 'quota-1' }),
        ])
        expect(store.messages.getAllMessages(sessionId)).toHaveLength(2)
        expect(probe).toHaveBeenCalledTimes(1)
    })

    it('keeps ordinary prompts and commands with arguments on their existing delivery path', async () => {
        for (const text of ['explain /status', '/status explain this', '/status\nthen edit files']) {
            await engine.sendMessage(sessionId, { text })
        }
        expect(emitted).toHaveBeenCalledTimes(3)
        expect(probe).not.toHaveBeenCalled()
    })

    it('reports probe failure without sending the command to the model', async () => {
        probe.mockImplementation(async () => { throw new Error('Runner disconnected') })
        await engine.sendMessage(sessionId, { text: '/status' })
        const messages = store.messages.getAllMessages(sessionId)
        expect(messages).toHaveLength(2)
        expect(JSON.stringify(messages[1].content)).toContain('unavailable')
        expect(emitted).not.toHaveBeenCalled()
    })

    it.each(AGENT_FLAVORS.filter(flavor => !['agy', 'codex'].includes(flavor)))('shows an honest status for %s without probing another provider', async flavor => {
        const cache = (engine as any).sessionCache
        const other = cache.getOrCreateSession(flavor, { flavor, path: '/workspace/project', host: 'runner' }, {}, 'default')
        cache.markSessionActive(other.id)
        await engine.sendMessage(other.id, { text: '/status' })
        const messages = store.messages.getAllMessages(other.id)
        expect(messages).toHaveLength(2)
        expect(JSON.stringify(messages[1].content)).toContain('account quota is unknown')
        expect(probe).not.toHaveBeenCalled()
        expect(emitted).not.toHaveBeenCalled()
    })

    it('does not stop or change an active turn while reading status', async () => {
        const session = engine.getSession(sessionId)!
        session.thinking = true
        session.activeTurnStartedAt = 1234
        await engine.sendMessage(sessionId, { text: '/status' })
        expect(engine.getSession(sessionId)?.thinking).toBe(true)
        expect(engine.getSession(sessionId)?.activeTurnStartedAt).toBe(1234)
        expect(emitted).not.toHaveBeenCalled()
    })

    it('exposes status and AGY aliases in autocomplete even when an old Runner cannot list commands', async () => {
        ;(engine as any).rpcGateway.listSlashCommands = async () => { throw new Error('old Runner') }
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => { c.set('namespace', 'default'); await next() })
        app.route('/', createSessionsRoutes(() => engine))
        const response = await app.request(`/sessions/${sessionId}/slash-commands`)
        expect(response.status).toBe(200)
        const body = await response.json() as { commands: { name: string }[] }
        expect(body.commands.map(command => command.name)).toEqual(['status', 'quota', 'usage'])
    })

    it('acknowledges status immediately so it never waits in the ordinary prompt queue', async () => {
        const events: unknown[] = []
        engine.subscribe(event => events.push(event))
        await engine.sendMessage(sessionId, { text: '/status', localId: 'status-ack' })
        expect(events).toContainEqual(expect.objectContaining({ type: 'messages-consumed', localIds: ['status-ack'] }))
        expect(engine.getQueuedState(sessionId, ['status-ack']).queuedLocalIds).toEqual([])
    })

    it('uses the authenticated message route and rejects a different namespace before probing', async () => {
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => { c.set('namespace', 'other'); await next() })
        app.route('/', createMessagesRoutes(() => engine))
        const response = await app.request(`/sessions/${sessionId}/messages`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '/status' }),
        })
        expect([403, 404]).toContain(response.status)
        expect(probe).not.toHaveBeenCalled()
        expect(store.messages.getAllMessages(sessionId)).toHaveLength(0)
    })
})
