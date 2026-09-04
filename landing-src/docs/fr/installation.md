---
title: Installation
description: Options d'installation — npx, global, app native macOS ou depuis les sources.
eyebrow: Commencer
permalink: /fr/docs/installation/index.html
---
{% from "docs/callouts.njk" import callout %}

Si vous avez exécuté `npx purplemux@latest` dans le [Démarrage rapide](/purplemux/fr/docs/quickstart/) et que cela vous suffit, c'est terminé. Cette page est destinée à celles et ceux qui veulent une installation persistante, une application desktop ou exécuter depuis les sources.

## Prérequis

- **macOS 13+ ou Linux** — Windows n'est pas pris en charge. WSL2 fonctionne en général, mais ne fait pas partie de notre matrice de tests.
- **[Node.js](https://nodejs.org) 20 ou plus récent** — vérifiez avec `node -v`.
- **[tmux](https://github.com/tmux/tmux)** — toute version 3.0+ convient.

## Méthodes d'installation

### npx (sans installation)

```bash
npx purplemux@latest
```

Télécharge purplemux au premier lancement et le met en cache dans `~/.npm/_npx/`. Idéal pour essayer ou pour un usage ponctuel sur une machine distante. Chaque exécution utilise la dernière version publiée.

### Installation globale

```bash
npm install -g purplemux
purplemux
```

pnpm et yarn fonctionnent de la même façon (`pnpm add -g purplemux` / `yarn global add purplemux`). Démarre plus vite ensuite parce qu'il n'y a plus rien à résoudre. Mise à jour avec `npm update -g purplemux`.

Le binaire est aussi disponible sous le nom plus court `pmux`.

### Application native macOS

Téléchargez le dernier `.dmg` depuis [Releases](https://github.com/subicura/purplemux/releases/latest) — des builds Apple Silicon et Intel sont fournis. La mise à jour automatique est intégrée.

L'application embarque Node, tmux et le serveur purplemux, et ajoute :

- Une icône dans la barre de menu indiquant l'état du serveur
- Des notifications natives (distinctes des Web Push)
- Le démarrage automatique à la connexion (à activer dans **Paramètres → Général**)

### Exécuter depuis les sources

```bash
git clone https://github.com/subicura/purplemux.git
cd purplemux
pnpm install
pnpm build
pnpm start
```

Pour le développement (rechargement à chaud) :

```bash
pnpm dev
```

## Port et variables d'environnement

purplemux écoute sur **8022** (web + ssh, pour la blague). Vous pouvez le changer avec `PORT` :

```bash
PORT=9000 purplemux
```

Le logging se contrôle avec `LOG_LEVEL` (par défaut `info`) et `LOG_LEVELS` pour des surcharges par module :

```bash
LOG_LEVEL=debug purplemux
# debug uniquement le module de hook Claude
LOG_LEVELS=hooks=debug purplemux
# plusieurs modules à la fois
LOG_LEVELS=hooks=debug,status=warn purplemux
```

Niveaux disponibles : `trace` · `debug` · `info` · `warn` · `error` · `fatal`. Les modules absents de `LOG_LEVELS` retombent sur `LOG_LEVEL`.

Voir [Ports & variables d'environnement](/purplemux/fr/docs/ports-env-vars/) pour la liste complète.

## Démarrage automatique

{% call callout('tip', 'Option la plus simple') %}
Si vous utilisez l'application macOS, activez **Paramètres → Général → Lancer à la connexion**. Pas de script à écrire.
{% endcall %}

Pour une installation CLI, encapsulez-la dans launchd (macOS) ou systemd (Linux). Une unité systemd minimale ressemble à ceci :

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

## Mise à jour

| Méthode | Commande |
|---|---|
| npx | automatique (dernière version à chaque exécution) |
| npm global | `npm update -g purplemux` |
| App macOS | automatique (mise à jour au lancement) |
| Depuis les sources | `git pull && pnpm install && pnpm build && pnpm start` |

## Désinstallation

```bash
npm uninstall -g purplemux          # ou pnpm remove -g / yarn global remove
rm -rf ~/.purplemux                 # efface paramètres et données de session
```

L'application native se glisse dans la Corbeille comme d'habitude. Voir [Répertoire de données](/purplemux/fr/docs/data-directory/) pour le détail de ce qui est stocké dans `~/.purplemux/`.
