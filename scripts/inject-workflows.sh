#!/usr/bin/env bash
set -euo pipefail
templates=$(cd "$1" && pwd)
cd "$2"
if [[ -f backend/go.mod && -f frontend/package.json && -f VERSION ]]; then
  lang=go-frontend-calver
  templates="$templates/go-frontend-calver"
elif [[ -f go.mod ]]; then
  lang=go
  grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' VERSION || { echo 'Go projects require a root semantic VERSION file' >&2; exit 1; }
elif [[ -f requirements.txt || -f pyproject.toml || -f Pipfile ]]; then
  lang=python
elif [[ -f package.json ]]; then
  lang=javascript
  node -e 'const p=require("./package.json"); for (const name of ["lint","test","build"]) if (!p.scripts?.[name]) throw new Error(`Missing required script: ${name}`)'
  test -f package-lock.json
else
  echo 'Unsupported root layout; migrate the project before workflow injection.' >&2
  exit 1
fi
# Validate the contract before touching existing workflow files.
mkdir -p .github/workflows
for workflow in "$templates"/*.yml; do
  sed "s/LANGUAGE/$lang/g" "$workflow" > ".github/workflows/$(basename "$workflow")"
done
