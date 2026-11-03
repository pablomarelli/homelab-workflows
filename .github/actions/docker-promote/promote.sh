#!/usr/bin/env bash
set -euo pipefail
[[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$VERSION" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]
[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]]
current=$(gh api "repos/$GITHUB_REPOSITORY/commits/main" --jq .sha)
[[ "$current" == "$REVISION" ]] || { echo 'Release superseded; refusing promotion' >&2; exit 1; }
# Release tags are immutable. Fail closed on registry errors other than a missing tag.
error_file=$(mktemp)
trap 'rm -f "$error_file"' EXIT
if existing=$(docker buildx imagetools inspect "$IMAGE:$VERSION" --format '{{.Manifest.Digest}}' 2>"$error_file"); then
  [[ "$existing" == "$DIGEST" ]] || { echo 'Release tag already points at another digest' >&2; exit 1; }
elif ! grep -Eqi 'not found|manifest unknown' "$error_file"; then
  cat "$error_file" >&2
  exit 1
fi
# --prefer-index=false preserves a single-platform manifest digest as well as indexes.
docker buildx imagetools create --prefer-index=false --tag "$IMAGE:$VERSION" --tag "$IMAGE:latest" "$IMAGE@$DIGEST"
echo 'published=true' >> "$GITHUB_OUTPUT"
