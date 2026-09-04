# purplemux

**Claude Code e Codex, várias tarefas ao mesmo tempo. Mais rápido.**

Todas as sessões em uma tela só. Sem quebras, até no celular.

Português (Brasil) | <a href="README.md">English</a> | <a href="README.ko.md">한국어</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh-CN.md">简体中文</a> | <a href="README.zh-TW.md">繁體中文</a> | <a href="README.de.md">Deutsch</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.ru.md">Русский</a> | <a href="README.tr.md">Türkçe</a>

![purplemux](docs/images/screenshot.png)

![purplemux mobile](docs/images/screenshot-mobile.png)

## Instalação

```bash
npx purplemux@latest
```

Abra [http://localhost:8022](http://localhost:8022) no navegador. Pronto.

> Requer Node.js 20+ e tmux. macOS ou Linux.

Prefere um app nativo? Baixe a versão Electron para macOS na [última release](https://github.com/subicura/purplemux/releases/latest) (`.dmg` para Apple Silicon e Intel).

## Por que purplemux

- **Painel multissessão** — Veja o status «trabalhando / aguardando entrada» de todas as sessões do Claude Code e do Codex de relance
- **Monitor de rate limit** — Saldo de 5 horas / 7 dias com contagem regressiva até o reset
- **Notificações push** — Alertas no desktop e no mobile quando uma tarefa termina ou precisa de entrada
- **Mobile e multi-dispositivo** — Acesse a mesma sessão a partir do celular, tablet ou outro desktop
- **Visualização da sessão ao vivo** — Sem mais rolar a saída do CLI: o progresso é apresentado como uma linha do tempo

E ainda

- **Sessões sem quebras** — Baseado em tmux. Feche o navegador e tudo continua no lugar. Ao reconectar, suas abas, painéis e diretórios estão exatamente onde você deixou
- **Self-hosted e open source** — Código e dados de sessão nunca saem da sua máquina. Sem servidores externos
- **Acesso remoto criptografado** — HTTPS de qualquer lugar via Tailscale

## Diferenças para o Remote Control oficial

> O Remote Control oficial foca no controle remoto de uma única sessão. Use o purplemux quando precisar de gestão multissessão, notificações push e persistência de sessão.

## Recursos

### Terminal

- **Divisão de painéis** — Divisão horizontal / vertical livre, com redimensionamento por arrasto
- **Gerenciamento de abas** — Múltiplas abas, reordenação por arrasto, títulos automáticos baseados no nome do processo
- **Atalhos de teclado** — Divisão, troca de abas, movimento de foco
- **Temas do terminal** — Modo escuro / claro e vários esquemas de cores
- **Workspaces e grupos** — Salve e restaure layouts de painéis, abas e diretórios de trabalho por workspace. Organize os workspaces em grupos com arrastar e soltar
- **Fluxo de trabalho Git** — Side-by-side / Line-by-line com destaque de sintaxe, expansão de hunks inline e uma aba de histórico paginada. Fetch / pull / push direto do painel com indicadores ahead/behind — se o sync falhar (dirty worktree, conflitos), Ask Claude ou Codex em um clique
- **Painel de navegador web** — Navegador embutido ao lado do terminal para conferir o resultado de desenvolvimento (Electron). Controle pelo CLI `purplemux` e alterne viewports com um emulador de dispositivo integrado
- **Abas de agentes** — Inicie Claude, Codex ou uma lista de sessões combinada pelo menu de nova aba

### Integração com Claude Code e Codex

- **Status em tempo real** — Indicadores de trabalhando / aguardando entrada e troca entre sessões
- **Visualização da sessão ao vivo** — Mensagens, chamadas de ferramentas, tarefas, solicitações de permissão e blocos thinking
- **Abas Codex** — Inicie sessões do Codex CLI com a mesma persistência baseada em tmux do Claude
- **Lista de sessões** — Navegue e retome sessões recentes do Claude e do Codex em uma visualização combinada
- **Resume em um clique** — Retome sessões pausadas do Claude ou do Codex direto do navegador
- **Resume automático** — Restauração automática de sessões anteriores do Claude ao iniciar o servidor
- **Prompts rápidos** — Cadastre prompts frequentes e envie com um clique
- **Anexos** — Solte imagens no campo de chat ou anexe arquivos para inserir o caminho. Funciona também no mobile
- **Histórico de mensagens** — Reutilize mensagens anteriores
- **Estatísticas de uso** — Tokens do Claude + Codex, custo, análise por projeto e relatórios de IA diários
- **Rate limit** — Saldo de 5 horas / 7 dias com contagem regressiva de reset para provedores compatíveis

### Mobile e acessibilidade

- **UI responsiva** — Terminal e linha do tempo no celular e tablet
- **PWA** — Adicione à tela inicial para uma experiência próxima de um app nativo
- **Web Push** — Receba notificações mesmo após fechar a aba
- **Sincronização multi-dispositivo** — Alterações no workspace refletem em tempo real
- **Tailscale** — Acesso HTTPS externo via túnel criptografado WireGuard
- **Autenticação por senha** — Hashing com scrypt, seguro mesmo quando exposto externamente
- **Multilíngue** — 11 idiomas, incluindo 한국어, English, 日本語, 中文

## Plataformas suportadas

| Plataforma | Status | Observações |
|---|---|---|
| macOS (Apple Silicon / Intel) | ✅ | App Electron incluído |
| Linux | ✅ | Sem Electron |
| Windows | ❌ | Sem suporte |

## Detalhes de instalação

### Requisitos

- macOS 13+ ou Linux
- [Node.js](https://nodejs.org/) 20+
- [tmux](https://github.com/tmux/tmux)

Necessário para abas Claude. Instale o Claude Code e faça login antes de iniciar uma aba Claude:

```bash
curl -fsSL https://claude.ai/install.sh | bash
# ou com o canal latest do Homebrew
brew install --cask claude-code@latest
```

Opcional para abas Codex. Instale o Codex CLI e faça login antes de iniciar uma aba Codex:

```bash
npm i -g @openai/codex
# ou
brew install --cask codex
```

### npx (mais rápido)

```bash
npx purplemux@latest
```

### Instalação global

```bash
npm install -g purplemux
purplemux
```

### Exemplos de CLI

```bash
purplemux tab create -w WS -t codex-cli -n "fix auth"
purplemux tab create -w WS -t agent-sessions
```

### A partir do código-fonte

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

Modo de desenvolvimento:

```bash
pnpm dev
```

#### Nível de log

Ajuste o nível geral com `LOG_LEVEL` (padrão `info`).

```bash
LOG_LEVEL=debug pnpm dev
```

Para ativar apenas módulos específicos, liste pares `modulo=nivel` separados por vírgula em `LOG_LEVELS`. Níveis disponíveis: `trace` / `debug` / `info` / `warn` / `error` / `fatal`.

```bash
# Rastreia somente o comportamento dos hooks do Claude Code em debug
LOG_LEVELS=hooks=debug pnpm dev

# Vários módulos ao mesmo tempo
LOG_LEVELS=hooks=debug,status=warn pnpm dev
```

Módulos não listados em `LOG_LEVELS` usam o valor de `LOG_LEVEL`.

## Acesso externo (Tailscale Serve)

```bash
tailscale serve --bg 8022
```

Acesse em `https://<machine>.<tailnet>.ts.net`. Para desativar:

```bash
tailscale serve --bg off 8022
```

## Segurança

### Senha

Defina uma senha no primeiro acesso. Ela é armazenada com hash scrypt em `~/.purplemux/config.json`.

Para redefinir, apague `~/.purplemux/config.json` e reinicie — a tela de onboarding aparece novamente.

### HTTPS

Por padrão, o protocolo é HTTP. Sempre use HTTPS ao expor externamente:

- **Tailscale Serve** — Criptografia WireGuard com certificados automáticos
- **Nginx / Caddy** — Deve encaminhar os cabeçalhos de upgrade de WebSocket (`Upgrade`, `Connection`)

### Diretório de dados (`~/.purplemux/`)

| Arquivo | Descrição |
|---|---|
| `config.json` | Credenciais (hash) e configurações do app |
| `workspaces.json` | Layouts de workspaces, abas e diretórios |
| `vapid-keys.json` | Chaves VAPID do Web Push (geradas automaticamente) |
| `push-subscriptions.json` | Dados de assinaturas push |
| `hooks/` | Hooks definidos pelo usuário |

## Arquitetura

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

**I/O do terminal** — xterm.js conecta-se ao node-pty via WebSocket e o node-pty se acopla às sessões do tmux. Um protocolo binário trata stdin/stdout/resize com controle de backpressure.

**Detecção de status** — Os hooks de eventos dos agentes entregam atualizações imediatas via HTTP POST. Claude Code usa `SessionStart`, `Stop` e `Notification`; Codex usa `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` e `PermissionRequest`. A cada 5–15 s a árvore de processos é inspecionada e os últimos 8 KB dos arquivos JSONL são analisados.

**Timeline** — Observa os logs de sessão JSONL em `~/.claude/projects/` e `~/.codex/sessions/`, faz o parse das novas linhas a cada mudança e envia entradas estruturadas para o navegador.

**Isolamento do tmux** — Usa um socket `purple` dedicado, completamente separado do seu tmux existente. Sem tecla prefixo nem barra de status.

**Recuperação automática** — Ao iniciar o servidor, sessões anteriores do Claude são restauradas via `claude --resume {sessionId}`. Sessões do Codex podem ser retomadas pela lista de sessões ou com `codex resume {sessionId}`.

## License

[MIT](LICENSE)
