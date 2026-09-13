#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

if [[ -n "${PNPM_CONFIG_GLOBAL_BIN_DIR:-}" ]]; then
  pnpm_global_bin="$PNPM_CONFIG_GLOBAL_BIN_DIR"
elif [[ -n "${npm_config_global_bin_dir:-}" ]]; then
  pnpm_global_bin="$npm_config_global_bin_dir"
else
  if [[ -n "${PNPM_HOME:-}" ]]; then
    pnpm_home="$PNPM_HOME"
  elif [[ -n "${XDG_DATA_HOME:-}" ]]; then
    pnpm_home="${XDG_DATA_HOME%/}/pnpm"
  elif [[ "$(uname -s)" == "Darwin" ]]; then
    pnpm_home="$HOME/Library/pnpm"
  else
    pnpm_home="$HOME/.local/share/pnpm"
  fi
  pnpm_global_bin="${pnpm_home%/}/bin"
fi

if [[ -z "$pnpm_global_bin" ]]; then
  echo "[purplemux] Could not determine the pnpm global bin directory." >&2
  exit 1
fi

case ":$PATH:" in
  *":$pnpm_global_bin:"*) ;;
  *)
    echo "[purplemux] Adding pnpm global bin to PATH for this launch: $pnpm_global_bin"
    export PATH="$pnpm_global_bin:$PATH"
    ;;
esac

# Keep pnpm's global install target aligned with the process-local PATH entry.
export PNPM_CONFIG_GLOBAL_BIN_DIR="$pnpm_global_bin"

if [[ ! -x node_modules/.bin/next || ! -x node_modules/.bin/tsx ]]; then
  echo "[purplemux] Installing source dependencies..."
  pnpm install --frozen-lockfile
fi

repo_version="$(node -p "require('./package.json').version")"
installed_version=""

if command -v purplemux >/dev/null 2>&1; then
  installed_version="$(purplemux --version 2>/dev/null || true)"
fi

if [[ "$installed_version" == "$repo_version" ]]; then
  echo "[purplemux] CLI $repo_version is ready."
else
  if [[ -z "$installed_version" ]]; then
    echo "[purplemux] Installing CLI $repo_version from this checkout..."
  else
    echo "[purplemux] Updating CLI from $installed_version to $repo_version using this checkout..."
  fi
  pnpm add --global "$repo_root"
  hash -r

  installed_version="$(purplemux --version 2>/dev/null || true)"
  if [[ "$installed_version" != "$repo_version" ]]; then
    echo "[purplemux] CLI installation did not put version $repo_version first in PATH." >&2
    echo "[purplemux] Check 'command -v purplemux' and your pnpm global bin configuration." >&2
    exit 1
  fi
fi

if node scripts/build-fingerprint.js check >/dev/null 2>&1; then
  echo "[purplemux] Production build is fresh."
else
  echo "[purplemux] Production build is missing, stale, or invalid; building..."
  pnpm build
fi

echo "[purplemux] Starting PurpleMux..."
exec pnpm start
