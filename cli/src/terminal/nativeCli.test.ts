import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalManager } from './TerminalManager'
import { killProcessTreeByPid } from '@/utils/process'
vi.mock('@/utils/process', () => ({ killProcessTreeByPid: vi.fn(async () => true) }))

const originalBun = globalThis.Bun
afterEach(() => { Object.assign(globalThis, { Bun: originalBun }) })

function fixture(prepareNativeCli: (signal: AbortSignal) => Promise<unknown>) {
    const terminal = { resize: vi.fn(), write: vi.fn(), close: vi.fn() }
    const proc = { pid: 123, terminal, killed: false, exitCode: null, kill: vi.fn() }
    const spawn = vi.fn((_command: string[], _options: unknown) => proc)
    Object.assign(globalThis, { Bun: { spawn } })
    const errors = vi.fn()
    const manager = new TerminalManager({ sessionId: 'sid', getSessionPath: () => '/project',
        onReady: vi.fn(), onOutput: vi.fn(), onExit: vi.fn(), onError: errors,
        idleTimeoutMs: 0, prepareNativeCli } as never)
    return { manager, spawn, errors, proc }
}

describe('native CLI terminals', () => {
    it('spawns an argv array with scoped auth and releases the lease on actual process exit', async () => {
        const release = vi.fn()
        const f = fixture(async () => ({ command: ['/native/codex', '--remote', 'ws://local', 'resume', 'thread'],
            env: { HAPI_CODEX_REMOTE_TOKEN: 'private-token' }, onExit: release }))
        await f.manager.create('t', 80, 24, true)
        expect(f.spawn.mock.calls[0]?.[0]).toEqual(['/native/codex', '--remote', 'ws://local', 'resume', 'thread'])
        expect((f.spawn.mock.calls[0] as unknown[])[1]).toMatchObject({ env: { HAPI_CODEX_REMOTE_TOKEN: 'private-token' } })
        f.manager.close('t')
        expect(release).not.toHaveBeenCalled()
        const options = (f.spawn.mock.calls[0] as unknown[])[1] as { onExit: (proc: unknown, code: number) => void;
            terminal: { exit: (terminal: unknown, code: number) => void } }
        options.terminal.exit({}, 1)
        expect(f.errors).not.toHaveBeenCalled()
        options.onExit({ signalCode: null }, 0)
        await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
        expect(killProcessTreeByPid).toHaveBeenCalledWith(123)
    })

    it('cancels preparation on close and never spawns a late process', async () => {
        let resolve!: (value: unknown) => void
        const release = vi.fn()
        const f = fixture(() => new Promise(done => { resolve = done }))
        const creating = f.manager.create('t', 80, 24, true)
        f.manager.close('t')
        resolve({ command: ['agy'], onExit: release })
        await creating
        expect(f.spawn).not.toHaveBeenCalled()
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('reports launch failures without silently opening a shell', async () => {
        const f = fixture(async () => { throw new Error('Stop the active AGY turn first') })
        await f.manager.create('t', 80, 24, true)
        expect(f.spawn).not.toHaveBeenCalled()
        expect(f.errors).toHaveBeenCalledWith(expect.objectContaining({ message: 'Stop the active AGY turn first' }))
    })
})
