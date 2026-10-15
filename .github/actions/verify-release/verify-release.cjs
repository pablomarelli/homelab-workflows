module.exports = async function verifyRelease({ github, context, revision }) {
  if (!/^[a-f0-9]{40}$/.test(revision)) {
    throw new Error("Release revision must be a full commit SHA");
  }
  const { owner, repo } = context.repo;
  const { data: head } = await github.rest.repos.getCommit({ owner, repo, ref: "main" });
  if (head.sha !== revision) {
    throw new Error("Release revision is no longer the current main commit");
  }
  const { data } = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: "ci.yaml",
    branch: "main",
    event: "push",
    head_sha: revision,
    per_page: 1,
  });
  const run = data.workflow_runs[0];
  if (
    !run ||
    run.head_sha !== revision ||
    run.head_branch !== "main" ||
    run.event !== "push" ||
    run.head_repository?.full_name !== `${owner}/${repo}` ||
    run.status !== "completed" ||
    run.conclusion !== "success"
  ) {
    throw new Error("The latest push CI run for this main revision must have completed successfully");
  }
};
