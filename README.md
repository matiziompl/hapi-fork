# HAPI

## matiziompl fork

This repository develops a fork of [tiann/hapi](https://github.com/tiann/hapi).
The upstream source imported for this fork is commit `f8e55fb930cde45dd4ef5cc5dd1fac0a047f38b8` from `matiziompl/hapi`.
The upstream package version and protocol remain independent of this fork's release counter.

### Deployment architecture

The **Hub** runs on Serweusz (Debian 13) using Docker Compose. The **Runner** runs
separately in the Ubuntu 24.04 `ai-workspace` Podman container and connects to the
Hub on the host. They do not share a filesystem. File previews use the code
already supplied in agent operations, rather than reading Runner paths on the Hub.

Copy the project source to `~/docker/hapi` on Serweusz while preserving the
existing destination `data/` and local secrets. Do not copy workspace `data/`,
`.env`, `node_modules/`, `.tools/`, or generated build output over the target.
Review the destination before copying; no data synchronization policy is implied.

The earlier operator-provided `docker-update.sh hapi` stops Compose, deletes
`~/docker/hapi`, recursively copies `~/workspace/hapi` there, including hidden
files such as `.git`, and rebuilds/starts Compose. **This script does not preserve
the destination `data/`, `.env`, or Git state.** With the current data bind mount,
it can replace the live Hub database, credentials and settings with an older
workspace copy. Preserve the target state before using that destructive workflow;
the agent does not run it or modify the server automatically.

For subsequent iterations, the workspace is the source of both code and Git
history. The agent verifies each iteration and creates its local commit here.
The operator copies that committed version with:

```bash
bash "$HOME/workspace/hapi/scripts/update-from-workspace.sh" \
  "$HOME/workspace/hapi" "$HOME/docker/hapi"
```

Every handoff includes the complete invocation. If the operator does not have
the script, the agent also supplies its current contents and a command to save
it, for example at `~/update-from-workspace.sh` outside the source repository.
If the script is unsuitable for an update, the handoff supplies the complete
equivalent Bash commands with the same preflight and data protections.

The script checks the source repository and required files before stopping
Compose. It copies the complete set of tracked source files and `.git`, then
rebuilds/starts the Hub. Destination `data/`, `.env` and other untracked local
settings are retained. The previous destination `.git` is moved into a private
backup beside the project; its commits are not imported into the new history.
The project directory itself is retained. Ignored dependencies, local tools and
build output are not copied. Application-file deletions need explicit handling
in the relevant iteration; the script does not delete untracked destination files.

The publication repository is [matiziompl/hapi-fork](https://github.com/matiziompl/hapi-fork),
configured as `origin` in the workspace, with local development on `main`.
The original import remote is retained as `import-source`; its history and the
recorded source commit are preserved. Check the destination branch and tracking
when publication is requested. The confirmed author is configured locally in
this repository. Earlier uncommitted iterations are included in the first fork
commit, and the agent commits further verified iterations without requiring a
push. The copied `.git` contains these commits, the index and the remote settings;
the operator does not need to stage or commit the files again on Serweusz.
After checking the deployed version, publication is optional:

```bash
cd "$HOME/docker/hapi"
git push -u origin main
```

The source Git history must be complete and self-contained. A shallow repository
or one using external object alternates is rejected before deployment. GitHub
authentication remains on Serweusz, outside this project directory. The agent
does not log in, push, or restart production services automatically.

From that directory, the operator builds and starts the Hub with:

```bash
docker compose up -d --build
```

This command rebuilds and may recreate the production Hub. The Dockerfile builds
the local frontend and Hub into a [standalone Bun executable](https://bun.com/docs/bundler/executables)
with embedded web assets; it does not install an unmodified npm Hub. Existing Hub
data stays in the `./data` bind mount and the runtime retains UID 1000. The Runner
is not rebuilt, installed, or restarted by this Compose project.

The Compose defaults use `http://192.168.1.102:3006` as the public URL and allowed
browser origin. Adjust both `HAPI_PUBLIC_URL` and `CORS_ORIGINS` when changing the
public address. Keep authentication enabled and preserve the Hub's existing data.

### Fork additions

- The current fork version appears at the bottom left of the web app.
- The composer has a **Status and limits** button. Hide or reposition it in
  **Settings → Chat → Input → Customize composer toolbar layout** (Hidden tools).
  Clicking it preserves the current draft, attachments and scheduled send.
  An immediate `/status` without attachments displays the same report in chat
  for every agent; AGY also accepts `/quota` and `/usage`.
  Live account quotas and reset times are supported for Codex and Antigravity.
  Other integrations show session settings and explicitly report unknown account
  quotas. This is separate from HAPI's token/cost usage ledger.
- File read/write operations can expose a collapsible code preview in the
  conversation. Previews are limited to 80 lines / 8,000 characters per snippet
  and eight snippets per operation. Open the operation for its full payload.
  Shell operations without an unambiguous file payload cannot provide a file
  preview. Pending or failed writes are labelled as proposed content.
- Interactive terminals use a black and green console palette inspired by
  Downloadeusz while preserving ANSI colors, keyboard input and existing transport.
- Reopening a Codex thread already owned by an active conversation opens that
  conversation when its namespace, machine, directory and native thread match.
  Ambiguous or inaccessible owners are reported as unavailable; the runtime
  ownership lock is preserved and existing conversation rows are retained.

### Reopening a thread already open in native Codex

On POSIX systems, the Runner's Codex adapter can reuse an already loaded thread
through the same user's default [Codex app-server Unix socket](https://learn.chatgpt.com/docs/app-server#protocol).
Discovery checks loaded-thread membership and the recorded working directory;
it does not start a turn, unload the thread or take over its writer lock.
Attachment preserves the native model, developer instructions, MCP setup and
collaboration settings. Closing HAPI detaches its wrapper while preserving the
native process, queue and uploaded files still referenced by native work. For
this attached case, ending the Hub view archives its Hub row without archiving
the native conversation. Unloaded threads keep the existing private-engine path.

**This requires the patched HAPI CLI in the Runner container. Rebuilding only
the Hub image does not update that executable.** The local Linux x64 build is
`.tools/runner-v1.4/bun-linux-x64-baseline/hapi`. It is an ignored build artifact,
not a production installation. The agent does not install it or restart Runner.
A manual executable update can trigger the existing Runner's automatic mtime
handoff/restart when `HAPI_DISABLE_VERSION_HANDOFF` is not set. Verify the active
CLI path and take a binary backup before applying an operator-controlled update.
No native writer lock should be removed and no unrelated Codex process killed.
If the native writer cannot be attached, Hub returns `resume_unavailable` (HTTP
409), retaining the archived row, rather than claiming a successful reopen.

### Account status and quotas

The Hub intercepts immediate status requests before they reach the model and
stores the request and report in chat. The existing authenticated session and
Bash RPC transport runs a fixed, bounded probe on the session machine. No new
Runner binary, provider tokens on the Hub, or shared filesystem is required.
The session machine needs `node` and the corresponding authenticated agent on
its PATH. The button is disabled for inactive sessions.

Codex is queried through a separate, short-lived `codex app-server` using only
initialization and [`account/rateLimits/read`](https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt).
It never loads a thread or changes the active writer. Antigravity uses its native
one-shot `agy --print /usage --output-format json`; its installed version must
support structured [usage reports](https://antigravity.google/docs/cli/commands/usage/).
Both use the session process's inherited account environment. Unavailable accounts,
API-key-only Codex accounts, missing Node.js, old agents and disconnected sessions
produce an unavailable result rather than invented quota values. The Web chat
renders status in a compact CLI-style panel with quota bars. Clocks use
`Europe/Warsaw`, including daylight-saving changes, in 24-hour format with
minute precision and no timezone suffix. Reset countdowns use whole minutes.
The status button also works over HTTP where `crypto.randomUUID` is unavailable.
The bare commands are reserved by the Hub; commands with arguments, attachments
or a scheduled delivery retain their existing delivery behavior.

### Close a session without archiving

Each active session's **More Actions → Close session** stops its agent and keeps
the conversation available for reopening. Archive remains a separate action.
The Hub waits for an inactive session with `lifecycleState: 'closed'`; a missing
close handler or unconfirmed stop is reported as an error.

This action requires the updated HAPI CLI on the Runner machine and sessions
started with that CLI. Updating the Hub alone is enough for the status panel,
but not for non-archiving close. Existing sessions from older CLI versions must
be reopened after the operator updates the CLI. No automatic Runner update or
service restart is performed.

Codex closes the selected Hub root, interrupts its active turn, and releases only
queue entries proven to have been submitted by HAPI. Other native clients' queued
input is retained. Shared wrappers keep other roots running; borrowed Codex
daemons are detached without archiving the native thread or terminating the
daemon. Other agents use their existing launcher teardown before reporting closure.

Fork v1.8 fixes reopening a closed or archived Codex root while its old shared
wrapper still serves other conversations. The Runner releases only that root's
cached spawn result and recovery entry, so ReOpen starts a new attachment instead
of returning a stale success. On Runner startup, old entries are released only
when the matching runtime explicitly records the root as inactive; uncertain
ownership stays protected. Existing session IDs, history and sibling roots are
retained. This fix requires updating the Runner CLI; rebuilding the Hub alone
does not apply it. A local Linux x64 build is available at
`.tools/runner-v1.8/bun-linux-x64-baseline/hapi` after building it with
`bun run --cwd cli build:exe --target bun-linux-x64-baseline --outdir ../.tools/runner-v1.8`.
Installing it and restarting the Runner remain operator-managed actions.

### Development and fork versioning

Use the pinned Bun version from `package.json`:

```bash
bun install --frozen-lockfile
bun run test:fork-version
bun run typecheck:web
bun run typecheck:hub
bun run build:web
```

`FORK_VERSION` in `shared/src/buildInfo.ts` is the only source of the fork version.
The existing `APP_VERSION` continues to describe the upstream code and is used for
upstream compatibility checks. Do not replace it with the fork release counter.

After the initial fork release, increment the minor counter **once per user task
that makes persistent changes**, including documentation and configuration:

```bash
bun run version:bump
# Document the actual changes and verification in docs/vN.M.md.
bun run version:check
```

The sequence is `v1.9` → `v1.10`, without an automatic major-version rollover.
`version:bump` also updates the generated footer at the very end of this README.
`bun run build:web` synchronizes that footer automatically without incrementing
the version. Use `bun run version:sync` after a manual version edit. Never bump
again for fixes, tests, builds, or status questions within the same ongoing task.
Production verification and GitHub publication are performed by the operator on
Serweusz; local checks do not establish that deployment succeeded.

## Upstream documentation

Run official Claude Code / Codex / Cursor Agent / Grok Build / OpenCode / Kimi / Copilot / Antigravity / Pi / DeepSeek Harness sessions and control them remotely through native iOS / Android apps, Web / PWA, or Telegram Mini App.

> **Why HAPI?** HAPI is a local-first alternative to Happy. See [Why Not Happy?](docs/guide/why-hapi.md) for the key differences.

## Features

- **Seamless Handoff** - Work locally, switch to remote when needed, switch back anytime. No context loss, no session restart.
- **Shared Codex Sessions** - Use Codex from your terminal and phone at the same time. Requires Codex 0.154.0+. [Usage and limits](docs/guide/codex-shared-sessions.md).
- **Native First** - HAPI wraps your AI agent instead of replacing it. Same terminal, same experience, same muscle memory.
- **AFK Without Stopping** - Step away from your desk? Approve AI requests from your phone with one tap.
- **Your AI, Your Choice** - Claude Code, Codex, Cursor Agent, Grok Build, OpenCode, Kimi, Copilot, Antigravity, Pi, DeepSeek Harness—different agents, one unified workflow.
- **Terminal Anywhere** - Run commands from your phone's browser or desktop web app, directly connected to the working machine.
- **Voice Control** - Use dictation in native apps, or talk to your AI agent hands-free with the web voice assistant.
- **Workspace Browser** - Opt-in via one or more `hapi runner start --workspace-root <path>` flags: browse scoped file trees from the web and start sessions in allowed subdirectories.

## Demo

https://github.com/user-attachments/assets/38230353-94c6-4dbe-9c29-b2a2cc457546

## Getting Started

```bash
npx @twsxtd/hapi hub --relay     # start hub with E2E encrypted relay
npx @twsxtd/hapi                 # choose an agent and start a session
```

`hapi server` remains supported as an alias.

Use `hapi <agent> [options]` to start an agent directly, for example `hapi claude`
or `hapi codex`. Scripts must specify the agent explicitly. `hapi --help` shows
HAPI's commands and supported agents.

The hub displays a URL and two QR codes. Then connect a client:

- **Web / PWA (free):** open the web URL in a browser, or scan the web QR code. [Install it as a PWA](docs/guide/pwa.md) for a home-screen app and push notifications.
- **Native apps (paid):** install HAPI from the [App Store](https://apps.apple.com/app/id6805699104) or [Google Play](https://play.google.com/store/apps/details?id=run.hapi.companion), then scan the companion QR. See [Native apps](docs/guide/native-apps.md) for pairing.

> The relay uses WireGuard + TLS for end-to-end encryption. Your data is encrypted from your device to your machine.

For self-hosted options (Cloudflare Tunnel, Tailscale), see [Installation](docs/guide/installation.md)

## Docs

- [Native apps (iOS / Android)](docs/guide/native-apps.md)
- [Web / PWA](docs/guide/pwa.md)
- [How it Works](docs/guide/how-it-works.md)
- [Supported Agents](docs/guide/agents.md)
- [AGY / Codex commands and skills in this fork](docs/guide/native-cli-commands.md)
- [Voice Assistant](docs/guide/voice-assistant.md)
- [Why HAPI](docs/guide/why-hapi.md)
- [FAQ](docs/guide/faq.md)

## Clients

- **Web / PWA (free)** - The full-featured web app, including the remote terminal and voice assistant. Works in any browser and installs as a PWA. See [Web / PWA](docs/guide/pwa.md).
- **Native iOS / Android apps (paid)** - SwiftUI/UIKit and Kotlin Compose clients with chat, approvals, session creation, files, dictation, and native push notifications. See the [native app guide](docs/guide/native-apps.md) for capabilities and pairing.

<a href="https://apps.apple.com/app/id6805699104"><img src="https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg" alt="Download on the App Store" height="48"></a>
<a href="https://play.google.com/store/apps/details?id=run.hapi.companion"><img src="https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png" alt="Get it on Google Play" height="72"></a>

Developers can build the apps from source: [iOS](ios/README.md), [Android](android/README.md). Protocol: [client contract](docs/api/client-contract/index.md).

## Build from source

Requires Bun 1.4.4.

```bash
bun install
bun run build:single-exe
```

## Credits

HAPI means "哈皮" a Chinese transliteration of [Happy](https://github.com/slopus/happy). Great credit to the original project.

<!-- hapi-fork-version:start -->
Current fork version: **v1.15**
<!-- hapi-fork-version:end -->
