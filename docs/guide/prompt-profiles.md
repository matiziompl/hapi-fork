# Personas and CLI agent profiles

The web/PWA composer has a **Personas** button alongside Status and the other
toolbar controls. In Settings → Chat → Composer toolbar, it can be moved or
hidden like the existing buttons. Hiding the button does not clear a selection;
choose **No persona** in its list to stop adding that persona to new messages.

The **+** at the bottom right of the list opens a larger creator. Supply a name
and description, then choose **Save persona**. Saving selects the new persona.
Names are unique within the authenticated namespace, ignoring case. Names are
limited to 100 characters, descriptions to 20,000, and each namespace can store
200 personas. A failed save leaves the form available for retry.

Personas are stored in the Hub's existing `settings.json`, under `promptProfiles`,
separately for each authenticated namespace. They are shared across that
namespace's sessions and devices. The chosen persona and agent profile belong
to a session. Resume/reopen carries the choice to a replacement session without
overwriting an existing destination choice. The normal data-preserving Hub
update script keeps this file in the destination data directory.

## Agent selection

The **Agent** selector stays at the right end of the composer toolbar, outside
the scrolling group. Open it to discover profiles on the session's own machine,
and search by name or description. **Default agent** clears the profile. The
picker supports loading, empty results, no matches, read errors and manual reload.
Discovery and selecting a new agent require an active session; clearing a
selection and creating/selecting a persona are also available while inactive.

Selecting an agent applies its saved instructions before subsequent ordinary
messages. It does not spawn an independent subagent or change the native CLI's
model, tools, permissions, hooks or process identity. Those still follow the
session's existing settings. The description in the picker makes this behavior
explicit. Reselect a profile after changing its file to refresh its instructions.

The Hub uses the existing authenticated, session-scoped Bash RPC and a read-only
Node.js probe. It does not assume access to Runner paths through its own
filesystem. Node.js must be available on the session machine, as for the existing
status probe. No Runner source or wire protocol is changed.

Discovery reads user and project agent definitions for the session's CLI:

| CLI | User definitions | Project definitions |
| --- | --- | --- |
| AGY | `~/.gemini/config/agents` | `.agents/agents` |
| Codex | `$CODEX_HOME/agents`, default `~/.codex/agents`; configured `[agents.<name>].config_file` roles | `.codex/agents`; `.codex/config.toml` roles |
| Claude | `$CLAUDE_CONFIG_DIR/agents`, default `~/.claude/agents` | `.claude/agents` |
| Gemini | `~/.gemini/agents` | `.gemini/agents` |
| Copilot | `~/.copilot/agents` | `.github/agents` |
| Cursor | `~/.cursor/agents`, with Claude/Codex compatibility directories | `.cursor/agents`, `.claude/agents`, `.codex/agents` |
| Kimi | `$KIMI_CODE_HOME/agents`, default `~/.kimi-code/agents`; `~/.agents/agents` | `.kimi-code/agents`, `.agents/agents` |
| OpenCode | `$XDG_CONFIG_HOME/opencode/agent` and `agents`, default `~/.config`; `opencode.json`/`opencode.jsonc` agent tables | `.opencode/agent`, `.opencode/agents`; `opencode.json`/`opencode.jsonc` agent tables |
| Grok | `$GROK_HOME/agents`, default `~/.grok/agents`, with Claude compatibility | `.grok/agents`, `.claude/agents` |
| Pi | `$PI_CODING_AGENT_DIR/agents`, default `~/.pi/agent/agents` (subagent extension format) | `.pi/agents` |

Project definitions override user definitions with the same name; the nearest
project directory wins when walking from the repository root toward the session
working directory. Without a repository boundary, only the working directory is
scanned for project files. Markdown uses YAML frontmatter and the body as prompt;
Codex TOML uses `developer_instructions`. OpenCode JSONC and `{file:...}` prompt
references are supported. Invalid/oversized files produce a warning while valid
profiles remain available. Reads are bounded (64 KiB per file, 512 KiB per probe,
200 files); linked regular files work and directory symlinks are not traversed.

This is a catalog of saved, reusable profile instructions. Native built-in roles,
transient/session-defined agents, plugin-only profiles outside these locations,
custom CLI discovery roots and managed policy inventories are not enumerated.
DSH's provider-specific preset/plugin composition is not mapped to plain prompt
profiles: its picker explicitly reports discovery unavailable. Hub personas
still work. Native launch flags and all plugin/model/tool configuration remain
owned by their CLIs.

## Message delivery

For web/PWA message submissions, the Hub snapshots the selected agent instructions
and persona description at send time. It stores the original user text and an
internal prefix separately, then prepends the snapshot only when delivering to
the CLI. The composer, chat text, copy/retry text and queue continue to show the
original message. Disabling a profile affects subsequent sends; already queued
or scheduled messages retain their snapshot. As with ordinary instructions,
earlier conversation context can still influence a model after deselection.

Live delivery, reconnect backfill, retry and scheduled delivery use the same
expansion. Native shared-queue mirrors strip only the known snapshot prefix before
updating the visible text. Claude transcript echoes and AGY abort-restore events
are normalized at Hub ingress against the exact stored delivery snapshot, using
a session-scoped message identifier. Combined restores preserve all original
messages, and unknown user-authored marker examples remain literal. A leading
`$skill` stays first, with the hidden overlay before its arguments, preserving
native skill expansion. Native slash commands (including plugin names) retain their leading slash and
are sent without an overlay. User-defined commands expanded into ordinary prompt
text follow normal message handling. The prefix is persisted for replay; it is
not a secrecy boundary against raw API/database/export inspection or against a
model quoting its input. Native terminals and Telegram/MCP submissions do not
inherit this web-composer selection.

If an interruption returns a wrapped prompt whose original stored row has already
been removed (for example, cancellation while disconnected), the Hub leaves the
draft unchanged and displays an explicit recovery failure. It does not restore
unverified profile instructions into the editor. Ordinary user-authored marker
examples remain untouched in incoming local messages.

Provider format references: [AGY](https://antigravity.google/docs/subagents?tab=cli),
[Codex](https://developers.openai.com/codex/subagents),
[Claude](https://code.claude.com/docs/en/sub-agents),
[Gemini](https://geminicli.com/docs/core/subagents/),
[Copilot](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/invoke-custom-agents),
[Cursor](https://cursor.com/docs/subagents),
[Kimi](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/agents.html),
[OpenCode](https://opencode.ai/docs/agents/),
[Grok](https://docs.x.ai/build/features/subagents),
[Pi extension](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/subagent/README.md).
