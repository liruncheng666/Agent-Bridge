# Agent-bridge

A lightweight bot that bridges Feishu / Lark messenger with your local Claude Code or Codex CLI. Run one command, scan a QR code to bind a PersonalAgent app, and talk to your local coding agent from chat.

[中文 README](./README.zh.md)

## What it does

- Forwards Feishu / Lark messages to local Claude Code or Codex CLI. Send a DM directly, or `@bot` in a group.
- **Streaming card**: text replies and tool calls update on one Lark card in real time.
- **Session continuity**: each chat, topic, or document comment thread keeps its own session.
- **Queueing and batching**: messages sent in quick succession are handled together; messages sent during a run are queued for the next turn, while commands like `/new`, `/cd`, `/ws use`, and `/stop` can interrupt the current task.
- **Multiple workspaces**: use `/cd` to switch the current project, and `/ws` to save and reuse common project directories.
- **Images and files**: send them to the bot directly, and the bridge downloads them locally for the agent.
- **Interactive cards**: `/help`, `/ws list`, and `/status` return cards with clickable buttons.

## Prerequisites

- Node.js **>= 20.12.0**
- At least one local agent installed and logged in:
  - Claude Code: `claude`, see https://docs.anthropic.com/en/docs/claude-code/quickstart
  - Codex CLI: `codex`, see https://developers.openai.com/codex/cli
- A Feishu / Lark **PersonalAgent** app. The first-run QR wizard can create and bind one for you.

## Install

```bash
npm i -g agent-bridge
# or
pnpm add -g agent-bridge
```

## First run

```bash
agent-bridge run
```

The first run opens a QR-code wizard:

1. A QR code renders in your terminal.
2. Scan it with the Feishu / Lark app.
3. Pick or create a PersonalAgent app.
4. If prompted, choose which agent to initialize.
5. Config is written to `~/.agent-bridge/config.json`.

You do not need to choose a project directory up front. The bridge creates a profile-managed default working directory; after startup, send `/cd <path>` in Feishu / Lark to switch to a real project.

If you already have a PersonalAgent app, pass `--app-id` during initialization to skip app creation. The command prompts for the App Secret.

```bash
agent-bridge run --app-id cli_xxx
# or initialize and start the background service directly
agent-bridge start --app-id cli_xxx
```

For Lark global apps, add `--tenant lark`.

## Background service

Use `run` for first-run setup and foreground debugging. After the bot can send and receive messages, stop the foreground process with `Ctrl-C`, then use an OS-managed service for background operation:

```bash
agent-bridge start
agent-bridge status
agent-bridge stop
```

Install globally before using service commands. The daemon's launchd plist / systemd unit / Windows task records the bridge CLI path; if that path comes from an npm temp cache through `npx`, the daemon can break when the cache is cleaned. `run` is fine through `npx` as a one-shot foreground process.

Service commands install a per-profile service:

```bash
agent-bridge start [--profile <name>]
agent-bridge stop [--profile <name>]
agent-bridge restart [--profile <name>]
agent-bridge status [--profile <name>]
agent-bridge unregister [--profile <name>]
```

Platform mapping:
- **macOS**: launchd user agent `ai.agent-bridge.bot.<profile>`
- **Linux**: systemd user unit `agent-bridge.bot.<profile>.service`
- **Windows**: Task Scheduler task `AgentBridge.Bot.<profile>`, launched through a `.cmd` wrapper

Daemon logs are under `~/.agent-bridge/profiles/<profile>/logs/daemon/`.

### Multiple profiles: Claude and Codex

By default, the bridge starts with the currently selected profile. Use `profile use <name>` to change it. Each profile keeps its own app credentials, sessions, working directories, and logs. Create multiple profiles only when you need to connect multiple PersonalAgent apps, or run Claude and Codex as separate bots:

```bash
agent-bridge start --profile claude --agent claude
agent-bridge start --profile codex --agent codex
```

For example, to restart only the Codex bot:

```bash
agent-bridge restart --profile codex
agent-bridge status --profile codex
```

## Commands

### Host CLI

```text
agent-bridge run [--profile <name>] [--agent claude|codex] [--workspace <path>] [-c <config>]
agent-bridge migrate [--profile <name>] [--agent claude|codex]
agent-bridge ps
agent-bridge kill <id|#>
agent-bridge --help
```

`profile use <name>` changes the profile used by later default starts. Use these profile management commands when running separate Claude / Codex bots, connecting multiple PersonalAgent apps, or doing scripted deployment:

```bash
agent-bridge profile create claude --agent claude
agent-bridge profile create codex --agent codex
agent-bridge profile list
agent-bridge profile use <name>
agent-bridge profile remove <name>
agent-bridge profile remove <name> --purge --yes
agent-bridge profile export <name> [--output ./profile.json] [--force]
agent-bridge profile export <name> --include-secrets --yes
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

**Chat access is private by default: out of the box, only *you* can use the bot in DMs and groups.** "You" = whoever created / owns the Feishu app (the person who scanned the QR to set it up). The bot figures out who the app owner is automatically from Feishu, so **solo chat use needs zero configuration** — you can DM it and `@`-mention it in any group, and everyone else's chat messages are silently ignored. Cloud-doc comments are document-scoped; see below.

### Three-tier group roles

Roles are **per-group** — the same person can have different roles in different groups:

| Role | ID | Source | Inside workspace | Outside workspace |
|---|---|---|---|---|
| **Owner** | `owner` | App creator (resolved at runtime) | Full read/write + commands | Full read/write + commands |
| **Collaborator** | `collaborator` | Owner assigns via `/role` in the group | ✅ Read/write + commands | Restricted |
| **Participant** | `participant` | Others (per group policy) | ✅ Read-only | Restricted |

**Managing roles:**
```
/role @name collaborator   # set someone as collaborator in current group
/role @name participant    # set as participant (read-only)
/role @name remove         # remove from role list
/role list                 # show current group role config
```

DM the bot and send `/config` to manage roles across groups from a single view.

### Group policy

Each group can set a default visitor policy:

| Policy | Effect |
|---|---|
| `strict` (default) | Users not in any role list → silently ignored |
| `open-participant` | Everyone in the group defaults to participant (read-only) |

Send `/config` inside the group to switch the policy.

### Basic access control (legacy / DM)

For DM access and admin privileges, use the original invite commands:

| List | Controls | Add | Remove |
|------|----------|-----|--------|
| **Allowed users** | who can DM the bot | `/invite user @them` | `/remove user @them` |
| **Allowed chats** | which groups the bot answers in (everyone inside) | `/invite group` / `/invite all group` | `/remove group` |
| **Admins** | who can change settings and use the bot in any group | `/invite admin @them` | `/remove admin @them` |

> `/invite`, `/remove`, and `/role` can only be run by **you (the creator) and admins**.

### Two identities that bypass everything

- **You (the creator)**: subject to no list at all — DMs, any group, every command. You **can never lock yourself out**: even if the lists get messed up, DM the bot and send `/config` to get back in.
- **Admins**: can DM, run management commands like `/config`, and bypass the allowed-chats list.

### Common setups

- **Just me** → nothing to do; this is the default.
- **Let a teammate collaborate (read/write workspace)** → `/role @them collaborator` in the group
- **Open a group to read-only for everyone** → `/config` → set group policy to `open-participant`
- **Let a teammate DM the bot** → `/invite user @them`
- **Add a co-admin** → `/invite admin @them`

### Worth knowing

- Changes take effect on the **next message** — no restart needed.
- **In groups you must `@` the bot first** (DMs don't need it). That's a separate toggle (`/config` → "require @ in groups").
- Strangers get pure silence — no reply at all.
- Cloud-doc comments are document-scoped: anyone who can comment and mention the bot can trigger a reply.

### Advanced: editing the config file directly

`/role`, `/invite`, and `/config` write the profile's `access` field in `~/.agent-bridge/config.json`:

```json
{
  "schemaVersion": 2,
  "profiles": {
    "claude": {
      "agentKind": "claude",
      "access": {
        "allowedUsers": ["ou_xxxxxxxxxxxxx"],
        "allowedChats": ["oc_xxxxxxxxxxxxx"],
        "admins": ["ou_xxxxxxxxxxxxx"],
        "requireMentionInGroup": true,
        "groupRoles": {
          "oc_xxxxxxxxxxxxx": {
            "collaborators": ["ou_aaaaaaaaaaaaaaaa"],
            "participants": ["ou_bbbbbbbbbbbbbbbb"],
            "policy": "strict"
          }
        }
      }
    }
  }
}
```

To find IDs: have the person message the bot, then check the log:

```bash
grep '"event":"enter"' ~/.agent-bridge/profiles/<profile>/logs/bridge-$(date +%Y%m%d).jsonl | tail -5
```

Each line carries `chatId` and `senderId`. After a manual edit, **restart the bridge** or send `/reconnect` to apply it.

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

## Optional telemetry

By default the bridge reports **nothing**: no metrics, no logs leave your machine, and it pulls in zero telemetry dependencies. The hook below is inert unless you opt in.

To wire up your own monitoring, point an environment variable at a module that default-exports (or exports `createAdapter`) an `AdapterFactory`:

```bash
AGENT_BRIDGE_TELEMETRY_MODULE=your-telemetry-package agent-bridge start
```

That module receives every `log.*` event plus error/metric hooks and forwards them wherever you like. The interface is exported from the package root:

```ts
import type { AdapterFactory, TelemetryAdapter, TelemetryEvent } from 'agent-bridge';

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

[MIT](./LICENSE)

Agent-bridge is a derivative work based on [lark-channel-bridge](https://github.com/zarazhangrui/feishu-claude-code-bridge) (MIT). See [NOTICE](./NOTICE) for attribution.
