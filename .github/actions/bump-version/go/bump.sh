#!/usr/bin/env bash
set -euo pipefail
version=$(cat VERSION)
[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || { echo 'VERSION must contain major.minor.patch' >&2; exit 1; }
IFS=. read -r major minor patch <<< "$version"
case "$BUMP_TYPE" in
  patch) patch=$((patch+1)) ;;
  minor) minor=$((minor+1)); patch=0 ;;
  major) major=$((major+1)); minor=0; patch=0 ;;
  *) echo 'Expected patch, minor, or major' >&2; exit 1 ;;
esac
version="$major.$minor.$patch"
printf '%s\n' "$version" > VERSION
echo "version=$version" >> "$GITHUB_OUTPUT"
