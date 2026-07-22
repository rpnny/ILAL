#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OLD_CLI_HEAD="3e74692ea4ed9625feb7b3226ab51c4c398f6266"

git -C "$ROOT_DIR" cat-file -e "${OLD_CLI_HEAD}^{commit}"
git -C "$ROOT_DIR" merge-base --is-ancestor "$OLD_CLI_HEAD" HEAD

for tag in cli-v0.1.1 cli-v0.1.2 cli-v0.2.0; do
  git -C "$ROOT_DIR" rev-parse --verify "refs/tags/$tag" >/dev/null
done

BUNDLE_PATH="$ROOT_DIR/../ilal-cli-legacy.bundle"
if [ -f "$BUNDLE_PATH" ]; then
  git -C "$ROOT_DIR" bundle verify "$BUNDLE_PATH" >/dev/null
fi

echo "legacy CLI HEAD and namespaced tags are reachable from the monorepo"
