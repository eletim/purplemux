---
title: 安装
description: 安装方式 — npx、全局安装、macOS 原生应用,或从源码运行。
eyebrow: 入门
permalink: /zh-CN/docs/installation/index.html
---
{% from "docs/callouts.njk" import callout %}

如果你按 [快速开始](/purplemux/zh-CN/docs/quickstart/) 跑了 `npx purplemux@latest` 就够用了,本页可以跳过。这页面是给那些想要永久安装、桌面应用,或者从源码运行的人看的。

## 系统要求

- **macOS 13+ 或 Linux** — 不支持 Windows。WSL2 通常能用,但不在我们的测试范围。
- **[Node.js](https://nodejs.org) 20 或更新版本** — 用 `node -v` 检查。
- **[tmux](https://github.com/tmux/tmux)** — 任何 3.0 以上版本均可。

## 安装方式

### npx(无需安装)

```bash
npx purplemux@latest
```

首次运行时下载 purplemux 并缓存到 `~/.npm/_npx/`。最适合用来体验,或在远程机器上临时运行。每次运行都使用最新发布的版本。

### 全局安装

```bash
npm install -g purplemux
purplemux
```

pnpm 和 yarn 用法相同(`pnpm add -g purplemux` / `yarn global add purplemux`)。后续启动更快,因为不需要再解析依赖。用 `npm update -g purplemux` 升级。

为了简短,二进制文件还有一个别名 `pmux`。

### macOS 原生应用

从 [Releases](https://github.com/subicura/purplemux/releases/latest) 下载最新的 `.dmg` — 同时提供 Apple Silicon 和 Intel 版本。内置自动更新。

应用打包了 Node、tmux 和 purplemux 服务端,并加入了:

- 显示服务状态的菜单栏图标
- 原生通知(独立于 Web Push)
- 登录时自动启动(在 **设置 → 通用** 中切换)

### 从源码运行

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

开发模式(支持热重载):

```bash
pnpm dev
```

## 端口与环境变量

purplemux 监听 **8022**(web + ssh,纯属玩梗)。用 `PORT` 覆盖:

```bash
PORT=9000 purplemux
```

日志通过 `LOG_LEVEL`(默认 `info`)控制,`LOG_LEVELS` 用于按模块单独覆盖:

```bash
LOG_LEVEL=debug purplemux
# 只对 Claude hook 模块开启 debug
LOG_LEVELS=hooks=debug purplemux
# 同时对多个模块设置
LOG_LEVELS=hooks=debug,status=warn purplemux
```

可用级别:`trace` · `debug` · `info` · `warn` · `error` · `fatal`。未在 `LOG_LEVELS` 中列出的模块会回退到 `LOG_LEVEL`。

完整列表见 [端口与环境变量](/purplemux/zh-CN/docs/ports-env-vars/)。

## 开机自启动

{% call callout('tip', '最简单的做法') %}
如果你用的是 macOS 原生应用,启用 **设置 → 通用 → 登录时启动** 即可。无需写任何脚本。
{% endcall %}

如果是 CLI 安装,可以用 launchd(macOS)或 systemd(Linux)包装。一个最小的 systemd 单元文件如下:

```ini
# ~/.config/systemd/user/purplemux.service
[Unit]
Description=purplemux

[Service]
ExecStart=/usr/local/bin/purplemux
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now purplemux
```

## 升级

| 方式 | 命令 |
|---|---|
| npx | 自动(每次运行都是最新) |
| 全局 npm | `npm update -g purplemux` |
| macOS 应用 | 自动(启动时检查更新) |
| 从源码 | `git pull && pnpm install && pnpm build && pnpm start` |

## 卸载

```bash
npm uninstall -g purplemux          # 或 pnpm remove -g / yarn global remove
rm -rf ~/.purplemux                 # 清除设置和会话数据
```

原生应用直接拖到回收站即可。`~/.purplemux/` 下到底放了什么,见 [数据目录](/purplemux/zh-CN/docs/data-directory/)。
