#!/usr/bin/env bash
set -euo pipefail
has_script() { node -e 'process.exit(Object.hasOwn(require("./package.json").scripts || {}, process.argv[1]) ? 0 : 1)' "$1"; }
if [[ "$E2E_SCRIPTS" == auto ]]; then
  E2E_SCRIPTS=''
  if has_script test:e2e; then E2E_SCRIPTS=test:e2e; fi
elif [[ "$E2E_SCRIPTS" == none ]]; then
  E2E_SCRIPTS=''
fi
read -r -a integration <<< "$INTEGRATION_SCRIPTS"
read -r -a browser <<< "$E2E_SCRIPTS"
for script in "${integration[@]}" "${browser[@]}"; do
  [[ "$script" =~ ^[a-zA-Z0-9:_-]+$ && "$script" != -* ]] && has_script "$script" || { echo "Missing or invalid required script: $script" >&2; exit 1; }
done
workers=()
if [[ -n "$PLAYWRIGHT_WORKERS" ]]; then
  [[ "$PLAYWRIGHT_WORKERS" =~ ^[1-9][0-9]*$ ]] || { echo 'Workers must be a positive integer' >&2; exit 1; }
  workers=(-- --workers="$PLAYWRIGHT_WORKERS")
fi
npm test
npm run build
for script in "${integration[@]}"; do npm run "$script"; done
if (( ${#browser[@]} )); then
  npx --no-install playwright install --with-deps chromium
  for script in "${browser[@]}"; do npm run "$script" "${workers[@]}"; done
fi
