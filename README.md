# homelab-workflows

New first-party apps must be registered in `.github/workflows/deploy-workflows.yml` to receive the shared deployment pipeline. Existing application CI is preserved.

The Go/frontend template supports `backend/go.mod`, `frontend/package.json`, a root `Dockerfile` and `VERSION`, and `scripts/check-version.sh` to validate the version. It releases after the application's **CI** workflow succeeds on a `main` push, builds that exact revision, and updates `homelab-infra` through the existing shared actions. Tags use `<VERSION>-<commit-SHA>` to avoid cached-image surprises; `VERSION` is not auto-bumped. Superseded revisions cannot proceed past the main-branch checks. Rerun the application's CI to retry a release; there is no separate manual deployment path.

The injector needs `REPOS_TOKEN` with workflow-write access. The application needs `INFRA_REPO_TOKEN` and `APP_NAMESPACE` (`media-share` for Easy Media Share). GHCR publishing uses `GITHUB_TOKEN`; make the package public or configure cluster image pull credentials.

Run `node --test tests/injection.test.cjs` to test injection and stale-revision checks without publishing images or changing application repositories.

See [the candidate release pipeline and adoption guide](docs/pipeline.md) for parallel image builds, gated digest promotion, version-stable npm caching, opt-in integration/browser suites and build artifacts, and the distinction between infrastructure updates and deployment health. Template changes are distributed on merge to `main`; review the rollout notes before merging.
