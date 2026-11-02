# Family Manager release pipeline

The private `family-manager-backend` and `family-manager-frontend` repositories
use the shared `family-manager.yml` injection template. Existing applications
continue to use their existing deployment template.

The reusable workflow checks the caller's exact commit before publishing
`ghcr.io/pablomarelli/<repository>:sha-<full-commit>`. It supports Go and JavaScript
without changing version files. Publishing is limited to `main`.

## Enable

1. Merge the application PRs and this workflow PR.
2. Give the injector's `REPOS_TOKEN` access to both private repositories and
   permission to update workflows. Run **Workflow Deployment**.
3. Keep `FAMILY_MANAGER_DEPLOY` unset for the first release. Run each injected
   **Family Manager release** workflow. Verify both private GHCR images exist.
4. Configure a read-only GHCR pull credential in 1Password for the cluster.
   Keep the packages private. Repository privacy does not configure package
   access or grant the cluster permission to pull images.
5. Set the exact published tags in the infrastructure activation PR. Complete
   its secret, storage, Authentik, and routing setup before enabling ArgoCD.
6. Set `INFRA_REPO_TOKEN` in each application repository. After activation,
   set `FAMILY_MANAGER_DEPLOY=true` to allow later successful releases to update
   `manifests/<repository>/deployment.yaml` through the existing GitOps action.

Application-specific pull-request checks remain in each application repository.
The release workflow repeats the required checks against the published source
revision. No application credentials, identity data, or database contents belong
in this repository or release inputs.
