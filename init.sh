#!/usr/bin/env bash
# Standard startup path for porto-3d. Installs dependencies and runs the
# baseline verification gate before any new work begins. If baseline
# verification is already failing, fix that first — do not stack new feature
# work on a broken starting state.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "==> Working directory: $PWD"
if [ -f .nvmrc ]; then
  echo "==> Node $(cat .nvmrc) required (current: $(node -v 2>/dev/null || echo 'not found'))"
fi

echo "==> Syncing dependencies"
npm install

echo "==> Running baseline verification"
npm run verify

echo "==> Startup command"
printf '    %s\n' "npm run dev"

if [ "${RUN_START_COMMAND:-0}" = "1" ]; then
  echo "==> Starting the app"
  exec npm run dev
fi

echo "Set RUN_START_COMMAND=1 to have init.sh launch the app directly."
