# purplemux

**Claude Code 与 Codex,多任务同时进行。更快。**

一屏纵览所有会话,在手机上也毫无中断。

简体中文 | <a href="README.md">English</a> | <a href="README.ko.md">한국어</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.ru.md">Русский</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.tr.md">Türkçe</a>

![purplemux](docs/images/screenshot.png)

![purplemux mobile](docs/images/screenshot-mobile.png)

## 安装

```bash
npx purplemux@latest
```

在浏览器中打开 [http://localhost:8022](http://localhost:8022)。完成。

> 需要 Node.js 20+ 和 tmux。macOS 或 Linux。

想用原生应用?可从[最新发布](https://github.com/subicura/purplemux/releases/latest)下载 macOS Electron 版(适用于 Apple Silicon 与 Intel 的 `.dmg`)。

## 为什么选择 purplemux

- **多会话仪表盘** — 一眼掌握所有 Claude Code 与 Codex 会话的「运行中 / 等待输入」状态
- **速率限制监控** — 显示 5 小时 / 7 天剩余额度及重置倒计时
- **推送通知** — 任务完成或需要输入时,桌面与移动端推送提醒
- **移动端 & 多设备** — 在手机、平板或其他桌面都能访问同一会话
- **实时会话视图** — 无需滚动 CLI 输出,进度以时间线形式呈现

此外

- **不中断的会话** — 基于 tmux。关闭浏览器后会话与工作环境依然保留。重新连接时,标签、面板、目录均保持最后状态
- **自托管 & 开源** — 代码与会话数据仅存在本机,不经任何外部服务器
- **加密远程访问** — 通过 Tailscale 在任何地点使用 HTTPS 接入

## 与官方 Remote Control 的区别

> 官方 Remote Control 专注于单一会话的远程控制。当你需要多会话管理、推送通知与会话持久化时,请使用 purplemux。

## 功能

### 终端

- **面板分割** — 水平 / 垂直自由分割,可拖拽调整大小
- **标签管理** — 多标签、拖拽排序、基于进程名的自动标题
- **键盘快捷键** — 分割、切换标签、焦点移动
- **终端主题** — 深色 / 浅色模式,多种配色主题
- **工作区 & 分组** — 以工作区为单位保存 / 恢复面板布局、标签与工作目录。通过拖拽将工作区组织为分组进行管理
- **Git 工作流** — 支持 Side-by-side / Line-by-line 切换与语法高亮,以及行内 hunk 展开、分页历史标签。可从面板直接 fetch / pull / push (含 ahead/behind 指示) — 同步失败时 (dirty worktree、冲突) 一键 Ask Claude 或 Codex
- **内置浏览器面板** — 在终端旁嵌入浏览器查看开发结果 (Electron)。可通过 `purplemux` CLI 控制,并内置设备模拟器切换视口
- **智能体标签** — 从新建标签菜单启动 Claude、Codex 或统一会话列表

### Claude Code 与 Codex 集成

- **实时状态** — 运行中 / 等待输入指示,支持在会话间切换
- **实时会话视图** — 消息、工具调用、任务、权限请求、thinking 区块
- **Codex 标签** — 使用与 Claude 相同的 tmux 持久化能力启动 Codex CLI 会话
- **会话列表** — 在统一视图中浏览并恢复最近的 Claude 与 Codex 会话
- **一键 Resume** — 直接从浏览器恢复已中断的 Claude 或 Codex 会话
- **自动 Resume** — 服务器启动时自动恢复之前的 Claude 会话
- **快速提示** — 注册常用提示,一键发送
- **附件** — 在聊天输入中拖入图片,或附加文件以自动插入路径。移动端同样可用
- **消息历史** — 复用之前的消息
- **用量统计** — Claude + Codex Token、成本、按项目拆分、每日 AI 报告
- **速率限制** — 支持的提供方的 5 小时 / 7 天剩余额度,重置倒计时

### 移动端 & 易用性

- **响应式 UI** — 在手机 / 平板上使用终端与时间线
- **PWA** — 添加到主屏幕,体验接近原生应用
- **Web Push** — 关闭标签也能接收通知
- **多设备同步** — 工作区变更实时同步
- **Tailscale** — 通过 WireGuard 加密隧道从外部进行 HTTPS 访问
- **密码认证** — scrypt 哈希,即便对外暴露也安全
- **多语言支持** — 한국어、English、日本語、中文 等 11 种语言

## 支持的平台

| 平台 | 状态 | 备注 |
|---|---|---|
| macOS (Apple Silicon / Intel) | ✅ | 包含 Electron 应用 |
| Linux | ✅ | 不含 Electron |
| Windows | ❌ | 不支持 |

## 安装详情

### 前置要求

- macOS 13+ 或 Linux
- [Node.js](https://nodejs.org/) 20+
- [tmux](https://github.com/tmux/tmux)

Claude 标签需要。安装 Claude Code,并在启动 Claude 标签前登录:

```bash
curl -fsSL https://claude.ai/install.sh | bash
# 或使用 Homebrew latest 频道
brew install --cask claude-code@latest
```

Codex 标签为可选。安装 Codex CLI,并在启动 Codex 标签前登录:

```bash
npm i -g @openai/codex
# 或
brew install --cask codex
```

### npx (最快)

```bash
npx purplemux@latest
```

### 全局安装

```bash
npm install -g purplemux
purplemux
```

### CLI 示例

```bash
purplemux tab create -w WS -t codex-cli -n "fix auth"
purplemux tab create -w WS -t agent-sessions
```

### 从源码运行

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

开发模式:

```bash
pnpm dev
```

#### 日志等级设置

整体等级通过 `LOG_LEVEL` (默认 `info`) 调整。

```bash
LOG_LEVEL=debug pnpm dev
```

若只想开启特定模块,将 `模块=等级` 对以逗号分隔写入 `LOG_LEVELS`。可用等级: `trace` / `debug` / `info` / `warn` / `error` / `fatal`。

```bash
# 仅将 Claude Code hook 行为以 debug 追踪
LOG_LEVELS=hooks=debug pnpm dev

# 同时指定多个模块
LOG_LEVELS=hooks=debug,status=warn pnpm dev
```

未在 `LOG_LEVELS` 中指定的模块,将沿用 `LOG_LEVEL`。

## 外部访问 (Tailscale Serve)

```bash
tailscale serve --bg 8022
```

通过 `https://<machine>.<tailnet>.ts.net` 访问。关闭:

```bash
tailscale serve --bg off 8022
```

## 安全

### 密码

首次访问时设置密码。使用 scrypt 哈希并保存到 `~/.purplemux/config.json`。

要重置,请删除 `~/.purplemux/config.json` 并重启,引导界面会再次出现。

### HTTPS

默认使用 HTTP。对外暴露时请务必启用 HTTPS:

- **Tailscale Serve** — WireGuard 加密 + 自动证书
- **Nginx / Caddy** — 必须转发 WebSocket 升级头 (`Upgrade`, `Connection`)

### 数据目录 (`~/.purplemux/`)

| 文件 | 说明 |
|---|---|
| `config.json` | 认证信息 (哈希) 与应用设置 |
| `workspaces.json` | 工作区布局、标签、目录 |
| `vapid-keys.json` | Web Push VAPID 密钥 (自动生成) |
| `push-subscriptions.json` | 推送订阅信息 |
| `hooks/` | 用户自定义 hook |

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                    │
│  ┌───────────┐ ┌───────────┐ ┌──────────┐ ┌─────────────┐   │
│  │  xterm.js │ │ Timeline  │ │ Status   │ │ Multi-device│   │
│  │  Terminal │ │           │ │          │ │ Sync        │   │
│  └─────┬─────┘ └─────┬─────┘ └────┬─────┘ └──────┬──────┘   │
└────────┼─────────────┼────────────┼──────────────┼──────────┘
         │ws           │ws          │ws            │ws
         │/terminal    │/timeline   │/status       │/sync
         ▼             ▼            ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│  Node.js Server (:8022)                                     │
│  ┌──────────┐  ┌───────────────┐  ┌─────────────────────┐   │
│  │ node-pty │  │ JSONL Watcher │  │ Status Manager      │   │
│  │ PTY↔WS   │  │ File watch →  │  │ Process tree +      │   │
│  │ Binary   │  │ Parse → Send  │  │ JSONL tail analysis │   │
│  └────┬─────┘  └───────┬───────┘  └──────────┬──────────┘   │
└───────┼────────────────┼─────────────────────┼──────────────┘
        ▼                ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│  System                                                     │
│  tmux (purple socket)         Agent CLIs                    │
│  ┌────────┐ ┌────────┐       ┌────────────────────────────┐ │
│  │Session1│ │Session2│  ...  │ Claude Code                │ │
│  │ (shell)│ │ (shell)│       │   ~/.claude/projects/*.jsonl │ │
│  └────────┘ └────────┘       │ Codex                      │ │
│                              │   ~/.codex/sessions/*.jsonl │ │
│                              └────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**终端 I/O** — xterm.js 通过 WebSocket 连接 node-pty,node-pty 再接入 tmux 会话。使用二进制协议处理 stdin / stdout / resize 并进行背压控制。

**状态检测** — 智能体事件 hook 通过 HTTP POST 立即推送更新。Claude Code 使用 `SessionStart`、`Stop`、`Notification`;Codex 使用 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`PermissionRequest`。每 5–15 秒轮询一次进程树,并分析 JSONL 文件末尾 8KB。

**时间线** — 监听 `~/.claude/projects/` 与 `~/.codex/sessions/` 下的 JSONL 会话日志,文件变化时解析新行并将结构化条目流式传送到浏览器。

**tmux 隔离** — 使用专用的 `purple` socket,与现有 tmux 完全隔离。无前缀键,无状态栏。

**自动恢复** — 服务器启动时通过 `claude --resume {sessionId}` 恢复之前的 Claude 会话。Codex 会话可从会话列表恢复,也可使用 `codex resume {sessionId}`。

## License

[MIT](LICENSE)
