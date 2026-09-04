---
title: Installation
description: Install options — npx, global, macOS native app, or from source.
eyebrow: Getting Started
permalink: /docs/installation/index.html
---
{% from "docs/callouts.njk" import callout %}

If you ran `npx purplemux@latest` in [Quickstart](/purplemux/docs/quickstart/) and that was enough, you're done. This page is for everyone who wants a persistent install, a desktop app, or to run from source.

## Requirements

- **macOS 13+ or Linux** — Windows is not supported. WSL2 usually works but is outside our test matrix.
- **[Node.js](https://nodejs.org) 20 or newer** — check with `node -v`.
- **[tmux](https://github.com/tmux/tmux)** — any 3.0+ release.

## Install methods

### npx (no install)

```bash
npx purplemux@latest
```

Downloads purplemux on first run and caches it under `~/.npm/_npx/`. Best for trying it out or running ad hoc on a remote box. Each run uses the latest published version.

### Global install

```bash
npm install -g purplemux
purplemux
```

pnpm and yarn work the same way (`pnpm add -g purplemux` / `yarn global add purplemux`). Starts faster on subsequent runs because nothing needs to be resolved. Upgrade with `npm update -g purplemux`.

The binary is also available as `pmux` for brevity.

### macOS native app

Download the latest `.dmg` from [Releases](https://github.com/subicura/purplemux/releases/latest) — Apple Silicon and Intel builds are provided. Auto-update is built in.

The app bundles Node, tmux, and the purplemux server, and adds:

- A menu bar icon with server status
- Native notifications (separate from Web Push)
- Automatic launch on login (toggle in **Settings → General**)

### Run from source

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

`pnpm start` serves the production standalone build. It checks that the build matches the current source and exits with instructions to run `pnpm build` when the artifact is missing or stale. For source-backed development with hot reload, use `pnpm dev` instead.

For development (hot reload):

```bash
pnpm dev
```

## Port and env vars

purplemux listens on **8022** (web + ssh, for humor). Override with `PORT`:

```bash
PORT=9000 purplemux
```

Logging is controlled with `LOG_LEVEL` (default `info`) and `LOG_LEVELS` for per-module overrides:

```bash
LOG_LEVEL=debug purplemux
# only debug the Claude hook module
LOG_LEVELS=hooks=debug purplemux
# multiple modules at once
LOG_LEVELS=hooks=debug,status=warn purplemux
```

Available levels: `trace` · `debug` · `info` · `warn` · `error` · `fatal`. Modules not listed in `LOG_LEVELS` fall back to `LOG_LEVEL`.

See [Ports & env vars](/purplemux/docs/ports-env-vars/) for the full list.

## Start on boot

{% call callout('tip', 'Easiest option') %}
If you use the macOS app, enable **Settings → General → Launch at login**. No scripts to write.
{% endcall %}

For a CLI install, wrap it in launchd (macOS) or systemd (Linux). A minimal systemd unit looks like:

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

## Updating

| Method | Command |
|---|---|
| npx | automatic (latest each run) |
| Global npm | `npm update -g purplemux` |
| macOS app | automatic (app updates on launch) |
| From source | `git pull && pnpm install && pnpm build && pnpm start` |

## Uninstall

```bash
npm uninstall -g purplemux          # or pnpm remove -g / yarn global remove
rm -rf ~/.purplemux                 # wipes settings and session data
```

The native app drags to Trash normally. See [Data directory](/purplemux/docs/data-directory/) for exactly what's stored under `~/.purplemux/`.
