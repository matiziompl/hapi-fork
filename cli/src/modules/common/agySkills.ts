import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { z } from 'zod'
import { getAgentLaunchCommand } from '@/agent/agentLaunchCommand'

const execute = promisify(execFile)
const SkillSchema = z.object({
    name: z.string().min(1), description: z.string().optional(), path: z.string().min(1)
}).passthrough()
export type AgySkill = z.infer<typeof SkillSchema>

export function parseAgySkills(output: string): AgySkill[] {
    const result = z.object({ status: z.string(), error: z.string().optional(), command: z.object({
        name: z.literal('skills'), data: z.object({ skills: z.array(SkillSchema) })
    }).optional() }).parse(JSON.parse(output))
    if (result.status !== 'SUCCESS') throw new Error(result.error ?? 'AGY skill catalog failed')
    if (!result.command) throw new Error('AGY returned no native skill catalog')
    return result.command.data.skills
}

const catalogs = new Map<string, { until: number; pending: Promise<AgySkill[]> }>()

export function listAgySkills(workingDirectory = process.cwd()): Promise<AgySkill[]> {
    const cached = catalogs.get(workingDirectory)
    if (cached && cached.until > Date.now()) return cached.pending
    const env: NodeJS.ProcessEnv = { ...process.env, GEMINI_FORCE_FILE_STORAGE: 'true' }
    for (const key of ['SSH_CLIENT', 'SSH_CONNECTION', 'SSH_TTY']) delete env[key]
    const pending = execute(getAgentLaunchCommand('agy'), ['--print', '/skills', '--output-format', 'json'], {
        cwd: workingDirectory, env, timeout: 15_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true
    }).then(({ stdout }) => parseAgySkills(stdout)).catch(error => {
        catalogs.delete(workingDirectory)
        throw error
    })
    catalogs.set(workingDirectory, { until: Date.now() + 5_000, pending })
    setTimeout(() => {
        if (catalogs.get(workingDirectory)?.pending === pending) catalogs.delete(workingDirectory)
    }, 5_000).unref()
    return pending
}
