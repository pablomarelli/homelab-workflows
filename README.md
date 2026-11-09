# homelab-workflows

New first-party apps must be registered in `.github/workflows/deploy-workflows.yml` to receive the shared deployment pipeline. Existing application CI is preserved.

The `uv-pnpm` template supports a root `pyproject.toml`, `uv.lock`, and `Dockerfile`, with `frontend/package.json` and `frontend/pnpm-lock.yaml`. The application must provide `.github/workflows/ci.yml` or `ci.yaml`, named **CI**, that checks both stacks on main pushes. The injector preserves that file. Releases use `<project.version>-<commit-SHA>` without changing version files and require successful same-repository push CI. Configure `NODE_AUTH_TOKEN` for private frontend packages; the shared Docker action passes it as a BuildKit secret. Set `APP_NAMESPACE` and `INFRA_REPO_TOKEN`; initial releases publish only until `DEPLOY_ENABLED=true` is explicitly set after infrastructure onboarding.

The Go/frontend template supports `backend/go.mod`, `frontend/package.json`, a root `Dockerfile` and `VERSION`, and `scripts/check-version.sh` to validate the version. It releases after the application's **CI** workflow succeeds on a `main` push, builds that exact revision, and updates `homelab-infra` through the existing shared actions. Tags use `<VERSION>-<commit-SHA>` to avoid cached-image surprises; `VERSION` is not auto-bumped. Superseded revisions cannot proceed past the main-branch checks. Rerun the application's CI to retry a release; there is no separate manual deployment path.

The injector needs `REPOS_TOKEN` with workflow-write access. The application needs `INFRA_REPO_TOKEN` and `APP_NAMESPACE` (`media-share` for Easy Media Share). GHCR publishing uses `GITHUB_TOKEN`; make the package public or configure cluster image pull credentials.

Run `node --test tests/injection.test.cjs` to test injection and stale-revision checks without publishing images or changing application repositories.
