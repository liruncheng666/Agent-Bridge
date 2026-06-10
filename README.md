# Agent-bridge

![CI](https://github.com/liruncheng666/Agent-Bridge/actions/workflows/ci.yml/badge.svg)

Use your phone to control a local AI on your computer — through Feishu / Lark. Send a task, watch it run in real time, check progress from anywhere. No terminal needed.

[中文 README](./README.zh.md)

## What it does

**Control your local AI from your phone.** Send a message in Feishu, and the bridge forwards it to Claude Code or Codex running on your machine. Replies stream back as a live card. Check task status with `/tasks`, switch projects with `/cd`, stop a run mid-way — all from the Feishu app on your phone.

**Bring teammates into the loop.** Add colleagues to a group, give them the right level of access (can edit, or read-only), and everyone can talk to the same AI together. The AI lives inside your team's conversation instead of being locked on one person's laptop — decisions get made where the discussion already happens.

**Multiple conversations stay separate.** Each group chat, topic thread, and document comment has its own session. Nothing crosses over.

Other capabilities:
- **Streaming card**: text and tool calls update on one card in real time.
- **Queueing**: messages sent while a run is in progress queue up for the next turn; `/new`, `/cd`, `/ws use`, and `/stop` can interrupt immediately.
- **Multiple workspaces**: `/cd` switches the project directory; `/ws` saves and restores named directories.
- **Images and files**: send them directly — the bridge downloads them locally before passing to the agent.
- **Interactive cards**: `/help`, `/ws list`, and `/status` return cards with clickable buttons.

## Prerequisites

- Node.js **>= 20.12.0**
- At least one local agent installed and logged in:
  - Claude Code: `claude`, see https://docs.anthropic.com/en/docs/claude-code/quickstart
  - Codex CLI: `codex`, see https://developers.openai.com/codex/cli
- A Feishu / Lark **PersonalAgent** app. The first-run QR wizard can create and bind one for you.

## Install

> **Windows users**: run the install command from an elevated PowerShell or Windows Terminal (right-click → "Run as administrator"). The standard Command Prompt may fail due to permission restrictions. The QR code also requires Windows Terminal or VS Code's terminal to render correctly — old cmd.exe shows garbled output.

```bash
npm i -g lark-ai-bridge
# or
pnpm add -g lark-ai-bridge
```

## First run

```bash
lark-ai-bridge run
```

The first run opens a QR-code wizard — the whole process takes about a minute:

1. A QR code renders in your terminal. If it looks garbled on Windows, switch to Windows Terminal or VS Code's integrated terminal.
2. Scan the QR code with the Feishu / Lark app. Feishu opens a "Create personal app" page — just tap **Create**. No developer account or form-filling needed.
3. After scanning, the terminal prints `✓ 应用创建成功` (app created).
4. The bridge automatically configures lark-cli. If the install times out on a slow network, a manual install hint is printed — all other features still work.
5. The terminal prints a message telling you to search for your bot in Feishu and start a DM.

**Finding your bot**: open Feishu → type the app name in the top search bar (the default name is usually your name + "的个人助手") → open the DM → send a message to test.

You do not need to choose a project directory up front. The bridge creates a profile-managed default working directory; after startup, send `/cd <path>` in Feishu / Lark to switch to a real project.

If you already have a PersonalAgent app, pass `--app-id` during initialization to skip app creation. The command prompts for the App Secret.

```bash
lark-ai-bridge run --app-id cli_xxx
# or initialize and start the background service directly
lark-ai-bridge start --app-id cli_xxx
```

For Lark global apps, add `--tenant lark`.

## Background service

Use `run` for first-run setup and foreground debugging. After the bot can send and receive messages, stop the foreground process with `Ctrl-C`, then use an OS-managed service for background operation:

```bash
lark-ai-bridge start
lark-ai-bridge status
lark-ai-bridge stop
```

Install globally before using service commands. The daemon's launchd plist / systemd unit / Windows task records the bridge CLI path; if that path comes from an npm temp cache through `npx`, the daemon can break when the cache is cleaned. `run` is fine through `npx` as a one-shot foreground process.

Service commands install a per-profile service:

```bash
lark-ai-bridge start [--profile <name>]
lark-ai-bridge stop [--profile <name>]
lark-ai-bridge restart [--profile <name>]
lark-ai-bridge status [--profile <name>]
lark-ai-bridge unregister [--profile <name>]
```

Platform mapping:
- **macOS**: launchd user agent `ai.agent-bridge.bot.<profile>`
- **Linux**: systemd user unit `agent-bridge.bot.<profile>.service`
- **Windows**: Task Scheduler task `AgentBridge.Bot.<profile>`, launched through a `.cmd` wrapper

Daemon logs are under `~/.agent-bridge/profiles/<profile>/logs/daemon/`.

### Multiple profiles: Claude and Codex

By default, the bridge starts with the currently selected profile. Use `profile use <name>` to change it. Each profile keeps its own app credentials, sessions, working directories, and logs. Create multiple profiles only when you need to connect multiple PersonalAgent apps, or run Claude and Codex as separate bots:

```bash
lark-ai-bridge start --profile claude --agent claude
lark-ai-bridge start --profile codex --agent codex
```

For example, to restart only the Codex bot:

```bash
lark-ai-bridge restart --profile codex
lark-ai-bridge status --profile codex
```

## Commands

### Host CLI

```text
lark-ai-bridge run [--profile <name>] [--agent claude|codex] [--workspace <path>] [-c <config>]
lark-ai-bridge migrate [--profile <name>] [--agent claude|codex]
lark-ai-bridge ps
lark-ai-bridge kill <id|#>
lark-ai-bridge --help
```

`profile use <name>` changes the profile used by later default starts. Use these profile management commands when running separate Claude / Codex bots, connecting multiple PersonalAgent apps, or doing scripted deployment:

```bash
lark-ai-bridge profile create claude --agent claude
lark-ai-bridge profile create codex --agent codex
lark-ai-bridge profile list
lark-ai-bridge profile use <name>
lark-ai-bridge profile remove <name>
lark-ai-bridge profile remove <name> --purge --yes
lark-ai-bridge profile export <name> [--output ./profile.json] [--force]
lark-ai-bridge profile export <name> --include-secrets --yes
```

`profile remove` archives local state by default, including the active profile. If other profiles remain, the bridge switches to the next one; if it was the last profile, the root config is cleared so the same name can be created again. `--purge --yes` permanently deletes local state. `profile export` redacts app secrets by default; `--include-secrets --yes` includes sensitive config.

If a profile was created with the wrong agent kind, stop or unregister any matching background service first, then run `profile remove <name>` and recreate it with the intended `--agent`.

### Slash commands inside Feishu / Lark

| Command | Effect |
|---|---|
| `/new`, `/reset` | Clear the current session |
| `/cd <path>` | Switch working directory and reset the session |
| `/ws list` | List named workspaces |
| `/ws save <name>` | Save the current working directory as a named workspace |
| `/ws use <name>` | Switch to a named workspace |
| `/ws remove <name>` | Delete a named workspace |
| `/resume` | Resume compatible history for the same agent, working directory, and permission mode |
| `/status` | Show profile, agent, working directory, session, and run state |
| `/config` | Adjust presentation preferences and view the access panel; shows group role panel inside groups |
| `/role @name collaborator` | Set someone as a collaborator in the current group (can read/write workspace) |
| `/role @name participant` | Set someone as a participant in the current group (read-only) |
| `/role @name remove` | Remove someone from the current group role list |
| `/role list` | Show current group role configuration |
| `/invite user @name` | Allow a user to use the bot in DMs |
| `/invite admin @name` | Add an access-control admin |
| `/invite group` | Allow the current group to use the bot |
| `/invite all group` | Allow all groups the bot has joined |
| `/remove user @name`, `/remove admin @name`, `/remove group` | Remove access entries |
| `/stop` | Stop the current run, including the card stop button |
| `/timeout [N\|off\|default]` | Set or clear the current session idle watchdog |
| `/ps` | List local bridge processes |
| `/exit <id\|#>` | Stop a bridge process |
| `/reconnect` | Force a WebSocket reconnect |
| `/doctor [description]` | Run low-sensitive diagnostics |
| `/help` | Help card |

DMs do not require an @ mention. Groups and topic groups require `@bot` by default; `@all` is ignored. Cloud-doc comments in supported document types run when the bot is mentioned.

## Working directories

Each profile may define a default working directory through `workspaces.default`. New profiles may be created with `--workspace <path>`; if omitted, the bridge creates a profile-managed default working directory.

This is a profile-field snippet. Do not replace the whole `config.json` with it; edit the matching profile's `workspaces` field.

```json
{
  "workspaces": {
    "default": "/Users/me/.agent-bridge-workspaces/claude/default"
  }
}
```

The bridge checks that a selected directory exists, is a directory, and is not an overly broad location such as `/`, the home root, a system directory, or a temp root. The working directory is only the current directory for an agent run. It is not a filesystem sandbox; actual file access still depends on the local agent process and its permission mode.

## Permission modes

The recommended user-facing profile config is `permissions.defaultAccess` and `permissions.maxAccess`. New profiles default to `full` for both values so the bridge can keep local tools, authorization flows, file writes, and other agent features fully usable. To tighten a profile, set one or both values to `workspace` or `read-only`; stricter modes can limit local tool execution, login/authorization flows, file writes, and similar capabilities.

This is a profile-field snippet. Do not replace the whole `config.json` with it; edit the matching profile's `permissions` field.

```json
{
  "permissions": {
    "defaultAccess": "full",
    "maxAccess": "full"
  }
}
```

Mode mapping:

| Bridge access | Claude permission mode | Codex mode |
|---|---|---|
| `full` | `bypassPermissions` | `danger-full-access` |
| `workspace` | `acceptEdits` | `workspace-write` |
| `read-only` | `plan` | `read-only` |

The legacy `sandbox` field is still readable for old configs. After the bridge saves the profile, it migrates that setting to canonical `permissions`.

## Data directories

| Path | Content |
|---|---|
| `~/.agent-bridge/config.json` | Root config with profiles and active profile |
| `~/.agent-bridge/active-profile` | Last selected profile |
| `~/.agent-bridge/profiles/<profile>/sessions.json` | Session state |
| `~/.agent-bridge/profiles/<profile>/sessions.json.catalog.json` | Agent-aware session catalog |
| `~/.agent-bridge/profiles/<profile>/workspaces.json` | Current and named workspace bindings |
| `~/.agent-bridge/profiles/<profile>/secrets.enc` | Profile-local encrypted secrets |
| `~/.agent-bridge/profiles/<profile>/media/` | Attachment cache |
| `~/.agent-bridge/profiles/<profile>/logs/` | Structured run logs |
| `~/.agent-bridge/registry/processes.json` | Local process registry |
| `~/.agent-bridge/registry/locks/` | Profile and app locks |

Set `LARK_CHANNEL_HOME=/path/to/state` to move all local bridge state. `AGENT_BRIDGE_LOG_DAYS` overrides log retention.

## Access control and group roles

Out of the box, **only you can use the bot** — the person who scanned the QR code to set it up. No configuration needed for solo use.

### Roles in a group

Each group has three levels. Roles are per-group — the same person can have different roles in different groups.

| Role | Who | What they can do |
|---|---|---|
| **Owner** | You (app creator) | Everything, everywhere |
| **Collaborator** | Someone you assign | Read/write the workspace + commands |
| **Participant** | Everyone else (per group policy) | Read-only |

```
/role @name collaborator   # give someone read/write access in this group
/role @name participant    # give someone read-only access
/role @name remove         # remove their role
/role list                 # see who has what role
```

By default, anyone not in the role list is silently ignored. To open a group so everyone defaults to read-only, send `/config` in the group and switch the policy to `open-participant`.

### DM access and admins

| Command | Effect |
|---|---|
| `/invite user @them` | Let someone DM the bot |
| `/invite admin @them` | Make someone an admin (can manage settings, use bot in any group) |
| `/invite group` | Let the current group use the bot |
| `/remove user @them` / `/remove admin @them` / `/remove group` | Reverse the above |

Only you and admins can run these commands. You can never lock yourself out — DM the bot and send `/config` to get back in.

### Common setups

- **Just me** → default, nothing to do.
- **Teammate needs read/write in a group** → `/role @them collaborator` in that group.
- **Teammate needs to DM the bot** → `/invite user @them`.
- **Everyone in a group gets read-only** → `/config` in the group → set policy to `open-participant`.
- **Co-admin** → `/invite admin @them`.

Cloud-doc comments are document-scoped: anyone who can comment and mention the bot in a supported document can trigger a reply — no separate access list needed.

## Cloud-doc comments

Cloud-doc comments do not need a separate workspace binding or document allowlist. In supported document comments, mention the bot and the bridge replies in the same thread. Comment runs reuse the document session key and fall back to the user home directory when no document cwd was previously recorded.

## FAQ

**The bot stays silent or the local CLI never replies.** Usually the local `claude` or `codex` CLI is not logged in, or the current session points to a working directory that no longer exists. Send `/status` to inspect; `/new` often fixes it by starting a fresh session.

**The agent subprocess looks frozen (card stuck on the last frame).** The bridge supports an idle watchdog: if the agent emits nothing for N minutes, the process is killed and the card is annotated with the auto-termination reason. Disabled by default. Enable with `/config` globally, or `/timeout 10` for the current session; `/timeout off` disables it for the session; `/timeout default` clears the session override.

**The agent says it cannot see an image I sent.** Upgrade to the latest version. Releases before 0.1.0 had a filename-dedup bug.

## Codex CLI verification

Codex profiles store a binary pin with `binaryPath`, `realpath`, `version`, and `sha256`. The bridge verifies the pin before every Codex run and refuses to continue if the binary changes. Arbitrary `codex.flags` are not exposed; bridge-owned Codex argv is fixed.

## Testing and CI

Local checks:

```bash
pnpm test
pnpm typecheck
pnpm build
```

`pnpm test` includes unit, integration, and process-level adapter tests. CI runs on macOS, Ubuntu, and Windows with `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm typecheck`, and `pnpm build`.

> Modifying the code, opening a PR, releasing, or syncing updates across the team? See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development and collaboration workflow.

## Daily digest

The `/digest` command and the automatic daily digest require the local `claude` CLI to be installed and logged in (Claude Code). The bridge calls it to analyze run logs and sends the summary to your Feishu / Lark DM. If the CLI is not logged in, the digest silently degrades — all other features are unaffected.

## Optional telemetry

By default the bridge reports **nothing**: no metrics, no logs leave your machine, and it pulls in zero telemetry dependencies. The hook below is inert unless you opt in.

To wire up your own monitoring, point an environment variable at a module that default-exports (or exports `createAdapter`) an `AdapterFactory`:

```bash
AGENT_BRIDGE_TELEMETRY_MODULE=your-telemetry-package lark-ai-bridge start
```

That module receives every `log.*` event plus error/metric hooks and forwards them wherever you like. The interface is exported from the package root:

```ts
import type { AdapterFactory, TelemetryAdapter, TelemetryEvent } from 'lark-ai-bridge';

const createAdapter: AdapterFactory = (meta) => ({
  emit(event) {/* ship event */},
  recordError(err, ctx) {/* ship exception */},
  recordMetric(name, value, tags) {/* ship metric */},
  flush(timeoutMs) {/* drain buffered events */},
});
export default createAdapter;
```

A missing module, a bad factory, or a throwing adapter all degrade to noop — telemetry can never stop the bridge from starting or break logging.

## License

[MIT](./LICENSE) · Built on [lark-channel-bridge](https://github.com/zarazhangrui/feishu-claude-code-bridge) by zarazhangrui (MIT).
