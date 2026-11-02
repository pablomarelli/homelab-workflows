#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d "${TMPDIR:-/tmp}/release-tests.XXXXXX")
trap 'rm -rf "$temp"' EXIT
export GITHUB_OUTPUT="$temp/outputs"
for lang in go javascript python; do
  project="$temp/$lang"
  mkdir -p "$project/.github/workflows"
  printf 'preserve\n' > "$project/.github/workflows/ci.yml"
  case "$lang" in
    go) touch "$project/go.mod"; printf '0.1.0\n' > "$project/VERSION" ;;
    javascript) printf '{"version":"0.1.0","scripts":{"lint":"lint","test":"test","build":"build"}}' > "$project/package.json"; printf '{}' > "$project/package-lock.json" ;;
    python) touch "$project/Pipfile" ;;
  esac
  bash "$root/scripts/inject-workflows.sh" "$root/workflows" "$project"
  grep -F "actions/bump-version/$lang@main" "$project/.github/workflows/deploy-prod.yml"
  test "$(cat "$project/.github/workflows/ci.yml")" = preserve
done
mkdir -p "$temp/unsupported/.github/workflows"
printf 'original\n' > "$temp/unsupported/.github/workflows/deploy-prod.yml"
if bash "$root/scripts/inject-workflows.sh" "$root/workflows" "$temp/unsupported"; then exit 1; fi
test "$(cat "$temp/unsupported/.github/workflows/deploy-prod.yml")" = original
for spec in 'patch 1.2.4' 'minor 1.3.0' 'major 2.0.0'; do
  read -r bump expected <<< "$spec"
  mkdir -p "$temp/version"
  (cd "$temp/version"; printf '1.2.3\n' > VERSION; BUMP_TYPE="$bump" bash "$root/.github/actions/bump-version/go/bump.sh"; test "$(cat VERSION)" = "$expected")
done
(cd "$temp/version"; printf '2026.08.26\n' > VERSION; if BUMP_TYPE=patch bash "$root/.github/actions/bump-version/go/bump.sh"; then exit 1; fi)
git init --bare -q "$temp/origin.git"
git init -q -b main "$temp/repo"
cd "$temp/repo"
git config user.name Test
git config user.email test@example.invalid
printf '0.1.0\n' > VERSION
git add VERSION
git commit -qm initial
git remote add origin "$temp/origin.git"
git push -qu origin main
export GITHUB_REF_NAME=main GITHUB_SHA
GITHUB_SHA=$(git rev-parse HEAD)
printf '0.1.1\n' > VERSION
VERSION=0.1.1 bash "$root/.github/actions/commit-release/commit.sh"
test "$(git --git-dir="$temp/origin.git" rev-parse main)" = "$(git --git-dir="$temp/origin.git" rev-parse v0.1.1)"
git log -1 --format=%s | grep -F '[skip ci]'
grep -Fx "revision=$(git rev-parse HEAD)" "$GITHUB_OUTPUT"
# Reject stale runs before a second commit or push.
printf '0.1.2\n' > VERSION
if VERSION=0.1.2 bash "$root/.github/actions/commit-release/commit.sh"; then exit 1; fi
test "$(git --git-dir="$temp/origin.git" rev-parse main)" = "$(git --git-dir="$temp/origin.git" rev-parse v0.1.1)"
# Simulate a source push after checkout: branch and tag must both fail atomically.
GITHUB_SHA=$(git rev-parse HEAD)
git clone -q --branch main "$temp/origin.git" "$temp/concurrent"
git -C "$temp/concurrent" -c user.name=Test -c user.email=test@example.invalid commit --allow-empty -qm concurrent
git -C "$temp/concurrent" push -q origin main
if VERSION=0.1.2 bash "$root/.github/actions/commit-release/commit.sh"; then exit 1; fi
if git --git-dir="$temp/origin.git" show-ref --verify --quiet refs/tags/v0.1.2; then exit 1; fi
echo 'Release versioning, exact revision, stale-run rejection, and atomic push tests passed.'
