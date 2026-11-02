import type { SlashCommand } from './apiTypes'

// Native screens stay in the installed CLI, so their validation, auth and
// feature/account restrictions remain authoritative.
const NATIVE_COMMANDS: Record<string, readonly (readonly [string, string])[]> = {
    codex: [
        ['skills', 'Browse and manage skills (invoke in chat with $skill-name)'],
        ['apps', 'Browse apps and connectors'], ['plugins', 'Manage plugins'],
        ['hooks', 'Manage lifecycle hooks'], ['mcp', 'Inspect MCP servers and tools'],
        ['agents', 'Open the agent command center'], ['subagents', 'Switch subagent threads'],
        ['review', 'Review the working tree or a base branch'], ['init', 'Create AGENTS.md instructions'],
        ['memories', 'Configure memory'], ['experimental', 'Configure experimental features'],
        ['approve', 'Retry an action denied by automatic review'], ['import', 'Import another agent setup'],
        ['presets', 'Save and reuse prompts and commands'], ['side', 'Open a side chat'], ['btw', 'Open a side chat'],
        ['ps', 'Inspect background terminals'], ['stop', 'Stop background terminals'],
        ['ide', 'Configure IDE context'], ['cd', 'Change the working directory'],
        ['pwd', 'Show the working directory'], ['cwd', 'Show the working directory'],
        ['worktree', 'Create or open a managed worktree'], ['usage', 'Inspect account usage'],
        ['debug-config', 'Inspect configuration layers'], ['warnings', 'Inspect retained warnings'],
        ['daemon', 'Manage the Codex server'], ['recap', 'Summarize without compacting context'],
        ['daybreak', 'Toggle Daybreak when available'], ['voice', 'Use native voice conversation'],
        ['config', 'Configure terminal preferences'], ['keymap', 'Configure keyboard shortcuts'],
        ['vim', 'Toggle Vim input'], ['raw', 'Toggle raw scrollback'], ['tui', 'Configure terminal mode'],
        ['statusline', 'Configure the terminal status line'], ['title', 'Configure the terminal title'],
        ['theme', 'Select the terminal theme'], ['pets', 'Select a terminal pet'], ['pet', 'Select a terminal pet'],
        ['setup-default-sandbox', 'Configure the Windows sandbox'], ['app', 'Continue in the desktop app'],
        ['feedback', 'Send CLI feedback'], ['logout', 'Sign out of Codex'],
        ['exit', 'Exit the native CLI'], ['quit', 'Exit the native CLI'],
        ['rename', 'Rename this conversation'], ['archive', 'Archive this conversation'],
        ['delete', 'Delete this conversation'], ['fork', 'Fork this conversation'],
        ['resume', 'Select a saved conversation'], ['copy', 'Copy a response'],
        ['export', 'Export this conversation'], ['mention', 'Attach a file'], ['diff', 'Review Git changes'],
    ],
    agy: [
        ['skills', 'Browse skills or reload the catalog with /skills reload'],
        ['agents', 'Select custom agents and inspect subagents'], ['plugin', 'Manage plugins'], ['plugins', 'Manage plugins'],
        ['hooks', 'Manage hooks'], ['mcp', 'Manage MCP servers'], ['config', 'Edit AGY settings'], ['settings', 'Edit AGY settings'],
        ['credits', 'Show G1 credits'], ['add-dir', 'Add a workspace directory'], ['artifact', 'Review artifacts'],
        ['codesearch', 'Search workspace code'], ['cs', 'Search workspace code'], ['search', 'Search workspace code'],
        ['context', 'Inspect context usage'], ['tasks', 'Inspect background tasks'], ['learn', 'Save corrections as rules or skills'],
        ['fork', 'Fork this conversation'], ['branch', 'Fork this conversation'], ['rewind', 'Rewind the conversation'],
        ['undo', 'Rewind the conversation'], ['clear', 'Start a new conversation'], ['new', 'Start a new conversation'],
        ['help', 'Show native CLI help'], ['changelog', 'Show CLI release notes'], ['feedback', 'Send CLI feedback'],
        ['keybindings', 'Configure keyboard shortcuts'], ['statusline', 'Configure the terminal status line'],
        ['title', 'Configure the terminal title'], ['open', 'Open a path in the editor'], ['remote-control', 'Manage AGY Remote Control'],
        ['logout', 'Sign out of AGY'], ['exit', 'Exit the native CLI'], ['quit', 'Exit the native CLI'],
        ['boost', 'Run deep reasoning'], ['teamwork', 'Run a collaborative agent team'], ['goal', 'Work toward a goal'],
        ['plan', 'Plan a task'], ['grill-me', 'Clarify requirements interactively'], ['browser', 'Use the browser agent'],
        ['btw', 'Ask a side question'], ['model', 'Select a model'], ['effort', 'Set reasoning effort'],
        ['permissions', 'Manage permissions'], ['rename', 'Rename this conversation'], ['copy', 'Copy a response'],
        ['resume', 'Select a conversation'], ['switch', 'Select a conversation'], ['conversation', 'Select a conversation'],
        ['voice', 'Dictate through native CLI audio'], ['record', 'Dictate through native CLI audio'],
        ['schedule', 'Schedule a task or recurring job'], ['diff', 'Review changes'],
    ],
}

export function findNativeCliCommand(text: string, agent: string, available: readonly SlashCommand[] = []): SlashCommand | null {
    if (/[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) return null
    const match = /^\s*\/([a-z0-9:_-]+)(?:\s|$)/i.exec(text)
    if (!match) return null
    const name = match[1].toLowerCase()
    const custom = available.find(command => command.name.toLowerCase() === name && command.source !== 'builtin')
    if (custom) return null
    return getBuiltinSlashCommands(agent).find(command => command.name === name && command.execution === 'native') ?? null
}

export const BUILTIN_SLASH_COMMANDS = {
    claude: [
        { name: 'clear', description: 'Clear conversation history and free up context', source: 'builtin' },
        { name: 'compact', description: 'Clear conversation history but keep a summary in context', source: 'builtin' },
        { name: 'context', description: 'Visualize current context usage as a colored grid', source: 'builtin' },
        { name: 'cost', description: 'Show the total cost and duration of the current session', source: 'builtin' },
        { name: 'doctor', description: 'Diagnose and verify your Claude Code installation and settings', source: 'builtin' },
        { name: 'plan', description: 'View or open the current session plan', source: 'builtin' },
        { name: 'stats', description: 'Show your Claude Code usage statistics and activity', source: 'builtin' },
        { name: 'status', description: 'Show Claude Code status including version, model, account, and API connectivity', source: 'builtin' },
    ],
    codex: [
        { name: 'agent', description: 'Toggle proactive Codex multi-agent delegation', source: 'builtin' },
        { name: 'clear', description: 'Clear current Codex thread context', source: 'builtin' },
        { name: 'compact', description: 'Compact current Codex thread context', source: 'builtin' },
        { name: 'goal', description: 'Set, view, pause, resume, or clear a persistent Codex goal', source: 'builtin' },
        { name: 'help', description: 'Show supported HAPI Codex slash commands', source: 'builtin' },
        { name: 'plan', description: 'Enable plan mode; use /plan off to return to default', source: 'builtin' },
        { name: 'default', description: 'Return Codex collaboration mode to default', source: 'builtin' },
        { name: 'execute', description: 'Return Codex collaboration mode to default', source: 'builtin' },
        { name: 'status', description: 'Show current Codex session config', source: 'builtin' },
        { name: 'model', description: 'Show or set Codex model, e.g. /model gpt-5.5', source: 'builtin' },
        { name: 'reasoning', description: 'Show or set reasoning effort', source: 'builtin' },
        { name: 'effort', description: 'Alias for /reasoning', source: 'builtin' },
        { name: 'personality', description: 'Show or set response style: friendly, pragmatic, or none', source: 'builtin' },
        { name: 'permissions', description: 'Show or set permission mode', source: 'builtin' },
        { name: 'permission', description: 'Alias for /permissions', source: 'builtin' },
    ],
    gemini: [
        { name: 'about', description: 'Show version info', source: 'builtin' },
        { name: 'clear', description: 'Clear the screen and conversation history', source: 'builtin' },
        { name: 'compress', description: 'Compress the context by replacing it with a summary', source: 'builtin' },
        { name: 'stats', description: 'Check session stats', source: 'builtin' },
    ],
    grok: [
        { name: 'compact', description: 'Compress conversation history to save context', source: 'builtin' },
        { name: 'context', description: 'Show context window usage and session stats', source: 'builtin' },
        { name: 'session-info', description: 'Show Grok session model, turns, and context usage', source: 'builtin' },
        { name: 'goal', description: 'Set, manage, or inspect an autonomous goal', source: 'builtin' },
        { name: 'always-approve', description: 'Toggle automatic tool approval', source: 'builtin' },
        { name: 'auto', description: 'Let Grok classify safe tool calls for automatic approval', source: 'builtin' },
    ],
    opencode: [
        { name: 'help', description: 'Show supported HAPI OpenCode slash commands', source: 'builtin' },
        { name: 'status', description: 'Show current OpenCode session config', source: 'builtin' },
        { name: 'plan', description: 'Enable plan mode; use /plan off to return to default', source: 'builtin' },
        { name: 'default', description: 'Return OpenCode permission mode to default', source: 'builtin' },
        { name: 'init', description: 'Generate or refresh AGENTS.md for this project', source: 'builtin' },
    ],
    cursor: [
        { name: 'compress', description: 'Compress conversation context to free window space (pass-through to Cursor agent)', source: 'builtin' },
    ],
    copilot: [
        { name: 'help', description: 'Show supported Copilot slash commands', source: 'builtin' },
        { name: 'status', description: 'Show current Copilot session config', source: 'builtin' },
        { name: 'plan', description: 'Start plan mode for structured implementation planning', source: 'builtin' },
        { name: 'autopilot', description: 'Start autopilot mode for autonomous multi-step work', source: 'builtin' },
        { name: 'fleet', description: 'Run parallel subagents for a task (combine with Interactive/Plan/Autopilot)', source: 'builtin' },
        { name: 'tasks', description: 'List or manage fleet tasks', source: 'builtin' },
        { name: 'subagents', description: 'Manage Copilot subagents', source: 'builtin' },
        { name: 'agents', description: 'Alias for /subagents', source: 'builtin' },
        { name: 'delegate', description: 'Delegate work to a subagent', source: 'builtin' },
        { name: 'agent', description: 'Select or configure a custom agent', source: 'builtin' },
        { name: 'rubber-duck', description: 'Consult the rubber-duck agent for a second opinion on plans, code, and tests', source: 'builtin' },
        { name: 'security-review', description: 'Run a focused security review of active local code changes', source: 'builtin' },
        { name: 'research', description: 'Run a deep research investigation across the codebase and web', source: 'builtin' },
        { name: 'review', description: 'Run the code-review agent on current changes', source: 'builtin' },
        { name: 'skills', description: 'List, inspect, add, or remove Copilot skills', source: 'builtin' },
        { name: 'context', description: 'Show current context usage', source: 'builtin' },
        { name: 'model', description: 'Show or switch the active model', source: 'builtin' },
        { name: 'permissions', description: 'Show or set permission mode', source: 'builtin' },
        { name: 'permission', description: 'Alias for /permissions', source: 'builtin' },
        { name: 'usage', description: 'Show session usage metrics', source: 'builtin' },
    ],
    kimi: [],
    // Pi runs `pi --mode rpc` over stdio; only commands HAPI can translate
    // to Pi RPC calls are listed. Terminal-only Pi builtins (e.g. /tree,
    // /export, /reload) are intercepted with an explicit "not supported"
    // message instead of being passed to the model as plain text.
    pi: [
        { name: 'help', description: 'Show supported HAPI Pi slash commands', source: 'builtin' },
        { name: 'compact', description: 'Compress conversation history to save context (optional custom instructions)', source: 'builtin' },
        { name: 'session', description: 'Show Pi session stats (tokens, cost, context usage)', source: 'builtin' },
        { name: 'model', description: 'Show or switch the Pi model, e.g. /model gpt-5.2', source: 'builtin' },
    ],
} as const satisfies Record<string, readonly SlashCommand[]>

export function getBuiltinSlashCommands(agent: string): SlashCommand[] {
    const native = (NATIVE_COMMANDS[agent] ?? []).map(([name, description]): SlashCommand => ({
        name, description, source: 'builtin', execution: 'native',
        ...(agent === 'codex' && name === 'import' ? { nativeCliContext: 'local' as const } : {})
    }))
    if (agent === 'agy') return [
        { name: 'status', description: 'Show session status and account limits', source: 'builtin' },
        { name: 'usage', description: 'Show AGY account quotas', source: 'builtin' },
        { name: 'quota', description: 'Show AGY account quotas', source: 'builtin' }, ...native
    ]
    const commands = BUILTIN_SLASH_COMMANDS[agent as keyof typeof BUILTIN_SLASH_COMMANDS]
        ?? BUILTIN_SLASH_COMMANDS.claude
    return mergeSlashCommands([...native, ...commands.map((command) => ({ ...command })),
        ...(agent === 'codex' ? [
            { name: 'new', description: 'Start a new Codex conversation', source: 'builtin' as const },
            { name: 'fast', description: 'Toggle the Fast service tier', source: 'builtin' as const },
        ] : [])])
}

export function mergeSlashCommands(commands: readonly SlashCommand[]): SlashCommand[] {
    const commandMap = new Map<string, SlashCommand>()
    for (const command of commands) {
        const key = command.name.toLowerCase()
        if (commandMap.has(key)) {
            commandMap.delete(key)
        }
        commandMap.set(key, command)
    }
    return Array.from(commandMap.values())
}
