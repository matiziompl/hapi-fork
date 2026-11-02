import { describe, expect, it, vi } from 'vitest'
import { runLocalRemoteLoop, type LoopLauncher, type SessionMode } from '../loopBase'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { BaseLocalLauncher } from '@/modules/common/launcher/BaseLocalLauncher'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'

function fakeSession() {
    let kill: () => Promise<void> = async () => {}
    return {
        onModeChange: vi.fn(),
        client: { sessionId: 'test', rpcHandlerManager: new RpcHandlerManager({ scopePrefix: 'test' }) },
        setKillHandler: (handler: () => Promise<void>) => { kill = handler },
        kill: () => kill(),
    }
}

type Reason = 'switch' | 'exit'

function launcher(...reasons: Reason[]): LoopLauncher<ReturnType<typeof fakeSession>> {
    let i = 0
    return vi.fn(async () => reasons[Math.min(i++, reasons.length - 1)])
}

async function run(opts: {
    startingMode?: SessionMode
    runLocal: LoopLauncher<ReturnType<typeof fakeSession>>
    runRemote: LoopLauncher<ReturnType<typeof fakeSession>>
    runPty?: LoopLauncher<ReturnType<typeof fakeSession>>
}) {
    const session = fakeSession()
    await runLocalRemoteLoop({
        session: session as never,
        startingMode: opts.startingMode,
        logTag: 'test',
        runLocal: opts.runLocal,
        runRemote: opts.runRemote,
        runPty: opts.runPty,
    })
    return session
}

describe('runLocalRemoteLoop mode selection', () => {
    it.each(['remote', 'local'] as const)('closes during %s startup using the new launcher control', async startingMode => {
        const session = fakeSession()
        let beginInit!: () => void; let finishInit!: () => void; let stopRemote!: () => void
        const started = new Promise<void>(resolve => { beginInit = resolve })
        const initialized = new Promise<void>(resolve => { finishInit = resolve })
        const stopped = new Promise<'switch'>(resolve => { stopRemote = () => resolve('switch') })
        const currentSwitch = vi.fn(async () => { stopRemote() })
        const running = runLocalRemoteLoop({ session: session as never, startingMode, logTag: 'test',
            runLocal: () => new BaseLocalLauncher({
                label: 'test', failureLabel: 'test', rpcHandlerManager: session.client.rpcHandlerManager,
                queue: { size: () => 1, reset() {}, setOnMessage() {} },
                launch: async () => {}, sendFailureMessage() {}, recordLocalLaunchFailure() {},
            }).run(),
            runRemote: async () => {
                beginInit(); await initialized
                session.client.rpcHandlerManager.registerHandler(RPC_METHODS.Switch, currentSwitch)
                return stopped
            },
        })
        await started
        const closing = session.kill()
        // Keep a rejection handler while initialization is deliberately blocked.
        const result = closing.then(() => 'closed', error => String(error))
        await new Promise(resolve => setImmediate(resolve))
        finishInit()
        expect(await Promise.race([result, new Promise(resolve => setTimeout(() => resolve('timed out'), 300))])).toBe('closed')
        expect(currentSwitch).toHaveBeenCalledOnce()
        await running
    })
    it('closes the active local launcher and waits for cleanup without launching remote', async () => {
        const session = fakeSession()
        let resolveCleanup!: () => void
        let launchStarted!: () => void
        const started = new Promise<void>(resolve => { launchStarted = resolve })
        const cleanup = new Promise<void>(resolve => { resolveCleanup = resolve })
        let aborted = false
        const runRemote = launcher('exit')
        const running = runLocalRemoteLoop({ session: session as never, logTag: 'test', runRemote, runLocal: () => new BaseLocalLauncher({
            label: 'test', failureLabel: 'test', rpcHandlerManager: session.client.rpcHandlerManager,
            queue: { size: () => 0, reset() {}, setOnMessage() {} },
            sendFailureMessage() {}, recordLocalLaunchFailure() {},
            launch: async signal => {
                launchStarted()
                await new Promise<void>(resolve => signal.addEventListener('abort', () => { aborted = true; resolve() }, { once: true }))
                await cleanup
            },
        }).run() })
        await started
        let closed = false
        const closing = session.kill().then(() => { closed = true })
        await vi.waitFor(() => expect(aborted).toBe(true))
        expect(closed).toBe(false)
        resolveCleanup()
        await closing; await running
        expect(runRemote).not.toHaveBeenCalled()
    })

    it('waits for remote launcher cleanup after switch acknowledgement', async () => {
        const session = fakeSession()
        let finish!: () => void
        const stopped = new Promise<'switch'>(resolve => { finish = () => resolve('switch') })
        const runLocal = launcher('exit')
        const running = runLocalRemoteLoop({ session: session as never, startingMode: 'remote', logTag: 'test', runLocal, runRemote: async () => {
            session.client.rpcHandlerManager.registerHandler(RPC_METHODS.Switch, async () => {})
            return stopped
        } })
        let closed = false
        const closing = session.kill().then(() => { closed = true })
        await new Promise(resolve => setImmediate(resolve))
        expect(closed).toBe(false)
        finish(); await running; await closing
        expect(runLocal).not.toHaveBeenCalled()
    })
    it('a non-PTY session hands off local→SDK remote even when a runPty launcher is registered', async () => {
        // A normal local session must still reach the SDK remote launcher, not
        // an optional PTY launcher.
        const runLocal = launcher('switch')
        const runRemote = launcher('exit')
        const runPty = launcher('exit')

        const session = await run({ startingMode: 'local', runLocal, runRemote, runPty })

        expect(runRemote).toHaveBeenCalledTimes(1)
        expect(runPty).not.toHaveBeenCalled()
        // The external mode reported is 'remote'.
        expect(session.onModeChange).toHaveBeenCalledWith('remote')
    })

    it('defaults (no startingMode) behave as a local→remote session', async () => {
        const runLocal = launcher('switch')
        const runRemote = launcher('exit')
        const runPty = launcher('exit')

        await run({ runLocal, runRemote, runPty })

        expect(runRemote).toHaveBeenCalledTimes(1)
        expect(runPty).not.toHaveBeenCalled()
    })

    it('a PTY session toggles local↔pty and never uses the SDK remote launcher', async () => {
        // pty → (switch) local → (switch) pty → (exit)
        const runPty = launcher('switch', 'exit')
        const runLocal = launcher('switch')
        const runRemote = launcher('exit')

        const session = await run({ startingMode: 'pty', runLocal, runRemote, runPty })

        expect(runPty).toHaveBeenCalledTimes(2)
        expect(runRemote).not.toHaveBeenCalled()
        // PTY is reported to the hub/UI as 'remote'.
        expect(session.onModeChange).toHaveBeenCalledWith('remote')
    })
})
