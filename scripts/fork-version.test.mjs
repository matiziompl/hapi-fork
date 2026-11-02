import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = new URL('./fork-version.mjs', import.meta.url).pathname
function fixture(version = '1.9') {
    const root = mkdtempSync(join(tmpdir(), 'hapi-version-'))
    mkdirSync(join(root, 'shared/src'), { recursive: true })
    writeFileSync(join(root, 'shared/src/buildInfo.ts'), `export const APP_VERSION = '0.33.3'\nexport const FORK_VERSION = '${version}'\n`)
    writeFileSync(join(root, 'README.md'), '# HAPI\n\nDocumentation.\n')
    return root
}
function run(root, command) { return spawnSync(process.execPath, [script, command], { cwd: root, encoding: 'utf8' }) }

test('sync appends exactly one version footer at the end and check detects stale versions', () => {
    const root = fixture()
    try {
        assert.notEqual(run(root, '--check').status, 0)
        assert.equal(run(root, '--sync').status, 0)
        const first = readFileSync(join(root, 'README.md'), 'utf8')
        assert.match(first, /Current fork version: \*\*v1\.9\*\*\n<!-- hapi-fork-version:end -->\n$/)
        assert.equal(run(root, '--sync').status, 0)
        assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), first)
        assert.equal(run(root, '--check').status, 0)
    } finally { rmSync(root, { recursive: true }) }
})
test('bump increments the prompt counter from 1.9 to 1.10 and syncs README', () => {
    const root = fixture()
    try {
        assert.equal(run(root, '--bump').status, 0)
        assert.match(readFileSync(join(root, 'shared/src/buildInfo.ts'), 'utf8'), /FORK_VERSION = '1\.10'/)
        assert.match(readFileSync(join(root, 'shared/src/buildInfo.ts'), 'utf8'), /APP_VERSION = '0\.33\.3'/)
        assert.match(readFileSync(join(root, 'README.md'), 'utf8'), /\*\*v1\.10\*\*/)
        assert.equal(run(root, '--check').status, 0)
    } finally { rmSync(root, { recursive: true }) }
})
test('rejects missing or malformed versions without writing any file', () => {
    const root = fixture('v1.2.3')
    try {
        const before = readFileSync(join(root, 'shared/src/buildInfo.ts'), 'utf8')
        assert.notEqual(run(root, '--bump').status, 0)
        assert.equal(readFileSync(join(root, 'shared/src/buildInfo.ts'), 'utf8'), before)
        assert.equal(readFileSync(join(root, 'README.md'), 'utf8'), '# HAPI\n\nDocumentation.\n')
    } finally { rmSync(root, { recursive: true }) }
})
