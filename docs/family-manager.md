# Family Manager pipeline adoption

Both private repositories use the standard `workflows/deploy-prod.yml` template.
The injector detects Go from `go.mod`, JavaScript from `package.json`, and Python
from the existing dependency-file conventions. There is no application-specific
workflow or repository-name condition.

The frontend's version is in `package.json` and its lockfile. The backend's
application version is in root `VERSION`, initially `0.1.0`. It is separate from
the Go toolchain version in `go.mod`.

## Release contract

1. Bump the application version and atomically push its commit and `v<version>`
   tag. A `[skip ci]` message prevents recursive release runs.
2. Run shared lint and test actions on that exact release commit.
3. Build the same commit from the checked-out directory and publish its semantic
   version tag to GHCR. Failed checks prevent publishing and deployment, but the
   version commit remains. Retry the failed jobs or start a new versioned release.
4. Update the infrastructure image using the existing ArgoCD deployment action.

Source changes during a bump cause the push to fail. The pipeline never rebases
a release onto unchecked code. Restart the workflow on current main in that case.
Concurrency serializes releases within each application repository.

## Onboarding

- Merge the application changes and this shared workflow PR.
- Configure `REPOS_TOKEN` access for injection and release commits in both private
  repositories, `INFRA_REPO_TOKEN` for infrastructure updates, and
  `APP_NAMESPACE=family-manager`.
- Before injecting, set `DEPLOY_ENABLED=false` in both application repositories.
  Run the existing workflow injector. It preserves application-specific CI files.
- Use the standard release workflow to publish initial images. Manual runs also
  support `publish-only=true`. Verify the exact semantic version tags exist and
  keep the GHCR packages private.
- Configure the cluster's private image-pull credential through 1Password.
- Complete the infrastructure activation PR with those published tags.
- Set `DEPLOY_ENABLED=true` after activation. Existing applications with the
  variable unset retain automatic deployment.

The shared template now requires lint and test commands. JavaScript projects
must expose `lint`, `test`, and `build` scripts and commit their npm lockfile.
Optional `test:e2e` runs Playwright suites defined by the application. Family
Manager includes its account tests in that script, rather than teaching the
shared pipeline application-specific test names.
Go projects need a root `VERSION` file. Python keeps its bumpversion configuration.
Check existing registered projects against these requirements before reinjection.

Current migration gaps: `dev-portfolio` lacks a `test` script; `easy-media-share`
uses a nested Go module and date version `2026.08.26`. The injector rejects
unsupported projects before writing workflows and allows other matrix entries
to continue. Their existing workflows remain until their adoption gaps are resolved.
