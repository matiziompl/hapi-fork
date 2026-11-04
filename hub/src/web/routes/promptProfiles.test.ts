import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { createPromptProfilesRoutes } from './promptProfiles'
import { copyPromptProfileSelection, getPromptProfilePrefix, readPromptProfile } from '../../config/promptProfiles'
import { createMessagesRoutes } from './messages'
import { readSettingsOrThrow, getSettingsFile, updateSettings } from '../../config/settings'

const directories: string[] = []
afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function setup() {
    const dataDir = await mkdtemp(join(tmpdir(), 'hapi-personas-'))
    directories.push(dataDir)
    const sent: Array<{ text: string; promptPrefix?: string }> = []
    const engine = {
        resolveSessionAccess: (id: string, namespace: string) => namespace === 'denied'
            ? { ok: false, reason: 'access-denied' }
            : { ok: true, sessionId: id, session: { id, active: true, metadata: { flavor: 'codex', path: '/project' } } },
        listAgentProfiles: async (_id: string, flavor: string, cwd: string) => {
            expect(flavor).toBe('codex')
            expect(cwd).toBe('/project')
            return { agents: [{ id: 'reviewer', name: 'reviewer', description: 'Review changes', source: 'project', instruction: 'Find regressions.' }] }
        },
        sendMessage: async (_id: string, payload: { text: string; promptPrefix?: string }) => { sent.push(payload) },
    } as unknown as SyncEngine
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', c.req.header('x-test-namespace') ?? 'default')
        await next()
    })
    app.route('/api', createPromptProfilesRoutes(() => engine, dataDir))
    app.route('/api', createMessagesRoutes(() => engine, dataDir))
    const request = (path: string, body?: unknown, namespace = 'default', method = 'POST') => app.request(`/api${path}`, {
        method: body === undefined ? 'GET' : method,
        headers: { 'content-type': 'application/json', 'x-test-namespace': namespace },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { app, request, dataDir, sent }
}

test('personas persist in the Hub, remain namespace-scoped, and selection is per session', async () => {
    const { request, dataDir } = await setup()
    await updateSettings(getSettingsFile(dataDir), settings => ({ settings: { ...settings, listenPort: 1234 }, result: undefined }))
    const created = await request('/personas', { name: '  Reviewer  ', description: '  Find regressions.  ' })
    expect(created.status).toBe(201)
    const { persona } = await created.json() as { persona: { id: string; name: string; description: string } }
    expect(persona.name).toBe('Reviewer')
    expect(persona.description).toBe('Find regressions.')
    expect((await request('/sessions/s1/prompt-profile', { personaId: persona.id }, 'default', 'PUT')).status).toBe(200)
    expect((await readPromptProfile(dataDir, 'default', 's1')).personaId).toBe(persona.id)
    expect((await readPromptProfile(dataDir, 'default', 's2')).personaId).toBeNull()
    await copyPromptProfileSelection(dataDir, 'default', 's1', 'resumed')
    expect((await readPromptProfile(dataDir, 'default', 'resumed')).personaId).toBe(persona.id)
    const other = await (await request('/sessions/s1/prompt-profile', undefined, 'other')).json() as { personas: unknown[] }
    expect(other.personas).toEqual([])
    expect((await request('/sessions/s1/prompt-profile', { personaId: persona.id }, 'other', 'PUT')).status).toBe(400)
    expect((await readSettingsOrThrow(getSettingsFile(dataDir))).listenPort).toBe(1234)
    expect((await request('/sessions/s1/prompt-profile', { personaId: null }, 'default', 'PUT')).status).toBe(200)
    expect((await readPromptProfile(dataDir, 'default', 's1')).personaId).toBeNull()
})

test('rejects invalid or duplicate personas and unauthorized session selection', async () => {
    const { request } = await setup()
    for (const body of [{ name: '', description: 'x' }, { name: 'x', description: ' ' }, { name: 'x', description: 'a'.repeat(20001) }]) {
        expect((await request('/personas', body)).status).toBe(400)
    }
    expect((await request('/personas', { name: 'Reviewer', description: 'one' })).status).toBe(201)
    expect((await request('/personas', { name: 'reviewer', description: 'two' })).status).toBe(409)
    expect((await request('/sessions/s1/prompt-profile', undefined, 'denied')).status).toBe(403)
    expect((await request('/sessions/s1/prompt-profile', { personaId: null }, 'denied', 'PUT')).status).toBe(403)
})

test('lists real agent summaries, validates selection and prepends agent plus persona only to ordinary prompts', async () => {
    const { request, dataDir, sent } = await setup()
    const catalog = await (await request('/sessions/s1/agent-profiles')).json() as { agents: Array<Record<string, unknown>> }
    expect(catalog.agents[0]!.name).toBe('reviewer')
    expect(catalog.agents[0]).not.toHaveProperty('instruction')
    expect((await request('/sessions/s1/prompt-profile', { agentId: 'invented' }, 'default', 'PUT')).status).toBe(400)
    expect((await request('/sessions/s1/prompt-profile', { agentId: 'reviewer' }, 'default', 'PUT')).status).toBe(200)
    const { persona } = await (await request('/personas', { name: 'Concise', description: 'Keep answers short.' })).json() as { persona: { id: string } }
    await request('/sessions/s1/prompt-profile', { personaId: persona.id }, 'default', 'PUT')
    await request('/sessions/s1/messages', { text: 'My prompt', localId: 'l1' })
    expect(sent[0]!.text).toBe('My prompt')
    expect(sent[0]!.promptPrefix).toBe('Find regressions.\n\nPersona: Concise\nKeep answers short.\n\n')
    await request('/sessions/s1/messages', { text: '/compact', localId: 'l2' })
    expect(sent[1]).not.toHaveProperty('promptPrefix')
    await request('/sessions/s1/messages', { text: '/plugin:command argument', localId: 'l3' })
    expect(sent[2]).not.toHaveProperty('promptPrefix')
    expect((await request('/sessions/s1/agent-profiles', undefined, 'denied')).status).toBe(403)
    await request('/sessions/s1/prompt-profile', { agentId: null }, 'default', 'PUT')
    expect(await getPromptProfilePrefix(dataDir, 'default', 's1')).toBe('Persona: Concise\nKeep answers short.\n\n')
})
