#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

if [[ ! -x node_modules/.bin/next || ! -x node_modules/.bin/tsx ]]; then
  echo "[purplemux] Installing source dependencies..."
  pnpm install --frozen-lockfile
fi

repo_version="$(node -p "require('./package.json').version")"
installed_version=""
configured_global_bin="$(pnpm config get global-bin-dir)"

if [[ -n "$configured_global_bin" && "$configured_global_bin" != "undefined" && "$configured_global_bin" != "null" ]]; then
  pnpm_global_bin="$configured_global_bin"
elif [[ -n "${PNPM_HOME:-}" ]]; then
  pnpm_global_bin="${PNPM_HOME%/}/bin"
else
  pnpm_global_root="$(pnpm root --global)"
  pnpm_global_bin="$(dirname -- "$(dirname -- "$(dirname -- "$pnpm_global_root")")")/bin"
fi

if [[ -z "$pnpm_global_bin" ]]; then
  echo "[purplemux] pnpm did not report a global bin directory." >&2
  exit 1
fi

case ":$PATH:" in
  *":$pnpm_global_bin:"*) ;;
  *)
    echo "[purplemux] Adding pnpm global bin to PATH for this launch: $pnpm_global_bin"
    export PATH="$pnpm_global_bin:$PATH"
    ;;
esac

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
