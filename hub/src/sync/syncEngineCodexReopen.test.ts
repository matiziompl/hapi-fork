import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'
import type { SessionCache } from './sessionCache'
import { Hono } from 'hono'
import type { WebAppEnv } from '../web/middleware/auth'
import { createSessionsRoutes } from '../web/routes/sessions'

describe('Codex reopen with an existing thread owner', () => {
    let store: Store
    let engine: SyncEngine
    let cache: SessionCache
    let spawn: ReturnType<typeof mock>

    function session(tag: string, overrides: Record<string, unknown> = {}, namespace = 'default') {
        return cache.getOrCreateSession(tag, {
            path: '/workspace/project', host: 'runner', machineId: 'machine-1',
            flavor: 'codex', codexSessionId: 'thread-1', ...overrides,
        }, { startingMode: 'remote' }, namespace)
    }

    beforeEach(() => {
        store = new Store(':memory:')
        engine = new SyncEngine(store, {} as never, new RpcRegistry(), { broadcast() {} } as never)
        cache = (engine as unknown as { sessionCache: SessionCache }).sessionCache
        ;(engine as any).machineCache.getOnlineMachinesByNamespace = () => [
            { id: 'machine-1', metadata: { host: 'runner' } },
        ]
        spawn = mock(async () => ({ type: 'error', message: 'test spawn refused' }))
        ;(engine as any).rpcGateway.spawnSession = spawn
    })
    afterEach(() => { engine.stop(); store.close() })

    it('opens the active session of the same thread without spawning or changing the archive', async () => {
        const archived = session('archived', { lifecycleState: 'archived', archivedBy: 'hub' })
        const owner = session('owner')
        cache.markSessionActive(owner.id)
        expect(await engine.reopenSession(archived.id, 'default')).toMatchObject({
            type: 'success', sessionId: owner.id,
        })
        expect(spawn).not.toHaveBeenCalled()
        expect(cache.getSession(archived.id)?.metadata?.lifecycleState).toBe('archived')
        expect(cache.getSession(owner.id)?.active).toBe(true)
    })

    it.each([
        ['another namespace', {}, 'other'],
        ['another machine', { machineId: 'machine-2' }, 'default'],
        ['another thread', { codexSessionId: 'thread-2' }, 'default'],
        ['another directory', { path: '/workspace/other' }, 'default'],
        ['another agent', { flavor: 'claude' }, 'default'],
    ])('does not redirect to %s', async (_label, metadata, namespace) => {
        const archived = session('archived', { lifecycleState: 'archived' })
        const unrelated = session('unrelated', metadata, namespace)
        cache.markSessionActive(unrelated.id)
        expect(await engine.reopenSession(archived.id, 'default')).toMatchObject({ type: 'error' })
        expect(spawn).toHaveBeenCalledTimes(1)
    })

    it('refuses an ambiguous active thread instead of choosing a conversation or spawning', async () => {
        const archived = session('archived', { lifecycleState: 'archived' })
        for (const tag of ['owner-1', 'owner-2']) cache.markSessionActive(session(tag).id)
        expect(await engine.reopenSession(archived.id, 'default')).toMatchObject({
            type: 'error', code: 'resume_unavailable',
        })
        expect(spawn).not.toHaveBeenCalled()
    })

    it('handles an owner becoming active during spawn without bypassing the runtime lock', async () => {
        const archived = session('archived', { lifecycleState: 'archived' })
        const owner = session('owner')
        spawn.mockImplementation(async () => {
            cache.markSessionActive(owner.id)
            return { type: 'error', message: `Thread belongs to another Codex runtime. Use hapi resume ${owner.id}.` }
        })
        expect(await engine.reopenSession(archived.id, 'default')).toMatchObject({
            type: 'success', sessionId: owner.id,
        })
        expect(cache.getSession(archived.id)?.metadata?.lifecycleState).toBe('archived')
    })

    it('reports unavailable if the runtime owner is not an accessible active session', async () => {
        const archived = session('archived', { lifecycleState: 'archived' })
        spawn.mockImplementation(async () => ({
            type: 'error', message: 'Thread belongs to another Codex runtime. Use hapi resume unknown-owner.',
        }))
        expect(await engine.reopenSession(archived.id, 'default')).toMatchObject({
            type: 'error', code: 'resume_unavailable',
        })
        expect(cache.getSession(archived.id)?.metadata?.lifecycleState).toBe('archived')
    })

    it('returns HTTP 409 for unavailable ownership through the real in-memory API', async () => {
        const archived = session('archived', { lifecycleState: 'archived' })
        spawn.mockImplementation(async () => ({
            type: 'error', message: 'Thread belongs to another Codex runtime. Use hapi resume unknown-owner.',
        }))
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => { c.set('namespace', 'default'); await next() })
        app.route('/', createSessionsRoutes(() => engine))
        const response = await app.request(`/sessions/${archived.id}/reopen`, { method: 'POST' })
        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({ code: 'resume_unavailable' })
    })
    it('reports the native active-writer refusal as HTTP 409', async () => {
        const archived = session('archived', { lifecycleState: 'archived' })
        spawn.mockImplementation(async () => ({
            type: 'error', message: 'Session process exited before webhook. stderr: Error: thread thread-1 already has an active writer',
        }))
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => { c.set('namespace', 'default'); await next() })
        app.route('/', createSessionsRoutes(() => engine))
        const response = await app.request(`/sessions/${archived.id}/reopen`, { method: 'POST' })
        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({ code: 'resume_unavailable' })
        expect(cache.getSession(archived.id)?.metadata?.lifecycleState).toBe('archived')
    })
    it('does not classify a different native thread failure as this session ownership', async () => {
        const archived = session('archived', { lifecycleState: 'archived' })
        spawn.mockImplementation(async () => ({
            type: 'error', message: 'thread another-thread already has an active writer',
        }))
        expect(await engine.reopenSession(archived.id, 'default')).toMatchObject({ code: 'resume_failed' })
    })
    it('redirects a writer-conflict race only to a matching accessible active session', async () => {
        const archived = session('archived', { lifecycleState: 'archived' })
        const owner = session('owner')
        spawn.mockImplementation(async () => {
            cache.markSessionActive(owner.id)
            return { type: 'error', message: 'thread thread-1 already has an active writer' }
        })
        expect(await engine.reopenSession(archived.id, 'default')).toMatchObject({ type: 'success', sessionId: owner.id })
        expect(cache.getSession(archived.id)?.metadata?.lifecycleState).toBe('archived')
    })

})
