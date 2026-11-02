import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const script = new URL('./update-from-workspace.sh', import.meta.url).pathname
function git(root, ...args) {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
}
function write(root, name, text) {
    const path = join(root, name)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, text)
}
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'hapi-handoff-'))
    const source = join(root, 'source with spaces')
    const target = join(root, 'target with spaces')
    for (const path of [source, target]) {
        mkdirSync(path)
        git(path, 'init', '-b', 'main')
        git(path, 'config', 'user.name', 'Fixture')
        git(path, 'config', 'user.email', 'fixture@example.invalid')
        write(path, '.gitignore', 'data/\n.env\n.tools/\n')
        write(path, 'Dockerfile', 'FROM scratch\n')
        write(path, 'docker-compose.yml', 'services: {}\n')
        write(path, 'app/main.txt', path === source ? 'new source' : 'old target')
        git(path, 'add', '--', '.gitignore', 'Dockerfile', 'docker-compose.yml', 'app/main.txt')
        git(path, 'commit', '-m', path === source ? 'source release' : 'independent server commit')
    }
    git(source, 'remote', 'add', 'origin', 'https://github.com/example/fixture.git')
    write(source, 'data/keep', 'source data')
    write(source, '.env', 'source secret')
    write(source, '.tools/keep', 'source tooling')
    write(target, 'data/keep', 'live data')
    write(target, '.env', 'live secret')
    write(target, 'local-settings', 'operator settings')
    const bin = join(root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'docker'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$HAPI_TEST_CALLS"\n[ "$*" != "$HAPI_TEST_FAIL" ]\n', { mode: 0o755 })
    const callsFile = join(root, 'docker-calls')
    const run = (failure = '') => spawnSync('bash', [script, source, target], {
        encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HAPI_TEST_CALLS: callsFile, HAPI_TEST_FAIL: failure }
    })
    const calls = () => existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n') : []
    const backups = () => readdirSync(root).filter(name => name.startsWith('.hapi-git-backup.')).map(name => join(root, name, 'git'))
    const protectedState = () => {
        assert.equal(readFileSync(join(target, 'data/keep'), 'utf8'), 'live data')
        assert.equal(readFileSync(join(target, '.env'), 'utf8'), 'live secret')
        assert.equal(readFileSync(join(target, 'local-settings'), 'utf8'), 'operator settings')
    }
    return { root, source, target, run, calls, backups, protectedState, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('copies the committed sources and Git, backs up independent server history, and retains runtime state', () => {
    const f = fixture()
    try {
        const oldHead = git(f.target, 'rev-parse', 'HEAD')
        const newHead = git(f.source, 'rev-parse', 'HEAD')
        const result = f.run()
        assert.equal(result.status, 0, result.stderr)
        assert.equal(readFileSync(join(f.target, 'app/main.txt'), 'utf8'), 'new source')
        assert.equal(git(f.target, 'rev-parse', 'HEAD'), newHead)
        assert.equal(git(f.target, 'remote', 'get-url', 'origin'), 'https://github.com/example/fixture.git')
        assert.equal(f.backups().length, 1)
        assert.equal(git(f.root, `--git-dir=${f.backups()[0]}`, 'rev-parse', 'HEAD'), oldHead)
        assert.equal(existsSync(join(f.target, '.tools/keep')), false)
        f.protectedState()
        assert.deepEqual(f.calls(), ['compose config --quiet', 'compose down', 'compose up -d --build'])
    } finally { f.cleanup() }
})

for (const issue of ['dirty source', 'missing file', 'tracked secret', 'symlink parent', 'external objects']) {
    test(`stops before Docker or target writes for ${issue}`, () => {
        const f = fixture()
        try {
            const oldHead = git(f.target, 'rev-parse', 'HEAD')
            if (issue === 'dirty source') write(f.source, 'app/main.txt', 'uncommitted')
            if (issue === 'missing file') rmSync(join(f.source, 'Dockerfile'))
            if (issue === 'tracked secret') {
                git(f.source, 'add', '-f', '.env')
                git(f.source, 'commit', '-m', 'fixture secret')
            }
            if (issue === 'symlink parent') {
                mkdirSync(join(f.root, 'outside'))
                write(f.root, 'outside/main.txt', 'outside data')
                rmSync(join(f.target, 'app'), { recursive: true })
                symlinkSync(join(f.root, 'outside'), join(f.target, 'app'))
            }
            if (issue === 'external objects') write(f.source, '.git/objects/info/alternates', `${join(f.target, '.git/objects')}\n`)
            const result = f.run()
            assert.notEqual(result.status, 0)
            assert.deepEqual(f.calls(), [])
            assert.equal(git(f.target, 'rev-parse', 'HEAD'), oldHead)
            assert.deepEqual(f.backups(), [])
            f.protectedState()
            if (issue === 'symlink parent') assert.equal(readFileSync(join(f.root, 'outside/main.txt'), 'utf8'), 'outside data')
        } finally { f.cleanup() }
    })
}

for (const failure of ['compose config --quiet', 'compose down', 'compose up -d --build']) {
    test(`propagates Docker failure at ${failure}`, () => {
        const f = fixture()
        try {
            const oldHead = git(f.target, 'rev-parse', 'HEAD')
            const result = f.run(failure)
            assert.notEqual(result.status, 0)
            const ordered = ['compose config --quiet', 'compose down', 'compose up -d --build']
            assert.deepEqual(f.calls(), ordered.slice(0, ordered.indexOf(failure) + 1))
            f.protectedState()
            if (failure !== 'compose up -d --build') {
                assert.equal(git(f.target, 'rev-parse', 'HEAD'), oldHead)
                assert.equal(readFileSync(join(f.target, 'app/main.txt'), 'utf8'), 'old target')
            } else {
                assert.equal(f.backups().length, 1)
            }
        } finally { f.cleanup() }
    })
}
