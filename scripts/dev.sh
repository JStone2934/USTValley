#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# The initial development machine has a verified Node 24 installation here.
# On other machines, any Node 24 already on PATH takes precedence.
if ! command -v node >/dev/null 2>&1; then
  export PATH="${XDG_DATA_HOME:-$HOME/.local/share}/ustvalley-node/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  echo 'Please install Node.js 24 (see .nvmrc), then run npm ci.' >&2
  exit 1
fi
exec npm run dev -- "$@"
