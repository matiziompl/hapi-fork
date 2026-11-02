import { RPC_METHODS } from '@hapi/protocol/rpcMethods';
import type { RpcHandler } from '@/api/rpc/types';
import { logger } from '@/ui/logger';
import type { AgentSessionBase } from './sessionBase';

export type LoopLauncher<TSession> = (session: TSession) => Promise<'switch' | 'exit'>;

export type SessionMode = 'local' | 'remote' | 'pty';

export async function runLocalRemoteSession<TSession extends AgentSessionBase<any>>(opts: {
    session: TSession;
    startingMode?: SessionMode;
    logTag: string;
    runLocal: LoopLauncher<TSession>;
    runRemote: LoopLauncher<TSession>;
    runPty?: LoopLauncher<TSession>;
    onSessionReady?: (session: TSession) => void;
}): Promise<void> {
    if (opts.onSessionReady) {
        opts.onSessionReady(opts.session);
    }

    await runLocalRemoteLoop({
        session: opts.session,
        startingMode: opts.startingMode,
        logTag: opts.logTag,
        runLocal: opts.runLocal,
        runRemote: opts.runRemote,
        runPty: opts.runPty,
    });
}

export async function runLocalRemoteLoop<TSession extends AgentSessionBase<any>>(opts: {
    session: TSession;
    startingMode?: SessionMode;
    logTag: string;
    runLocal: LoopLauncher<TSession>;
    runRemote: LoopLauncher<TSession>;
    runPty?: LoopLauncher<TSession>;
}): Promise<void> {
    let mode: SessionMode = opts.startingMode ?? 'local';

    let closing = false;
    let finished = false;
    let failure: unknown;
    let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; });
    let activeControl: Promise<RpcHandler | null> = Promise.resolve(null);
    const launch = async (launcher: LoopLauncher<TSession>) => {
        let ready!: (handler: RpcHandler | null) => void;
        activeControl = new Promise(resolve => { ready = resolve; });
        const unsubscribe = opts.session.client.rpcHandlerManager.onHandlerRegistered(RPC_METHODS.Switch, ready);
        try { return await launcher(opts.session); }
        finally { unsubscribe(); ready(null); }
    };
    opts.session.setKillHandler(async () => {
        if (finished) {
            if (closing && failure) throw failure;
            return;
        }
        closing = true;
        // Stop through the current launcher's own control; the loop gate prevents
        // switching into another launcher. Completion includes its finally cleanup.
        // Startup can still be registering controls. Never use the preceding
        // launcher's Switch (which may already have been replaced with a no-op).
        const stop = await activeControl;
        if (stop) await stop({});
        await completion;
        if (failure) throw failure;
    });
    try {
        while (!closing) {
            logger.debug(`[${opts.logTag}] Iteration with mode: ${mode}`);

            if (mode === 'local') {
                const reason = await launch(opts.runLocal);
                if (closing || reason === 'exit') {
                    return;
                }

                // Leaving local mode returns to this session's remote variant. PTY
                // is OPT-IN: only a session that started in PTY mode hands off to the
                // PTY launcher. A normal local/remote session must still use the SDK
                // remote launcher merely because a PTY launcher is available.
                mode = opts.startingMode === 'pty' && opts.runPty ? 'pty' : 'remote';
                opts.session.onModeChange(mode === 'pty' ? 'remote' : mode);
                continue;
            }

            if (mode === 'remote') {
                const reason = await launch(opts.runRemote);
                if (closing || reason === 'exit') {
                    return;
                }

                mode = 'local';
                opts.session.onModeChange(mode);
                continue;
            }

            if (mode === 'pty') {
                if (!opts.runPty) {
                    throw new Error('PTY mode selected but no runPty launcher provided');
                }

                const reason = await launch(opts.runPty);
                if (closing || reason === 'exit') {
                    return;
                }

                mode = 'local';
                opts.session.onModeChange(mode);
                continue;
            }
        }
    } catch (error) {
        failure = error;
        throw error;
    } finally {
        finished = true;
        finish();
    }
}
