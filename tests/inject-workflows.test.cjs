const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");

function project(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), contents);
  }
  return dir;
}

function inject(dir, profile) {
  return spawnSync("bash", [path.join(root, "scripts/inject-workflows.sh"), root, dir, profile], { encoding: "utf8" });
}

const goFiles = {
  "backend/go.mod": "module example.com/app\n",
  "frontend/package.json": "{}\n",
  "VERSION": "2026.08.26\n",
  "Dockerfile": "FROM scratch\n",
  ".github/workflows/ci.yaml": "name: CI\n",
};

test("injects a single release workflow for the real Go/frontend layout without modifying CI or VERSION", (t) => {
  const dir = project(t, goFiles);
  for (let i = 0; i < 2; i++) {
    const result = inject(dir, "go-frontend-calver");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(dir, ".github/workflows/deploy-prod.yml"), "utf8"),
      fs.readFileSync(path.join(root, "workflows/go-frontend-calver/deploy-prod.yml"), "utf8"));
    assert.equal(fs.readFileSync(path.join(dir, ".github/workflows/ci.yaml"), "utf8"), goFiles[".github/workflows/ci.yaml"]);
    assert.equal(fs.readFileSync(path.join(dir, "VERSION"), "utf8"), goFiles.VERSION);
    assert.deepEqual(fs.readdirSync(path.join(dir, ".github/workflows")).sort(), ["ci.yaml", "deploy-prod.yml"]);
  }
});

test("preserves the existing JavaScript deployment profile", (t) => {
  const dir = project(t, { "package.json": "{}\n", ".github/workflows/ci.yaml": "unchanged\n" });
  const result = inject(dir, "javascript");
  assert.equal(result.status, 0, result.stderr);
  const rendered = fs.readFileSync(path.join(dir, ".github/workflows/deploy-prod.yml"), "utf8");
  assert.match(rendered, /bump-version\/javascript@main/);
  assert.doesNotMatch(rendered, /LANGUAGE/);
  assert.equal(fs.readFileSync(path.join(dir, ".github/workflows/ci.yaml"), "utf8"), "unchanged\n");
});

test("preserves the Python profile", (t) => {
  const dir = project(t, { "pyproject.toml": "" });
  const result = inject(dir, "python");
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(dir, ".github/workflows/deploy-prod.yml"), "utf8"), /bump-version\/python@main/);
});

for (const missing of Object.keys(goFiles)) {
  test(`fails before injection when ${missing} is missing`, (t) => {
    const files = { ...goFiles };
    delete files[missing];
    const dir = project(t, files);
    assert.notEqual(inject(dir, "go-frontend-calver").status, 0);
    assert.equal(fs.existsSync(path.join(dir, ".github/workflows/deploy-prod.yml")), false);
  });
}

test("rejects unknown profiles without modifying existing workflows", (t) => {
  const dir = project(t, { ".github/workflows/deploy-prod.yml": "existing\n" });
  assert.notEqual(inject(dir, "../invalid").status, 0);
  assert.equal(fs.readFileSync(path.join(dir, ".github/workflows/deploy-prod.yml"), "utf8"), "existing\n");
});

test("a missing template does not truncate an existing workflow", (t) => {
  const dir = project(t, { "package.json": "{}\n", ".github/workflows/deploy-prod.yml": "existing\n" });
  const emptySource = project(t, {});
  const result = spawnSync("bash", [path.join(root, "scripts/inject-workflows.sh"), emptySource, dir, "javascript"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(dir, ".github/workflows/deploy-prod.yml"), "utf8"), "existing\n");
});

for (const version of ["2026.08.26", "2026.08.26.1", "2024.02.29", "2000.02.29"]) {
  test(`reads valid calendar version ${version} without modifying it`, (t) => {
    const dir = project(t, { VERSION: `${version}\n` });
    const result = spawnSync("bash", [path.join(root, ".github/actions/read-version/read-version.sh"), path.join(dir, "VERSION")], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${version}\n`);
    assert.equal(fs.readFileSync(path.join(dir, "VERSION"), "utf8"), `${version}\n`);
  });
}

for (const version of ["", "1.2.3", "2026.02.29", "1900.02.29", "2026.04.31", "2026.13.01", "2026.08.00", "2026.08.26.0", "2026.08.26.01", "2026.08.26\nextra", "2026.08.26\n", "2026.08.26\r", "2026.08.26;echo bad"]) {
  test(`rejects invalid VERSION ${JSON.stringify(version)} before injection`, (t) => {
    const dir = project(t, { ...goFiles, VERSION: `${version}\n` });
    assert.notEqual(inject(dir, "go-frontend-calver").status, 0);
    assert.equal(fs.existsSync(path.join(dir, ".github/workflows/deploy-prod.yml")), false);
  });
}
