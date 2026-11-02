import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexRuntimeRecord } from '@/codex/shared/registry'
import type { startRunnerControlServer } from './controlServer'
import type { Metadata } from '@/api/types'

const mocks = vi.hoisted(() => ({
    controlServer: vi.fn(),
    readRuntimes: vi.fn(),
    findRuntime: vi.fn(),
    reapOrphans: vi.fn<typeof import('./orphanReap')['reapRunnerSpawnedOrphans']>(),
    kill: vi.fn(),
    spawn: vi.fn(),
}))

vi.mock('./controlServer', () => ({ startRunnerControlServer: mocks.controlServer }))
vi.mock('@/utils/spawnHappyCLI', () => ({ spawnHappyCLI: mocks.spawn }))
vi.mock('@/agent/agentAvailability', () => ({ getAgentAvailability: () => ({ available: true }) }))
vi.mock('./controlClient', () => ({
    isRunnerRunningCurrentlyInstalledHappyVersion: async () => false,
    stopRunner: async () => {},
}))
vi.mock('@/persistence', async importOriginal => ({
    ...await importOriginal<typeof import('@/persistence')>(),
    acquireRunnerLock: async () => ({}),
}))
vi.mock('@/ui/auth', () => ({ authAndSetupMachineIfNeeded: async () => ({ machineId: 'machine' }) }))
vi.mock('@/ui/logger', () => ({ logger: { debug: vi.fn(), debugLargeJson: vi.fn(), warn: vi.fn() } }))
vi.mock('@/ui/doctor', () => ({ getEnvironmentInfo: () => ({}) }))
vi.mock('@/codex/shared/registry', () => ({
    readRuntimes: mocks.readRuntimes,
    findRuntime: mocks.findRuntime,
    runtimeAuthHash: () => 'test-auth',
    runtimeMayBeAlive: () => true,
}))
vi.mock('@/runner/orphanReap', () => ({
    reapRunnerSpawnedOrphans: mocks.reapOrphans,
    findStopSessionOrphanTargets: vi.fn(),
}))
vi.mock('@/utils/process', async importOriginal => ({
    ...await importOriginal<typeof import('@/utils/process')>(),
    isWindows: () => false,
    isProcessAlive: () => true,
    getProcessStartMarker: () => 'generation',
    getProcessThreadGroupId: () => null,
    killProcess: mocks.kill,
    killProcessTreeByPid: mocks.kill,
    killProcessByChildProcess: mocks.kill,
}))

import { configuration } from '@/configuration'
import { startRunner } from './run'

describe('runner stop confirmation after shared Codex tracking loss', () => {
    let stopSession: Parameters<typeof startRunnerControlServer>[0]['stopSession']
    let record: CodexRuntimeRecord
    let home: string
    let handlers: Parameters<typeof startRunnerControlServer>[0]

    async function captureRunner(stateFile = join(home, 'runner.json')) {
        const originalStateFile = configuration.runnerStateFile
        const captured = new Error('control handlers captured before runner networking')
        mocks.controlServer.mockImplementation(async capturedHandlers => {
            handlers = capturedHandlers
            stopSession = handlers.stopSession
            throw captured
        })
        // Stop startup at control-server registration. Exercise its real closure
        // without installing process handlers, taking a lock, or connecting a hub.
        vi.spyOn(process, 'on').mockReturnValue(process)
        vi.spyOn(process, 'exit').mockImplementation(() => { throw captured })
        vi.stubEnv('HAPI_RUNNER_HANDOFF_FROM_PID', '')
        Object.defineProperty(configuration, 'runnerStateFile', { value: stateFile, configurable: true })
        try {
            await expect(startRunner()).rejects.toBe(captured)
            expect(stopSession!).toBeTypeOf('function')
        } finally {
            Object.defineProperty(configuration, 'runnerStateFile', { value: originalStateFile, configurable: true })
            vi.restoreAllMocks()
            vi.unstubAllEnvs()
        }
    }

    beforeAll(async () => {
        home = mkdtempSync(join(tmpdir(), 'hapi-stop-confirm-'))
        await captureRunner()
    })

    afterAll(() => rmSync(home, { recursive: true, force: true }))

    beforeEach(() => {
        vi.clearAllMocks()
        record = {
            id: 'runtime', pid: 42, marker: 'generation', endpoint: 'unused',
            command: 'codex', args: [], codexHome: home,
            hub: configuration.apiUrl, authHash: 'test-auth',
            sessions: { target: { threadId: 'thread', namespace: 'test', active: false } },
        }
        mocks.readRuntimes.mockResolvedValue([record])
        mocks.findRuntime.mockResolvedValue(undefined)
        mocks.reapOrphans.mockResolvedValue(null)
    })

    it('confirms the last inactive root without tracking or an exit tombstone', async () => {
        await expect(stopSession('target')).resolves.toBe('stopped')
        expect(mocks.reapOrphans).toHaveBeenCalledWith('target', expect.any(Object))
        expect(mocks.kill).not.toHaveBeenCalled()
    })

    it('also confirms an inactive root while preserving a live sibling', async () => {
        record.sessions.sibling = { threadId: 'other', namespace: 'test', active: true }
        await expect(stopSession('target')).resolves.toBe('stopped')
        expect(mocks.kill).not.toHaveBeenCalled()
    })

    it('does not treat an active root as stopped when runtime control is unavailable', async () => {
        record.sessions.target.active = true
        await expect(stopSession('target')).resolves.toBe('still_alive')
        expect(mocks.reapOrphans).not.toHaveBeenCalled()
    })

    it('does not infer success from an absent binding', async () => {
        record.sessions = {}
        await expect(stopSession('target')).resolves.toBe('unknown')
    })

    it('still refuses when the orphan sweep cannot establish exit', async () => {
        mocks.reapOrphans.mockResolvedValue('still_alive')
        await expect(stopSession('target')).resolves.toBe('still_alive')
    })

    it('does not use a binding from another hub or auth namespace', async () => {
        record.hub = 'another-hub'
        await expect(stopSession('target')).resolves.toBe('unknown')
        record.hub = configuration.apiUrl
        record.authHash = 'another-auth'
        await expect(stopSession('target')).resolves.toBe('unknown')
    })

    it('keeps raw PID confirmation fail-closed without a start marker', async () => {
        await expect(stopSession('PID-42')).resolves.toBe('unknown')
        expect(mocks.kill).not.toHaveBeenCalled()
    })

    it.each(['closed', 'archived'])('reopens a %s shared root while its old wrapper still serves a sibling', async lifecycleState => {
        const id = `reopen-${lifecycleState}`
        const children: Array<EventEmitter & { pid: number }> = []
        const metadata = (pid: number, state = 'running'): Metadata => ({
            path: home, host: 'runner', flavor: 'codex', hostPid: pid,
            hostStartMarker: 'generation', startedBy: 'runner',
            capabilities: { concurrentClients: true }, lifecycleState: state,
        })
        mocks.spawn.mockImplementation(() => {
            const child = Object.assign(new EventEmitter(), { pid: 41_000 + children.length })
            children.push(child)
            setImmediate(() => handlers.onHappySessionWebhook(id, metadata(child.pid)))
            return child
        })
        const options = { directory: home, agent: 'codex' as const, existingSessionId: id }
        expect(await handlers.spawnSession(options)).toEqual({ type: 'success', sessionId: id })
        const original = children[0]
        handlers.onHappySessionWebhook(`${id}-sibling`, metadata(original.pid))
        handlers.onHappySessionWebhook(`${id}-finished-sibling`, metadata(original.pid))
        handlers.onHappySessionWebhook(`${id}-finished-sibling`, metadata(original.pid, lifecycleState))
        await handlers.spawnSession(options)
        expect(children).toHaveLength(1)
        handlers.onHappySessionWebhook(id, { ...metadata(original.pid, lifecycleState), hostStartMarker: 'stale-generation' })
        expect(handlers.getChildren().find(child => child.happySessionId === id)?.pid).toBe(original.pid)
        handlers.onHappySessionWebhook(id, metadata(original.pid, lifecycleState))
        expect(handlers.getChildren().find(child => child.happySessionId === `${id}-sibling`)?.pid).toBe(original.pid)

        expect(await handlers.spawnSession(options)).toEqual({ type: 'success', sessionId: id })
        expect(children).toHaveLength(2)
        expect(handlers.getChildren().find(child => child.happySessionId === id)?.pid).toBe(children[1].pid)
        const persisted = JSON.parse(readFileSync(join(home, 'runner.json.resume-processes.json'), 'utf8'))
        expect(persisted.filter((row: { requestedSessionId: string }) => row.requestedSessionId === id))
            .toEqual([expect.objectContaining({ pid: children[1].pid })])

        // Late closure/exit of the old generation cannot release the new spawn.
        handlers.onHappySessionWebhook(id, metadata(original.pid, lifecycleState))
        original.emit('exit', 0, null)
        expect(await handlers.spawnSession(options)).toEqual({ type: 'success', sessionId: id })
        expect(children).toHaveLength(2)
        expect(JSON.parse(readFileSync(join(home, 'runner.json.verified-exits.json'), 'utf8'))).not.toContain(id)
        expect(mocks.kill).not.toHaveBeenCalled()
    })

    it.each(['inactive', 'active', 'absent', 'pending', 'other-hub', 'other-auth', 'other-generation', 'unreadable'])(
        'recovers a persisted shared spawn with %s ownership evidence', async evidence => {
            const stateFile = join(home, `recovery-${evidence}.json`)
            writeFileSync(`${stateFile}.resume-processes.json`, JSON.stringify([{
                requestedSessionId: 'target', confirmedSessionId: 'target',
                pid: 42, processStartMarker: 'generation',
            }]))
            record.sessions.sibling = { threadId: 'other', namespace: 'test', active: true }
            if (evidence === 'active') record.sessions.target.active = true
            if (evidence === 'absent') delete record.sessions.target
            if (evidence === 'pending') record.pendingCreations = ['target']
            if (evidence === 'other-hub') record.hub = 'another-hub'
            if (evidence === 'other-auth') record.authHash = 'another-auth'
            if (evidence === 'other-generation') record.marker = 'another-generation'
            if (evidence === 'unreadable') mocks.readRuntimes.mockRejectedValue(new Error('unreadable registry'))
            await captureRunner(stateFile)
            if (evidence === 'inactive') {
                handlers.onHappySessionWebhook('target', {
                    path: home, host: 'runner', flavor: 'codex', hostPid: 42,
                    hostStartMarker: 'generation', startedBy: 'runner',
                    capabilities: { concurrentClients: true }, lifecycleState: 'closed',
                })
                expect(handlers.getChildren()).toHaveLength(0)
            }
            mocks.spawn.mockImplementation(() => {
                const child = Object.assign(new EventEmitter(), { pid: 43 })
                setImmediate(() => handlers.onHappySessionWebhook('target', {
                    path: home, host: 'runner', flavor: 'codex', hostPid: 43,
                    hostStartMarker: 'generation', startedBy: 'runner',
                    capabilities: { concurrentClients: true }, lifecycleState: 'running',
                }))
                return child
            })
            expect(await handlers.spawnSession({ directory: home, agent: 'codex', existingSessionId: 'target' }))
                .toEqual({ type: 'success', sessionId: 'target' })
            if (evidence === 'inactive') {
                expect(handlers.getChildren().find(child => child.happySessionId === 'target')?.pid).toBe(43)
                const persisted = JSON.parse(readFileSync(`${stateFile}.resume-processes.json`, 'utf8'))
                expect(persisted).toEqual([expect.objectContaining({ pid: 43 })])
            } else {
                expect(mocks.spawn).not.toHaveBeenCalled()
            }
            expect(mocks.kill).not.toHaveBeenCalled()
        }
    )
})
