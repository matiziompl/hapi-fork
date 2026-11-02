import { z } from 'zod'

export const AgentStatusReportSchema = z.object({
    version: z.literal(1),
    agent: z.string().max(160),
    model: z.string().max(160),
    reasoning: z.string().max(160),
    permissions: z.string().max(160),
    directory: z.string().max(4096),
    sessionState: z.string().max(160),
    checkedAt: z.number().finite().min(0).max(8.64e15),
    limits: z.array(z.object({
        label: z.string().max(350),
        remainingPercent: z.number().finite().min(0).max(100),
        resetsAt: z.number().finite().min(0).max(8.64e15).nullable(),
    })).max(600),
    unavailableMessage: z.string().max(2000).nullable(),
})

export type AgentStatusReport = z.infer<typeof AgentStatusReportSchema>

/** Status clocks use Poland's civil time, including its daylight-saving rules. */
export function formatAgentStatusTime(timestamp: number): string {
    return new Intl.DateTimeFormat('pl-PL', {
        timeZone: 'Europe/Warsaw', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(timestamp))
}

export function parseAgentStatusReport(code: string): AgentStatusReport | null {
    if (code.length > 262144) return null
    try {
        const parsed = AgentStatusReportSchema.safeParse(JSON.parse(code))
        return parsed.success ? parsed.data : null
    } catch { return null }
}
