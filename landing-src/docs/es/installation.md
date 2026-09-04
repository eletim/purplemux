---
title: Instalación
description: Opciones de instalación — npx, global, app nativa de macOS o desde el código fuente.
eyebrow: Primeros pasos
permalink: /es/docs/installation/index.html
---
{% from "docs/callouts.njk" import callout %}

Si ejecutaste `npx purplemux@latest` en [Inicio rápido](/purplemux/es/docs/quickstart/) y con eso te bastó, ya está. Esta página es para quien quiera una instalación persistente, una app de escritorio, o ejecutarlo desde el código fuente.

## Requisitos

- **macOS 13+ o Linux** — Windows no está soportado. WSL2 suele funcionar pero queda fuera de nuestra matriz de pruebas.
- **[Node.js](https://nodejs.org) 20 o superior** — verifica con `node -v`.
- **[tmux](https://github.com/tmux/tmux)** — cualquier versión 3.0+.

## Métodos de instalación

### npx (sin instalar)

```bash
npx purplemux@latest
```

Descarga purplemux en la primera ejecución y lo cachea bajo `~/.npm/_npx/`. Ideal para probarlo o para ejecutarlo de forma puntual en una máquina remota. Cada ejecución usa la última versión publicada.

### Instalación global

```bash
npm install -g purplemux
purplemux
```

pnpm y yarn funcionan igual (`pnpm add -g purplemux` / `yarn global add purplemux`). Arranca más rápido en ejecuciones posteriores porque no hay que resolver nada. Actualiza con `npm update -g purplemux`.

El binario también está disponible como `pmux` para abreviar.

### App nativa de macOS

Descarga el último `.dmg` desde [Releases](https://github.com/subicura/purplemux/releases/latest) — se ofrecen builds para Apple Silicon e Intel. La autoactualización viene incluida.

La app empaqueta Node, tmux y el servidor de purplemux, y añade:

- Un icono en la barra de menús con el estado del servidor
- Notificaciones nativas (independientes de Web Push)
- Inicio automático al iniciar sesión (interruptor en **Configuración → General**)

### Ejecutar desde el código fuente

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

Para desarrollo (recarga en caliente):

```bash
pnpm dev
```

## Puerto y variables de entorno

purplemux escucha en el puerto **8022** (web + ssh, por humor). Cámbialo con `PORT`:

```bash
PORT=9000 purplemux
```

El registro se controla con `LOG_LEVEL` (por defecto `info`) y con `LOG_LEVELS` para ajustes por módulo:

```bash
LOG_LEVEL=debug purplemux
# solo depurar el módulo de hooks de Claude
LOG_LEVELS=hooks=debug purplemux
# varios módulos a la vez
LOG_LEVELS=hooks=debug,status=warn purplemux
```

Niveles disponibles: `trace` · `debug` · `info` · `warn` · `error` · `fatal`. Los módulos no listados en `LOG_LEVELS` usan `LOG_LEVEL`.

Consulta [Puertos y variables de entorno](/purplemux/es/docs/ports-env-vars/) para la lista completa.

## Arranque al inicio

{% call callout('tip', 'La opción más sencilla') %}
Si usas la app de macOS, activa **Configuración → General → Iniciar al iniciar sesión**. Sin scripts.
{% endcall %}

Para una instalación por CLI, envuélvelo con launchd (macOS) o systemd (Linux). Una unidad systemd mínima sería:

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

## Actualizar

| Método | Comando |
|---|---|
| npx | automático (última versión en cada ejecución) |
| npm global | `npm update -g purplemux` |
| App de macOS | automático (la app se actualiza al arrancar) |
| Desde el código fuente | `git pull && pnpm install && pnpm build && pnpm start` |

## Desinstalar

```bash
npm uninstall -g purplemux          # o pnpm remove -g / yarn global remove
rm -rf ~/.purplemux                 # borra ajustes y datos de sesión
```

La app nativa se arrastra a la Papelera con normalidad. Consulta [Directorio de datos](/purplemux/es/docs/data-directory/) para saber exactamente qué se guarda en `~/.purplemux/`.
