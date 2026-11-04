import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { discoverAgentProfiles } from './agentProfiles'

const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })

function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'hapi-agent-profiles-'))
    directories.push(dir)
    const home = join(dir, 'home')
    const cwd = join(dir, "project 'quoted'")
    mkdirSync(home); mkdirSync(cwd); mkdirSync(join(cwd, '.git'))
    const write = (root: string, path: string, content: string) => {
        const target = join(root, path)
        mkdirSync(join(target, '..'), { recursive: true })
        writeFileSync(target, content)
    }
    const run = (flavor: string) => discoverAgentProfiles(async command => {
        const result = spawnSync('/bin/sh', ['-c', command], {
            env: { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), XDG_CONFIG_HOME: join(home, '.config') },
            encoding: 'utf8', timeout: 5000,
        })
        expect(result.status).toBe(0)
        return { success: result.status === 0, stdout: result.stdout }
    }, flavor, cwd)
    return { home, cwd, write, run }
}

test('discovers AGY user and ancestor project definitions; nearest project overrides the same name', async () => {
    const { home, cwd, write, run } = setup()
    write(home, '.gemini/config/agents/reviewer/agent.md', '---\nname: reviewer\ndescription: User reviewer\n---\nUser instructions.')
    write(cwd, '.agents/agents/reviewer.md', '---\nname: reviewer\ndescription: |\n  Project reviewer\n  Full description.\n---\nProject instructions.')
    const catalog = await run('agy')
    expect(catalog.agents).toHaveLength(1)
    expect(catalog.agents[0]!.name).toBe('reviewer')
    expect(catalog.agents[0]!.description).toContain('Full description.')
    expect(catalog.agents[0]!.instruction).toContain('Project instructions.')
    expect(catalog.agents[0]!.instruction).not.toContain('User instructions.')
})

test('discovers Codex TOML definitions and config-file roles without leaking unrelated config fields', async () => {
    const { home, cwd, write, run } = setup()
    write(home, '.codex/config.toml', 'token = "private-value"\n[agents.reviewer]\ndescription = "Review code"\nconfig_file = "roles/reviewer.toml"')
    write(home, '.codex/roles/reviewer.toml', 'developer_instructions = """Find regressions.\nRead connected code."""')
    write(cwd, '.codex/agents/architect.toml', 'name = "architect"\ndescription = "Design systems"\ndeveloper_instructions = "Keep it small."')
    const catalog = await run('codex')
    expect(catalog.agents.map(agent => agent.name)).toEqual(['architect', 'reviewer'])
    expect(catalog.agents.find(agent => agent.name === 'reviewer')!.instruction).toContain('Find regressions.')
    expect(JSON.stringify(catalog)).not.toContain('private-value')
})

test('uses only the selected CLI roots and reports malformed files without losing valid definitions', async () => {
    const { home, cwd, write, run } = setup()
    write(home, '.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Review\n---\nRead the changes.')
    write(cwd, '.claude/agents/bad.md', '---\nname: [invalid\n---\nBad')
    write(cwd, '.agents/agents/agy-only.md', '---\nname: agy-only\ndescription: AGY\n---\nDo AGY work.')
    const catalog = await run('claude')
    expect(catalog.agents.map(agent => agent.name)).toEqual(['reviewer'])
    expect(catalog.warning).toBeTruthy()
})

test('discovers Copilot, Gemini, Cursor, Kimi and OpenCode definitions in their real directories', async () => {
    const { cwd, write, run } = setup()
    for (const [flavor, path] of [
        ['copilot', '.github/agents/reviewer.agent.md'], ['gemini', '.gemini/agents/reviewer.md'],
        ['cursor', '.cursor/agents/reviewer.md'], ['kimi', '.kimi-code/agents/reviewer.md'],
        ['opencode', '.opencode/agents/reviewer.md'],
    ]) {
        write(cwd, path!, '---\nname: reviewer\ndescription: Review\n---\nFind regressions.')
        expect((await run(flavor!)).agents.some(agent => agent.name === 'reviewer')).toBe(true)
    }
})

test('does not substitute skills or invent agents for unsupported catalogs', async () => {
    const { cwd, write, run } = setup()
    write(cwd, '.agents/skills/hello/SKILL.md', '---\nname: hello\n---\nSkill')
    expect((await run('agy')).agents).toEqual([])
    expect((await run('dsh')).warning).toContain('not available')
})

test('supports OpenCode JSONC file prompts and a project disabling an inherited profile', async () => {
    const { home, cwd, write, run } = setup()
    write(home, '.config/opencode/agents/hidden.md', '---\nname: hidden\ndescription: Hidden\n---\nInherited prompt.')
    write(cwd, 'opencode.jsonc', '{ // project config\n "agent": { "hidden": { "disable": true }, "reviewer": { "description": "Review", "prompt": "{file:prompts/review.txt}" }, }, }')
    write(cwd, 'prompts/review.txt', 'Read connected code and identify regressions.')
    const catalog = await run('opencode')
    expect(catalog.agents.map(agent => agent.name)).toEqual(['reviewer'])
    expect(catalog.agents[0]!.instruction).toContain('Read connected code')
})

test('loads Pi extension profiles linked from user storage, without following directory symlink loops', async () => {
    const { home, cwd, write, run } = setup()
    write(home, 'profiles/reviewer.md', '---\nname: reviewer\ndescription: Review\n---\nRead the code.')
    mkdirSync(join(home, '.pi/agent/agents'), { recursive: true })
    symlinkSync(join(home, 'profiles/reviewer.md'), join(home, '.pi/agent/agents/reviewer.md'))
    symlinkSync(join(home, '.pi/agent/agents'), join(home, '.pi/agent/agents/loop'))
    expect((await run('pi')).agents.map(agent => agent.name)).toEqual(['reviewer'])
    write(cwd, '.pi/agents/reviewer.md', '---\nname: reviewer\ndescription: Project review\n---\nProject instructions.')
    expect((await run('pi')).agents[0]!.instruction).toContain('Project instructions.')
})
