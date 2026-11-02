import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildAgentStatusCommand } from './agentStatusProbe'
import { parseAgentQuota } from './agentStatus'

const node = Bun.which('node')!
const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function run(flavor: 'codex' | 'agy', script: string) {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-agent-status-'))
    directories.push(dir)
    writeFileSync(join(dir, flavor), `#!${node}\n${script}`, { mode: 0o700 })
    const result = spawnSync('/bin/sh', ['-c', buildAgentStatusCommand(flavor)], {
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, STATUS_TEST_LOG: join(dir, 'requests') },
        encoding: 'utf8', timeout: 5000,
    })
    expect(result.status).toBe(0)
    return { result: JSON.parse(result.stdout), dir }
}

describe('agent account status probe', () => {
    it('only initializes and reads Codex account limits; never loads a thread or starts a turn', () => {
        const { result, dir } = run('codex', `
            const fs = require('node:fs');
            require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
                const request = JSON.parse(line);
                fs.appendFileSync(process.env.STATUS_TEST_LOG, request.method + '\\n');
                if (request.method === 'initialize') console.log(JSON.stringify({ id: request.id, result: {} }));
                if (request.method === 'account/rateLimits/read') console.log(JSON.stringify({ id: request.id,
                    result: { rateLimits: { primary: { usedPercent: 20, resetsAt: 1790000000 } } } }));
            });
        `)
        expect(result.success).toBe(true)
        expect(readFileSync(join(dir, 'requests'), 'utf8').trim().split('\n')).toEqual([
            'initialize', 'initialized', 'account/rateLimits/read',
        ])
        expect(parseAgentQuota('codex', JSON.stringify(result)).limits[0].remainingPercent).toBe(80)
    })

    it('requests the native AGY usage command separately and accepts only its structured command result', () => {
        const { result, dir } = run('agy', `
            require('node:fs').writeFileSync(process.env.STATUS_TEST_LOG, JSON.stringify(process.argv.slice(2)));
            console.log(JSON.stringify({ status: 'SUCCESS', command: { name: 'usage', data: { groups: [
                { name: 'Gemini', buckets: [{ name: 'Weekly', remaining_fraction: 0.75, reset_time: '2026-11-04T13:15:13Z' }] }
            ] } } }));
        `)
        expect(JSON.parse(readFileSync(join(dir, 'requests'), 'utf8'))).toEqual([
            '--print', '/usage', '--output-format', 'json', '--print-timeout', '10s',
        ])
        expect(parseAgentQuota('agy', JSON.stringify(result)).limits[0].remainingPercent).toBe(75)
    })

    it('rejects a model response or unsupported command instead of presenting it as quota data', () => {
        const { result } = run('agy', `console.log(JSON.stringify({ status: 'SUCCESS', response: 'You have 100% left' }));`)
        expect(result.success).toBe(false)
        expect(JSON.stringify(result)).not.toContain('100%')
    })

    it('does not publish native error payloads that might contain credentials', () => {
        const { result } = run('codex', `
            process.stdin.once('data', () => console.log(JSON.stringify({ id: 1, error: { message: 'secret-token' } })));
        `)
        expect(result.success).toBe(false)
        expect(JSON.stringify(result)).not.toContain('secret-token')
    })
})

describe('account quota presentation', () => {
    it('shows each Codex bucket and window once, and never substitutes legacy limits for the multi-bucket result', () => {
        const parsed = parseAgentQuota('codex', JSON.stringify({ success: true, data: {
            rateLimits: { limitId: 'legacy', primary: { usedPercent: 90 } },
            rateLimitsByLimitId: {
                codex: { limitName: 'Codex', primary: { usedPercent: 25, windowDurationMins: 300 }, secondary: { usedPercent: 10, windowDurationMins: 10080 } },
                other: { limitName: 'Other', primary: { usedPercent: 100 } },
            }, accountId: 'private-account',
        } }))
        expect(parsed.limits.map(limit => limit.remainingPercent)).toEqual([75, 90, 0])
        const text = JSON.stringify(parsed)
        expect(text).not.toContain('legacy')
        expect(text).not.toContain('private-account')
    })

    it('treats missing or invalid percentages as unknown rather than an unused allowance', () => {
        for (const usedPercent of [undefined, null, -5, 105, '25']) {
            const parsed = parseAgentQuota('codex', JSON.stringify({ success: true, data: { rateLimits: { primary: { usedPercent } } } }))
            expect(parsed.unavailableMessage).toContain('unavailable')
            expect(parsed.limits).toEqual([])
        }
    })
})
