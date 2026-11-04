import { Hono } from 'hono'
import { CreatePersonaRequestSchema, UpdatePromptProfileRequestSchema } from '@hapi/protocol'
import { createPersona, PromptProfileError, readPromptProfile, updatePromptProfile } from '../../config/promptProfiles'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

export function createPromptProfilesRoutes(getSyncEngine: () => SyncEngine | null, dataDir: string): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()
    app.onError((error, c) => {
        if (error instanceof PromptProfileError) return c.json({ error: error.message }, error.status)
        console.error('Prompt profile request failed:', error)
        return c.json({ error: 'Could not load or save prompt profiles. Try again.' }, 500)
    })
    app.post('/personas', async c => {
        const parsed = CreatePersonaRequestSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'A name (1–100 characters) and description (1–20000 characters) are required' }, 400)
        const persona = await createPersona(dataDir, c.get('namespace'), parsed.data)
        return c.json({ persona }, 201)
    })
    app.get('/sessions/:id/prompt-profile', async c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const access = requireSessionFromParam(c, engine)
        if (access instanceof Response) return access
        c.header('Cache-Control', 'no-store')
        return c.json(await readPromptProfile(dataDir, c.get('namespace'), access.sessionId))
    })
    app.get('/sessions/:id/agent-profiles', async c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const access = requireSessionFromParam(c, engine, { requireActive: true })
        if (access instanceof Response) return access
        const cwd = access.session.metadata?.path
        if (!cwd) return c.json({ error: 'The session working directory is unavailable' }, 409)
        const catalog = await engine.listAgentProfiles(access.sessionId, access.session.metadata?.flavor ?? 'claude', cwd)
        c.header('Cache-Control', 'no-store')
        return c.json({ agents: catalog.agents.map(({ instruction: _instruction, ...agent }) => agent), warning: catalog.warning })
    })
    app.put('/sessions/:id/prompt-profile', async c => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const access = requireSessionFromParam(c, engine)
        if (access instanceof Response) return access
        const parsed = UpdatePromptProfileRequestSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid prompt profile selection' }, 400)
        let agent = null
        if (parsed.data.agentId) {
            if (!access.session.active || !access.session.metadata?.path) return c.json({ error: 'Resume the session before selecting a CLI agent' }, 409)
            const catalog = await engine.listAgentProfiles(access.sessionId, access.session.metadata.flavor ?? 'claude', access.session.metadata.path)
            agent = catalog.agents.find(value => value.id === parsed.data.agentId) ?? null
            if (!agent) return c.json({ error: 'Agent not found. Reload agents and choose an available profile.' }, 400)
        }
        return c.json(await updatePromptProfile(dataDir, c.get('namespace'), access.sessionId, parsed.data, agent))
    })
    return app
}
