import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { build } = require('../frontend/node_modules/esbuild');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../frontend/src/backend.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  write: false,
});

function createBackend(folder, storageDir = tmpdir()) {
  const module = { exports: {} };
  const vscode = {
    ExtensionMode: { Development: 2 },
    workspace: { workspaceFolders: folder ? [{ uri: { fsPath: folder } }] : [], getConfiguration: () => ({ get: (_, fallback) => fallback }) },
    ProgressLocation: { Notification: 1 },
    window: { withProgress: async (_, action) => action({ report() {} }) },
  };
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, process, URL, Buffer,
    require: (name) => name === 'vscode' ? vscode : require(name),
  });
  return new module.exports.BackendClient({
    globalStorageUri: { fsPath: storageDir },
    extensionPath: tmpdir(),
    extensionMode: 1,
  }, { appendLine() {} });
}

test('hash resolution reads the actual Git origin and builds a GitHub commit URL', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'rationale-commit-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', folder]);
  const backend = createBackend(folder);
  for (const origin of ['https://github.com/owner/repo.git', 'git@github.com:owner/repo.git', 'ssh://git@github.com/owner/repo.git']) {
    execFileSync('git', ['-C', folder, 'config', 'remote.origin.url', origin]);
    assert.equal(await backend.resolveCommitUrl(' ABC1234 '), 'https://github.com/owner/repo/commit/abc1234');
  }
  execFileSync('git', ['-C', folder, 'config', 'remote.origin.url', 'https://gitlab.com/owner/repo.git']);
  await assert.rejects(backend.resolveCommitUrl('abc1234'), /origin must be a GitHub remote/);
  execFileSync('git', ['-C', folder, 'config', '--unset', 'remote.origin.url']);
  await assert.rejects(backend.resolveCommitUrl('abc1234'), /no origin remote/);
});

test('URLs bypass origin resolution and hashes require an open repository', async () => {
  const backend = createBackend();
  assert.equal(await backend.resolveCommitUrl('https://github.com/other/project/commit/ABC1234'), 'https://github.com/other/project/commit/abc1234');
  await assert.rejects(backend.resolveCommitUrl('abc1234'), /Open a Git repository folder/);
  await assert.rejects(backend.resolveCommitUrl('HEAD'), /Enter a commit hash/);
});

test('commit analysis saves footnotes in the workspace Markdown and returns them for the panel', async (t) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'rationale-markdown-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  execFileSync('git', ['init', '--quiet', folder]);
  const backend = createBackend(folder, path.join(folder, 'storage'));
  backend.install = async () => {};
  backend.runScript = async (script) => {
    if (script !== 'rationale_generation.py') return;
    const output = path.join(folder, 'storage', 'runtime', 'results', 'owner__repo__abc1234');
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'rationale_summary.json'), JSON.stringify({
      components: { NEED: 'Keep the custom firewall.[^abc1234-12_5_3_0]' },
      references: [{ id: 'abc1234-12_5_3_0', sentenceId: '12_5_3_0', source: 'ISSUE', url: 'https://github.com/owner/repo/issues/42#issuecomment-123', sentence: 'The custom firewall was discarded.', labels: ['NEED'] }],
    }));
  };
  const result = await backend.explainCommit('https://github.com/owner/repo/commit/abc1234', { mode: 'api', provider: 'anthropic', model: 'test-model', apiKey: 'fake-key' });
  const markdown = await readFile(result.rationaleFile, 'utf8');
  assert.equal(result.rationaleFile, path.join(folder, '.rationale', 'owner', 'repo', 'commit-abc1234.md'));
  assert.ok(markdown.includes('Keep the custom firewall.[^1]'));
  assert.ok(markdown.includes('[^1]: [Issue](<https://github.com/owner/repo/issues/42#issuecomment-123>)'));
  assert.equal(result.references[0].number, 1);
  assert.equal(result.components.NEED, 'Keep the custom firewall.[^1]');
});
