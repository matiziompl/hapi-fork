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
    let active = true
    const agents = [
        { id: 'reviewer', name: 'reviewer', description: 'Review changes', source: 'project', instruction: 'Find regressions.' },
        { id: 'writer', name: 'writer', description: 'Write changes', source: 'user', instruction: 'Write clearly.' },
    ]
    const machineQueries: Array<{ machineId: string; flavor: string; cwd: string }> = []
    const engine = {
        resolveSessionAccess: (id: string, namespace: string) => namespace === 'denied'
            ? { ok: false, reason: 'access-denied' }
            : { ok: true, sessionId: id, session: { id, active, metadata: { flavor: 'codex', path: '/project' } } },
        listAgentProfiles: async (_id: string, flavor: string, cwd: string) => {
            expect(flavor).toBe('codex')
            expect(cwd).toBe('/project')
            return { agents }
        },
        getMachine: (id: string) => id === 'missing' ? undefined : { id, namespace: 'default', active: true },
        listAgentProfilesForMachine: async (machineId: string, flavor: string, cwd: string) => {
            machineQueries.push({ machineId, flavor, cwd })
            return { agents, warning: 'A definition was skipped.' }
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
    return { app, request, dataDir, sent, machineQueries, setActive: (value: boolean) => { active = value } }
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

test('conversation default survives active changes and resume, and restores its saved instructions while inactive', async () => {
    const { request, dataDir, setActive } = await setup()
    const select = (body: unknown) => request('/sessions/s1/prompt-profile', body, 'default', 'PUT')
    expect((await select({ defaultAgentId: 'reviewer' })).status).toBe(200)
    let state = await readPromptProfile(dataDir, 'default', 's1')
    expect(state.defaultAgent?.id).toBe('reviewer')
    expect(state.agent?.id).toBe('reviewer')
    expect((await select({ agentId: 'writer' })).status).toBe(200)
    state = await readPromptProfile(dataDir, 'default', 's1')
    expect(state.defaultAgent?.id).toBe('reviewer')
    expect(state.agent?.id).toBe('writer')
    expect((await readPromptProfile(dataDir, 'default', 's2')).defaultAgent).toBeNull()
    expect((await readPromptProfile(dataDir, 'other', 's1')).defaultAgent).toBeNull()
    await copyPromptProfileSelection(dataDir, 'default', 's1', 'resumed')
    expect((await readPromptProfile(dataDir, 'default', 'resumed')).defaultAgent?.id).toBe('reviewer')
    expect((await readPromptProfile(dataDir, 'default', 'resumed')).agent?.id).toBe('writer')
    setActive(false)
    expect((await select({ useDefaultAgent: true })).status).toBe(200)
    expect(await getPromptProfilePrefix(dataDir, 'default', 's1')).toBe('Find regressions.\n\n')
    expect((await select({ defaultAgentId: null })).status).toBe(200)
    state = await readPromptProfile(dataDir, 'default', 's1')
    expect(state.defaultAgent).toBeNull()
    expect(state.agent?.id).toBe('reviewer')
    expect((await select({ useDefaultAgent: true })).status).toBe(200)
    expect((await readPromptProfile(dataDir, 'default', 's1')).agent).toBeNull()
})

test('default selection rejects missing profiles, inactive discovery, unauthorized writes and ambiguous changes', async () => {
    const { request, dataDir, setActive } = await setup()
    const select = (body: unknown, namespace = 'default') => request('/sessions/s1/prompt-profile', body, namespace, 'PUT')
    for (const body of [
        { defaultAgentId: 'invented' }, { defaultAgentId: '' }, { useDefaultAgent: false },
        { defaultAgentId: 'reviewer', agentId: 'writer' },
        { useDefaultAgent: true, agentId: 'writer' },
        { useDefaultAgent: true, defaultAgentId: 'reviewer' },
    ]) expect((await select(body)).status).toBe(400)
    expect((await select({ defaultAgentId: 'reviewer' }, 'denied')).status).toBe(403)
    expect((await readPromptProfile(dataDir, 'default', 's1')).defaultAgent).toBeNull()
    setActive(false)
    expect((await select({ defaultAgentId: 'reviewer' })).status).toBe(409)
})

test('machine catalog is available before session creation with namespace authorization and no instructions exposed', async () => {
    const { request, machineQueries } = await setup()
    const response = await request('/machines/m1/agent-profiles?flavor=codex&cwd=%2Fproject')
    expect(response.status).toBe(200)
    const catalog = await response.json() as { agents: Array<Record<string, unknown>>; warning?: string }
    expect(catalog.agents.map(agent => agent.id)).toEqual(['reviewer', 'writer'])
    expect(catalog.agents[0]).not.toHaveProperty('instruction')
    expect(catalog.warning).toBe('A definition was skipped.')
    expect(machineQueries).toEqual([{ machineId: 'm1', flavor: 'codex', cwd: '/project' }])
    expect((await request('/machines/m1/agent-profiles?flavor=codex&cwd=%2Fproject', undefined, 'denied')).status).toBe(403)
    expect((await request('/machines/missing/agent-profiles?flavor=codex&cwd=%2Fproject')).status).toBe(404)
    expect((await request('/machines/m1/agent-profiles?flavor=invalid&cwd=%2Fproject')).status).toBe(400)
    expect((await request('/machines/m1/agent-profiles?flavor=codex')).status).toBe(400)
    expect(machineQueries).toHaveLength(1)
})
