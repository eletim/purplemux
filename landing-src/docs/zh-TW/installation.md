---
title: 安裝
description: 各種安裝方式 — npx、全域安裝、macOS 原生 App，或從原始碼建置。
eyebrow: 開始上手
permalink: /zh-TW/docs/installation/index.html
---
{% from "docs/callouts.njk" import callout %}

如果你已經透過 [快速開始](/purplemux/zh-TW/docs/quickstart/) 執行了 `npx purplemux@latest` 並且足夠用了，那就到此為止。本頁是給想要永久安裝、桌面應用程式，或是從原始碼執行的人。

## 系統需求

- **macOS 13+ 或 Linux** — 不支援 Windows。WSL2 通常可以運作，但不在測試範圍內。
- **[Node.js](https://nodejs.org) 20 或更新版本** — 用 `node -v` 檢查。
- **[tmux](https://github.com/tmux/tmux)** — 任何 3.0+ 版本皆可。

## 安裝方式

### npx（免安裝）

```bash
npx purplemux@latest
```

第一次執行時會下載 purplemux 並快取到 `~/.npm/_npx/`。最適合用來嘗試或在遠端機器上臨時執行，每次執行都會使用最新發行版。

### 全域安裝

```bash
npm install -g purplemux
purplemux
```

pnpm 與 yarn 同樣可用（`pnpm add -g purplemux` / `yarn global add purplemux`）。後續啟動會更快，因為不需要再解析。升級指令是 `npm update -g purplemux`。

執行檔也可用 `pmux` 這個簡短別名。

### macOS 原生 App

從 [Releases](https://github.com/subicura/purplemux/releases/latest) 下載最新的 `.dmg` — 同時提供 Apple Silicon 與 Intel 版本，內建自動更新。

這個 App 內建了 Node、tmux 和 purplemux 伺服器，並另外提供：

- 顯示伺服器狀態的選單列圖示
- 原生通知（與 Web Push 是分開的）
- 登入時自動啟動（在 **設定 → 一般** 切換）

### 從原始碼執行

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

開發模式（熱重載）：

```bash
pnpm dev
```

## 連接埠與環境變數

purplemux 監聽 **8022**（取自 web + ssh，純屬玩笑）。可透過 `PORT` 覆寫：

```bash
PORT=9000 purplemux
```

日誌等級由 `LOG_LEVEL`（預設 `info`）控制，並可透過 `LOG_LEVELS` 對個別模組覆寫：

```bash
LOG_LEVEL=debug purplemux
# 只對 Claude hook 模組除錯
LOG_LEVELS=hooks=debug purplemux
# 一次調整多個模組
LOG_LEVELS=hooks=debug,status=warn purplemux
```

可用等級：`trace` · `debug` · `info` · `warn` · `error` · `fatal`。未在 `LOG_LEVELS` 列出的模組會回退到 `LOG_LEVEL`。

完整清單請見 [連接埠與環境變數](/purplemux/zh-TW/docs/ports-env-vars/)。

## 開機自動啟動

{% call callout('tip', '最簡單的方式') %}
若使用 macOS App，啟用 **設定 → 一般 → 登入時啟動** 即可，不需要寫任何指令稿。
{% endcall %}

對於 CLI 安裝，可用 launchd（macOS）或 systemd（Linux）包裝。一個最精簡的 systemd unit 看起來像這樣：

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

## 更新

| 安裝方式 | 指令 |
|---|---|
| npx | 自動（每次執行都是最新版） |
| 全域 npm | `npm update -g purplemux` |
| macOS App | 自動（啟動時更新） |
| 從原始碼 | `git pull && pnpm install && pnpm build && pnpm start` |

## 解除安裝

```bash
npm uninstall -g purplemux          # 或 pnpm remove -g / yarn global remove
rm -rf ~/.purplemux                 # 清除設定與工作階段資料
```

原生 App 直接拖到垃圾桶即可。`~/.purplemux/` 內到底儲存了什麼，請見 [資料目錄](/purplemux/zh-TW/docs/data-directory/)。
