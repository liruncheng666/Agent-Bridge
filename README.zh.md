# Agent-bridge

![CI](https://github.com/liruncheng666/Agent-Bridge/actions/workflows/ci.yml/badge.svg)

用手机通过飞书控制电脑上的本地 AI。发一条消息，任务就交给本机的 Claude Code 或 Codex 执行，回复实时推回来。不用打开终端，不用坐在电脑前。

[English README](./README.md)

## 主要功能

**手机就能控制本地 AI。** 在飞书发消息，bridge 把任务转给本机的 Claude Code 或 Codex CLI 执行，回复以实时卡片的形式流回来。用 `/tasks` 查任务进度，用 `/cd` 切项目，随时 `/stop` 中断——全在飞书 App 里操作，不需要打开终端。

**让团队一起和 AI 协作。** 把同事加进群，按需分配权限（能改文件，或只能看），大家在同一个群里和 AI 一起讨论、推进任务。AI 就在团队对话里，不是某一个人电脑上的私人工具——讨论和决策发生在同一个地方。

**多个对话互不干扰。** 每个群聊、每个话题、每条文档评论各自维护独立会话，不会串台。

其他能力：
- **流式卡片**：文本回复和工具调用实时更新在同一张卡片上。
- **消息排队**：任务运行中收到的消息会排队到下一轮；`/new`、`/cd`、`/ws use`、`/stop` 可以立即中断当前任务。
- **多工作空间**：用 `/cd` 切换项目目录，用 `/ws` 保存和复用常用目录。
- **图片 / 文件**：直接发给 bot，bridge 下载到本地后交给 agent 处理。
- **卡片按钮**：`/help`、`/ws list`、`/status` 返回可点击的交互卡片。

## 前置条件

- Node.js **>= 20.12.0**
- 本机至少安装并登录一个 agent：
  - Claude Code：`claude`，安装说明：https://docs.anthropic.com/en/docs/claude-code/quickstart
  - Codex CLI：`codex`，安装说明：https://developers.openai.com/codex/cli
- 一个飞书 / Lark PersonalAgent 应用。首次启动的扫码向导可以帮你创建并绑定。

## 安装

> **Windows 用户**：请用「以管理员身份运行」的 PowerShell 或 Windows Terminal 执行安装命令，普通命令提示符（cmd）可能因权限不足而失败。二维码需要 Windows Terminal 或 VS Code 终端才能正常渲染，老版 cmd 会显示乱码。

```bash
npm i -g lark-ai-bridge
# 或
pnpm add -g lark-ai-bridge
```

## 首次启动

```bash
lark-ai-bridge run
```

第一次运行会进入扫码向导，全程约 1 分钟：

1. 终端渲染二维码（若乱码，请换用 Windows Terminal 或 macOS 自带终端）。
2. 用飞书 App 扫码 → 飞书会打开「创建个人应用」页面，按提示点击「创建」即可，无需填写任何开发者信息。
3. 扫码完成后终端提示「✓ 应用创建成功」。
4. bridge 自动完成 lark-cli 配置（若国内网络安装超时，会打印手动安装提示，其他功能不受影响）。
5. 终端输出「bridge 启动后，打开飞书，在搜索框搜索你刚才创建的应用名称，打开私聊即可开始使用。」

**找到 bot 的方法**：打开飞书 → 顶部搜索框搜应用名（默认名称一般是你的姓名 + "的个人助手"）→ 点击私聊 → 发一条消息测试。

没有指定项目目录也可以启动。bridge 会创建一个 profile 托管的默认工作目录；启动后在飞书里发送 `/cd <path>` 切到实际项目。

如果已经有 PersonalAgent app，可以在初始化时传 `--app-id` 跳过创建应用流程；命令会提示输入 App Secret。

```bash
lark-ai-bridge run --app-id cli_xxx
# 或直接初始化并启动后台服务
lark-ai-bridge start --app-id cli_xxx
```

Lark 国际版应用可加 `--tenant lark`。

## 后台运行

`run` 适合首次配置和前台调试。确认 bot 能正常收发消息后，先用 `Ctrl-C` 停掉前台进程，再用系统服务常驻后台：

```bash
lark-ai-bridge start
lark-ai-bridge status
lark-ai-bridge stop
```

服务层命令必须先全局安装，不能直接用 `npx`。daemon 的 launchd plist / systemd unit / Windows 任务会记录 bridge CLI 的路径；如果这个路径来自 npm 临时缓存，缓存清掉后 daemon 就起不来。`run` 用 `npx` 单次启动没问题。

服务层命令按 profile 注册，每个 profile 有独立服务：

```bash
lark-ai-bridge start [--profile <name>]
lark-ai-bridge stop [--profile <name>]
lark-ai-bridge restart [--profile <name>]
lark-ai-bridge status [--profile <name>]
lark-ai-bridge unregister [--profile <name>]
```

平台映射：
- **macOS**：launchd 用户代理 `ai.agent-bridge.bot.<profile>`
- **Linux**：systemd 用户单元 `agent-bridge.bot.<profile>.service`
- **Windows**：Task Scheduler 任务 `AgentBridge.Bot.<profile>`，launcher 是 `.cmd`

daemon 日志在 `~/.agent-bridge/profiles/<profile>/logs/daemon/`。

### 多 profile：分别运行 Claude 和 Codex

默认情况下，bridge 使用当前激活的 profile；可以通过 `profile use <name>` 切换。每个 profile 会维护独立的应用凭据、会话、工作目录和日志。只有在需要同时连接多个 PersonalAgent 应用，或分别运行 Claude 和 Codex 时，才需要创建多个 profile：

```bash
lark-ai-bridge start --profile claude --agent claude
lark-ai-bridge start --profile codex --agent codex
```

例如只重启 Codex bot：

```bash
lark-ai-bridge restart --profile codex
lark-ai-bridge status --profile codex
```

## 命令速查

### 宿主 CLI

```text
lark-ai-bridge run [--profile <name>] [--agent claude|codex] [--workspace <path>] [-c <config>]
lark-ai-bridge migrate [--profile <name>] [--agent claude|codex]
lark-ai-bridge ps
lark-ai-bridge kill <id|#>
lark-ai-bridge --help
```

`profile use <name>` 会切换后续默认启动使用的 profile。需要同时跑 Claude / Codex 两个 bot、连接多套 PersonalAgent 应用，或做脚本化部署时，再使用这些 profile 管理命令：

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

`profile remove` 默认归档本地状态，也可以删除当前激活的 profile。若还剩其他 profile，会自动切到下一个；若这是最后一个 profile，会清空 root config，之后可以用同名重新创建。只有加 `--purge --yes` 才会永久删除。`profile export` 默认脱敏 app secret；只有加 `--include-secrets --yes` 才会导出敏感配置。

如果某个 profile 被建成了错误的 agent 类型，先 `stop` 或 `unregister --profile <name>` 清理对应后台服务，再 `profile remove <name>`，然后用正确的 `--agent` 重新创建。

### 飞书内斜杠命令

| 命令                                                       | 作用                            |
| -------------------------------------------------------- | ----------------------------- |
| `/new`, `/reset`                                         | 清空当前会话                        |
| `/cd <path>`                                             | 切换工作目录并重置会话                   |
| `/ws list`                                               | 列出命名工作空间                      |
| `/ws save <name>`                                        | 把当前工作目录保存为命名工作空间              |
| `/ws use <name>`                                         | 切换到命名工作空间                     |
| `/ws remove <name>`                                      | 删除命名工作空间                      |
| `/resume`                                                | 恢复同 agent、工作目录、权限模式兼容的历史会话    |
| `/status`                                                | 查看 profile、agent、工作目录、会话和运行状态 |
| `/config`                                                | 调整展示偏好、查看访问控制面板；群内额外展示群角色管理面板 |
| `/role @某人 讨论人`                                          | 在当前群把某人设为讨论人（可读写 workspace）   |
| `/role @某人 参与人`                                          | 在当前群把某人设为参与人（仅读 workspace）    |
| `/role @某人 移除`                                           | 从当前群角色名单移除某人                  |
| `/role list`                                             | 列出当前群的角色配置                    |
| `/invite user @某人`                                       | 允许用户私聊使用 bot                  |
| `/invite admin @某人`                                      | 添加访问控制管理员                     |
| `/invite group`                                          | 允许当前群使用 bot                   |
| `/invite all group`                                      | 允许 bot 所在的所有群使用               |
| `/remove user @某人`, `/remove admin @某人`, `/remove group` | 移除访问控制条目                      |
| `/stop`                                                  | 停止当前 run，也可点卡片停止按钮            |
| `/timeout [N\|off\|default]`                             | 设置或清除当前会话的 idle watchdog      |
| `/ps`                                                    | 列出本机 bridge 进程                |
| `/exit <id\|#>`                                          | 停止指定 bridge 进程                |
| `/reconnect`                                             | 强制 WebSocket 重连               |
| `/doctor [描述]`                                           | 执行低敏诊断                        |
| `/help`                                                  | 帮助卡片                          |

私聊不需要 @。群和话题群默认必须 `@bot`；`@all` 会被忽略。支持的云文档评论里 @bot 就会触发回复。

## 工作目录

每个 profile 都可以有一个默认工作目录：`workspaces.default`。新建 profile 时可以传 `--workspace <path>` 作为初始目录；没传时 bridge 会创建一个 profile 托管的默认工作目录。

下面只是 profile 里的字段片段，不要整段覆盖 `config.json`；请改对应 profile 下的 `workspaces` 字段。

```json
{
  "workspaces": {
    "default": "/Users/me/.agent-bridge-workspaces/claude/default"
  }
}
```

bridge 会检查所选目录存在、是目录，并且不是 `/`、Home 根、系统目录或临时目录根这类范围过大的位置。工作目录只是 agent run 的当前目录，不是文件系统 sandbox；agent 实际能访问哪些文件仍取决于本机 agent 进程及其权限模式。

## 权限模式

推荐给用户配置的是 `permissions.defaultAccess` 和 `permissions.maxAccess`。新 profile 默认两项都是 `full`，以保持 bridge 的本地工具、授权流程、文件写入等能力完整可用。如需收紧权限，可以改成 `workspace` 或 `read-only`；收紧后本地工具执行、登录 / 授权流程、文件写入等能力可能受限。

下面只是 profile 里的字段片段，不要整段覆盖 `config.json`；请改对应 profile 下的 `permissions` 字段。

```json
{
  "permissions": {
    "defaultAccess": "full",
    "maxAccess": "full"
  }
}
```

模式映射：

| Bridge access | Claude permission mode | Codex mode |
|---|---|---|
| `full` | `bypassPermissions` | `danger-full-access` |
| `workspace` | `acceptEdits` | `workspace-write` |
| `read-only` | `plan` | `read-only` |

旧版 `sandbox` 字段仍可读取。bridge 保存 profile 后，会把该设置迁移为 canonical `permissions`。

## 数据目录

| 路径 | 内容 |
|---|---|
| `~/.agent-bridge/config.json` | root config，包含 profiles 和 active profile |
| `~/.agent-bridge/active-profile` | 最近选择的 profile |
| `~/.agent-bridge/profiles/<profile>/sessions.json` | 会话状态 |
| `~/.agent-bridge/profiles/<profile>/sessions.json.catalog.json` | agent-aware 会话索引 |
| `~/.agent-bridge/profiles/<profile>/workspaces.json` | 当前和命名工作空间绑定 |
| `~/.agent-bridge/profiles/<profile>/secrets.enc` | profile 本地加密 secret |
| `~/.agent-bridge/profiles/<profile>/media/` | 附件缓存 |
| `~/.agent-bridge/profiles/<profile>/logs/` | 结构化运行日志 |
| `~/.agent-bridge/registry/processes.json` | 本机进程注册表 |
| `~/.agent-bridge/registry/locks/` | profile lock 和 app lock |

设置 `LARK_CHANNEL_HOME=/path/to/state` 可以迁移整棵本地状态目录。`AGENT_BRIDGE_LOG_DAYS` 可以调整日志保留天数。

## 访问控制与群角色

开箱即用时，**只有你能用这个 bot**——也就是扫码把它建起来的那个人。一个人用完全不需要任何配置。

### 群角色

每个群有三个级别，角色跟群走——同一个人在不同群可以有不同角色。

| 角色 | 谁 | 能做什么 |
|---|---|---|
| **Owner** | 你（应用创建者） | 全部权限，无限制 |
| **讨论人** | 你指定的人 | 可读写 workspace + 使用命令 |
| **参与人** | 其他人（按群策略） | 只读 |

```
/role @某人 讨论人    # 在当前群给某人读写权限
/role @某人 参与人    # 给某人只读权限
/role @某人 移除      # 移除角色
/role list            # 查看当前群角色配置
```

默认情况下，不在角色名单里的人发消息会被静默忽略。想让群里所有人都能只读，在群内发 `/config`，把群策略切换为"开放只读"。

### 私聊权限和管理员

| 命令 | 作用 |
|---|---|
| `/invite user @某人` | 允许某人私聊 bot |
| `/invite admin @某人` | 设为管理员（可改设置，在任意群都能用 bot） |
| `/invite group` | 允许当前群使用 bot |
| `/remove user @某人` / `/remove admin @某人` / `/remove group` | 撤销以上权限 |

只有你和管理员能执行这些命令。你永远锁不死自己——私聊 bot 发 `/config` 随时能找回控制权。

### 常见配置

- **只给自己用** → 默认就是，什么都不用做。
- **让同事在群里能读写文件** → 在群里发 `/role @他 讨论人`。
- **让同事能私聊 bot** → `/invite user @他`。
- **让整个群默认只读** → 在群里发 `/config`，把群策略设为"开放只读"。
- **加一个共同管理员** → `/invite admin @他`。

云文档评论按文档权限生效：能在支持的文档里评论并 @bot 的人即可触发回复，无需单独配置访问名单。

## 云文档评论

云文档评论不再需要单独绑定工作目录或维护文档白名单。支持的文档评论里 @bot 后，bridge 会在同一个评论线程里回复。评论运行复用文档级 session key；没有记录过文档 cwd 时回退到用户 home 目录。

## 常见问题

**bot 没反应 / agent 不回复**：通常是本机 `claude` 或 `codex` CLI 没登录，或者当前会话指向了不存在的工作目录。发 `/status` 看当前状态；`/new` 重开会话往往就好。

**agent 子进程假死（卡片停在最后一帧不动）**：支持 idle 探活。agent 一段时间没输出就会被 SIGTERM kill，卡片末尾会标出自动终止原因。默认关闭。开启方式：`/config` 设全局值（分钟），或 `/timeout 10` 只对当前会话生效；`/timeout off` 关掉当前会话的探活；`/timeout default` 清掉会话覆盖，回退到全局设置。

**图片发过去 agent 说看不到**：升级到最新版，0.1.0 之前的版本有文件名去重 bug。

## Codex CLI 安全校验

Codex profile 会记录 binary pin，包括 `binaryPath`、`realpath`、`version` 和 `sha256`。bridge 每次 Codex run 前都会复核 pin；二进制被替换时会拒绝继续运行。bridge 不开放任意 `codex.flags` 配置，Codex argv 由 bridge 固定生成。

## 测试与 CI

本地检查：

```bash
pnpm test
pnpm typecheck
pnpm build
```

`pnpm test` 包含 unit、integration 和 process-level adapter 测试。CI 在 macOS、Ubuntu、Windows 上执行 `pnpm install --frozen-lockfile`、`pnpm test`、`pnpm typecheck` 和 `pnpm build`。

> 要修改代码、提 PR、发布版本或在团队间同步更新？开发与协作流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 每日摘要（Daily Digest）

`/digest` 命令和每日自动摘要需要本机 `claude` CLI 已登录（Claude Code）。bridge 会调用它对运行日志做 AI 分析后发送到你的飞书私聊。未登录时摘要功能会静默降级——其他功能不受影响。

## 可选：遥测（Telemetry）

默认情况下 bridge **不上报任何数据**：没有指标、没有日志离开你的机器，也不引入任何遥测依赖。下面这个钩子在你主动开启前完全是空操作。

想接自己的监控时，用环境变量指向一个 default export（或导出 `createAdapter`）`AdapterFactory` 的模块：

```bash
AGENT_BRIDGE_TELEMETRY_MODULE=your-telemetry-package lark-ai-bridge start
```

该模块会收到每一条 `log.*` 事件，以及错误 / 指标钩子，转发到任何你想要的地方。接口从包根导出：

```ts
import type { AdapterFactory, TelemetryAdapter, TelemetryEvent } from 'lark-ai-bridge';

const createAdapter: AdapterFactory = (meta) => ({
  emit(event) {/* 上报事件 */},
  recordError(err, ctx) {/* 上报异常 */},
  recordMetric(name, value, tags) {/* 上报指标 */},
  flush(timeoutMs) {/* 冲刷缓冲事件 */},
});
export default createAdapter;
```

模块不存在、工厂函数不合法、或者 adapter 抛错，都会降级为空操作——遥测永远不会阻止 bridge 启动，也不会打断日志。

## 许可

[MIT](./LICENSE) · 基于 [lark-channel-bridge](https://github.com/zarazhangrui/feishu-claude-code-bridge)（zarazhangrui，MIT）二次开发。
