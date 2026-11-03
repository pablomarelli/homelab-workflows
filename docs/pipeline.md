# Candidate builds and checked releases

This change is a proposal for the shared pipeline. Opening its PR does not inject workflows, change application variables, or deploy an application. **Merging does affect consumers:** actions reference `@main`, and template changes trigger the injector on main. Review and coordinate adoption before merging; this repository has no staged rollout mechanism.

## Default release path

The semver template still reserves a version by committing the bump and creating its Git tag atomically. That Git tag is version bookkeeping, not evidence of a successful image release. The resulting exact commit is checked out for lint, tests, and a Docker candidate build in parallel. This preserves embedded application version behavior and exact-revision validation; no build or test runs on a different pre-bump source tree.

Candidates have `sha-<full-release-SHA>-<run-id>-<attempt>` tags. A rerun gets a new tag, so candidates do not overwrite one another. The registry itself does not enforce immutability; promotion consumes the digest returned by that build. Candidates do not receive branch, release, or `latest` aliases. Failed checks may leave unused candidates and build cache entries; configure registry retention separately without deleting deployed images.

Promotion requires successful lint, tests, and exactly one build route. It verifies that the checked revision is still main, then assigns the version and `latest` tags to the existing digest without rebuilding. An existing version tag pointing at another digest is rejected. Registry lookup errors fail closed except an explicit missing manifest. Retrying a previously published version with a nondeterministic rebuild can therefore fail; use a new release rather than overwrite it. `latest` and version updates are registry operations, not an atomic multi-tag transaction.

Deployment rechecks main before requesting an infrastructure update. A new application push between that check and the infrastructure push remains a small race; GitHub/registry/infra do not offer a shared transaction. Release concurrency prevents overlapping releases from this workflow. Infrastructure push conflicts fail instead of rebasing a stale deployment over another update.

The Go/frontend calendar-version template retains its successful, same-repository main-push CI trigger and freshness checks, and now uses candidate promotion too. It does not acquire the JavaScript-only configuration below. The Docker action retains the legacy `version` input for already-injected workflows: those callers must have finished their checks before calling it. New workflows omit that input and use a separate promotion job.

## Dependency caching

The JavaScript lint/test actions normalize only `package.json.version`, `package-lock.json.version`, and `package-lock.json.packages[""].version` in temporary copies. The npm download cache key uses the normalized lockfile; dependency integrity, dependency versions, and workspace versions still affect the key. `npm ci` always installs from the original committed files. This is a download cache, not a cached `node_modules` tree.

Docker layer caching cannot be fixed transparently for arbitrary Dockerfiles. Opt in with repository variable `CI_NORMALIZED_DEPENDENCIES=true` **and** a Dockerfile that consumes the supplied `dependencies` named context:

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24 AS build
WORKDIR /app
COPY --from=dependencies package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
# Continue with the application's runtime stage.
```

Exclude `node_modules`, `.git`, and `.ci-dependencies` from the primary context via `.dockerignore`. The later source copy restores the actual application version. Adopt this only if install hooks do not require the root version, missing source files, workspace files, or other uncopied configuration. Apps with `.npmrc`, workspaces, native builds, or lifecycle scripts need a tailored dependency stage. A conventional Dockerfile still works, but its dependency layer will still be invalidated by version bumps until the app opts in. No application Dockerfiles were changed here.

Native `linux/amd64` builds no longer install QEMU. Direct action callers can set `platforms` and `qemu: 'true'` when emulation is needed.

## Explicit JavaScript test coverage

Shared checks and releases pass repository configuration through workflow environment variables. Direct action callers can instead use the corresponding inputs. These controls do not infer frameworks or provision application services.

| Repository variable | Test action input | Behavior |
| --- | --- | --- |
| `CI_E2E_SCRIPTS` | `e2e-scripts` | Space-separated npm browser scripts; default `auto` runs `test:e2e` if present; `none` disables browser suites |
| `CI_INTEGRATION_SCRIPTS` | `integration-scripts` | Space-separated required npm integration scripts; empty by default |
| `CI_PLAYWRIGHT_WORKERS` | `playwright-workers` | Optional positive integer, forwarded as `-- --workers=N` to each browser script |
| `CI_BUILD_ARTIFACT_PATH` | `artifact-path` | Opt-in production build output directory; empty by default |
| `CI_RUNTIME_DOCKERFILE` | Docker build `dockerfile` | Runtime Dockerfile used for artifact mode; default `Dockerfile.runtime` |

The order is unit tests → build → integration scripts → browser scripts. Explicitly requested missing scripts fail, rather than silently reducing coverage. Browser scripts must accept Playwright CLI arguments if workers are configured; Chromium is installed once. Scripts run sequentially, while Playwright can parallelize tests within each script. Service startup, readiness checks, credentials, cleanup, test data isolation, and any additional browsers belong to the application's scripts or custom workflow. Suites that need workflow `services`, secrets, or environment setup should use an app-owned workflow invoking these actions; merely naming a script cannot provision that environment.

For family-manager, inspect and adopt its actual backend/integration and production-browser npm scripts explicitly. Existing default `test:e2e` coverage does **not** imply those suites ran. Tune worker counts against runner CPU, memory, and test isolation; do not assume four workers halves runtime. This PR neither changes family-manager variables (including `DEPLOY_ENABLED`) nor adds its missing application test/service setup.

## Optional build-once frontend artifacts

Setting `CI_BUILD_ARTIFACT_PATH` selects the artifact route in production: the JavaScript test action builds once, completes all configured suites, and uploads the chosen directory. A separate packaging job downloads that run/attempt-specific artifact and builds `Dockerfile.runtime` from the same checked revision. The normal parallel Docker build is skipped. The runtime Dockerfile must copy the prebuilt output and must not rebuild it. It must be excluded from `.dockerignore` rules that would hide the downloaded output. Do not mutate the built output during later test scripts.

The artifact name is scoped to a run and attempt; rerun **all jobs** for artifact mode, because a failed-jobs-only rerun may not recreate that attempt's artifact. Missing artifacts fail closed. Only opt in for root JavaScript projects; Go/Python test actions do not upload this artifact.

This trades parallel Docker build time for avoiding duplicate compilation. It works for a static frontend with a compatible runtime image, but SSR bundles, runtime dependencies, generated files outside the selected directory, and build-time public configuration need application-specific packaging. Only public deployable output belongs in the artifact. Artifact upload/download adds latency. Nothing assumes Vite, Next.js, or a common output directory.

## Outcome meanings and validation

The always-run semver outcome job records `published`, the promotion result, the deployment job result (including `skipped`), `infra-updated`, and `healthy`. Publish-only runs and `DEPLOY_ENABLED=false` may successfully publish while skipping infrastructure. `infra-updated=true` means a changed infrastructure commit was pushed; a manifest already at the desired tag yields false. Missing or ambiguous application images fail. `healthy=unknown` always: neither Git push nor workflow success verifies ArgoCD sync, rollout readiness, application health, or browser smoke tests. Cluster-backed verification is a separate follow-up requiring connectivity and an application health contract.

Run:

```sh
node --test tests/*.test.cjs
bash tests/releases.sh
go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.11 -shellcheck= .github/workflows/*.yml workflows/*.yml workflows/*/*.yml
```

Regression tests cover the promotion gate's status combinations, stale/API-error rejection, immutable release-tag checks, normalized cache manifests, explicit suite selection/failure, and infrastructure outcomes. These local tests mock registry and infrastructure operations; they do not establish live GHCR or cluster behavior. Validate the generated workflow and app Dockerfile in a controlled application adoption PR before rollout. No measured speedup is claimed: parallelism reduces the default critical path from checks-plus-build to the slower branch, but consumes build minutes even when checks fail. Version reservation remains serial, and application E2E time can still dominate.
