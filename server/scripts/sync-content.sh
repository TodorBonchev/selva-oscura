#!/usr/bin/env bash
# Refresh server/content from monorepo content/ (run from repo root)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="$ROOT/server/content"
mkdir -p "$DEST"/{cantos,drops/tables,drops/pools,economy} "$ROOT/server/vendor"
cp "$ROOT"/content/cantos/*.json "$DEST/cantos/"
cp "$ROOT"/content/drops/tables/*.json "$DEST/drops/tables/"
cp "$ROOT"/content/drops/pools/*.json "$DEST/drops/pools/"
cp "$ROOT"/content/economy/*.json "$DEST/economy/"
cp "$ROOT"/shared/game-core/src/constants.mjs "$ROOT/server/vendor/constants.mjs"
echo "Synced content → server/content and vendor/constants.mjs"
