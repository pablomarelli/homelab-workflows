const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'bin'));
  return dir;
}
function executable(dir, name, text) {
  fs.writeFileSync(path.join(dir, 'bin', name), '#!/usr/bin/env bash\nset -eu\n' + text, { mode: 0o755 });
}
function run(dir, script, env = {}) {
  return spawnSync('bash', [path.join(root, script)], { cwd: dir, encoding: 'utf8', env: {
    ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, GITHUB_OUTPUT: `${dir}/output`,
    GITHUB_STEP_SUMMARY: `${dir}/summary`, LOG: `${dir}/log`, ...env,
  } });
}
test('normalization ignores only root versions, keeps dependency and workspace changes', t => {
  const dir = fixture(t);
  const pkg = { name: 'app', version: '1.0.0', dependencies: { dep: '1.0.0' } };
  const lock = { version: '1.0.0', lockfileVersion: 3, packages: { '': { version: '1.0.0', dependencies: pkg.dependencies }, 'node_modules/dep': { version: '1.0.0', integrity: 'sha512-original' }, 'packages/child': { version: '1.0.0' } } };
  function normalize() {
    fs.writeFileSync(`${dir}/package.json`, JSON.stringify(pkg));
    fs.writeFileSync(`${dir}/package-lock.json`, JSON.stringify(lock));
    const result = spawnSync(process.execPath, [path.join(root, '.github/actions/javascript-dependencies/normalize.cjs'), 'normalized'], { cwd: dir });
    assert.equal(result.status, 0, result.stderr?.toString());
    return ['package.json', 'package-lock.json'].map(n => fs.readFileSync(`${dir}/normalized/${n}`, 'utf8'));
  }
  const original = normalize();
  pkg.version = lock.version = lock.packages[''].version = '1.0.1';
  assert.deepEqual(normalize(), original);
  assert.equal(JSON.parse(fs.readFileSync(`${dir}/package.json`)).version, '1.0.1');
  lock.packages['node_modules/dep'].integrity = 'sha512-changed';
  assert.notEqual(normalize()[1], original[1]);
  lock.packages['node_modules/dep'].integrity = 'sha512-original';
  lock.packages['packages/child'].version = '1.0.1';
  assert.notEqual(normalize()[1], original[1]);
});
test('promotion gate requires all checks and exactly one successful build route', () => {
  const workflow = read('workflows/deploy-prod.yml');
  const block = workflow.split('  promote:\n')[1].split('  deploy:\n')[0];
  const condition = block.match(/    if: >-\n([\s\S]*?)    runs-on:/)[1].trim();
  const statuses = ['success', 'failure', 'cancelled', 'skipped'];
  for (const bump of statuses) for (const lint of statuses) for (const test of statuses)
    for (const build of statuses) for (const artifact of statuses) {
      const needs = Object.fromEntries(Object.entries({ 'bump-version': bump, lint, test, build, 'build-from-artifact': artifact }).map(([key, result]) => [key, { result }]));
      const expression = condition.replaceAll('needs.bump-version', 'needs["bump-version"]').replaceAll('needs.build-from-artifact', 'needs["build-from-artifact"]');
      const expected = bump === 'success' && lint === 'success' && test === 'success' &&
        ((build === 'success' && artifact === 'skipped') || (build === 'skipped' && artifact === 'success'));
      assert.equal(runInNewContext(expression, { needs, always: () => true, cancelled: () => false }), expected);
      assert.equal(runInNewContext(expression, { needs, always: () => true, cancelled: () => true }), false);
    }
  const build = workflow.split('  build:\n')[1].split('  build-from-artifact:')[0];
  assert.match(build, /needs: bump-version/);
  assert.doesNotMatch(build, /version: \$\{\{/);
  assert.match(read('.github/actions/docker-build/action.yml'), /if: inputs.qemu == 'true'/);
});
for (const [name, overrides, success] of [
  ['missing release tag', {}, true],
  ['same existing digest', { INSPECT: 'same' }, true],
  ['different existing digest', { INSPECT: 'different' }, false],
  ['registry authentication failure', { INSPECT: 'denied' }, false],
  ['stale source', { API_SHA: 'b'.repeat(40) }, false],
  ['API failure with matching stdout', { API_STATUS: '1' }, false],
  ['empty digest', { DIGEST: '' }, false],
  ['tag injection', { VERSION: 'bad;tag' }, false],
]) test(`promotion: ${name}`, t => {
  const dir = fixture(t);
  executable(dir, 'gh', 'printf "%s" "$API_SHA"\nexit "$API_STATUS"\n');
  executable(dir, 'docker', `if [[ "$3" == inspect ]]; then
    case "$INSPECT" in
      missing) echo 'manifest unknown' >&2; exit 1 ;;
      denied) echo 'unauthorized' >&2; exit 1 ;;
      same) echo "$DIGEST" ;;
      different) echo 'sha256:other' ;;
    esac
  else printf '%s\\n' "$*" >> "$LOG"; fi\n`);
  const result = run(dir, '.github/actions/docker-promote/promote.sh', {
    IMAGE: 'ghcr.io/owner/app', DIGEST: `sha256:${'a'.repeat(64)}`, VERSION: '1.2.3',
    REVISION: 'a'.repeat(40), API_SHA: 'a'.repeat(40), API_STATUS: '0',
    INSPECT: 'missing', GITHUB_REPOSITORY: 'owner/app', ...overrides,
  });
  assert.equal(result.status === 0, success, result.stderr);
  assert.equal(fs.existsSync(`${dir}/log`), success);
  if (success) {
    assert.match(fs.readFileSync(`${dir}/log`, 'utf8'), /--prefer-index=false --tag ghcr.io\/owner\/app:1.2.3 --tag ghcr.io\/owner\/app:latest ghcr.io\/owner\/app@sha256:/);
    assert.equal(fs.readFileSync(`${dir}/output`, 'utf8'), 'published=true\n');
  }
});
for (const [name, env, scripts, expected, success] of [
  ['auto skips absent browser suite', {}, {}, ['npm test', 'npm run build'], true],
  ['auto retains existing suite', {}, { 'test:e2e': 'playwright test' }, ['npm test', 'npm run build', 'npx --no-install playwright install --with-deps chromium', 'npm run test:e2e'], true],
  ['explicit integration and production browser suites', { E2E_SCRIPTS: 'browser:demo browser:production', INTEGRATION_SCRIPTS: 'test:backend', PLAYWRIGHT_WORKERS: '4' }, { 'browser:demo': 'x', 'browser:production': 'x', 'test:backend': 'x' }, ['npm test', 'npm run build', 'npm run test:backend', 'npx --no-install playwright install --with-deps chromium', 'npm run browser:demo -- --workers=4', 'npm run browser:production -- --workers=4'], true],
  ['missing requested suite fails', { E2E_SCRIPTS: 'missing' }, {}, [], false],
  ['invalid workers fail', { PLAYWRIGHT_WORKERS: '0' }, {}, [], false],
  ['required integration failure stops browser tests', { INTEGRATION_SCRIPTS: 'integration', FAIL: 'run integration' }, { integration: 'x' }, ['npm test', 'npm run build', 'npm run integration'], false],
]) test(`test selection: ${name}`, t => {
  const dir = fixture(t);
  fs.writeFileSync(`${dir}/package.json`, JSON.stringify({ scripts }));
  executable(dir, 'npm', 'echo "npm $*" >> "$LOG"\n[[ "$*" != "${FAIL:-}" ]]\n');
  executable(dir, 'npx', 'echo "npx $*" >> "$LOG"\n');
  const result = run(dir, '.github/actions/test/javascript/test.sh', { E2E_SCRIPTS: 'auto', INTEGRATION_SCRIPTS: '', PLAYWRIGHT_WORKERS: '', ...env });
  assert.equal(result.status === 0, success, result.stderr);
  const actual = fs.existsSync(`${dir}/log`) ? fs.readFileSync(`${dir}/log`, 'utf8').trim().split('\n') : [];
  assert.deepEqual(actual, expected);
});
test('infrastructure updates fail on missing images and never claim health', t => {
  const dir = fixture(t);
  fs.mkdirSync(`${dir}/manifests/app`, { recursive: true });
  executable(dir, 'git', 'echo "$*" >> "$LOG"\nif [[ "$1" == diff ]]; then exit "$DIFF_STATUS"; fi\nif [[ "$1" == push ]]; then exit "$PUSH_STATUS"; fi\n');
  const manifest = `${dir}/manifests/app/deployment.yaml`;
  fs.writeFileSync(manifest, '  image: ghcr.io/pablomarelli/other:1\n');
  const env = { APP_NAME: 'app', VERSION: '1.2.3', DIFF_STATUS: '1', PUSH_STATUS: '0' };
  assert.notEqual(run(dir, '.github/actions/argo-deploy/update.sh', env).status, 0);
  assert.equal(fs.existsSync(`${dir}/output`), false);
  fs.writeFileSync(manifest, '  image: ghcr.io/pablomarelli/app:1\n');
  assert.notEqual(run(dir, '.github/actions/argo-deploy/update.sh', { ...env, PUSH_STATUS: '1' }).status, 0);
  assert.equal(fs.existsSync(`${dir}/output`), false);
  assert.equal(run(dir, '.github/actions/argo-deploy/update.sh', env).status, 0);
  assert.equal(fs.readFileSync(`${dir}/output`, 'utf8'), 'infra-updated=true\n');
  assert.match(fs.readFileSync(`${dir}/summary`, 'utf8'), /Healthy: unknown/);
  assert.equal(run(dir, '.github/actions/argo-deploy/update.sh', { ...env, DIFF_STATUS: '0' }).status, 0);
  assert.match(fs.readFileSync(`${dir}/output`, 'utf8'), /infra-updated=false/);
});
