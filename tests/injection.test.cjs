const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { runInNewContext } = require("node:vm");

const root = path.resolve(__dirname, "..");
const injector = 'bash main/scripts/inject-workflows.sh main/workflows project';

function fixture(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(root, "workflows"), path.join(dir, "main/workflows"), { recursive: true });
  fs.cpSync(path.join(root, "scripts"), path.join(dir, "main/scripts"), { recursive: true });
  for (const [name, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

for (const [language, files, expected] of [
  ["Go/frontend", { "backend/go.mod": "module app", "frontend/package.json": "{}", VERSION: "2026.08.26" }, "go-frontend-calver/deploy-prod.yml"],
  ["Go", { "go.mod": "module app", VERSION: "0.1.0" }, "deploy-prod.yml"],
  ["JavaScript", { "package.json": JSON.stringify({ scripts: { lint: "lint", test: "test", build: "build" } }), "package-lock.json": "{}" }, "deploy-prod.yml"],
  ["Python", { "pyproject.toml": "" }, "deploy-prod.yml"],
]) {
  test(`injects the ${language} templates and preserves CI and VERSION`, (t) => {
    const dir = fixture(t, Object.fromEntries(Object.entries({ ...files, ".github/workflows/ci.yaml": "existing CI" })
      .map(([name, contents]) => [`project/${name}`, contents])));
    const result = spawnSync("bash", ["-e", "-c", injector], { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const rendered = fs.readFileSync(path.join(dir, "project/.github/workflows/deploy-prod.yml"), "utf8");
    const template = fs.readFileSync(path.join(root, "workflows", expected), "utf8");
    assert.equal(rendered, template.replaceAll("LANGUAGE", language.toLowerCase()));
    const checksPath = path.join(dir, "project/.github/workflows/checks.yml");
    if (language === "Go/frontend") {
      assert.equal(fs.existsSync(checksPath), false);
    } else {
      const checks = fs.readFileSync(path.join(root, "workflows/checks.yml"), "utf8");
      assert.equal(fs.readFileSync(checksPath, "utf8"), checks.replaceAll("LANGUAGE", language.toLowerCase()));
      // Reinjection updates managed checks while retaining unrelated application CI.
      fs.writeFileSync(checksPath, "old shared checks");
      const reinjected = spawnSync("bash", ["-e", "-c", injector], { cwd: dir, encoding: "utf8" });
      assert.equal(reinjected.status, 0, reinjected.stderr);
      assert.equal(fs.readFileSync(checksPath, "utf8"), checks.replaceAll("LANGUAGE", language.toLowerCase()));
    }
    assert.equal(fs.readFileSync(path.join(dir, "project/.github/workflows/ci.yaml"), "utf8"), "existing CI");
    if (files.VERSION) assert.equal(fs.readFileSync(path.join(dir, "project/VERSION"), "utf8"), files.VERSION);
  });
}

test("unsupported layouts fail without overwriting existing shared workflows", (t) => {
  const dir = fixture(t, {
    "project/.github/workflows/deploy-prod.yml": "existing deployment",
    "project/.github/workflows/checks.yml": "existing checks",
  });
  assert.notEqual(spawnSync("bash", ["-e", "-c", injector], { cwd: dir }).status, 0);
  assert.equal(fs.readFileSync(path.join(dir, "project/.github/workflows/deploy-prod.yml"), "utf8"), "existing deployment");
  assert.equal(fs.readFileSync(path.join(dir, "project/.github/workflows/checks.yml"), "utf8"), "existing checks");
});

test("both freshness checks fail closed for stale revisions or API failures", (t) => {
  const workflow = fs.readFileSync(path.join(root, "workflows/go-frontend-calver/deploy-prod.yml"), "utf8");
  const checks = [...workflow.matchAll(/run: (test .*SOURCE_SHA")/g)].map((match) => match[1]);
  assert.equal(checks.length, 2);
  const dir = fixture(t, { "bin/gh": '#!/bin/sh\nprintf "%s" "$API_SHA"\nexit "$API_STATUS"\n' });
  fs.chmodSync(path.join(dir, "bin/gh"), 0o755);
  for (const check of checks) {
    for (const [apiSha, status, expectedSuccess] of [["tested", "0", true], ["newer", "0", false], ["", "1", false]]) {
      const result = spawnSync("bash", ["-e", "-c", check], {
        env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, SOURCE_SHA: "tested", GITHUB_REPOSITORY: "owner/app", API_SHA: apiSha, API_STATUS: status },
      });
      assert.equal(result.status === 0, expectedSuccess);
    }
  }
});

test("the release condition permits only successful same-repository push CI", () => {
  const workflow = fs.readFileSync(path.join(root, "workflows/go-frontend-calver/deploy-prod.yml"), "utf8");
  const condition = workflow.match(/    if: >-\n([\s\S]*?)    runs-on:/)[1].trim();
  for (const [conclusion, event, repository, allowed] of [
    ["success", "push", "owner/app", true],
    ["failure", "push", "owner/app", false],
    ["cancelled", "push", "owner/app", false],
    ["skipped", "push", "owner/app", false],
    [null, "push", "owner/app", false],
    ["success", "pull_request", "owner/app", false],
    ["success", "push", "fork/app", false],
  ]) {
    const github = { repository: "owner/app", event: { workflow_run: { conclusion, event, head_repository: { full_name: repository } } } };
    assert.equal(runInNewContext(condition, { github }), allowed);
  }
});
