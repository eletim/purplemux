---
title: Installation
description: Installationsoptionen — npx, global, native macOS-App oder aus dem Quellcode.
eyebrow: Erste Schritte
permalink: /de/docs/installation/index.html
---
{% from "docs/callouts.njk" import callout %}

Wenn dir `npx purplemux@latest` aus dem [Schnellstart](/purplemux/de/docs/quickstart/) gereicht hat, bist du fertig. Diese Seite ist für alle, die persistent installieren, eine Desktop-App haben oder aus dem Quellcode bauen wollen.

## Voraussetzungen

- **macOS 13+ oder Linux** — Windows wird nicht unterstützt. WSL2 funktioniert meistens, ist aber außerhalb unserer Test-Matrix.
- **[Node.js](https://nodejs.org) 20 oder neuer** — prüfe mit `node -v`.
- **[tmux](https://github.com/tmux/tmux)** — beliebige Version ab 3.0.

## Installationsmethoden

### npx (ohne Installation)

```bash
npx purplemux@latest
```

Lädt purplemux beim ersten Lauf herunter und cached es unter `~/.npm/_npx/`. Am besten zum Ausprobieren oder für ad-hoc-Läufe auf Remote-Maschinen geeignet. Jeder Lauf nutzt die neueste veröffentlichte Version.

### Globale Installation

```bash
npm install -g purplemux
purplemux
```

pnpm und yarn funktionieren analog (`pnpm add -g purplemux` / `yarn global add purplemux`). Folgeläufe starten schneller, weil nichts mehr aufgelöst werden muss. Update mit `npm update -g purplemux`.

Das Binary ist außerdem als `pmux` verfügbar — kürzer.

### Native macOS-App

Lade die aktuelle `.dmg` von [Releases](https://github.com/subicura/purplemux/releases/latest) — Builds für Apple Silicon und Intel sind verfügbar. Auto-Update ist eingebaut.

Die App enthält Node, tmux und den purplemux-Server und ergänzt:

- Ein Menüleisten-Symbol mit Server-Status
- Native Benachrichtigungen (getrennt von Web Push)
- Automatischer Start beim Login (Toggle in **Einstellungen → Allgemein**)

### Aus dem Quellcode

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

Für Entwicklung (Hot Reload):

```bash
pnpm dev
```

## Port und Umgebungsvariablen

purplemux lauscht auf **8022** (web + ssh, als kleines Wortspiel). Override mit `PORT`:

```bash
PORT=9000 purplemux
```

Logging steuerst du über `LOG_LEVEL` (Default `info`) und `LOG_LEVELS` für Pro-Modul-Overrides:

```bash
LOG_LEVEL=debug purplemux
# nur das Claude-Hook-Modul debuggen
LOG_LEVELS=hooks=debug purplemux
# mehrere Module gleichzeitig
LOG_LEVELS=hooks=debug,status=warn purplemux
```

Verfügbare Levels: `trace` · `debug` · `info` · `warn` · `error` · `fatal`. Module, die nicht in `LOG_LEVELS` stehen, fallen auf `LOG_LEVEL` zurück.

Siehe [Ports & Umgebungsvariablen](/purplemux/de/docs/ports-env-vars/) für die vollständige Liste.

## Beim Booten starten

{% call callout('tip', 'Einfachste Option') %}
Wenn du die macOS-App nutzt, aktiviere **Einstellungen → Allgemein → Beim Login starten**. Keine Skripte nötig.
{% endcall %}

Bei einer CLI-Installation packst du den Start in launchd (macOS) oder systemd (Linux). Eine minimale systemd-Unit sieht so aus:

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

## Updates

| Methode | Befehl |
|---|---|
| npx | automatisch (neueste bei jedem Lauf) |
| Global npm | `npm update -g purplemux` |
| macOS-App | automatisch (App aktualisiert beim Start) |
| Aus dem Quellcode | `git pull && pnpm install && pnpm build && pnpm start` |

## Deinstallation

```bash
npm uninstall -g purplemux          # oder pnpm remove -g / yarn global remove
rm -rf ~/.purplemux                 # löscht Einstellungen und Session-Daten
```

Die native App ziehst du wie gewohnt in den Papierkorb. Siehe [Daten-Verzeichnis](/purplemux/de/docs/data-directory/) für eine genaue Übersicht, was unter `~/.purplemux/` liegt.
