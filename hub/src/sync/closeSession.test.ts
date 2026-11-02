import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'
import { RpcTargetMissingError } from './rpcGateway'
import { createSessionsRoutes } from '../web/routes/sessions'
import type { WebAppEnv } from '../web/middleware/auth'

describe('close session without archiving', () => {
    let store: Store
    let engine: SyncEngine
    let sessionId: string
    let siblingId: string
    let close: ReturnType<typeof mock>
    let archive: ReturnType<typeof mock>
    const cache = () => (engine as any).sessionCache

    beforeEach(() => {
        store = new Store(':memory:')
        engine = new SyncEngine(store, {} as never, new RpcRegistry(), { broadcast() {} } as never)
        const create = (tag: string) => {
            const session = cache().getOrCreateSession(tag, { flavor: 'codex', path: '/project', host: 'runner' }, {}, 'default')
            cache().markSessionActive(session.id)
            return session.id
        }
        sessionId = create('chosen'); siblingId = create('sibling')
        store.messages.addMessage(sessionId, { role: 'user', content: { type: 'text', text: 'keep history' } })
        close = mock(async (id: string) => {
            const session = engine.getSession(id)!
            store.sessions.updateSessionMetadata(id, { ...session.metadata, lifecycleState: 'closed' }, session.metadataVersion, 'default')
            cache().refreshSession(id)
            engine.handleSessionEnd({ sid: id, time: Date.now(), reason: 'terminated' })
        })
        archive = mock(async () => {})
        ;(engine as any).rpcGateway.closeSession = close
        ;(engine as any).rpcGateway.killSession = archive
        ;(engine as any).rpcGateway.stopRunnerSession = archive
    })
    afterEach(() => { engine.stop(); store.close() })

    function app(namespace = 'default') {
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => { c.set('namespace', namespace); await next() })
        app.route('/', createSessionsRoutes(() => engine))
        return app
    }

    it('closes exactly the selected session through its dedicated RPC and retains its history', async () => {
        const response = await app().request(`/sessions/${sessionId}/close`, { method: 'POST' })
        expect(response.status).toBe(200)
        expect(close).toHaveBeenCalledWith(sessionId)
        expect(archive).not.toHaveBeenCalled()
        expect(engine.getSession(sessionId)?.active).toBe(false)
        expect(engine.getSession(sessionId)?.metadata?.lifecycleState).toBe('closed')
        expect(engine.getSession(siblingId)?.active).toBe(true)
        expect(store.messages.getAllMessages(sessionId)).toHaveLength(1)
    })

    it('does not substitute archive or machine tree-kill when an old Runner lacks close support', async () => {
        close.mockImplementation(async () => { throw new RpcTargetMissingError('closeSession', 'handler-not-registered') })
        const response = await app().request(`/sessions/${sessionId}/close`, { method: 'POST' })
        expect(response.status).toBe(409)
        expect(await response.json()).toMatchObject({ code: 'close_unsupported' })
        expect(engine.getSession(sessionId)?.active).toBe(true)
        expect(archive).not.toHaveBeenCalled()
    })

    it('rejects another namespace before invoking the session RPC', async () => {
        const response = await app('other').request(`/sessions/${sessionId}/close`, { method: 'POST' })
        expect([403, 404]).toContain(response.status)
        expect(close).not.toHaveBeenCalled()
    })

    it('waits for closed metadata arriving after session-end', async () => {
        close.mockImplementation(async (id: string) => {
            engine.handleSessionEnd({ sid: id, time: Date.now(), reason: 'terminated' })
            setTimeout(() => {
                const session = engine.getSession(id)!
                store.sessions.updateSessionMetadata(id, { ...session.metadata, lifecycleState: 'closed' }, session.metadataVersion, 'default')
                cache().refreshSession(id)
            }, 30)
        })
        const response = await app().request(`/sessions/${sessionId}/close`, { method: 'POST' })
        expect(response.status).toBe(200)
        expect(engine.getSession(sessionId)?.metadata?.lifecycleState).toBe('closed')
    })

    it('does not claim success for an acknowledged request without confirmed closure', async () => {
        close.mockImplementation(async () => {})
        ;(engine as any).waitForSessionInactive = async () => false
        const response = await app().request(`/sessions/${sessionId}/close`, { method: 'POST' })
        expect(response.status).toBe(504)
        expect(engine.getSession(sessionId)?.active).toBe(true)
        expect(archive).not.toHaveBeenCalled()
    })
})
