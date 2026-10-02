import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import type { BackendClient } from "./backend";
import { CliUpdateRequiredError, ensureSupportedCli, offerCliUpdate, runCommand } from "./cli";

export type RunMode = "api" | "cli";
export type Provider = "openai" | "anthropic" | "codex" | "claude-code";

const MODE_KEY = "runMode";
const PROVIDER_KEY = "provider";
const GITHUB_SECRET = "githubToken";
const LEGACY_OPENAI_SECRET = "openaiApiKey";

const defaults: Record<Provider, { model: string; secret: string }> = {
  openai: { model: "", secret: "providerKey:openai" },
  anthropic: { model: "", secret: "providerKey:anthropic" },
  codex: { model: "gpt-6-sol", secret: "" },
  "claude-code": { model: "sonnet", secret: "" },
};

export interface LlmConfiguration {
  mode: RunMode;
  provider: Provider;
  model: string;
  apiKey?: string;
}

export async function getLlmConfiguration(context: vscode.ExtensionContext): Promise<LlmConfiguration> {
  const mode = context.globalState.get<RunMode>(MODE_KEY, "api");
  const provider = context.globalState.get<Provider>(PROVIDER_KEY, mode === "api" ? "openai" : "codex");
  const apiKey = await getStoredApiKey(context, provider);
  return {
    mode,
    provider,
    model: context.globalState.get<string>(`model:${provider}`, defaults[provider].model),
    apiKey,
  };
}

const CLI_DEFAULT_MODEL = { id: "default", name: "CLI default (whatever the CLI is configured to use)" };

export function openConfigurationPage(context: vscode.ExtensionContext, backend: BackendClient): void {
  const panel = vscode.window.createWebviewPanel("rationale.configuration", "Rationale Configuration", vscode.ViewColumn.One, {
    enableScripts: true,
    retainContextWhenHidden: true,
  });
  const nonce = randomBytes(16).toString("hex");
  panel.webview.html = getHtml(panel.webview.cspSource, nonce);

  let verifiedConfiguration: string | undefined;
  let latestTest = 0;
  let saving = false;
  const readConfiguration = async (message: Record<string, unknown>): Promise<LlmConfiguration> => {
    const mode = message.mode;
    const provider = message.provider as Provider;
    const validProviders: Provider[] = mode === "api" ? ["openai", "anthropic"] : mode === "cli" ? ["codex", "claude-code"] : [];
    if (!validProviders.includes(provider)) throw new Error("Choose a mode and provider first.");
    const model = typeof message.model === "string" ? message.model.trim() : "";
    if (!model) throw new Error("Choose a model first.");
    const apiKey = mode === "api"
      ? (typeof message.apiKey === "string" ? message.apiKey.trim() : "") || await getStoredApiKey(context, provider)
      : undefined;
    if (mode === "api" && !apiKey) throw new Error("Paste an API key before testing the connection.");
    return { mode: mode as RunMode, provider, model, apiKey };
  };

  panel.webview.onDidReceiveMessage(async (message: Record<string, unknown>) => {
    if (message.type === "ready") {
      const llm = await getLlmConfiguration(context);
      const hasSavedMode = context.globalState.keys().includes(MODE_KEY) && context.globalState.keys().includes(PROVIDER_KEY);
      const hasAnyApiKey = Boolean(
        await context.secrets.get(defaults.openai.secret) ||
        await context.secrets.get(LEGACY_OPENAI_SECRET) ||
        await context.secrets.get(defaults.anthropic.secret),
      );
      const setupComplete = context.globalState.get<boolean>("configurationComplete", false) || hasAnyApiKey || (hasSavedMode && Boolean(context.globalState.get<string>(`model:${llm.provider}`)));
      panel.webview.postMessage({
        type: "state", setupComplete,
        mode: setupComplete ? llm.mode : "",
        provider: setupComplete ? llm.provider : "",
        model: llm.model,
        apiKeySaved: Boolean(llm.apiKey),
        githubTokenSaved: Boolean(await context.secrets.get(GITHUB_SECRET)),
      });
      return;
    }
    if (message.type === "refreshModels") {
      const mode: RunMode = message.mode === "cli" ? "cli" : "api";
      const provider = message.provider as Provider;
      const key = typeof message.apiKey === "string" && message.apiKey.trim()
        ? message.apiKey.trim()
        : await getStoredApiKey(context, provider);
      await refreshModels(panel, context, mode, provider, key, message.requestId, message.model);
      return;
    }
    if (message.type === "openExternal" && typeof message.url === "string") {
      const url = vscode.Uri.parse(message.url);
      if (url.scheme === "https") await vscode.env.openExternal(url);
      return;
    }
    if (message.type === "testConnection") {
      const test = ++latestTest;
      verifiedConfiguration = undefined;
      try {
        const llm = await readConfiguration(message);
        await backend.selfTest(llm);
        if (test !== latestTest) return;
        verifiedConfiguration = JSON.stringify(llm);
        panel.webview.postMessage({ type: "connection", requestId: message.requestId, valid: true, message: `✓ Connected. ${llm.model} responded to the test prompt. You can save now.` });
      } catch (error) {
        if (test !== latestTest) return;
        const hint = message.mode === "cli" ? " Make sure the CLI is installed, available on VS Code's PATH, and signed in. Restart VS Code if you recently installed it or changed PATH." : "";
        panel.webview.postMessage({ type: "connection", requestId: message.requestId, valid: false, message: `Connection test failed: ${(error as Error).message}${hint}` });
        if (error instanceof CliUpdateRequiredError) void offerCliUpdate(error);
      }
      return;
    }
    if (message.type !== "save" || saving) return;
    saving = true;
    try {
      const llm = await readConfiguration(message);
      if (verifiedConfiguration !== JSON.stringify(llm)) throw new Error("Test the selected provider and model successfully before saving.");
      if (llm.mode === "api" && llm.apiKey) await context.secrets.store(defaults[llm.provider].secret, llm.apiKey);
      if (llm.provider === "openai" && llm.apiKey) await context.secrets.delete(LEGACY_OPENAI_SECRET);
      const githubToken = typeof message.githubToken === "string" ? message.githubToken.trim() : "";
      if (githubToken) await context.secrets.store(GITHUB_SECRET, githubToken);
      await context.globalState.update(MODE_KEY, llm.mode);
      await context.globalState.update(PROVIDER_KEY, llm.provider);
      await context.globalState.update(`model:${llm.provider}`, llm.model);
      await context.globalState.update("configurationComplete", true);
      panel.webview.postMessage({ type: "saved", apiKeySaved: Boolean(llm.apiKey), githubTokenSaved: Boolean(await context.secrets.get(GITHUB_SECRET)) });
    } catch (error) {
      panel.webview.postMessage({ type: "saveFailed", message: `Not saved: ${(error as Error).message}` });
    } finally {
      saving = false;
    }
  });
}

async function getStoredApiKey(context: vscode.ExtensionContext, provider: Provider): Promise<string | undefined> {
  if (provider === "openai") return await context.secrets.get(defaults.openai.secret) || await context.secrets.get(LEGACY_OPENAI_SECRET);
  if (provider === "anthropic") return context.secrets.get(defaults.anthropic.secret);
  return undefined;
}

async function refreshModels(
  panel: vscode.WebviewPanel,
  context: vscode.ExtensionContext,
  mode: RunMode,
  provider: Provider,
  apiKey?: string,
  requestId?: unknown,
  selectedModel?: unknown,
): Promise<void> {
  try {
    const models = mode === "api"
      ? await fetchApiModels(provider, apiKey)
      : await fetchCliModels(provider);
    if (!models.length) throw new Error("No models were returned. Check this account's model access.");
    const current = typeof selectedModel === "string" && selectedModel ? selectedModel : context.globalState.get<string>(`model:${provider}`, "");
    panel.webview.postMessage({ type: "models", requestId, valid: true, models, current, message: `Loaded ${models.length} model choices. Choose a model, then test the connection.` });
  } catch (error) {
    const current = context.globalState.get<string>(`model:${provider}`, defaults[provider].model);
    const hint = mode === "cli"
      ? "Make sure the CLI is installed and available on VS Code's PATH. Restart VS Code if you recently installed it or changed PATH, then click Load models again."
      : "Check your API key, then click Load models again.";
    panel.webview.postMessage({
      type: "models", requestId, valid: false,
      models: current ? [{ id: current, name: `${current} (saved; refresh failed)` }] : [],
      current,
      message: `Could not load models: ${(error as Error).message}. ${hint}`,
    });
  }
}

async function fetchApiModels(provider: Provider, apiKey?: string): Promise<Array<{ id: string; name: string }>> {
  if (!apiKey) throw new Error("Paste an API key, then click Load models");
  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}`);
    const result = await response.json() as { data?: Array<{ id?: string; created?: number }> };
    return (result.data || [])
      .filter((item): item is { id: string; created?: number } => typeof item.id === "string")
      .sort((a, b) => (b.created || 0) - (a.created || 0))
      .map(({ id }) => ({ id, name: id }));
  }
  if (provider !== "anthropic") throw new Error("Model listing is supported only for API providers");
  const models: Array<{ id: string; name: string }> = [];
  let afterId = "";
  while (true) {
    const query = new URLSearchParams({ limit: "1000", ...(afterId ? { after_id: afterId } : {}) });
    const response = await fetch(`https://api.anthropic.com/v1/models?${query}`, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    });
    if (!response.ok) throw new Error(`Anthropic returned HTTP ${response.status}`);
    const result = await response.json() as { data?: Array<{ id?: string; display_name?: string }>; has_more?: boolean; last_id?: string };
    models.push(...(result.data || []).filter((item): item is { id: string; display_name?: string } => typeof item.id === "string").map(({ id, display_name }) => ({ id, name: display_name || id })));
    if (!result.has_more || !result.last_id || result.last_id === afterId) break;
    afterId = result.last_id;
  }
  return models;
}

async function fetchCliModels(provider: Provider): Promise<Array<{ id: string; name: string }>> {
  if (provider !== "codex" && provider !== "claude-code") throw new Error("Unknown CLI provider");
  await ensureSupportedCli(provider);
  if (provider === "claude-code") {
    return [
      CLI_DEFAULT_MODEL,
      { id: "claude-fable-5-1", name: "Claude Fable 5.1" },
      { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
      { id: "opus", name: "Opus (account alias)" },
      { id: "sonnet", name: "Sonnet (account alias)" },
      { id: "haiku", name: "Haiku (account alias)" },
    ];
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(await runCommand("codex", ["debug", "models"]));
  } catch {
    return [CLI_DEFAULT_MODEL];
  }
  const found: Array<{ id: string; name: string }> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else if (value && typeof value === "object") {
      const item = value as Record<string, unknown>;
      const id = typeof item.slug === "string" ? item.slug : typeof item.id === "string" ? item.id : typeof item.model === "string" ? item.model : undefined;
      if (id && item.visibility !== "hide" && item.hidden !== true && (!Array.isArray(item.inputModalities) || item.inputModalities.includes("text"))) {
        const name = typeof item.displayName === "string" ? item.displayName : typeof item.display_name === "string" ? item.display_name : id;
        found.push({ id, name });
      } else {
        for (const child of Object.values(item)) visit(child);
      }
    }
  };
  visit(decoded);
  const unique = [...new Map(found.map((model) => [model.id, model])).values()];
  return [CLI_DEFAULT_MODEL, ...unique];
}

function getHtml(cspSource: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rationale Configuration</title>
  <style>
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font: var(--vscode-font); max-width: 760px; margin: 0 auto; padding: 24px; }
    h1 { font-size: 1.6em; } h2 { margin: 0 0 12px; font-size: 1.2em; }
    label { display: block; margin: 16px 0 6px; font-weight: 600; }
    select, input { width: 100%; box-sizing: border-box; padding: 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder)); }
    button { padding: 8px 14px; margin: 14px 8px 0 0; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: .55; cursor: default; }
    fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
    .muted { color: var(--vscode-descriptionForeground); }
    .status { min-height: 1.5em; }
    .success { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
    .error { color: var(--vscode-errorForeground); }
    .card { border: 1px solid var(--vscode-panel-border); padding: 20px; margin: 16px 0; }
    .hidden { display: none !important; }
    code { font-family: var(--vscode-editor-font-family); }
  </style>
</head>
<body>
  <h1>Configure Rationale</h1>
  <p class="muted">Connect a provider, choose a model, and test it before saving.</p>
  <fieldset id="configuration-fields" disabled>
    <section class="card">
      <h2>1. Connect a provider</h2>
      <label for="mode">How should Rationale generate explanations?</label>
      <select id="mode"><option value="">Choose how to connect</option><option value="api">API key — pay through your provider's API account</option><option value="cli">Installed CLI — use the CLI's signed-in account</option></select>
      <label for="provider">Provider</label>
      <select id="provider" disabled><option value="">Choose a provider</option></select>
      <p id="provider-description" class="muted"></p>
      <section id="api-section" class="hidden">
        <label for="api-key">API key</label>
        <input id="api-key" type="password" autocomplete="off" placeholder="Paste a key, or leave blank to use the saved key">
        <p id="api-key-status" class="muted">Keys are stored in VS Code SecretStorage when you save.</p>
        <button id="get-api-key" type="button">Open API key page</button>
      </section>
      <section id="cli-section" class="hidden">
        <p id="cli-instructions" class="muted"></p>
      </section>
      <button id="load-models" type="button" disabled>Load models</button>
      <p id="model-status" class="status muted" role="status" aria-live="polite">Choose a provider to load its models.</p>
    </section>
    <section class="card">
      <h2>2. Choose and test a model</h2>
      <label for="model">Model</label>
      <select id="model" disabled><option value="">Load models first</option></select>
      <div id="custom-model-wrap" class="hidden">
        <label for="custom-model">Custom model ID</label>
        <input id="custom-model" type="text" autocomplete="off" placeholder="Enter the exact model ID from your provider">
      </div>
      <p class="muted">The test sends one short prompt through the selected model. API tests use API billing; CLI tests use your CLI account.</p>
      <button id="test-connection" type="button" disabled>Test connection</button>
      <p id="connection-status" class="status muted" role="status" aria-live="polite">Load models and choose one, then click Test connection.</p>
    </section>
    <section class="card">
      <h2>3. Add GitHub access <span class="muted">(optional)</span></h2>
      <p class="muted">Public repositories work without a token. For private repositories, paste a token with access to the repository: classic tokens need the <code>repo</code> scope; fine-grained tokens need read access to Contents, Issues, and Pull requests.</p>
      <label for="github-token">GitHub token</label>
      <input id="github-token" type="password" autocomplete="off" placeholder="Leave blank to skip or keep your saved token">
      <button id="get-github-token" type="button">Open GitHub token page</button>
      <p id="github-status" class="muted">GitHub access is separate from the model connection test.</p>
    </section>
  </fieldset>
  <button id="save" type="button" disabled>Save configuration</button>
  <p id="save-hint" class="muted">Save unlocks after the connection test passes.</p>
  <p id="status" class="status" role="status" aria-live="polite"></p>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const providers = {
      openai: { label: 'OpenAI', url: 'https://platform.openai.com/api-keys', desc: 'Use an OpenAI API key. API usage is billed to your OpenAI API account.' },
      anthropic: { label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys', desc: 'Use an Anthropic API key. API usage is billed to your Anthropic API account.' },
      codex: { label: 'Codex CLI', desc: 'Use the Codex CLI installed on this computer.', instructions: "Install Codex CLI and make sure codex is on VS Code's PATH. Run codex login in a terminal, then click Load models. Restart VS Code after installing the CLI or changing PATH." },
      'claude-code': { label: 'Claude Code CLI', desc: 'Use the Claude Code CLI installed on this computer.', instructions: "Install Claude Code and make sure claude is on VS Code's PATH. Run claude in a terminal and sign in, then click Load models. Restart VS Code after installing the CLI or changing PATH." }
    };
    const byId = id => document.getElementById(id);
    let revision = 0;
    let verified = false;
    let loading = false;
    let testing = false;
    let saving = false;
    let saved = false;
    let savedModel = '';
    let savedKeyProvider = '';
    function modelId() {
      return byId('model').value === '__custom__' ? byId('custom-model').value.trim() : byId('model').value;
    }
    function configuration() {
      return { mode: byId('mode').value, provider: byId('provider').value, model: modelId(), apiKey: byId('api-key').value };
    }
    function status(id, message, kind = 'muted') {
      byId(id).textContent = message;
      byId(id).className = 'status ' + kind;
    }
    function updateButtons() {
      const hasProvider = Boolean(byId('provider').value);
      byId('load-models').disabled = !hasProvider || loading || testing || saving;
      byId('load-models').textContent = loading ? 'Loading models…' : 'Load models';
      byId('test-connection').disabled = !hasProvider || !modelId() || loading || testing || saving;
      byId('test-connection').textContent = testing ? 'Testing connection…' : verified ? 'Test again' : 'Test connection';
      byId('save').disabled = !verified || loading || testing || saving || saved;
      byId('save').textContent = saving ? 'Saving…' : saved ? '✓ Configuration saved' : 'Save configuration';
      byId('save-hint').textContent = saving ? 'Saving settings and credentials…' : saved ? 'Settings saved. You can now analyze a commit or selected code.' : verified ? '✓ Connection verified. Save to use these settings.' : 'Save unlocks after the connection test passes.';
    }
    function invalidate() {
      revision++;
      verified = false;
      saved = false;
      loading = false;
      testing = false;
      status('connection-status', 'Test the selected provider and model before saving.');
      status('status', '');
      updateButtons();
    }
    function populateModels(items, current) {
      const model = byId('model');
      model.innerHTML = '';
      for (const item of items) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name + (item.id !== item.name ? ' — ' + item.id : '');
        model.appendChild(option);
      }
      const custom = document.createElement('option');
      custom.value = '__custom__';
      custom.textContent = 'Enter a custom model ID…';
      model.appendChild(custom);
      model.value = items.some(item => item.id === current) ? current : current ? '__custom__' : items[0]?.id || '__custom__';
      byId('custom-model').value = model.value === '__custom__' ? current || '' : '';
      byId('custom-model-wrap').classList.toggle('hidden', model.value !== '__custom__');
      model.disabled = false;
    }
    function fillProviders(current = '') {
      const mode = byId('mode').value;
      const choices = mode === 'api' ? ['openai', 'anthropic'] : mode === 'cli' ? ['codex', 'claude-code'] : [];
      byId('provider').innerHTML = '<option value="">Choose a provider</option>';
      for (const id of choices) {
        const option = document.createElement('option'); option.value = id; option.textContent = providers[id].label; byId('provider').appendChild(option);
      }
      byId('provider').disabled = choices.length === 0;
      byId('provider').value = choices.includes(current) ? current : '';
    }
    function updateProvider() {
      const provider = byId('provider').value;
      const selected = providers[provider];
      const api = byId('mode').value === 'api';
      byId('provider-description').textContent = selected?.desc || '';
      byId('api-section').classList.toggle('hidden', !selected || !api);
      byId('cli-section').classList.toggle('hidden', !selected || api);
      byId('cli-instructions').textContent = selected?.instructions || '';
      byId('api-key-status').textContent = savedKeyProvider === provider ? 'A key is saved in VS Code SecretStorage. Leave the field blank to use it, or paste a replacement.' : 'Paste a key, or leave blank if you previously saved a key for this provider. Keys are stored only when you save.';
      byId('model').innerHTML = '<option value="">Load models first</option>';
      byId('model').disabled = true;
      byId('custom-model-wrap').classList.add('hidden');
      status('model-status', selected ? 'Click Load models to list model choices. This does not test model access.' : 'Choose a provider to load its models.');
      updateButtons();
    }
    function loadModels(current = modelId()) {
      invalidate();
      loading = true;
      status('model-status', 'Loading model choices…');
      updateButtons();
      vscode.postMessage({ type: 'refreshModels', ...configuration(), model: current, requestId: revision });
    }
    byId('mode').addEventListener('change', () => {
      byId('api-key').value = '';
      invalidate(); fillProviders(); updateProvider();
    });
    byId('provider').addEventListener('change', () => {
      byId('api-key').value = '';
      invalidate(); updateProvider();
    });
    byId('api-key').addEventListener('input', () => {
      invalidate();
      byId('api-key-status').textContent = byId('api-key').value.trim() ? 'This key has not been saved. Test the connection, then save to use it.' : 'Leave blank to use the saved key for this provider.';
      status('model-status', 'Key changed. Load models again or test the selected model with this key.');
    });
    byId('model').addEventListener('change', () => {
      byId('custom-model-wrap').classList.toggle('hidden', byId('model').value !== '__custom__');
      invalidate();
    });
    byId('custom-model').addEventListener('input', invalidate);
    byId('github-token').addEventListener('input', () => {
      saved = false;
      status('status', '');
      updateButtons();
    });
    byId('load-models').addEventListener('click', () => loadModels());
    byId('test-connection').addEventListener('click', () => {
      invalidate(); testing = true;
      status('connection-status', 'Sending a test prompt to ' + modelId() + '…');
      updateButtons();
      vscode.postMessage({ type: 'testConnection', ...configuration(), requestId: revision });
    });
    byId('save').addEventListener('click', () => {
      if (!verified || saving || saved) return;
      saving = true;
      byId('configuration-fields').disabled = true;
      status('status', 'Saving settings and credentials…');
      updateButtons();
      vscode.postMessage({ type: 'save', ...configuration(), githubToken: byId('github-token').value });
    });
    byId('get-api-key').addEventListener('click', () => {
      const url = providers[byId('provider').value]?.url;
      if (url) vscode.postMessage({ type: 'openExternal', url });
    });
    byId('get-github-token').addEventListener('click', () => vscode.postMessage({ type: 'openExternal', url: 'https://github.com/settings/personal-access-tokens' }));
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'state') {
        byId('configuration-fields').disabled = false;
        byId('mode').value = message.mode;
        savedModel = message.model || '';
        savedKeyProvider = message.apiKeySaved ? message.provider : '';
        fillProviders(message.provider); updateProvider();
        byId('github-status').textContent = message.githubTokenSaved ? 'A token is saved in VS Code SecretStorage. Leave blank to keep it. GitHub access is not checked by the model test.' : 'No token saved. Skip this for public repositories.';
        if (message.setupComplete) loadModels(savedModel);
      }
      if (message.type === 'models' && message.requestId === revision) {
        loading = false;
        populateModels(message.models || [], message.current || '');
        status('model-status', message.message, message.valid ? 'muted' : 'error');
        status('connection-status', 'Choose a model, then click Test connection to verify access.');
        updateButtons();
      }
      if (message.type === 'connection' && message.requestId === revision) {
        testing = false;
        verified = message.valid === true;
        status('connection-status', message.message, verified ? 'success' : 'error');
        updateButtons();
      }
      if (message.type === 'saveFailed') {
        saving = false;
        byId('configuration-fields').disabled = false;
        status('status', message.message, 'error');
        updateButtons();
      }
      if (message.type === 'saved') {
        saving = false; saved = true;
        byId('configuration-fields').disabled = false;
        savedKeyProvider = message.apiKeySaved ? byId('provider').value : '';
        byId('api-key').value = '';
        byId('github-token').value = '';
        if (message.apiKeySaved) byId('api-key-status').textContent = 'Key saved in VS Code SecretStorage. Leave blank to keep it.';
        byId('github-status').textContent = message.githubTokenSaved ? 'Token saved in VS Code SecretStorage. Leave blank to keep it. GitHub access is not checked by the model test.' : 'No token saved. Public repositories work without one.';
        status('status', '✓ Configuration saved. Run Rationale: Search via Commit… or Rationale: Explain Selected Code.', 'success');
        updateButtons();
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
