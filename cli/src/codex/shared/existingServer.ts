import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { CodexAppServerClient } from '../codexAppServerClient';
import { initializeSharedClient } from './launch';
import { record, string } from './gateway';

/** Discover an already loaded thread, never load or take over a stored thread. */
export async function findLoadedCodexEndpoint(home: string, threadId: string, cwd: string): Promise<string | undefined> {
    if (process.platform === 'win32') return undefined;
    const socket = join(home, 'app-server-control', 'app-server-control.sock');
    const info = await stat(socket).catch(() => undefined);
    if (!info?.isSocket() || info.uid !== process.getuid?.()) return undefined;
    const endpoint = `unix://${socket}`;
    const client = new CodexAppServerClient({ endpoint, cwd });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            (async () => {
                await initializeSharedClient(client);
                let cursor: string | undefined;
                const seen = new Set<string>();
                do {
                    const page = record(await client.request('thread/loaded/list', { cursor }));
                    if (Array.isArray(page.data) && page.data.includes(threadId)) {
                        const thread = record(record(await client.request('thread/read', { threadId, includeTurns: false })).thread);
                        const status = record(thread.status).type;
                        return thread.id === threadId && typeof thread.cwd === 'string'
                            && resolve(thread.cwd) === resolve(cwd) && (status === 'active' || status === 'idle')
                            ? endpoint : undefined;
                    }
                    cursor = string(page.nextCursor);
                    if (cursor && seen.has(cursor)) return undefined;
                    if (cursor) seen.add(cursor);
                } while (cursor);
                return undefined;
            })(),
            new Promise<undefined>(resolveTimeout => { timer = setTimeout(() => resolveTimeout(undefined), 2500); }),
        ]);
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
        await client.disconnect();
    }
}
