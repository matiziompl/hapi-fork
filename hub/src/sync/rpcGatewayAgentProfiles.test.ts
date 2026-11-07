import { expect, test } from 'bun:test'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'
import { RpcGateway } from './rpcGateway'

function setup(pathResult: object) {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    const socket = {
        timeout() {
            return {
                async emitWithAck(_event: string, payload: { method: string; params: string }) {
                    calls.push({ method: payload.method, params: JSON.parse(payload.params) })
                    if (payload.method.endsWith(':path-exists')) return JSON.stringify(pathResult)
                    return JSON.stringify({ success: true, stdout: JSON.stringify({
                        files: [{ path: '/project/.codex/agents/reviewer.toml', kind: 'toml', source: 'project', content: 'developer_instructions = "Review carefully."' }],
                        warnings: [],
                    }) })
                },
            }
        },
    }
    const io = { of: () => ({ sockets: { get: () => socket } }) } as unknown as Server
    const registry = { getSocketIdForMethod: () => 'machine-socket' } as unknown as RpcRegistry
    return { gateway: new RpcGateway(io, registry), calls }
}

test('pre-session catalog checks Runner paths before probing through machine-scoped Bash', async () => {
    const cwd = "/project/it's $(literal)"
    const { gateway, calls } = setup({ exists: { [cwd]: true } })
    const catalog = await gateway.listAgentProfilesForMachine('machine-1', 'codex', cwd)
    expect(calls.map(call => call.method)).toEqual(['machine-1:path-exists', 'machine-1:bash'])
    expect(calls[0]!.params).toEqual({ paths: [cwd] })
    expect(calls[1]!.params.timeout).toBe(10_000)
    const command = calls[1]!.params.command as string
    // The untrusted directory must remain inside the shell-quoted JSON argument.
    expect(command).toContain("it'\\''s $(literal)")
    expect(catalog.agents[0]?.id).toBe('reviewer')
    expect(catalog.agents[0]?.instruction).toContain('Review carefully.')
})

test('missing or disallowed workspaces never trigger a machine Bash probe', async () => {
    for (const pathResult of [
        { exists: { '/project': false } },
        { exists: { '/project': true }, outsideWorkspaceRoots: ['/project'] },
        { exists: {} },
    ]) {
        const { gateway, calls } = setup(pathResult)
        await expect(gateway.listAgentProfilesForMachine('machine-1', 'codex', '/project')).rejects.toThrow()
        expect(calls.map(call => call.method)).toEqual(['machine-1:path-exists'])
    }
})
