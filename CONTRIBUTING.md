# 贡献与开发指南（CONTRIBUTING）

> 本文档面向**修改 Agent-bridge 代码的人**。只是使用 bot 的同学看 [README.zh.md](./README.zh.md) 即可。

Agent-bridge 基于开源项目 lark-coding-agent-bridge 二次开发，详见 [NOTICE](./NOTICE)。

---

## 1. 本地开发环境

```bash
git clone https://github.com/liruncheng666/Agent-Bridge.git
cd Agent-Bridge
pnpm install        # 装依赖
pnpm build          # 构建 dist/（运行时实际加载的是 dist，不是 src）
npm i -g .          # 注册全局 agent-bridge 命令（首次一次即可）
```

前置依赖：

- Node.js **≥ 20.12**
- 本机已安装并登录 `claude`（Claude Code CLI）
- `lark-cli` **≥ 1.0.47**（需支持 `config bind --source`，旧版本会导致 bot 无法主动调用飞书 API）：`npm i -g @larksuite/cli`

---

## 2. 改代码后如何生效（重要）

`agent-bridge run` 运行的是 `dist/`，不是 `src/`。改完源码必须重新构建并重启进程：

```bash
pnpm build          # 1. 重新构建 dist
# 2. 在运行 bridge 的终端按 Ctrl-C 停掉旧进程
agent-bridge run    # 3. 重启，加载新代码
```

> ⚠️ 注意：
> - 飞书内 `/reconnect` 只重连 WebSocket、**不重新加载代码**。
> - `git pull` 也不会让正在运行的进程变化。
> - 代码生效只认「`pnpm build` + 重启进程」这一条路径。
> - 全局命令是软链到项目目录的，`pnpm build` 后无需重新 `npm i -g .`，直接重启即可。

---

## 3. 提交前自检（CI 三门）

推代码前先在本地跑一遍，与 CI 完全一致：

```bash
pnpm test           # unit + integration + process 测试
pnpm typecheck      # 类型检查
pnpm build          # 构建
# 或一条命令：
pnpm run ci:local
```

**三门必须全绿才提交。** 当前测试基线 500+ 用例，新增功能应同步补测试。

---

## 4. 分支与 PR 流程

`main` 是稳定主干，**不直接在 main 上改**。

```bash
git checkout -b feat/简短描述     # 1. 开功能分支
# 改代码 → pnpm run ci:local 自检 → 提交
git commit -m "feat: 描述改动"
git push -u origin feat/简短描述   # 2. 推分支
```

3. 在 GitHub 发起 **Pull Request**（合并到 main）。
4. push / PR 自动触发 **CI**：在 macOS / Ubuntu / Windows 三系统跑三门（见 `.github/workflows/ci.yml`）。
5. CI 全绿 +（建议）他人 review 后，合并到 main。

提交信息建议用前缀：`feat:` 新功能 / `fix:` 修复 / `refactor:` 重构 / `test:` 测试 / `docs:` 文档 / `chore:` 杂项。

---

## 5. 团队同步更新

改代码的人推到 main 后，其他同学这样同步到本地：

```bash
git pull            # 拉最新代码
pnpm install        # 依赖有变化时才需要
pnpm build          # 重新构建 dist（dist 不进仓库，必须本地构建）
# Ctrl-C 后重启 agent-bridge run
```

> 改代码的人自己不需要 `git pull`——本地就是源头，已是最新；只需 `pnpm build` + 重启即可生效。

---

## 6. 发布版本

`dist/` 不进仓库，使用者各自构建，所以「发布」= 在 main 上打一个版本标记：

```bash
# main 稳定后
git tag v0.3.0
git push --tags
```

同学按 tag 取稳定版（`git checkout v0.3.0`）。版本号遵循语义化版本（主.次.修订）。后续如需更正式的发布（GitHub Release / 内部 npm），再在 CI 中扩展。

---

## 7. 凭据与安全

- 飞书应用凭据、扫码登录态存在各自的 `~/.agent-bridge/`，**不在项目目录、不会被提交**。
- 每个人绑定自己的飞书 PersonalAgent 应用，互不影响。
- `dist/`、`node_modules/`、`.env` 已在 `.gitignore` 中排除。
- 提交前确认改动中没有硬编码的 app secret、token、appId 等敏感信息。

---

## 8. 协议红线（二次开发时务必保留）

以下是与飞书 / lark-cli 对接的协议常量，**改了就会导致扫码、绑定、飞书功能失灵**，重命名 / 重构时绝对不要动：

- `--source lark-channel`（lark-cli 绑定 source 值）
- `LARK_CHANNEL` / `LARK_CHANNEL_HOME` / `LARK_CHANNEL_PROFILE` / `LARK_CHANNEL_CONFIG` / `LARKSUITE_CLI_CONFIG_DIR`（bridge 与 lark-cli 之间的环境变量约定）
- 飞书扫码注册使用的 source 值
- 自我回复检测标记、`source === 'lark-channel-bridge'` 元数据标记

用户可见的品牌（命令名 `agent-bridge`、数据目录 `~/.agent-bridge`、文案）已统一改名；上述协议值刻意保留原值。
