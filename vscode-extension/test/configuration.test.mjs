import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { build } = require('../frontend/node_modules/esbuild');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../frontend/src/configuration.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false,
});

function setup(selfTest = async () => {}, secrets = new Map()) {
  const messages = [];
  const state = new Map();
  let receive;
  const webview = {
    cspSource: 'vscode-webview:', html: '',
    postMessage: message => messages.push(message),
    onDidReceiveMessage: handler => { receive = handler; },
  };
  const vscode = { window: { createWebviewPanel: () => ({ webview }) }, ViewColumn: { One: 1 } };
  const module = { exports: {} };
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, process, URL, URLSearchParams,
    fetch: async () => ({ ok: true, json: async () => ({ data: [{ id: 'model-a' }] }) }),
    require: name => name === 'vscode' ? vscode : require(name),
  });
  module.exports.openConfigurationPage({
    globalState: { get: (key, fallback) => state.get(key) ?? fallback, keys: () => [...state.keys()], update: async (key, value) => { state.set(key, value); } },
    secrets: { get: async key => secrets.get(key), store: async (key, value) => { secrets.set(key, value); }, delete: async key => { secrets.delete(key); } },
  }, { selfTest });
  return { receive: message => receive(message), messages, state, secrets, webview };
}

const api = { mode: 'api', provider: 'anthropic', model: 'model-a', apiKey: 'test-key' };
const cli = { mode: 'cli', provider: 'claude-code', model: 'sonnet' };

test('loading models alone does not authorize saving', async () => {
  const page = setup();
  await page.receive({ type: 'refreshModels', ...api, requestId: 1 });
  assert.equal(page.messages.at(-1).valid, true);
  assert.equal(page.messages.at(-1).requestId, 1);
  await page.receive({ type: 'save', ...api });
  assert.equal(page.messages.at(-1).type, 'saveFailed');
  assert.equal(page.state.size, 0);
  assert.equal(page.secrets.size, 0);
});

test('a real model test gates API and CLI saves and rejects changed settings', async () => {
  for (const configuration of [api, cli]) {
    const tests = [];
    const page = setup(async value => { tests.push(value); });
    await page.receive({ type: 'testConnection', ...configuration, requestId: 7 });
    assert.equal(tests.length, 1);
    assert.equal(tests[0].model, configuration.model);
    assert.equal(tests[0].apiKey, configuration.apiKey);
    assert.equal(page.messages.at(-1).valid, true);
    assert.match(page.messages.at(-1).message, /✓ Connected/);
    assert.equal(page.messages.at(-1).requestId, 7);
    for (const changes of [{ model: 'other-model' }, { provider: configuration.mode === 'api' ? 'openai' : 'codex' }, ...(configuration.mode === 'api' ? [{ apiKey: 'other-key' }] : [])]) {
      await page.receive({ type: 'save', ...configuration, ...changes });
      assert.equal(page.messages.at(-1).type, 'saveFailed');
      assert.equal(page.state.size, 0);
      assert.equal(page.secrets.size, 0);
    }
    await page.receive({ type: 'save', ...configuration, githubToken: 'github-test-token' });
    assert.equal(page.messages.at(-1).type, 'saved');
    assert.equal(page.state.get('configurationComplete'), true);
    assert.equal(page.state.get('provider'), configuration.provider);
    assert.equal(page.secrets.get('githubToken'), 'github-test-token');
    assert.equal(tests.length, 1);
  }
});

test('failed tests and missing keys never write settings', async () => {
  const page = setup(async () => { throw new Error('Please sign in'); });
  await page.receive({ type: 'testConnection', ...cli });
  assert.equal(page.messages.at(-1).valid, false);
  assert.match(page.messages.at(-1).message, /Please sign in/);
  assert.match(page.messages.at(-1).message, /VS Code's PATH/);
  assert.match(page.messages.at(-1).message, /Restart VS Code/);
  await page.receive({ type: 'save', ...cli });
  assert.equal(page.messages.at(-1).type, 'saveFailed');
  await page.receive({ type: 'testConnection', ...api, apiKey: '' });
  assert.match(page.messages.at(-1).message, /Paste an API key/);
  assert.equal(page.state.size, 0);
  assert.equal(page.secrets.size, 0);
});

test('saved keys can be tested and kept without pasting them again', async () => {
  const page = setup(async value => { assert.equal(value.apiKey, 'saved-key'); }, new Map([['providerKey:anthropic', 'saved-key']]));
  await page.receive({ type: 'testConnection', ...api, apiKey: '' });
  await page.receive({ type: 'save', ...api, apiKey: '' });
  assert.equal(page.messages.at(-1).type, 'saved');
  assert.equal(page.secrets.get('providerKey:anthropic'), 'saved-key');
});

test('an older test completing late cannot authorize saving', async () => {
  let finishOld;
  const page = setup(value => value.model === 'old-model' ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve());
  const oldTest = page.receive({ type: 'testConnection', ...cli, model: 'old-model', requestId: 1 });
  await new Promise(resolve => setImmediate(resolve));
  await page.receive({ type: 'testConnection', ...cli, requestId: 2 });
  finishOld();
  await oldTest;
  assert.equal(page.messages.filter(message => message.type === 'connection').length, 1);
  await page.receive({ type: 'save', ...cli, model: 'old-model' });
  assert.equal(page.messages.at(-1).type, 'saveFailed');
  await page.receive({ type: 'save', ...cli });
  assert.equal(page.messages.at(-1).type, 'saved');
});

test('configuration storage errors stay visible and allow a retry', async () => {
  const page = setup();
  await page.receive({ type: 'testConnection', ...api });
  page.secrets.set = () => { throw new Error('SecretStorage unavailable'); };
  await page.receive({ type: 'save', ...api });
  assert.equal(page.messages.at(-1).type, 'saveFailed');
  assert.match(page.messages.at(-1).message, /SecretStorage unavailable/);
  assert.equal(page.state.size, 0);
});
