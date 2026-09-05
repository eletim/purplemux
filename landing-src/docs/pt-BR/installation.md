---
title: Instalação
description: Opções de instalação — npx, global, app nativo do macOS ou direto do código-fonte.
eyebrow: Primeiros passos
permalink: /pt-BR/docs/installation/index.html
---
{% from "docs/callouts.njk" import callout %}

Se você rodou `npx purplemux@latest` no [Início rápido](/purplemux/pt-BR/docs/quickstart/) e isso já bastou, está tudo certo. Esta página é para quem quer uma instalação persistente, um app de desktop ou rodar a partir do código-fonte.

## Requisitos

- **macOS 13+ ou Linux** — Windows não é suportado. O WSL2 normalmente funciona, mas está fora do nosso escopo de testes.
- **[Node.js](https://nodejs.org) 20 ou mais novo** — verifique com `node -v`.
- **[tmux](https://github.com/tmux/tmux)** — qualquer versão 3.0+.

## Métodos de instalação

### npx (sem instalar)

```bash
npx purplemux@latest
```

Baixa o purplemux na primeira execução e armazena em cache em `~/.npm/_npx/`. Ideal para experimentar ou rodar pontualmente em uma máquina remota. Cada execução usa a versão publicada mais recente.

### Instalação global

```bash
npm install -g purplemux
purplemux
```

pnpm e yarn funcionam do mesmo jeito (`pnpm add -g purplemux` / `yarn global add purplemux`). As execuções seguintes ficam mais rápidas porque nada precisa ser resolvido. Atualize com `npm update -g purplemux`.

O binário também está disponível como `pmux`, para encurtar.

### App nativo do macOS

Baixe o `.dmg` mais recente em [Releases](https://github.com/subicura/purplemux/releases/latest) — temos builds para Apple Silicon e Intel. Auto-update incluído.

O app empacota Node, tmux e o servidor purplemux, e ainda adiciona:

- Um ícone na barra de menu mostrando o status do servidor
- Notificações nativas (separadas das Web Push)
- Início automático no login (alterne em **Configurações → Geral**)

### Rodando direto do código-fonte

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

Para desenvolvimento (hot reload):

```bash
pnpm dev
```

## Porta e variáveis de ambiente

O purplemux escuta na porta **8022** (web + ssh, brincadeira nossa). Sobrescreva com `PORT`:

```bash
PORT=9000 purplemux
```

O log é controlado por `LOG_LEVEL` (padrão `info`) e `LOG_LEVELS` para overrides por módulo:

```bash
LOG_LEVEL=debug purplemux
# debug apenas no módulo de hooks do Claude
LOG_LEVELS=hooks=debug purplemux
# vários módulos de uma vez
LOG_LEVELS=hooks=debug,status=warn purplemux
```

Níveis disponíveis: `trace` · `debug` · `info` · `warn` · `error` · `fatal`. Módulos não listados em `LOG_LEVELS` caem em `LOG_LEVEL`.

Veja [Portas e variáveis de ambiente](/purplemux/pt-BR/docs/ports-env-vars/) para a lista completa.

## Iniciar no boot

{% call callout('tip', 'Opção mais simples') %}
Se você usa o app de macOS, ative **Configurações → Geral → Iniciar no login**. Sem scripts.
{% endcall %}

Para uma instalação via CLI, embrulhe num launchd (macOS) ou systemd (Linux). Uma unit mínima do systemd fica assim:

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

## Atualizando

| Método | Comando |
|---|---|
| npx | automático (sempre a versão mais recente) |
| npm global | `npm update -g purplemux` |
| App de macOS | automático (atualiza ao iniciar) |
| Código-fonte | `git pull && pnpm install && pnpm build && pnpm start` |

## Desinstalar

```bash
npm uninstall -g purplemux          # ou pnpm remove -g / yarn global remove
rm -rf ~/.purplemux                 # apaga configurações e dados de sessão
```

O app nativo é arrastado para a Lixeira normalmente. Veja [Diretório de dados](/purplemux/pt-BR/docs/data-directory/) para saber exatamente o que fica em `~/.purplemux/`.
