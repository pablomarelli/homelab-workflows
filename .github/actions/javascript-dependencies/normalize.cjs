const fs = require('node:fs');
const path = require('node:path');
// Preserve dependency/workspace versions; only root release metadata is irrelevant.
const target = process.argv[2];
fs.mkdirSync(target, { recursive: true });
for (const name of ['package.json', 'package-lock.json']) {
  const value = JSON.parse(fs.readFileSync(name, 'utf8'));
  delete value.version;
  if (name === 'package-lock.json' && value.packages?.['']) delete value.packages[''].version;
  fs.writeFileSync(path.join(target, name), JSON.stringify(value, null, 2) + '\n');
}
