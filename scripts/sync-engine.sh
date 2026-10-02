#!/usr/bin/env bash
# Port engine updates from the braga-3d source of truth into this single-city
# fork. Report-only by default; only --apply copies files.
#
#   scripts/sync-engine.sh              # report engine changes since the base
#   scripts/sync-engine.sh --record     # set the base to braga's current HEAD
#   scripts/sync-engine.sh --apply      # copy the changed engine files, then verify
#
# Engine = everything EXCEPT this fork's city-specific files:
#   src/ (minus src/models/porto/, src/locales/{en,pt}.porto.js), scripts/, api/,
#   index.html, vite.config.js.
#
# The base commit is recorded in scripts/engine-base.txt. See feature_list.json
# porto-011 and AGENTS.md "Engine Lineage".
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRAGA="${BRAGA_DIR:-$(cd "$ROOT/.." && pwd)/braga-3d}"
BASE_FILE="$ROOT/scripts/engine-base.txt"
PATHS=(src scripts api index.html vite.config.js)
EXCLUDES=(':(exclude)src/models/porto' ':(exclude)src/locales/en.porto.js' ':(exclude)src/locales/pt.porto.js')

die() { echo "error: $*" >&2; exit 1; }
[ -d "$BRAGA/.git" ] || die "braga-3d not found at $BRAGA (set BRAGA_DIR)"

if [ "${1:-}" = "--record" ]; then
  git -C "$BRAGA" rev-parse HEAD > "$BASE_FILE"
  echo "recorded engine base: $(cat "$BASE_FILE")"
  exit 0
fi

[ -f "$BASE_FILE" ] || die "no $BASE_FILE; run with --record"
BASE="$(tr -d '[:space:]' < "$BASE_FILE")"
HEAD="$(git -C "$BRAGA" rev-parse HEAD)"

echo "engine source : $BRAGA"
echo "base          : $BASE"
echo "braga HEAD    : $HEAD"
echo

if [ "$BASE" = "$HEAD" ]; then
  echo "up to date — braga has no new commits."
  exit 0
fi

echo "=== commits in braga since base (engine paths) ==="
git -C "$BRAGA" log --oneline "$BASE..$HEAD" -- "${PATHS[@]}" "${EXCLUDES[@]}" || true
echo
echo "=== changed engine files ==="
git -C "$BRAGA" diff --stat "$BASE..$HEAD" -- "${PATHS[@]}" "${EXCLUDES[@]}" || true
echo

if [ "${1:-}" = "--apply" ]; then
  echo "=== copying engine files from braga ==="
  rsync -a --files-from=<(git -C "$BRAGA" diff --name-only "$BASE..$HEAD" -- "${PATHS[@]}" "${EXCLUDES[@]}") "$BRAGA/" "$ROOT/"
  echo "done. Review: git diff --stat && npm run verify"
else
  echo "Report-only. Re-run with --apply to copy the files, then: npm run verify"
fi
