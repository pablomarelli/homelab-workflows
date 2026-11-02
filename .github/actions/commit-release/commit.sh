#!/usr/bin/env bash
set -euo pipefail
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]] || { echo 'Invalid semantic version' >&2; exit 1; }
[[ "$(git rev-parse HEAD)" == "$GITHUB_SHA" ]] || { echo 'Release source changed; run the workflow on the current main commit.' >&2; exit 1; }
git config user.name 'github-actions[bot]'
git config user.email 'github-actions[bot]@users.noreply.github.com'
git add -u
# Prevent version commits from recursively starting another release.
git commit -m "chore: bump version to $VERSION [skip ci]"
git tag "v$VERSION"
# Never rebase a release onto source that has not passed its checks.
git push --atomic origin "HEAD:refs/heads/$GITHUB_REF_NAME" "refs/tags/v$VERSION"
echo "revision=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
