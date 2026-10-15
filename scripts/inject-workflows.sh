#!/usr/bin/env bash
set -euo pipefail

source_dir=${1:?Usage: inject-workflows.sh SOURCE PROJECT PROFILE}
project_dir=${2:?Usage: inject-workflows.sh SOURCE PROJECT PROFILE}
profile=${3:?Usage: inject-workflows.sh SOURCE PROJECT PROFILE}

require_file() {
  if [[ ! -f "$project_dir/$1" ]]; then
    echo "Profile $profile requires $1 in $project_dir" >&2
    exit 1
  fi
}

case "$profile" in
  javascript)
    require_file package.json
    template="$source_dir/workflows/deploy-prod.yml"
    ;;
  python)
    if [[ ! -f "$project_dir/requirements.txt" && ! -f "$project_dir/pyproject.toml" && ! -f "$project_dir/Pipfile" ]]; then
      echo "Python profile requires requirements.txt, pyproject.toml, or Pipfile" >&2
      exit 1
    fi
    template="$source_dir/workflows/deploy-prod.yml"
    ;;
  go-frontend-calver)
    require_file backend/go.mod
    require_file frontend/package.json
    require_file VERSION
    require_file Dockerfile
    require_file .github/workflows/ci.yaml
    bash "$source_dir/.github/actions/read-version/read-version.sh" "$project_dir/VERSION" >/dev/null
    template="$source_dir/workflows/go-frontend-calver/deploy-prod.yml"
    ;;
  *)
    echo "Unsupported workflow profile: $profile" >&2
    exit 1
    ;;
esac

if [[ ! -f "$template" ]]; then
  echo "Workflow template not found: $template" >&2
  exit 1
fi
mkdir -p "$project_dir/.github/workflows"
sed "s/LANGUAGE/$profile/g" "$template" > "$project_dir/.github/workflows/deploy-prod.yml"
