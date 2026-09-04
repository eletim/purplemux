# purplemux

**Claude Code と Codex、複数のタスクを同時に。もっと速く。**

1 つの画面ですべてのセッションを、スマホでも途切れることなく。

日本語 | <a href="README.md">English</a> | <a href="README.ko.md">한국어</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.ru.md">Русский</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.tr.md">Türkçe</a>

![purplemux](docs/images/screenshot.png)

![purplemux mobile](docs/images/screenshot-mobile.png)

## インストール

```bash
npx purplemux@latest
```

ブラウザで [http://localhost:8022](http://localhost:8022) を開いてください。以上。

> Node.js 20+ と tmux が必要です。macOS または Linux。

ネイティブアプリがお好みなら、[最新リリース](https://github.com/subicura/purplemux/releases/latest) から macOS Electron ビルドを入手できます(Apple Silicon & Intel 向け `.dmg`)。

## purplemux を選ぶ理由

- **マルチセッションダッシュボード** — すべての Claude Code と Codex セッションの「作業中 / 入力待ち」ステータスを一目で把握
- **レート制限モニタリング** — 5 時間 / 7 日の残量とリセットまでのカウントダウンを表示
- **プッシュ通知** — タスク完了や入力要求をデスクトップ / モバイルへ通知
- **モバイル & マルチデバイス** — スマホ、タブレット、別のデスクトップからも同じセッションへ
- **ライブセッションビュー** — CLI 出力をスクロールする必要なし。進捗をタイムラインで整理して表示

さらに

- **途切れないセッション** — tmux ベース。ブラウザを閉じてもセッションと作業環境はそのまま。再接続すればタブ、ペイン、ディレクトリまで最後の状態のまま
- **セルフホスト & オープンソース** — コードとセッションデータは自分のマシンにのみ存在。外部サーバーを経由しない
- **暗号化されたリモートアクセス** — Tailscale でどこからでも HTTPS アクセス

## 公式 Remote Control との違い

> 公式 Remote Control は単一セッションのリモート操作に特化しています。マルチセッション管理、プッシュ通知、セッション永続化が必要なときは purplemux を使ってください。

## 特徴

### ターミナル

- **ペイン分割** — 水平 / 垂直に自由分割、ドラッグでリサイズ
- **タブ管理** — 複数タブ、ドラッグで並べ替え、プロセス名ベースの自動タイトル
- **キーボードショートカット** — 分割、タブ切り替え、フォーカス移動
- **ターミナルテーマ** — ダーク / ライトモード、多彩なカラーテーマ
- **ワークスペース & グループ** — ペインレイアウト、タブ、作業ディレクトリをワークスペース単位で保存 / 復元。ドラッグ & ドロップでワークスペースをグループ化して管理
- **Git ワークフロー** — Side-by-side / Line-by-line 切り替えとシンタックスハイライトに加え、インライン hunk 展開、ページネーション付き履歴タブ。パネルから直接 fetch / pull / push (ahead/behind 表示) — 同期失敗 (dirty worktree、コンフリクト) はワンクリックで Claude または Codex に質問
- **Web ブラウザペイン** — ターミナル隣の組み込みブラウザで開発結果を確認 (Electron)。`purplemux` CLI から操作でき、内蔵のデバイスエミュレータでビューポートを切り替え
- **エージェントタブ** — 新規タブメニューから Claude、Codex、または統合セッション一覧を開始

### Claude Code と Codex 連携

- **リアルタイムステータス** — 作業中 / 入力待ちインジケーター、セッション間の切り替え
- **ライブセッションビュー** — メッセージ、ツール呼び出し、タスク、権限リクエスト、thinking ブロック
- **Codex タブ** — Claude と同じ tmux ベースの永続性で Codex CLI セッションを起動
- **セッション一覧** — 最近の Claude と Codex セッションを 1 つの統合ビューで参照・再開
- **ワンクリック Resume** — 中断した Claude または Codex セッションをブラウザからそのまま再開
- **自動 Resume** — サーバー起動時に以前の Claude セッションを自動復元
- **クイックプロンプト** — よく使うプロンプトを登録してワンクリック送信
- **添付** — チャット入力に画像をドロップ、またはファイル添付でパスを自動挿入。モバイルでも動作
- **メッセージ履歴** — 過去のメッセージを再利用
- **使用量分析** — Claude + Codex のトークン、コスト、プロジェクト別分析、日次 AI レポート
- **レート制限** — 対応プロバイダーの 5 時間 / 7 日の残量、リセットまでのカウントダウン

### モバイル & アクセシビリティ

- **レスポンシブ UI** — スマホ / タブレットでもターミナルとタイムラインを利用可能
- **PWA** — ホーム画面に追加してネイティブアプリのように
- **Web Push** — タブを閉じても通知を受信
- **マルチデバイス同期** — ワークスペースの変更をリアルタイムで反映
- **Tailscale** — WireGuard 暗号化トンネル経由で外部から HTTPS アクセス
- **パスワード認証** — scrypt ハッシュ、外部公開時でも安全
- **多言語対応** — 한국어、English、日本語、中文 など 11 言語

## 対応プラットフォーム

| プラットフォーム | ステータス | 備考 |
|---|---|---|
| macOS (Apple Silicon / Intel) | ✅ | Electron アプリ同梱 |
| Linux | ✅ | Electron 非対応 |
| Windows | ❌ | 未サポート |

## インストール詳細

### 必須要件

- macOS 13+ または Linux
- [Node.js](https://nodejs.org/) 20+
- [tmux](https://github.com/tmux/tmux)

Claude タブに必要です。Claude Code をインストールし、Claude タブを開始する前にログインしてください:

```bash
curl -fsSL https://claude.ai/install.sh | bash
# または Homebrew latest チャンネル
brew install --cask claude-code@latest
```

Codex タブは任意です。Codex CLI をインストールし、Codex タブを開始する前にログインしてください:

```bash
npm i -g @openai/codex
# または
brew install --cask codex
```

### npx (最速)

```bash
npx purplemux@latest
```

### グローバルインストール

```bash
npm install -g purplemux
purplemux
```

### CLI 例

```bash
purplemux tab create -w WS -t codex-cli -n "fix auth"
purplemux tab create -w WS -t agent-sessions
```

### ソースから実行

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

開発モード:

```bash
pnpm dev
```

#### ログレベル設定

全体のレベルは `LOG_LEVEL` (既定 `info`) で調整します。

```bash
LOG_LEVEL=debug pnpm dev
```

特定モジュールだけ切り替えたい場合は `LOG_LEVELS` に `モジュール=レベル` ペアをカンマ区切りで指定します。使用可能なレベル: `trace` / `debug` / `info` / `warn` / `error` / `fatal`。

```bash
# Claude Code フックの動作だけ debug で追跡
LOG_LEVELS=hooks=debug pnpm dev

# 複数モジュールを同時指定
LOG_LEVELS=hooks=debug,status=warn pnpm dev
```

`LOG_LEVELS` に含まれないモジュールは `LOG_LEVEL` の値が適用されます。

## 外部アクセス (Tailscale Serve)

```bash
tailscale serve --bg 8022
```

`https://<machine>.<tailnet>.ts.net` でアクセスできます。解除:

```bash
tailscale serve --bg off 8022
```

## セキュリティ

### パスワード

初回アクセス時にパスワードを設定します。scrypt でハッシュ化され `~/.purplemux/config.json` に保存されます。

初期化するには `~/.purplemux/config.json` を削除して再起動すると、オンボーディング画面が再表示されます。

### HTTPS

デフォルトは HTTP です。外部公開する場合は必ず HTTPS を適用してください:

- **Tailscale Serve** — WireGuard 暗号化 + 証明書自動適用
- **Nginx / Caddy** — WebSocket アップグレードヘッダー (`Upgrade`, `Connection`) の転送が必須

### データディレクトリ (`~/.purplemux/`)

| ファイル | 説明 |
|---|---|
| `config.json` | 認証情報 (ハッシュ)、アプリ設定 |
| `workspaces.json` | ワークスペースレイアウト、タブ、ディレクトリ |
| `vapid-keys.json` | Web Push VAPID キー (自動生成) |
| `push-subscriptions.json` | プッシュ購読情報 |
| `hooks/` | ユーザー定義フック |

## アーキテクチャ

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

**ターミナル I/O** — xterm.js は WebSocket 経由で node-pty に接続し、node-pty は tmux セッションにアタッチされます。バイナリプロトコルで stdin / stdout / resize を処理し、バックプレッシャーを制御します。

**ステータス検出** — エージェントイベントフックが HTTP POST で即時更新を配信します。Claude Code は `SessionStart`、`Stop`、`Notification` を使用し、Codex は `SessionStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`Stop`、`PermissionRequest` を使用します。5〜15 秒ごとにプロセスツリーを確認し、JSONL ファイル末尾 8KB を解析します。

**タイムライン** — `~/.claude/projects/` と `~/.codex/sessions/` 配下の JSONL セッションログを監視し、変更時に新しい行をパースして構造化エントリをブラウザへストリーミングします。

**tmux 分離** — 専用の `purple` ソケットを使用し、既存の tmux と完全に分離されています。prefix キーなし、ステータスバーなし。

**自動復旧** — サーバー起動時に `claude --resume {sessionId}` で以前の Claude セッションを復元します。Codex セッションはセッション一覧または `codex resume {sessionId}` で再開できます。

## License

[MIT](LICENSE)
