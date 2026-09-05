# purplemux

**Claude Code 與 Codex,多項任務同時進行。更快速。**

一個畫面縱覽所有工作階段,在手機上也毫無中斷。

繁體中文 | <a href="README.md">English</a> | <a href="README.ko.md">한국어</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.ru.md">Русский</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.tr.md">Türkçe</a>

![purplemux](docs/images/screenshot.png)

![purplemux mobile](docs/images/screenshot-mobile.png)

## 安裝

```bash
npx purplemux@latest
```

在瀏覽器中開啟 [http://localhost:8022](http://localhost:8022)。完成。

> 需要 Node.js 20+ 與 tmux。macOS 或 Linux。

想用原生應用程式?可從[最新發行版](https://github.com/subicura/purplemux/releases/latest)下載 macOS Electron 版(適用於 Apple Silicon 與 Intel 的 `.dmg`)。

## 為什麼選擇 purplemux

- **多工作階段儀表板** — 一眼掌握所有 Claude Code 與 Codex 工作階段的「執行中 / 等待輸入」狀態
- **速率限制監控** — 顯示 5 小時 / 7 天剩餘額度與重置倒數
- **推播通知** — 任務完成或需要輸入時,透過桌面與行動裝置推播提醒
- **行動裝置 & 多裝置** — 在手機、平板或其他桌面都能存取同一工作階段
- **即時工作階段檢視** — 不必捲動 CLI 輸出,進度以時間軸形式整理呈現

此外

- **不中斷的工作階段** — 以 tmux 為基礎。關閉瀏覽器後工作階段與作業環境依然保留。重新連線時,分頁、窗格、目錄都維持最後狀態
- **自架 & 開源** — 程式碼與工作階段資料僅存在本機,不經任何外部伺服器
- **加密遠端存取** — 透過 Tailscale 在任何地方使用 HTTPS 連線

## 與官方 Remote Control 的差異

> 官方 Remote Control 專注於單一工作階段的遠端控制。當你需要多工作階段管理、推播通知與工作階段持久化時,請使用 purplemux。

## 特色

### 終端機

- **窗格分割** — 水平 / 垂直自由分割,可拖曳調整大小
- **分頁管理** — 多分頁、拖曳排序、依據行程名稱自動命名
- **鍵盤快速鍵** — 分割、切換分頁、移動焦點
- **終端機佈景主題** — 深色 / 淺色模式,多種配色佈景主題
- **工作區 & 群組** — 以工作區為單位儲存 / 還原窗格配置、分頁與工作目錄。可透過拖曳將工作區組織為群組進行管理
- **Git 工作流程** — 支援 Side-by-side / Line-by-line 切換與語法高亮,並可行內展開 hunk、分頁瀏覽歷史紀錄分頁。可從窗格直接 fetch / pull / push (含 ahead/behind 指示) — 同步失敗時 (dirty worktree、衝突) 一鍵 Ask Claude 或 Codex
- **內建瀏覽器窗格** — 在終端機旁嵌入瀏覽器檢視開發結果 (Electron)。可透過 `purplemux` CLI 控制,並以內建裝置模擬器切換視口
- **代理分頁** — 從新增分頁選單啟動 Claude、Codex 或整合工作階段列表

### Claude Code 與 Codex 整合

- **即時狀態** — 執行中 / 等待輸入指示,可於工作階段間切換
- **即時工作階段檢視** — 訊息、工具呼叫、任務、權限請求、thinking 區塊
- **Codex 分頁** — 以與 Claude 相同的 tmux 持久化能力啟動 Codex CLI 工作階段
- **工作階段列表** — 在單一整合檢視中瀏覽並恢復最近的 Claude 與 Codex 工作階段
- **一鍵 Resume** — 直接從瀏覽器恢復已中斷的 Claude 或 Codex 工作階段
- **自動 Resume** — 伺服器啟動時自動還原先前的 Claude 工作階段
- **快速提示** — 註冊常用提示,一鍵送出
- **附件** — 在聊天輸入中拖放圖片,或附加檔案以自動插入路徑。行動裝置同樣可用
- **訊息紀錄** — 重複使用先前的訊息
- **使用量統計** — Claude + Codex Token、成本、依專案分析、每日 AI 報告
- **速率限制** — 支援的提供方的 5 小時 / 7 天剩餘額度,重置倒數

### 行動裝置 & 易用性

- **響應式 UI** — 在手機 / 平板上使用終端機與時間軸
- **PWA** — 加入主畫面,體驗接近原生應用
- **Web Push** — 關閉分頁仍可接收通知
- **多裝置同步** — 工作區變更即時同步
- **Tailscale** — 透過 WireGuard 加密隧道從外部進行 HTTPS 連線
- **密碼驗證** — scrypt 雜湊,對外暴露也安全
- **多語系支援** — 한국어、English、日本語、中文 等 11 種語言

## 支援的平台

| 平台 | 狀態 | 備註 |
|---|---|---|
| macOS (Apple Silicon / Intel) | ✅ | 內含 Electron 應用程式 |
| Linux | ✅ | 不含 Electron |
| Windows | ❌ | 不支援 |

## 安裝細節

### 前置需求

- macOS 13+ 或 Linux
- [Node.js](https://nodejs.org/) 20+
- [tmux](https://github.com/tmux/tmux)

Claude 分頁需要。安裝 Claude Code,並在啟動 Claude 分頁前登入:

```bash
curl -fsSL https://claude.ai/install.sh | bash
# 或使用 Homebrew latest 頻道
brew install --cask claude-code@latest
```

Codex 分頁為選用。安裝 Codex CLI,並在啟動 Codex 分頁前登入:

```bash
npm i -g @openai/codex
# 或
brew install --cask codex
```

### npx (最快速)

```bash
npx purplemux@latest
```

### 全域安裝

```bash
npm install -g purplemux
purplemux
```

### CLI 範例

```bash
purplemux tab create -w WS -t codex-cli -n "fix auth"
purplemux tab create -w WS -t agent-sessions
```

### 從原始碼執行

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

開發模式:

```bash
pnpm dev
```

#### 記錄層級設定

整體層級以 `LOG_LEVEL` (預設 `info`) 調整。

```bash
LOG_LEVEL=debug pnpm dev
```

若只想開啟特定模組,將 `模組=層級` 組合以逗號分隔寫入 `LOG_LEVELS`。可用層級: `trace` / `debug` / `info` / `warn` / `error` / `fatal`。

```bash
# 只以 debug 追蹤 Claude Code hook 行為
LOG_LEVELS=hooks=debug pnpm dev

# 同時指定多個模組
LOG_LEVELS=hooks=debug,status=warn pnpm dev
```

未在 `LOG_LEVELS` 中指定的模組,會沿用 `LOG_LEVEL`。

## 外部連線 (Tailscale Serve)

```bash
tailscale serve --bg 8022
```

透過 `https://<machine>.<tailnet>.ts.net` 連線。停用:

```bash
tailscale serve --bg off 8022
```

## 安全性

### 密碼

首次連線時設定密碼。使用 scrypt 雜湊後儲存於 `~/.purplemux/config.json`。

如需重置,請刪除 `~/.purplemux/config.json` 並重新啟動,引導畫面會再次出現。

### HTTPS

預設使用 HTTP。對外暴露時請務必套用 HTTPS:

- **Tailscale Serve** — WireGuard 加密 + 自動憑證
- **Nginx / Caddy** — 必須轉送 WebSocket 升級標頭 (`Upgrade`, `Connection`)

### 資料目錄 (`~/.purplemux/`)

| 檔案 | 說明 |
|---|---|
| `config.json` | 驗證資訊 (雜湊) 與應用設定 |
| `workspaces.json` | 工作區配置、分頁、目錄 |
| `vapid-keys.json` | Web Push VAPID 金鑰 (自動產生) |
| `push-subscriptions.json` | 推播訂閱資訊 |
| `hooks/` | 使用者自訂 hook |

## 架構

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

**終端機 I/O** — xterm.js 透過 WebSocket 連線至 node-pty,node-pty 再接上 tmux 工作階段。使用二進位協定處理 stdin / stdout / resize 並控制背壓。

**狀態偵測** — 代理事件 hook 透過 HTTP POST 立即推送更新。Claude Code 使用 `SessionStart`、`Stop`、`Notification`;Codex 使用 `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`PermissionRequest`。每 5–15 秒輪詢一次行程樹,並分析 JSONL 檔案末尾 8KB。

**時間軸** — 監聽 `~/.claude/projects/` 與 `~/.codex/sessions/` 下的 JSONL 工作階段記錄,檔案變動時解析新行並將結構化項目串流至瀏覽器。

**tmux 隔離** — 使用專屬的 `purple` socket,與現有 tmux 完全隔離。無前置鍵,無狀態列。

**自動還原** — 伺服器啟動時以 `claude --resume {sessionId}` 還原先前的 Claude 工作階段。Codex 工作階段可從工作階段列表恢復,也可使用 `codex resume {sessionId}`。

## License

[MIT](LICENSE)
