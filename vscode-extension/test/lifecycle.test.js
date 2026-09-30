const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

test('packaged extension points to the frontend and bundles its one-shot Python backend', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.main, './frontend/dist/extension.js');
  assert.ok(fs.existsSync(path.join(root, manifest.main)));
  for (const script of ['artifact_retrieval.py', 'rationale_sentence_identifier.py', 'rationale_generation.py', 'llm_provider.py']) {
    assert.ok(fs.existsSync(path.join(root, 'python', 'scripts', 'ARGUS', script)));
  }
  for (const file of ['pyproject.toml', 'uv.lock', 'scripts/ARGUS/runner.py', 'scripts/ARGUS/cli_selftest.py', 'scripts/ARGUS/sentence_splitter.py']) {
    assert.ok(fs.existsSync(path.join(root, 'python', file)), file);
  }
});
