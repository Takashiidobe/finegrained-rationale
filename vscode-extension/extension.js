const vscode = require('vscode');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function activate(context) {
  const output = vscode.window.createOutputChannel('ARGUS');
  context.subscriptions.push(output);
  context.subscriptions.push(vscode.commands.registerCommand('argus.runCommit', async () => {
    const commitUrl = await vscode.window.showInputBox({
      prompt: 'GitHub commit URL',
      placeHolder: 'https://github.com/owner/repo/commit/<sha>',
      validateInput: value => /^https:\/\/github\.com\/[^/]+\/[^/]+\/commit\/[a-fA-F0-9]+$/.test(value) ? undefined : 'Enter a GitHub commit URL.'
    });
    if (!commitUrl) return;
    const githubToken = await getSecret(context, 'githubToken', 'GitHub token (optional; improves API rate limits)');
    const openaiKey = await getSecret(context, 'openaiKey', 'OpenAI API key');
    if (!openaiKey) return;

    const runtime = context.globalStorageUri.fsPath;
    const pythonRoot = path.join(context.extensionPath, 'python');
    const binDir = process.platform === 'win32' ? 'Scripts' : 'bin';
    const venv = path.join(runtime, 'venv');
    const python = process.platform === 'win32' ? path.join(venv, binDir, 'python.exe') : path.join(venv, binDir, 'python');
    const configuredPython = vscode.workspace.getConfiguration('argus').get('pythonPath');
    const bootstrapPython = configuredPython || (process.platform === 'win32' ? 'python' : 'python3');
    fs.mkdirSync(runtime, { recursive: true });

    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'ARGUS commit analysis', cancellable: true }, async (progress, token) => {
      const run = (command, args, cwd, env = process.env) => new Promise((resolve, reject) => {
        output.appendLine(`$ ${command} ${args.join(' ')}`);
        const child = cp.spawn(command, args, { cwd, env });
        const cancel = token.onCancellationRequested(() => child.kill());
        child.stdout.on('data', data => output.append(data.toString()));
        child.stderr.on('data', data => output.append(data.toString()));
        child.on('error', error => { cancel.dispose(); reject(error); });
        child.on('close', code => {
          cancel.dispose();
          if (code === 0) resolve();
          else reject(new Error(`Process exited with code ${code}`));
        });
      });
      try {
        if (!fs.existsSync(python)) {
          progress.report({ message: 'Creating private Python environment…' });
          await run(bootstrapPython, ['-m', 'venv', venv], runtime);
        }
        const marker = path.join(venv, '.argus-deps-installed');
        const requirements = fs.readFileSync(path.join(pythonRoot, 'requirements.txt'));
        const requirementsHash = crypto.createHash('sha256').update(requirements).digest('hex');
        if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8') !== requirementsHash) {
          progress.report({ message: 'Installing Python dependencies (first run)…' });
          await run(python, ['-m', 'pip', 'install', '--upgrade', 'pip'], runtime);
          await run(python, ['-m', 'pip', 'install', '-r', path.join(pythonRoot, 'requirements.txt')], runtime);
          fs.writeFileSync(marker, requirementsHash);
        }
        const outputRoot = path.join(runtime, 'results');
        const env = { ...process.env, ARGUS_SPACY_MODEL: 'en_core_web_sm', OPENAI_API_KEY: openaiKey, OPENAI_TOKEN: openaiKey, ...(githubToken ? { GITHUB_TOKEN: githubToken } : {}) };
        const model = vscode.workspace.getConfiguration('argus').get('model', 'o4-mini');
        const runs = vscode.workspace.getConfiguration('argus').get('runs', 3);
        const coordinates = ['--commit-url', commitUrl, '--output-root', outputRoot];
        progress.report({ message: 'Retrieving GitHub artifacts…' });
        await run(python, [path.join(pythonRoot, 'scripts', 'ARGUS', 'artifact_retrieval.py'), ...coordinates], pythonRoot, env);
        progress.report({ message: 'Identifying rationale sentences…' });
        await run(python, [path.join(pythonRoot, 'scripts', 'ARGUS', 'rationale_sentence_identifier.py'), ...coordinates, '--model', model, '--runs', String(runs)], pythonRoot, env);
        progress.report({ message: 'Generating rationale summary…' });
        await run(python, [path.join(pythonRoot, 'scripts', 'ARGUS', 'rationale_generation.py'), ...coordinates, '--model', model], pythonRoot, env);
        const [, owner, repo, , sha] = new URL(commitUrl).pathname.split('/');
        const folder = path.join(outputRoot, `${owner}__${repo}__${sha.slice(0, 12)}`);
        const summary = path.join(folder, 'rationale_summary.json');
        output.appendLine(`Results: ${folder}`);
        await vscode.window.showInformationMessage('ARGUS analysis complete.', 'Open results').then(choice => choice && vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(folder)));
        if (fs.existsSync(summary)) output.appendLine(fs.readFileSync(summary, 'utf8'));
      } catch (error) {
        output.appendLine(String(error));
        vscode.window.showErrorMessage(`ARGUS failed: ${error.message}. See the ARGUS output channel.`);
      }
    });
  }));
}

async function getSecret(context, key, prompt) {
  const existing = await context.secrets.get(key);
  const value = await vscode.window.showInputBox({ prompt, password: true, ignoreFocusOut: true, value: existing || '' });
  if (value) await context.secrets.store(key, value);
  return value || existing;
}

function deactivate() {}
module.exports = { activate, deactivate };
