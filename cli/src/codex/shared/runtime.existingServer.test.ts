import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runSharedRuntime } from './runtime';

const state = vi.hoisted(() => ({
    home: '', endpoint: 'unix:///existing/codex.sock' as string | undefined,
    requests: [] as Array<{ method: string; params: any }>,
    spawn: vi.fn(), kill: vi.fn(), root: null as any, hooks: null as any,
    saved: [] as any[],
    host: null as any,
}));
vi.mock('node:child_process', () => ({ spawn: state.spawn, execFileSync: () => '' }));
vi.mock('@/configuration', () => ({ configuration: { apiUrl: 'http://hub.invalid' } }));
vi.mock('@/agent/sessionFactory', () => ({
    bootstrapSession: async () => bootstrap(), bootstrapExistingSession: async () => bootstrap(),
}));
function bootstrap() { return { workingDirectory: '/project', metadata: { hostStartMarker: 'marker' },
    sessionInfo: { namespace: 'default' }, session: { sessionId: 'hub-session', getMetadata: () => ({ path: '/project', hostStartMarker: 'marker' }), flush: async () => {}, sendSessionEvent() {} } }; }
vi.mock('@/runner/controlClient', () => ({ notifyRunnerSessionStarted: async () => {} }));
vi.mock('@/utils/process', () => ({ getProcessStartMarker: () => 'marker', killProcessByChildProcess: state.kill }));
vi.mock('@/ui/logger', () => ({ logger: { debug() {} } }));
vi.mock('./existingServer', () => ({ findLoadedCodexEndpoint: async () => state.endpoint }));
vi.mock('./registry', () => ({ codexHome: () => state.home, runtimeDirectory: () => join(state.home, 'registry'),
    runtimeAuthHash: () => 'auth-hash', saveRuntime: async (r: any) => { state.saved.push(structuredClone(r)); },
    findColdBinding: async () => undefined, withThreadOwnership: async (_h: any, _t: any, _id: any, work: any) => work(),
}));
vi.mock('./launch', () => ({ resolveSharedCodex: () => ({ command: 'codex', args: [] }),
    sharedLaunchConfig: () => ({ cwd: '/project', serverArgs: [], threadParams: { model: 'hub-model' } }),
    initializeSharedClient: async (client: any) => { await client.connect(); await client.initialize(); },
    checkSharedCapabilities: async () => {}, takeReservedSessionId: () => undefined,
}));
vi.mock('../codexAppServerClient', () => ({ isIndeterminateError: () => false, CodexAppServerClient: class {
    async connect() {} async initialize() {} async disconnect() {}
    setServerRequestHandler() {} setNotificationHandler() {} setTransportAbandonedHandler() {}
    async request(method: string, params: any) {
        state.requests.push({ method, params });
        return { thread: { id: 'thread', cwd: '/project', status: { type: 'active' } } };
    }
} }));
vi.mock('./gateway', async (original) => {
    const actual = await original<typeof import('./gateway')>();
    return { ...actual, startCodexGateway: async (options: any) => {
        state.hooks = options.hooks;
        return { endpoint: 'unix:///hapi/clients.sock', close: async () => {} };
    } };
});
vi.mock('./root', () => ({ SharedCodexRoot: class {
    bootstrap: any; session: any; threadId = ''; client: any;
    constructor(boot: any, host: any) { this.bootstrap = boot; this.session = boot.session; state.root = this; state.host = host;
        this.client = { request: async (method: string, params: any) => {
            state.requests.push({ method, params }); return { thread: { id: 'thread', cwd: '/project' } };
        } };
    }
    async prepare() {} config(params: any) { return { ...params, developerInstructions: 'HAPI override' }; }
    async bind(id: string) { this.threadId = id; } activate = vi.fn(async () => {});
    stopAccepting() {} suspend = vi.fn(async () => {}); close = vi.fn(async () => {});
    prepareClose = vi.fn(async () => {});
} }));

let abort: AbortController;
let running: Promise<void> | undefined;
beforeEach(async () => {
    vi.clearAllMocks(); state.requests = []; state.saved = []; state.endpoint = 'unix:///existing/codex.sock';
    abort = new AbortController();
    state.home = '';
    state.home = await mkdtemp(join(tmpdir(), 'hapi-runtime-existing-'));
    state.kill.mockResolvedValue(true);
    state.spawn.mockImplementation(() => {
        const child = new EventEmitter() as any;
        child.pid = 1234; child.exitCode = null; child.signalCode = null; child.stderr = new EventEmitter();
        return child;
    });
    abort = new AbortController();
});
afterEach(async () => {
    abort?.abort(); await running?.catch(() => {}); running = undefined;
    if (state.home) await rm(state.home, { recursive: true, force: true }); vi.useRealTimers();
});
async function start() {
    let ready!: (value: any) => void;
    const readiness = new Promise<any>(resolve => { ready = resolve; });
    running = runSharedRuntime({ workingDirectory: '/project', resumeSessionId: 'thread', existingSessionId: 'hub-session',
        collaborationMode: 'plan', startedBy: 'runner' }, ready, abort.signal);
    return Promise.race([readiness, running.then(() => { throw new Error('Stopped before readiness'); })]);
}
describe('resume through an existing native Codex server', () => {
    it.each([true, false])('closes without archiving while preserving a borrowed engine and uploads (shutdown race: %s)', async race => {
        await start()
        await state.host.end(state.root, false, false)
        if (race) abort.abort()
        await running
        expect(state.root.prepareClose).toHaveBeenCalledOnce()
        expect(state.root.close).toHaveBeenCalledWith(false, true, true)
        expect(state.requests.some(request => request.method === 'thread/archive')).toBe(false)
        expect(state.kill).not.toHaveBeenCalled()
    })
    it('reuses the native writer and preserves its current settings', async () => {
        const { runtime } = await start();
        expect(state.spawn).not.toHaveBeenCalled();
        expect(runtime.serverPid).toBeUndefined();
        expect(state.requests.filter(r => r.method === 'thread/resume').map(r => r.params))
            .toEqual([{ threadId: 'thread', excludeTurns: true }, { threadId: 'thread', excludeTurns: true }]);
        expect(state.requests.some(r => r.method === 'thread/metadata/update')).toBe(false);
        expect(state.root.activate).toHaveBeenCalledWith(undefined);
        const attached = await state.hooks.before({ id: 1, method: 'thread/resume', params: { threadId: 'thread' } }, 'client');
        expect(attached.params).toEqual({ threadId: 'thread' });
    });
    it('does not kill or archive the borrowed server when the wrapper stops', async () => {
        await start(); abort.abort(); await running;
        expect(state.kill).not.toHaveBeenCalled();
        expect(state.root.suspend).toHaveBeenCalledWith(false);
        expect(state.requests.some(r => r.method === 'thread/archive')).toBe(false);
        expect(state.saved.at(-1).sessions['hub-session'].active).toBe(false);
    });
    it('ending the Hub view detaches without archiving the native conversation', async () => {
        await start();
        await state.hooks.control('hapi/stopSession', { sessionId: 'hub-session' });
        await running;
        expect(state.root.close).toHaveBeenCalledWith(true, true);
        expect(state.requests.some(r => r.method === 'thread/archive')).toBe(false);
        expect(state.kill).not.toHaveBeenCalled();
    });
    it('preserves borrowed uploads when End races wrapper shutdown', async () => {
        vi.useFakeTimers();
        await start();
        await state.hooks.control('hapi/stopSession', { sessionId: 'hub-session' });
        abort.abort(); await running;
        expect(state.root.close.mock.calls[0]).toEqual([true, true]);
        await vi.advanceTimersByTimeAsync(100);
    });
    it('keeps private engine ownership and cleanup when no loaded server is found', async () => {
        state.endpoint = undefined;
        const { runtime } = await start();
        expect(state.spawn).toHaveBeenCalledOnce();
        expect(runtime.serverPid).toBe(1234);
        expect(state.requests.find(r => r.method === 'thread/resume')?.params.developerInstructions).toBe('HAPI override');
        abort.abort(); await running; expect(state.kill).toHaveBeenCalledOnce();
    });
});
