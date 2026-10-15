const assert = require("node:assert/strict");
const { test } = require("node:test");
const verifyRelease = require("../.github/actions/verify-release/verify-release.cjs");

const revision = "a".repeat(40);
const context = { repo: { owner: "pablomarelli", repo: "easy-media-share" } };

function fixture(overrides = {}, head = revision) {
  const run = {
    head_sha: revision,
    head_branch: "main",
    event: "push",
    head_repository: { full_name: "pablomarelli/easy-media-share" },
    status: "completed",
    conclusion: "success",
    ...overrides,
  };
  return {
    context,
    revision,
    github: {
      rest: {
        repos: {
          async getCommit(params) {
            assert.deepEqual(params, { ...context.repo, ref: "main" });
            return { data: { sha: head } };
          },
        },
        actions: {
          async listWorkflowRuns(params) {
            assert.deepEqual(params, {
              ...context.repo,
              workflow_id: "ci.yaml",
              branch: "main",
              event: "push",
              head_sha: revision,
              per_page: 1,
            });
            return { data: { workflow_runs: overrides.missing ? [] : [run] } };
          },
        },
      },
    },
  };
}

test("allows successful push CI for the exact main commit", async () => {
  await verifyRelease(fixture());
});

for (const [name, overrides] of Object.entries({
  "missing CI": { missing: true },
  "failed CI": { conclusion: "failure" },
  "cancelled CI": { conclusion: "cancelled" },
  "skipped CI": { conclusion: "skipped" },
  "running CI": { status: "in_progress", conclusion: null },
  "wrong source revision": { head_sha: "b".repeat(40) },
  "pull request CI": { event: "pull_request" },
  "feature branch CI": { head_branch: "feature" },
  "fork CI": { head_repository: { full_name: "someone/easy-media-share" } },
  "missing repository": { head_repository: null },
})) {
  test(`rejects ${name}`, async () => {
    await assert.rejects(verifyRelease(fixture(overrides)), /must have completed successfully/);
  });
}

test("rejects a superseded main commit", async () => {
  await assert.rejects(verifyRelease(fixture({}, "b".repeat(40))), /no longer the current main/);
});

test("rejects invalid source revisions before API calls", async () => {
  await assert.rejects(verifyRelease({ revision: "main" }), /full commit SHA/);
});

test("API failures fail closed", async () => {
  const args = fixture();
  args.github.rest.actions.listWorkflowRuns = async () => { throw new Error("API unavailable"); };
  await assert.rejects(verifyRelease(args), /API unavailable/);
});
