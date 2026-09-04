---
title: インストール
description: インストール方法 — npx、グローバル、macOS ネイティブアプリ、ソースから。
eyebrow: はじめに
permalink: /ja/docs/installation/index.html
---
{% from "docs/callouts.njk" import callout %}

[クイックスタート](/purplemux/ja/docs/quickstart/) で `npx purplemux@latest` を実行してそれで十分なら、もう終わりです。このページは、永続的なインストール、デスクトップアプリ、ソースからの実行をしたい人向けです。

## 必要要件

- **macOS 13+ または Linux** — Windows はサポートしていません。WSL2 はだいたい動きますが、テスト対象外です。
- **[Node.js](https://nodejs.org) 20 以上** — `node -v` で確認。
- **[tmux](https://github.com/tmux/tmux)** — 3.0 以上のリリース。

## インストール方法

### npx (インストールなし)

```bash
npx purplemux@latest
```

初回実行時に purplemux をダウンロードし、`~/.npm/_npx/` の下にキャッシュします。試用やリモートマシンでのアドホック実行に最適です。実行のたびに最新版が使われます。

### グローバルインストール

```bash
npm install -g purplemux
purplemux
```

pnpm や yarn でも同様に動作します (`pnpm add -g purplemux` / `yarn global add purplemux`)。2 回目以降は解決処理が不要なため起動が速くなります。アップデートは `npm update -g purplemux` で。

短縮形として `pmux` バイナリも使えます。

### macOS ネイティブアプリ

最新の `.dmg` を [リリース](https://github.com/subicura/purplemux/releases/latest) からダウンロードしてください — Apple Silicon と Intel のビルドを提供しています。自動アップデート対応です。

このアプリは Node、tmux、purplemux サーバを同梱し、さらに以下を追加します:

- サーバステータスを表示するメニューバーアイコン
- ネイティブ通知 (Web Push とは別)
- ログイン時の自動起動 (**設定 → 一般** で切り替え)

### ソースから実行

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

開発用 (ホットリロード):

```bash
pnpm dev
```

## ポートと環境変数

purplemux は **8022** で待ち受けます (web + ssh の語呂合わせ)。`PORT` で上書き可能です:

```bash
PORT=9000 purplemux
```

ロギングは `LOG_LEVEL` (デフォルト `info`) と、モジュール単位の上書き用 `LOG_LEVELS` で制御します:

```bash
LOG_LEVEL=debug purplemux
# Claude フックモジュールだけをデバッグ
LOG_LEVELS=hooks=debug purplemux
# 複数モジュールを同時に
LOG_LEVELS=hooks=debug,status=warn purplemux
```

利用可能なレベル: `trace` · `debug` · `info` · `warn` · `error` · `fatal`。`LOG_LEVELS` に列挙されていないモジュールは `LOG_LEVEL` にフォールバックします。

すべてのリストは [ポート & 環境変数](/purplemux/ja/docs/ports-env-vars/) を参照してください。

## 起動時に開始する

{% call callout('tip', '一番楽な方法') %}
macOS アプリを使っているなら、**設定 → 一般 → ログイン時に起動** を有効にしてください。スクリプトを書く必要はありません。
{% endcall %}

CLI インストールの場合、launchd (macOS) または systemd (Linux) でラップします。最小限の systemd ユニットの例:

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

## アップデート

| 方法 | コマンド |
|---|---|
| npx | 自動 (毎回最新) |
| グローバル npm | `npm update -g purplemux` |
| macOS アプリ | 自動 (起動時に更新) |
| ソースから | `git pull && pnpm install && pnpm build && pnpm start` |

## アンインストール

```bash
npm uninstall -g purplemux          # または pnpm remove -g / yarn global remove
rm -rf ~/.purplemux                 # 設定とセッションデータを消去
```

ネイティブアプリは通常通りゴミ箱にドラッグしてください。`~/.purplemux/` に何が保存されているかは [データディレクトリ](/purplemux/ja/docs/data-directory/) を参照してください。
