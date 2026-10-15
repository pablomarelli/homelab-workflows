# homelab-workflows

Shared deployment workflows and actions for first-party homelab applications. The injector commits `deploy-prod.yml` into registered application repositories; application-specific CI remains owned by those repositories.

## Register an application

Add a `project` and `profile` entry to the matrix in `.github/workflows/deploy-workflows.yml`:

```yaml
- project: easy-media-share
  profile: go-frontend-calver
```

Supported profiles:

| Profile | Project layout | Version handling |
|---|---|---|
| `javascript` | Root `package.json` | Existing JavaScript semver bump action |
| `python` | Root `requirements.txt`, `pyproject.toml`, or `Pipfile` | Existing Python semver bump action |
| `go-frontend-calver` | `backend/go.mod`, `frontend/package.json`, root `Dockerfile` and `VERSION`, `.github/workflows/ci.yaml` | Read and validate `YYYY.MM.DD` or `YYYY.MM.DD.N`; no automatic source commit |

Profiles are explicit: a nested frontend does not make a Go application a root-level JavaScript project. Add layout/version support here before registering an unsupported project. Change templates here rather than editing injected workflows by hand.

Pushing template, injector, or registration changes to `main` runs **Workflow Deployment**. It can also be dispatched manually. Injection only replaces `.github/workflows/deploy-prod.yml`; it preserves existing CI and reports commit/push failures instead of silently succeeding.

## Go/frontend calendar-version releases

The root Dockerfile builds the frontend and Go server into one image. The injected workflow:

1. Runs after **CI** completes on a `main` push, or on a manual dispatch from `main`.
2. Requires the latest push run of `.github/workflows/ci.yaml` to have succeeded for the exact current `main` commit, including manual releases. PR/fork runs, failed or running CI, and superseded commits cannot publish.
3. Checks out that exact tested revision and reads `VERSION` without semver-bumping it.
4. Uses the shared Docker action to publish `ghcr.io/<owner>/<app>:<VERSION>-<full-commit-SHA>`. The binary's version remains the root `VERSION`; the commit-qualified deployment tag prevents node image caches from masking new builds when `VERSION` is unchanged.
5. Checks the source is still current and CI is still successful before using the shared ArgoCD action to update `manifests/<app>/deployment.yaml` in `homelab-infra`. ArgoCD performs the rollout; no direct cluster credentials are needed.

The shared Docker action builds from the checked-out filesystem, labels the image with its actual commit SHA, and stores registry build cache under `:buildcache` rather than overwriting the runnable `:latest` image with cache metadata.

Production runs are serialized. The application CI workflow must be named `CI`, live at `.github/workflows/ci.yaml`, and run on every `main` push that should be releasable. A failed CI run does not publish; a manual release cannot bypass CI. If `main` advances during a build, the older release cannot update infrastructure; the new commit must pass its own CI.

### Credentials and first rollout

- `homelab-workflows` needs `REPOS_TOKEN` with permission to push workflow files to registered repositories.
- The application repository needs `INFRA_REPO_TOKEN` with write access to `homelab-infra`, plus the `APP_NAMESPACE` variable (`media-share` for Easy Media Share).
- Publishing uses the application's `GITHUB_TOKEN` with job-scoped `packages: write`; CI verification uses `actions: read`.
- Make the GHCR package public, or configure an ESO-managed image pull secret in the target namespace. Public source code does not automatically make the package public.

After merging changes here, inspect **Workflow Deployment** for successful injection. The injected commit should trigger the application's existing CI and then its deployment workflow. Alternatively, manually run **Prod Deploy (ArgoCD)** after CI succeeds for the current `main` revision. Confirm the image is published and pullable, the infrastructure tag update is pushed, and ArgoCD reports a healthy rollout. No image is published or deployment triggered by opening a PR here.

## Validation

Run `node --test tests/*.test.cjs` for isolated filesystem injection tests, calendar-version edge cases, and mocked GitHub CI/revision gates. The validation workflow also runs actionlint against workflows and the rendered legacy JavaScript template, plus ShellCheck on shell scripts. Full GitHub injection, GHCR publishing, and ArgoCD deployment require a merge and configured credentials; local tests do not claim to exercise those external side effects.
