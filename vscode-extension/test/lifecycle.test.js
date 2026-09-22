const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');

test('first command bootstraps one private environment, later commands reuse it', async () => {
  const globalStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'argus-extension-'));
  const invocations = [];
  let command;
  const vscode = {
    ProgressLocation: { Notification: 1 },
    window: {
      createOutputChannel: () => ({ appendLine() {}, append() {} }),
      register: null,
      showInputBox: async ({ prompt }) => prompt === 'GitHub commit URL' ? 'https://github.com/acme/widget/commit/abcdef123456' : prompt.startsWith('OpenAI') ? 'openai-test-key' : 'github-test-token',
      showInformationMessage: async () => undefined,
      showErrorMessage: message => { throw new Error(message); },
      withProgress: async (_options, callback) => callback({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) })
    },
    commands: {
      registerCommand: (_name, callback) => { command = callback; return { dispose() {} }; },
      executeCommand: async () => {}
    },
    workspace: { getConfiguration: () => ({ get: (_key, fallback) => fallback }) },
    Uri: { file: value => value }
  };
  const originalLoad = Module._load;
  const originalSpawn = require('node:child_process').spawn;
  Module._load = function(request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
  };
  require('node:child_process').spawn = (executable, args, options) => {
    invocations.push({ executable, args, options });
    if (args[0] === '-m' && args[1] === 'venv') {
      const python = path.join(args[2], 'bin', 'python');
      fs.mkdirSync(path.dirname(python), { recursive: true });
      fs.writeFileSync(python, 'mock python');
    }
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    process.nextTick(() => child.emit('close', 0));
    return child;
  };
  try {
    const extension = require('../extension');
    extension.activate({ extensionPath: path.resolve(__dirname, '..'), globalStorageUri: { fsPath: globalStorage }, subscriptions: [], secrets: { get: async () => undefined, store: async () => {} } });
    await command();
    assert.equal(invocations.length, 6);
    assert.ok(fs.existsSync(path.join(globalStorage, 'venv', '.argus-deps-installed')));
    await command();
    assert.equal(invocations.length, 9);
  } finally {
    Module._load = originalLoad;
    require('node:child_process').spawn = originalSpawn;
    fs.rmSync(globalStorage, { recursive: true, force: true });
  }
});
