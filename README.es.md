# purplemux

**Claude Code y Codex, muchas tareas a la vez. Más rápido.**

Todas tus sesiones en una sola pantalla. Sin interrupciones, incluso desde el móvil.

Español | <a href="README.md">English</a> | <a href="README.ko.md">한국어</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ru.md">Русский</a> | <a href="README.pt-BR.md">Português (Brasil)</a> | <a href="README.tr.md">Türkçe</a>

![purplemux](docs/images/screenshot.png)

![purplemux mobile](docs/images/screenshot-mobile.png)

## Instalación

```bash
npx purplemux@latest
```

Abre [http://localhost:8022](http://localhost:8022) en tu navegador. Listo.

> Requiere Node.js 20+ y tmux. macOS o Linux.

¿Prefieres una app nativa? Descarga la versión Electron para macOS desde la [última release](https://github.com/subicura/purplemux/releases/latest) (`.dmg` para Apple Silicon e Intel).

## Por qué purplemux

- **Panel multisesión** — Consulta de un vistazo el estado «trabajando / requiere entrada» de todas tus sesiones de Claude Code y Codex
- **Monitor de límites** — Saldo de 5 horas / 7 días y cuenta atrás para el reinicio
- **Notificaciones push** — Avisos de escritorio y móvil cuando una tarea termina o requiere entrada
- **Móvil y multi-dispositivo** — Accede a la misma sesión desde el teléfono, la tablet u otro escritorio
- **Vista en vivo de la sesión** — Deja de desplazarte por la salida de la CLI: el progreso se organiza como una línea temporal

Además

- **Sesiones sin interrupciones** — Basado en tmux. Cierra el navegador y todo queda intacto. Al reconectarte, tus pestañas, paneles y directorios están exactamente donde los dejaste
- **Autoalojado y de código abierto** — El código y los datos de sesión nunca salen de tu máquina. Sin servidores externos
- **Acceso remoto cifrado** — HTTPS desde cualquier lugar vía Tailscale

## Diferencias con el Remote Control oficial

> El Remote Control oficial se centra en el control remoto de una única sesión. Usa purplemux cuando necesites gestión multisesión, notificaciones push y persistencia de sesiones.

## Características

### Terminal

- **Paneles divididos** — División horizontal / vertical libre, redimensionables con arrastrar
- **Gestión de pestañas** — Múltiples pestañas, reordenación por arrastre, títulos automáticos basados en el nombre del proceso
- **Atajos de teclado** — División, cambio de pestaña, movimiento de foco
- **Temas de terminal** — Modo oscuro / claro y varios esquemas de color
- **Workspaces y grupos** — Guarda y restaura diseños de paneles, pestañas y directorios de trabajo por workspace. Organiza los workspaces en grupos con arrastrar y soltar
- **Flujo de trabajo Git** — Side-by-side / Line-by-line con resaltado de sintaxis, expansión de hunks en línea y una pestaña de historial paginada. Fetch / pull / push desde el panel con indicadores ahead/behind — si la sincronización falla (dirty worktree, conflictos), Ask Claude o Codex con un clic
- **Panel de navegador web** — Navegador integrado junto al terminal para comprobar la salida de desarrollo (Electron). Contrólalo desde la CLI `purplemux` y cambia el viewport con un emulador de dispositivo integrado
- **Pestañas de agentes** — Inicia Claude, Codex o una lista de sesiones combinada desde el menú de nueva pestaña

### Integración con Claude Code y Codex

- **Estado en tiempo real** — Indicadores de trabajando / requiere entrada y cambio entre sesiones
- **Vista en vivo de la sesión** — Mensajes, llamadas a herramientas, tareas, solicitudes de permisos y bloques de thinking
- **Pestañas Codex** — Inicia sesiones de Codex CLI con la misma persistencia basada en tmux que Claude
- **Lista de sesiones** — Explora y reanuda sesiones recientes de Claude y Codex desde una vista combinada
- **Reanudación en un clic** — Retoma una sesión pausada de Claude o Codex directamente desde el navegador
- **Reanudación automática** — Recupera sesiones previas de Claude al arrancar el servidor
- **Prompts rápidos** — Registra prompts frecuentes y envíalos con un clic
- **Adjuntos** — Suelta imágenes en el cuadro de chat o adjunta archivos para insertar su ruta. También funciona en móvil
- **Historial de mensajes** — Reutiliza mensajes anteriores
- **Estadísticas de uso** — Tokens de Claude + Codex, coste, desglose por proyecto e informes diarios de IA
- **Rate limits** — Saldo de 5 horas / 7 días y cuenta atrás para el reinicio en proveedores compatibles

### Móvil y accesibilidad

- **Interfaz responsive** — Terminal y línea temporal en móviles y tablets
- **PWA** — Añádelo a la pantalla de inicio para sentirlo como una app nativa
- **Web Push** — Recibe notificaciones aunque hayas cerrado la pestaña
- **Sincronización multi-dispositivo** — Los cambios en el workspace se reflejan en tiempo real
- **Tailscale** — Acceso HTTPS desde el exterior mediante un túnel cifrado con WireGuard
- **Autenticación por contraseña** — Hashing scrypt, seguro incluso al exponerlo al exterior
- **Multilingüe** — 11 idiomas, entre ellos 한국어, English, 日本語, 中文

## Plataformas soportadas

| Plataforma | Estado | Notas |
|---|---|---|
| macOS (Apple Silicon / Intel) | ✅ | App de Electron incluida |
| Linux | ✅ | Sin Electron |
| Windows | ❌ | No soportado |

## Detalles de instalación

### Requisitos

- macOS 13+ o Linux
- [Node.js](https://nodejs.org/) 20+
- [tmux](https://github.com/tmux/tmux)

Requerido para pestañas de Claude. Instala Claude Code e inicia sesión antes de abrir una pestaña de Claude:

```bash
curl -fsSL https://claude.ai/install.sh | bash
# o con el canal latest de Homebrew
brew install --cask claude-code@latest
```

Opcional para pestañas de Codex. Instala Codex CLI e inicia sesión antes de abrir una pestaña de Codex:

```bash
npm i -g @openai/codex
# o
brew install --cask codex
```

### npx (el más rápido)

```bash
npx purplemux@latest
```

### Instalación global

```bash
npm install -g purplemux
purplemux
```

### Ejemplos de CLI

```bash
purplemux tab create -w WS -t codex-cli -n "fix auth"
purplemux tab create -w WS -t agent-sessions
```

### Desde el código fuente

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

Modo desarrollo:

```bash
pnpm dev
```

#### Nivel de log

Ajusta el nivel global con `LOG_LEVEL` (por defecto `info`).

```bash
LOG_LEVEL=debug pnpm dev
```

Para activar módulos concretos, lista pares `módulo=nivel` separados por comas en `LOG_LEVELS`. Niveles disponibles: `trace` / `debug` / `info` / `warn` / `error` / `fatal`.

```bash
# Rastrea sólo los hooks de Claude Code en debug
LOG_LEVELS=hooks=debug pnpm dev

# Varios módulos a la vez
LOG_LEVELS=hooks=debug,status=warn pnpm dev
```

Los módulos no listados en `LOG_LEVELS` usan el valor de `LOG_LEVEL`.

## Acceso externo (Tailscale Serve)

```bash
tailscale serve --bg 8022
```

Accede en `https://<machine>.<tailnet>.ts.net`. Para desactivarlo:

```bash
tailscale serve --bg off 8022
```

## Seguridad

### Contraseña

Define una contraseña en el primer acceso. Se guarda con hashing scrypt en `~/.purplemux/config.json`.

Para reiniciarla, elimina `~/.purplemux/config.json` y reinicia: la pantalla de onboarding volverá a aparecer.

### HTTPS

Por defecto usa HTTP. Aplica siempre HTTPS al exponer la aplicación al exterior:

- **Tailscale Serve** — Cifrado WireGuard con certificados automáticos
- **Nginx / Caddy** — Debe reenviar las cabeceras de upgrade de WebSocket (`Upgrade`, `Connection`)

### Directorio de datos (`~/.purplemux/`)

| Archivo | Descripción |
|---|---|
| `config.json` | Credenciales (hash) y ajustes de la app |
| `workspaces.json` | Diseños de workspace, pestañas y directorios |
| `vapid-keys.json` | Claves VAPID de Web Push (autogeneradas) |
| `push-subscriptions.json` | Datos de suscripción push |
| `hooks/` | Hooks definidos por el usuario |

## Arquitectura

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

**E/S del terminal** — xterm.js se conecta a node-pty mediante WebSocket y node-pty se acopla a las sesiones de tmux. Un protocolo binario gestiona stdin/stdout/resize con control de backpressure.

**Detección de estado** — Los hooks de eventos de los agentes envían actualizaciones inmediatas por HTTP POST. Claude Code usa `SessionStart`, `Stop` y `Notification`; Codex usa `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` y `PermissionRequest`. Cada 5–15 s se inspeccionan los árboles de procesos y se analizan los últimos 8 KB de los archivos JSONL.

**Timeline** — Observa los logs JSONL de sesiones bajo `~/.claude/projects/` y `~/.codex/sessions/`, parsea las nuevas líneas al cambiar el archivo y envía entradas estructuradas al navegador.

**Aislamiento tmux** — Usa un socket `purple` dedicado, totalmente separado de tu tmux actual. Sin tecla prefix ni barra de estado.

**Recuperación automática** — Al iniciar el servidor, restaura las sesiones previas de Claude con `claude --resume {sessionId}`. Las sesiones de Codex pueden reanudarse desde la lista de sesiones o con `codex resume {sessionId}`.

## License

[MIT](LICENSE)
