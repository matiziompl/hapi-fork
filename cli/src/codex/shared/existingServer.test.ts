import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findLoadedCodexEndpoint } from './existingServer';

const native = vi.hoisted(() => ({
    request: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), initialize: vi.fn(),
    stat: vi.fn(),
}));
vi.mock('node:fs/promises', () => ({ stat: native.stat }));
vi.mock('../codexAppServerClient', () => ({ CodexAppServerClient: class {
    request = native.request; disconnect = native.disconnect;
    connect = native.connect; initialize = native.initialize;
} }));

describe.skipIf(process.platform === 'win32')('existing local Codex server discovery', () => {
    afterEach(() => vi.useRealTimers());
    beforeEach(() => {
        vi.clearAllMocks();
        native.stat.mockResolvedValue({ isSocket: () => true, uid: process.getuid?.() });
        native.request.mockImplementation(async (method: string) => {
            if (method === 'thread/loaded/list') return { data: ['thread'], nextCursor: null };
            if (method === 'thread/read') return { thread: { id: 'thread', cwd: '/project', status: { type: 'active' } } };
            throw new Error(`Unexpected method: ${method}`);
        });
    });
    it('finds the loaded thread without resuming, changing settings or acquiring another writer', async () => {
        expect(await findLoadedCodexEndpoint('/codex-home', 'thread', '/project'))
            .toBe('unix:///codex-home/app-server-control/app-server-control.sock');
        expect(native.request.mock.calls.map(([method]) => method)).toEqual(['thread/loaded/list', 'thread/read']);
        expect(native.disconnect).toHaveBeenCalledTimes(1);
    });
    it('does not load a stored but currently unloaded thread', async () => {
        native.request.mockResolvedValue({ data: [], nextCursor: null });
        expect(await findLoadedCodexEndpoint('/codex-home', 'thread', '/project')).toBeUndefined();
        expect(native.request).toHaveBeenCalledTimes(1);
    });
    it('checks later pages of loaded threads', async () => {
        native.request.mockResolvedValueOnce({ data: ['other'], nextCursor: 'page-2' })
            .mockResolvedValueOnce({ data: ['thread'], nextCursor: null })
            .mockResolvedValueOnce({ thread: { id: 'thread', cwd: '/project', status: { type: 'idle' } } });
        expect(await findLoadedCodexEndpoint('/codex-home', 'thread', '/project')).toContain('unix://');
    });
    it('rejects a different working directory without changing it', async () => {
        expect(await findLoadedCodexEndpoint('/codex-home', 'thread', '/other-project')).toBeUndefined();
    });
    it('leaves the existing launch path available if no local socket exists', async () => {
        native.stat.mockRejectedValue(new Error('ENOENT'));
        expect(await findLoadedCodexEndpoint('/codex-home', 'thread', '/project')).toBeUndefined();
        expect(native.connect).not.toHaveBeenCalled();
    });
    it('rejects a socket belonging to another user', async () => {
        native.stat.mockResolvedValue({ isSocket: () => true, uid: -1 });
        expect(await findLoadedCodexEndpoint('/codex-home', 'thread', '/project')).toBeUndefined();
        expect(native.connect).not.toHaveBeenCalled();
    });
    it('disconnects cleanly when native discovery fails', async () => {
        native.request.mockRejectedValue(new Error('unsupported'));
        expect(await findLoadedCodexEndpoint('/codex-home', 'thread', '/project')).toBeUndefined();
        expect(native.disconnect).toHaveBeenCalledTimes(1);
    });
    it('bounds discovery time and disconnects an unresponsive server', async () => {
        vi.useFakeTimers();
        native.initialize.mockImplementationOnce(() => new Promise(() => {}));
        const pending = findLoadedCodexEndpoint('/codex-home', 'thread', '/project');
        await vi.advanceTimersByTimeAsync(3000);
        expect(await pending).toBeUndefined();
        expect(native.disconnect).toHaveBeenCalledOnce();
        expect(native.request).not.toHaveBeenCalled();
    });

});
