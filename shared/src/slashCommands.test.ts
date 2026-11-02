import { describe, expect, it } from 'bun:test'
import { getBuiltinSlashCommands, findNativeCliCommand } from './slashCommands'
import { TerminalOpenPayloadSchema } from './socket'

describe('native CLI commands', () => {
    it('exposes AGY commands without falling back to Claude', () => {
        const commands = getBuiltinSlashCommands('agy')
        expect(commands.find(command => command.name === 'plugin')).toMatchObject({ execution: 'native' })
        expect(commands.some(command => command.name === 'doctor')).toBe(false)
    })

    it('routes native commands and aliases while respecting custom prompts', () => {
        expect(findNativeCliCommand(' /plugins list ', 'codex')?.name).toBe('plugins')
        expect(findNativeCliCommand('/settings', 'agy')?.name).toBe('settings')
        expect(findNativeCliCommand('/import', 'codex')?.nativeCliContext).toBe('local')
        expect(findNativeCliCommand('/status', 'agy')).toBeNull()
        expect(findNativeCliCommand('/model test', 'codex')).toBeNull()
        expect(findNativeCliCommand('/review', 'codex', [{ name: 'review', source: 'project', content: 'Review' }])).toBeNull()
        expect(findNativeCliCommand('/config\u001b[H', 'codex')).toBeNull()
    })

    it('keeps terminal protocol backwards compatible and rejects nonboolean launch requests', () => {
        const base = { sessionId: 'session', terminalId: 'terminal', cols: 80, rows: 24 }
        expect(TerminalOpenPayloadSchema.parse(base)).toEqual(base)
        expect(TerminalOpenPayloadSchema.parse({ ...base, nativeCli: true }).nativeCli).toBe(true)
        expect(TerminalOpenPayloadSchema.safeParse({ ...base, nativeCli: 'codex;echo BAD' }).success).toBe(false)
    })
})
