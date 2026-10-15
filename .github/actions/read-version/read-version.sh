#!/usr/bin/env bash
set -euo pipefail

file=${1:-VERSION}
if [[ ! -f "$file" ]] || ! awk 'END { exit NR != 1 }' "$file"; then
  echo 'VERSION must contain exactly one line' >&2
  exit 1
fi
version=$(cat -- "$file")
if [[ ! "$version" =~ ^[0-9]{4}\.(0[1-9]|1[0-2])\.(0[1-9]|[12][0-9]|3[01])(\.[1-9][0-9]*)?$ ]]; then
  echo 'Expected YYYY.MM.DD or YYYY.MM.DD.N in VERSION' >&2
  exit 1
fi
calendar_date=${version:0:10}
if [[ $(date -u -d "${calendar_date//./-}" +%Y.%m.%d) != "$calendar_date" ]]; then
  echo 'VERSION contains an invalid calendar date' >&2
  exit 1
fi
printf '%s\n' "$version"
