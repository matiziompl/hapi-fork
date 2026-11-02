# AGY and Codex commands in HAPI

Fork v1.13 adds the documented AGY and Codex CLI command catalogs to the web/PWA
composer. Type `/` to search commands. Rows ending in `CLI` open the installed
agent's real terminal interface, using the existing authenticated HAPI terminal
transport. Wait for its prompt, then press **Send to CLI** or use the terminal's
input. Native menus, errors and confirmations remain visible in that interface.

Existing HAPI chat commands, including Codex `/model`, `/reasoning`, `/effort`,
`/permissions`, `/personality`, `/plan`, `/goal`, `/compact`, `/clear`, `/new`,
`/fast` and `/help`, retain their existing handling. `/status` and AGY `/usage`
and `/quota` retain the Hub status report. Custom commands retain precedence
over same-name built-ins. Native CLI commands cannot be combined with HAPI
attachments or scheduled message delivery; a rejected submission keeps its draft.

## Skills

In a Codex chat, type `$` and select a skill, for example:

```text
$skill-creator Create a skill for this repository.
Use $plugin:build and $review to check the change.
```

Type a partial name such as `$pony` to preview all matching skills, including
plugin names such as `$ponytail:ponytail-general` and `$ponytail:ponytail-review`.
Each row shows the full reference and its description; the selected skill's
description expands in full. Use the arrow keys and Enter/Tab, or click a row,
to insert its complete reference. A bare `$` lists all available skills.

The picker refreshes even when a prefix is pasted or restored directly. Cached
previews remain available during refresh. Loading, an empty catalog, no matches
and discovery failures have separate messages; **Reload skills** retries a failed
or empty catalog. Escape dismisses the picker even if discovery is still pending.
The list uses the active session's catalog; it does not invent aliases or skills
that the session's agent cannot discover. These picker refinements ship in v1.14
and do not require an additional Runner change beyond the v1.13 integration.

`$[skill-name]` is also accepted. HAPI obtains enabled skills and their real
paths from the current shared Codex app-server's `skills/list`, including plugin
skills. References become structured native skill inputs before entering the
native message queue. Multiple references, inline references and names containing
dots are supported; code examples, escaped references, unknown skills and
disabled skills remain literal text. The catalog is invalidated on native skill
changes and workspace changes, and refreshed when opening the skill picker.

For AGY, HAPI uses `agy --print /skills --output-format json` in the session's
directory, rather than guessing filesystem discovery rules. Its `/` suggestions
include the CLI's actual skill names, including plugin namespaces and manifest
entries. Invoking `/<skill-name>` uses AGY's existing headless expansion.

## Native terminal lifecycle

- Codex session terminals use the exact executable, configuration home, private
  endpoint and thread owned by the running HAPI runtime. They do not start a
  second engine for that thread. Native setting changes continue to flow through
  existing app-server notifications. A native `/cd` rebinds HAPI's file/Git
  handlers and skill discovery to the new directory.
- Codex `/import` opens a separate local CLI with the same configuration home:
  Codex disables this operation in remote clients. This local settings
  conversation does not cold-resume or retarget the current HAPI thread.
- AGY has one writer at a time. Opening its native terminal is refused during
  active, queued or retrying chat work. For an idle session, HAPI retires the warm
  headless process before launching the interactive CLI. New chat messages stay
  queued and cancelable until that CLI exits.
- Native terminals close when leaving the terminal view or losing its socket.
  HAPI stops the owned process tree; AGY's delivery gate is released after process
  exit and successful shutdown verification. A failed verification keeps delivery
  paused and reports an error. Ordinary shell-terminal reconnect behavior is
  unchanged.
- AGY conversation switches, forks and resets made inside the CLI remain in that
  terminal. Returning to HAPI resumes its original conversation identity. Native
  AGY terminal output and terminal-only turns are not imported as HAPI chat
  messages. HAPI's explicit model/effort/permission overrides remain its chat
  settings; global CLI configuration follows the native CLI's persistence rules.

## Availability and update requirements

Install the updated HAPI CLI on the Runner and reopen the affected sessions.
Updating only the Hub image cannot update an already running session wrapper.
The web client refuses native launch on an older wrapper instead of opening an
ordinary shell. Protocol fields are optional for compatibility with other agents
and existing clients.

The catalog exposes native entry points, not a claim that every feature works on
every machine. Installed CLI version, account access, native remote-client
restrictions and host hardware still apply. Examples include Windows-only sandbox
setup, desktop-app launch, paid reasoning workflows and native microphone access.
Native microphone/editor/clipboard commands operate on the Runner host, not the
browser device. The iOS and Android applications were not changed in this release.

No commands require interpreting user text as a shell command. CLI launch uses
an argv array. Command drafts stay in browser memory rather than URLs or persistent
storage; the Codex runtime token is passed through a scoped environment variable,
not command-line text, and is excluded from ordinary shell terminals.

Local Linux x64 Runner build:

```bash
cd ~/workspace/hapi
bun run --cwd cli scripts/build-executable.ts --target bun-linux-x64-baseline --outdir "$HOME/hapi-runner-v1.13"
```

This produces `~/hapi-runner-v1.13/bun-linux-x64-baseline/hapi`. Install it using
the Runner's established installation/service procedure; no service changes are
performed by this build. The upstream `hapi --version` package number remains
`0.33.3`; the independent fork counter is `v1.13`.
