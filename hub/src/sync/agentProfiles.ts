import { posix, win32 } from 'node:path'
import { z } from 'zod'
import { AgentProfileSchema, isObject } from '@hapi/protocol'
import type { SelectedAgentProfile } from '../config/promptProfiles'

// Read-only discovery runs on the session machine over its existing Bash RPC.
// Never scan the Hub filesystem for files owned by a remote CLI.
export const AGENT_PROFILES_PROBE = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const options = JSON.parse(process.argv[1]);
const home = os.homedir();
const files = [];
const warnings = [];
let bytes = 0;
let visited = 0;
function read(file, kind, source, extra = {}) {
    let fd;
    try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const info = fs.fstatSync(fd);
        if (!info.isFile()) return;
        if (info.size > 65536 || bytes + info.size > 524288 || files.length >= 200) {
            warnings.push('Some agent files exceed the discovery size limit.'); return;
        }
        const buffer = Buffer.alloc(info.size + 1);
        const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
        if (count > info.size) { warnings.push('An agent file changed during discovery. Reload the catalog.'); return; }
        bytes += count;
        files.push({ path: file, kind, source, content: buffer.subarray(0, count).toString('utf8'), ...extra });
    } catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) warnings.push('Some agent files could not be read. Check their permissions.');
    } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function scan(root, source, depth = 0) {
    if (++visited > 500 || depth > 5) { warnings.push('Some agent directories exceed the discovery depth limit.'); return; }
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); }
    catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) warnings.push('Some agent directories could not be read.'); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (files.length >= 200) { warnings.push('Some agent files exceed the discovery count limit.'); break; }
        const file = path.join(root, entry.name);
        if (entry.isSymbolicLink()) {
            try { if (fs.statSync(file).isFile() && /\.(md|toml)$/i.test(entry.name)) read(file, entry.name.endsWith('.toml') ? 'toml' : 'markdown', source); } catch {}
            continue;
        }
        if (entry.isDirectory()) scan(file, source, depth + 1);
        else if (entry.isFile() && /\.(md|toml)$/i.test(entry.name)) read(file, entry.name.endsWith('.toml') ? 'toml' : 'markdown', source);
    }
}
if (options.references) {
    for (const item of options.references.slice(0, 200)) read(item.path, item.kind, item.source, { name: item.name, description: item.description });
} else {
    const flavor = options.flavor;
    const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const codexHome = process.env.CODEX_HOME || path.join(home, '.codex');
    const claudeHome = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
    const kimiHome = process.env.KIMI_CODE_HOME || path.join(home, '.kimi-code');
    const grokHome = process.env.GROK_HOME || path.join(home, '.grok');
    const locations = {
        agy: { user: [path.join(home, '.gemini/config/agents')], project: ['.agents/agents'] },
        claude: { user: [path.join(claudeHome, 'agents')], project: ['.claude/agents'] },
        codex: { user: [path.join(codexHome, 'agents')], project: ['.codex/agents'] },
        gemini: { user: [path.join(home, '.gemini/agents')], project: ['.gemini/agents'] },
        copilot: { user: [path.join(home, '.copilot/agents')], project: ['.github/agents'] },
        cursor: { user: [path.join(home, '.codex/agents'), path.join(claudeHome, 'agents'), path.join(home, '.cursor/agents')], project: ['.codex/agents', '.claude/agents', '.cursor/agents'] },
        kimi: { user: [path.join(home, '.agents/agents'), path.join(kimiHome, 'agents')], project: ['.agents/agents', '.kimi-code/agents'] },
        opencode: { user: [path.join(configHome, 'opencode/agent'), path.join(configHome, 'opencode/agents')], project: ['.opencode/agent', '.opencode/agents'] },
        grok: { user: [path.join(claudeHome, 'agents'), path.join(grokHome, 'agents')], project: ['.claude/agents', '.grok/agents'] },
        pi: { user: [path.join(process.env.PI_CODING_AGENT_DIR || path.join(home, '.pi/agent'), 'agents')], project: ['.pi/agents'] },
    }[flavor];
    if (!locations) warnings.push('Custom agent discovery is not available for this CLI. Personas are still available.');
    else {
        for (const root of locations.user) scan(root, 'user');
        if (flavor === 'codex') read(path.join(codexHome, 'config.toml'), 'codex-config', 'user');
        if (flavor === 'opencode') {
            read(path.join(configHome, 'opencode/opencode.json'), 'opencode-config', 'user');
            read(path.join(configHome, 'opencode/opencode.jsonc'), 'opencode-config', 'user');
        }
        const ancestors = [];
        let current = path.resolve(options.cwd);
        while (true) {
            ancestors.push(current);
            if (fs.existsSync(path.join(current, '.git'))) break;
            const parent = path.dirname(current);
            if (parent === current || current === home) { ancestors.splice(1); break; }
            current = parent;
        }
        for (const directory of ancestors.reverse()) {
            for (const root of locations.project) scan(path.join(directory, root), 'project');
            if (flavor === 'codex') read(path.join(directory, '.codex/config.toml'), 'codex-config', 'project');
            if (flavor === 'opencode') {
                read(path.join(directory, 'opencode.json'), 'opencode-config', 'project');
                read(path.join(directory, 'opencode.jsonc'), 'opencode-config', 'project');
            }
        }
    }
}
process.stdout.write(JSON.stringify({ files, warnings: [...new Set(warnings)] }));
`

type AgentFileReference = { path: string; name: string; description: string; source: string; kind: 'toml' | 'prompt' }
const InventorySchema = z.object({
    files: z.array(z.object({
        path: z.string().max(2000), kind: z.enum(['markdown', 'toml', 'codex-config', 'opencode-config', 'prompt']),
        source: z.string().max(1000), content: z.string().max(65536), name: z.string().optional(), description: z.string().optional(),
    })).max(200),
    warnings: z.array(z.string().max(500)).max(200),
})

function quote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'` }
export function buildAgentProfilesCommand(flavor: string, cwd: string, references?: AgentFileReference[]): string {
    return `node -e ${quote(AGENT_PROFILES_PROBE)} ${quote(JSON.stringify({ flavor, cwd, references }))}`
}

export function parseAgentProfiles(output: string): { agents: SelectedAgentProfile[]; references: AgentFileReference[]; warning?: string } {
    const inventory = InventorySchema.parse(JSON.parse(output))
    const agents = new Map<string, SelectedAgentProfile>()
    let references: AgentFileReference[] = []
    const warnings = [...inventory.warnings]
    const add = (file: typeof inventory.files[number], raw: Record<string, unknown>, instruction: unknown) => {
        const paths = /^(?:[a-z]:[\\/]|\\\\)/i.test(file.path) ? win32 : posix
        const basename = paths.basename(file.path).replace(/(?:\.agent)?\.(?:md|toml)$/i, '')
        const name = file.name ?? (typeof raw.name === 'string' ? raw.name : basename === 'agent' ? paths.basename(paths.dirname(file.path)) : basename)
        if (raw.disable === true || raw.disabled === true || raw.hidden === true) {
            agents.delete(name)
            references = references.filter(reference => reference.name !== name)
            return
        }
        const description = file.description ?? (typeof raw.description === 'string' ? raw.description : '')
        const parsed = AgentProfileSchema.safeParse({ id: name, name, description, source: file.source })
        if (!parsed.success || typeof instruction !== 'string' || !instruction.trim() || instruction.length > 20000) {
            warnings.push('Some agent definitions are invalid or do not contain reusable instructions.'); return
        }
        agents.set(name, { ...parsed.data, instruction: `Agent profile: ${name}\n${instruction.trim()}` })
        references = references.filter(reference => reference.name !== name)
    }
    for (const file of inventory.files) {
        try {
            if (file.kind === 'markdown') {
                const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(file.content)
                if (!match) throw new Error('Missing frontmatter')
                const raw = Bun.YAML.parse(match[1]!)
                if (!isObject(raw)) throw new Error('Invalid frontmatter')
                add(file, raw, match[2])
            } else if (file.kind === 'toml') {
                const raw = Bun.TOML.parse(file.content)
                if (!isObject(raw)) throw new Error('Invalid TOML')
                add(file, raw, raw.developer_instructions ?? raw.system_prompt ?? raw.prompt)
            } else if (file.kind === 'prompt') {
                add(file, {}, file.content)
            } else if (file.kind === 'codex-config') {
                const raw = Bun.TOML.parse(file.content)
                if (!isObject(raw)) throw new Error('Invalid TOML')
                if (!isObject(raw.agents)) continue
                const paths = /^(?:[a-z]:[\\/]|\\\\)/i.test(file.path) ? win32 : posix
                for (const [name, role] of Object.entries(raw.agents)) {
                    if (!isObject(role) || role.disabled === true) continue
                    if (typeof role.config_file === 'string') {
                        agents.delete(name)
                        references = references.filter(reference => reference.name !== name)
                        references.push({ path: paths.resolve(paths.dirname(file.path), role.config_file), name,
                            description: typeof role.description === 'string' ? role.description : '', source: file.source, kind: 'toml' })
                    }
                }
            } else {
                const raw = Bun.JSON5.parse(file.content)
                if (!isObject(raw) || !isObject(raw.agent)) continue
                const paths = /^(?:[a-z]:[\\/]|\\\\)/i.test(file.path) ? win32 : posix
                for (const [name, role] of Object.entries(raw.agent)) {
                    if (!isObject(role)) continue
                    const reference = typeof role.prompt === 'string' ? /^\{file:(.+)\}$/.exec(role.prompt) : null
                    if (reference && role.disable !== true && role.hidden !== true) {
                        agents.delete(name)
                        references = references.filter(value => value.name !== name)
                        references.push({ path: paths.resolve(paths.dirname(file.path), reference[1]!), name,
                            description: typeof role.description === 'string' ? role.description : '', source: file.source, kind: 'prompt' })
                        continue
                    }
                    add({ ...file, name }, role, role.prompt)
                }
            }
        } catch { warnings.push('Some agent definitions could not be parsed. Check their YAML, TOML or JSON syntax.') }
    }
    return { agents: [...agents.values()].sort((a, b) => a.name.localeCompare(b.name)), references,
        ...(warnings.length ? { warning: [...new Set(warnings)].join(' ') } : {}) }
}

export async function discoverAgentProfiles(
    run: (command: string) => Promise<{ success: boolean; stdout?: string; error?: string }>, flavor: string, cwd: string,
): Promise<{ agents: SelectedAgentProfile[]; warning?: string }> {
    const collect = async (references?: AgentFileReference[]) => {
        const result = await run(buildAgentProfilesCommand(flavor, cwd, references))
        if (!result.success) throw new Error('Could not read CLI agent profiles. Check the session connection and Node.js on the Runner.')
        try { return parseAgentProfiles(result.stdout ?? '') }
        catch { throw new Error('The CLI agent catalog returned an invalid response. Reload agents to retry.') }
    }
    const catalog = await collect()
    if (!catalog.references.length) return { agents: catalog.agents, warning: catalog.warning }
    const additional = await collect(catalog.references)
    const agents = new Map(catalog.agents.map(agent => [agent.name, agent]))
    for (const agent of additional.agents) agents.set(agent.name, agent)
    return { agents: [...agents.values()].sort((a, b) => a.name.localeCompare(b.name)),
        warning: [catalog.warning, additional.warning].filter(Boolean).join(' ') || undefined }
}
