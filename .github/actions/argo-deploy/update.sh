#!/usr/bin/env bash
set -euo pipefail
[[ "$APP_NAME" =~ ^[a-z0-9][a-z0-9-]*$ ]]
[[ "$VERSION" =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]]
manifest="manifests/$APP_NAME/deployment.yaml"
export MANIFEST="$manifest"
python3 - <<'PY'
import os, re
from pathlib import Path
p = Path(os.environ['MANIFEST'])
s = p.read_text()
pattern = r'(?m)^(\s*image:\s*ghcr\.io/pablomarelli/' + re.escape(os.environ['APP_NAME']) + r':)[^\s]+(\s*)$'
s, count = re.subn(pattern, lambda m: m[1] + os.environ['VERSION'] + m[2], s)
if count != 1:
    raise SystemExit(f'Expected exactly one application image in {p}; found {count}')
p.write_text(s)
PY
changed=false
if ! git diff --quiet -- "$manifest"; then
  git config user.name 'github-actions[bot]'
  git config user.email 'github-actions[bot]@users.noreply.github.com'
  git add -- "$manifest"
  git commit -m "chore($APP_NAME): update image to $VERSION"
  # A concurrent infrastructure push fails safely; rerun instead of rebasing over a newer release.
  git push origin HEAD:main
  changed=true
fi
echo "infra-updated=$changed" >> "$GITHUB_OUTPUT"
{
  echo "Infra-updated: $changed"
  echo 'Healthy: unknown — ArgoCD reconciliation and workload health are not checked.'
} >> "$GITHUB_STEP_SUMMARY"
