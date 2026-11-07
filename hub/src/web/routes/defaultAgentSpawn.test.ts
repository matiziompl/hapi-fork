import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { MACHINE_CAPABILITIES } from '@hapi/protocol'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { readPromptProfile } from '../../config/promptProfiles'
import { createMachinesRoutes } from './machines'

const directories: string[] = []
afterEach(async () => {
    await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function setup(options: { discoveryFails?: boolean } = {}) {
    const dataDir = await mkdtemp(join(tmpdir(), 'hapi-default-spawn-'))
    directories.push(dataDir)
    const calls: string[] = []
    let launches = 0
    const engine = {
        getMachine: () => ({ id: 'm1', namespace: 'default', active: true, metadata: { capabilities: [MACHINE_CAPABILITIES.AgentAvailability] } }),
        listAgentProfilesForMachine: async (machineId: string, flavor: string, cwd: string) => {
            calls.push('catalog')
            expect({ machineId, flavor, cwd }).toEqual({ machineId: 'm1', flavor: 'codex', cwd: '/project' })
            if (options.discoveryFails) throw new Error('Runner offline')
            return { agents: [{ id: 'reviewer', name: 'Reviewer', description: 'Review changes', source: 'project', instruction: 'Find regressions.' }] }
        },
        spawnSession: async (...args: unknown[]) => {
            calls.push('spawn')
            const prepare = args.at(-1)
            if (typeof prepare === 'function') await prepare('new-session')
            // The real engine runs preparation before dispatching Runner RPC.
            launches += 1
            return { type: 'success', sessionId: 'new-session' }
        },
    } as unknown as SyncEngine
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => { c.set('namespace', c.req.header('x-test-namespace') ?? 'default'); await next() })
    app.route('/api', createMachinesRoutes(() => engine, dataDir))
    const request = (body: unknown, namespace = 'default') => app.request('/api/machines/m1/spawn', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-namespace': namespace },
        body: JSON.stringify(body),
    })
    return { request, dataDir, calls, launches: () => launches }
}

test('creating a conversation validates and stores its default before Runner dispatch', async () => {
    const { request, dataDir, calls, launches } = await setup()
    const response = await request({ directory: '/project', agent: 'codex', defaultAgentId: 'reviewer' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ type: 'success', sessionId: 'new-session' })
    expect(calls).toEqual(['catalog', 'spawn'])
    expect(launches()).toBe(1)
    const selection = await readPromptProfile(dataDir, 'default', 'new-session')
    expect(selection.defaultAgent?.id).toBe('reviewer')
    expect(selection.agent?.id).toBe('reviewer')
    expect((await readPromptProfile(dataDir, 'other', 'new-session')).defaultAgent).toBeNull()
})

test('invalid, missing or unauthorized defaults never dispatch a new conversation', async () => {
    const { request, calls, launches } = await setup()
    for (const defaultAgentId of ['', null, 'invented']) {
        const response = await request({ directory: '/project', agent: 'codex', defaultAgentId })
        expect(response.status).toBe(400)
    }
    expect((await request({ directory: '/project', agent: 'codex', defaultAgentId: 'reviewer' }, 'denied')).status).toBe(403)
    expect(launches()).toBe(0)
    expect(calls).toEqual(['catalog'])
})

test('profile discovery failure prevents launch and creating without a default remains compatible', async () => {
    const failing = await setup({ discoveryFails: true })
    const failed = await failing.request({ directory: '/project', agent: 'codex', defaultAgentId: 'reviewer' })
    expect(failed.status).toBeGreaterThanOrEqual(400)
    expect(failing.launches()).toBe(0)
    const normal = await setup()
    const response = await normal.request({ directory: '/project', agent: 'codex' })
    expect(response.status).toBe(200)
    expect(normal.calls).toEqual(['spawn'])
    expect(normal.launches()).toBe(1)
    expect((await readPromptProfile(normal.dataDir, 'default', 'new-session')).defaultAgent).toBeNull()
})
