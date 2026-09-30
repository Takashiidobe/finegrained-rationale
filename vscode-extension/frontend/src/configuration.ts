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
  const apiKey = provider === "openai" && !(await context.secrets.get(defaults.openai.secret))
    ? await context.secrets.get(LEGACY_OPENAI_SECRET)
    : await context.secrets.get(defaults[provider].secret);
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

  panel.webview.onDidReceiveMessage(async (message: Record<string, unknown>) => {
    if (message.type === "ready") {
      const mode = context.globalState.get<RunMode>(MODE_KEY, "api");
      const provider = context.globalState.get<Provider>(PROVIDER_KEY, mode === "api" ? "openai" : "codex");
      const storedApiKey = await getStoredApiKey(context, provider);
      const hasSavedModel = Boolean(context.globalState.get<string>(`model:${provider}`));
      const hasSavedMode = context.globalState.keys().includes(MODE_KEY) && context.globalState.keys().includes(PROVIDER_KEY);
      const hasAnyApiKey = Boolean(
        await context.secrets.get(defaults.openai.secret) ||
        await context.secrets.get(LEGACY_OPENAI_SECRET) ||
        await context.secrets.get(defaults.anthropic.secret),
      );
      const setupComplete = context.globalState.get<boolean>("configurationComplete", false) || hasAnyApiKey || (hasSavedMode && hasSavedModel);
      const apiKeySaved = provider === "openai"
        ? Boolean(storedApiKey)
        : provider === "anthropic" ? Boolean(storedApiKey) : false;
      panel.webview.postMessage({
        type: "state",
        setupComplete,
        mode: setupComplete ? mode : "",
        provider: setupComplete ? provider : "",
        model: context.globalState.get<string>(`model:${provider}`, defaults[provider].model),
        apiKeySaved,
        githubTokenSaved: Boolean(await context.secrets.get(GITHUB_SECRET)),
      });
      if (setupComplete) void refreshModels(panel, context, mode, provider, storedApiKey);
      return;
    }
    if (message.type === "providerChanged") {
      const provider = message.provider;
      const mode: RunMode = message.mode === "cli" ? "cli" : "api";
      if (typeof provider === "string" && Object.prototype.hasOwnProperty.call(defaults, provider)) {
        const key = typeof message.apiKey === "string" && message.apiKey.trim()
          ? message.apiKey.trim()
          : await getStoredApiKey(context, provider as Provider);
        const saved = provider === "openai" ? Boolean(key) : provider === "anthropic" ? Boolean(key) : false;
        panel.webview.postMessage({ type: "providerStatus", saved });
      }
      return;
    }
    if (message.type === "validateApiKey") {
      const provider = message.provider as Provider;
      const apiKey = (typeof message.apiKey === "string" ? message.apiKey.trim() : "") || await getStoredApiKey(context, provider);
      if ((provider !== "openai" && provider !== "anthropic") || !apiKey) {
        panel.webview.postMessage({ type: "validation", valid: false, message: "Enter an API key first." });
        return;
      }
      try {
        const models = await fetchApiModels(provider, apiKey);
        if (!models.length) throw new Error("the key is valid, but no models were returned for this account");
        panel.webview.postMessage({ type: "validation", valid: true, models, current: context.globalState.get<string>(`model:${provider}`, ""), message: `Connected. Found ${models.length} available models.` });
      } catch (error) {
        panel.webview.postMessage({ type: "validation", valid: false, message: `Could not connect: ${(error as Error).message}` });
      }
      return;
    }
    if (message.type === "validateCli") {
      const provider = message.provider as Provider;
      if (provider !== "codex" && provider !== "claude-code") {
        panel.webview.postMessage({ type: "validation", valid: false, message: "Choose a CLI provider first." });
        return;
      }
      try {
        const models = await fetchCliModels(provider);
        panel.webview.postMessage({ type: "validation", valid: true, models, current: context.globalState.get<string>(`model:${provider}`, ""), message: `CLI found. Loaded ${models.length} model choices. Sign in through the CLI if you have not already.` });
      } catch (error) {
        panel.webview.postMessage({ type: "validation", valid: false, message: `Could not load the CLI: ${(error as Error).message}` });
        if (error instanceof CliUpdateRequiredError) void offerCliUpdate(error);
      }
      return;
    }
    if (message.type === "refreshModels") {
      const mode: RunMode = message.mode === "cli" ? "cli" : "api";
      const provider = message.provider as Provider;
      const key = typeof message.apiKey === "string" && message.apiKey.trim()
        ? message.apiKey.trim()
        : await getStoredApiKey(context, provider);
      await refreshModels(panel, context, mode, provider, key);
      return;
    }
    if (message.type === "openExternal" && typeof message.url === "string") {
      const url = vscode.Uri.parse(message.url);
      if (url.scheme === "https") await vscode.env.openExternal(url);
      return;
    }
    if (message.type !== "save") return;

    const mode: RunMode = message.mode === "cli" ? "cli" : "api";
    const validProviders: Provider[] = mode === "api" ? ["openai", "anthropic"] : ["codex", "claude-code"];
    const provider = validProviders.includes(message.provider as Provider) ? message.provider as Provider : validProviders[0];
    const model = typeof message.model === "string" && message.model.trim() ? message.model.trim() : defaults[provider].model;
    if (mode === "cli") {
      panel.webview.postMessage({ type: "status", message: `Sending a test prompt through the CLI with model "${model}"…` });
      try {
        await backend.selfTest({ mode, provider, model });
      } catch (error) {
        panel.webview.postMessage({ type: "saveFailed", message: `Not saved. The CLI test failed: ${(error as Error).message}` });
        if (error instanceof CliUpdateRequiredError) void offerCliUpdate(error);
        return;
      }
    }
    await context.globalState.update(MODE_KEY, mode);
    await context.globalState.update(PROVIDER_KEY, provider);
    await context.globalState.update(`model:${provider}`, model);
    await context.globalState.update("configurationComplete", true);

    const apiKey = typeof message.apiKey === "string" ? message.apiKey.trim() : "";
    if (mode === "api" && apiKey) await context.secrets.store(defaults[provider].secret, apiKey);
    if (provider === "openai" && apiKey) await context.secrets.delete(LEGACY_OPENAI_SECRET);
    const githubToken = typeof message.githubToken === "string" ? message.githubToken.trim() : "";
    if (githubToken) await context.secrets.store(GITHUB_SECRET, githubToken);

    panel.webview.postMessage({ type: "saved", setupComplete: true, mode, provider, apiKeySaved: mode === "api" ? Boolean(apiKey || await context.secrets.get(defaults[provider].secret)) : false, githubTokenSaved: Boolean(githubToken || await context.secrets.get(GITHUB_SECRET)) });
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
): Promise<void> {
  try {
    const models = mode === "api"
      ? await fetchApiModels(provider, apiKey)
      : await fetchCliModels(provider);
    const current = context.globalState.get<string>(`model:${provider}`, "");
    panel.webview.postMessage({ type: "models", models, current, message: `${models.length} model choices loaded.` });
  } catch (error) {
    const current = context.globalState.get<string>(`model:${provider}`, defaults[provider].model);
    panel.webview.postMessage({
      type: "models",
      models: current ? [{ id: current, name: `${current} (saved; refresh failed)` }] : [],
      current,
      message: `Model refresh failed: ${(error as Error).message}. Check the API key or CLI installation, then refresh again.`,
    });
  }
}

async function fetchApiModels(provider: Provider, apiKey?: string): Promise<Array<{ id: string; name: string }>> {
  if (!apiKey) throw new Error("enter and save or paste the provider API key first");
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
    h1 { font-size: 1.6em; } h2 { margin-top: 24px; }
    label { display: block; margin: 16px 0 6px; font-weight: 600; }
    select, input { width: 100%; box-sizing: border-box; padding: 8px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder)); }
    button { padding: 8px 14px; margin: 14px 8px 0 0; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: .55; cursor: default; }
    .muted { color: var(--vscode-descriptionForeground); } .status { min-height: 1.5em; margin-top: 12px; }
    .card { border: 1px solid var(--vscode-panel-border); padding: 16px; margin: 16px 0; }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <h1>Rationale setup</h1>
  <p class="muted">Choose an API provider or a local CLI account for model generation.</p>

  <section id="first-run" class="hidden">
    <p id="wizard-progress" class="muted">Step 1 of 3</p>
    <div class="card" id="provider-card">
      <h2>1. Choose how to run models</h2>
      <label for="mode">Execution mode</label>
      <select id="mode"><option value="">Choose a mode</option><option value="api">Provider API</option><option value="cli">Local CLI subscription</option></select>
      <label for="provider">Provider</label>
      <select id="provider" disabled><option value="">Choose a provider</option></select>
      <p id="provider-description" class="muted"></p>
      <button id="continue-provider" type="button" disabled>Continue</button>
    </div>
    <div class="card hidden" id="access-card">
      <h2>2. Connect to the provider</h2>
      <section id="api-section" class="hidden">
        <p class="muted">Enter an API key. Rationale will check it by requesting the models available to your account. The key is saved only when you finish setup.</p>
        <label for="api-key">Provider API key</label>
        <input id="api-key" type="password" autocomplete="off" placeholder="Paste API key">
        <button id="get-api-key" type="button">Get an API key</button>
      </section>
      <section id="cli-section" class="hidden">
        <p class="muted">Install the selected CLI and sign in before analysis. Rationale checks that it is available and loads its model choices.</p>
      </section>
      <button id="connect" type="button">Check for models</button>
      <p id="api-key-status" class="muted"></p>
    </div>
    <div class="card hidden" id="model-card">
      <h2>3. Choose a model and finish</h2>
      <label for="model">Model</label>
      <select id="model"></select>
      <div id="custom-model-wrap" class="hidden"><label for="custom-model">Custom model ID</label><input id="custom-model" type="text" autocomplete="off"></div>
      <p id="model-status" class="muted"></p>
      <h3>GitHub access <span class="muted">(optional)</span></h3>
      <p class="muted">For private repositories, a classic token needs the <code>repo</code> scope. A fine-grained token needs read access to Contents, Issues, and Pull requests.</p>
      <label for="github-token">GitHub token</label>
      <input id="github-token" type="password" autocomplete="off" placeholder="Leave blank to skip">
      <button id="get-github-token" type="button">Create a GitHub token</button>
      <p id="github-status" class="muted">Optional for public repositories.</p>
      <button id="finish" type="button">Finish setup</button>
    </div>
  </section>

  <section id="returning-config" class="hidden">
    <div class="card">
      <h2>Model provider</h2>
      <label for="mode">Execution mode</label>
      <select id="mode"><option value="api">Provider API</option><option value="cli">Local CLI subscription</option></select>
      <label for="provider">Provider</label>
      <select id="provider"></select>
      <p id="provider-description" class="muted"></p>
      <section id="api-section">
        <label for="api-key">Provider API key</label>
        <input id="api-key" type="password" autocomplete="off" placeholder="Leave blank to keep the saved key">
        <button id="get-api-key" type="button">Get an API key</button>
      </section>
      <section id="cli-section" class="hidden"><p class="muted">Install the selected CLI and sign in before analysis.</p></section>
      <p id="api-key-status" class="muted"></p>
    </div>
    <div class="card">
      <h2>Model</h2>
      <label for="model">Model</label>
      <select id="model"></select>
      <div id="custom-model-wrap" class="hidden"><label for="custom-model">Custom model ID</label><input id="custom-model" type="text" autocomplete="off"></div>
      <button id="refresh-models" type="button">Check for models</button>
      <p id="model-status" class="muted">Connect to a provider to load its models.</p>
    </div>
    <div class="card">
      <h2>GitHub access <span class="muted">(optional for public repositories)</span></h2>
      <p class="muted">For private repositories, a classic token needs the <code>repo</code> scope. A fine-grained token needs read access to Contents, Issues, and Pull requests.</p>
      <label for="github-token">GitHub token</label>
      <input id="github-token" type="password" autocomplete="off" placeholder="Leave blank to keep the saved token">
      <button id="get-github-token" type="button">Create a GitHub token</button>
      <p id="github-status" class="muted"></p>
    </div>
    <button id="save" type="button">Save configuration</button>
  </section>

  <p id="status" class="status" role="status"></p>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const defaults = {
      openai: { label: 'OpenAI', url: 'https://platform.openai.com/api-keys', desc: 'Calls the OpenAI Responses API. Requires an OpenAI API key; usage follows API billing.' },
      anthropic: { label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys', desc: 'Calls the Anthropic Messages API. Requires an Anthropic API key; usage follows API billing.' },
      codex: { label: 'Codex CLI', url: '', desc: 'Runs the local Codex CLI. Its ChatGPT account plan allowance applies.' },
      'claude-code': { label: 'Claude Code CLI', url: '', desc: 'Runs the local Claude Code CLI. Its account plan allowance applies.' }
    };
    let validated = false;
    let pendingSave = '';
    function byId(id) { return document.getElementById(id); }
    function getValue(id) { const element = byId(id); return element ? element.value : ''; }
    function setView(setupComplete) {
      byId('first-run').classList.toggle('hidden', setupComplete);
      byId('returning-config').classList.toggle('hidden', !setupComplete);
      if (setupComplete) {
        const selectors = document.querySelectorAll('#returning-config select');
        fillProviders(selectors[0], selectors[1], getValueFromState('mode'), getValueFromState('provider'));
        updateProviderDisplay('returning-config');
      } else {
        const selectors = document.querySelectorAll('#first-run select');
        fillProviders(selectors[0], selectors[1], '', '');
        byId('provider').value = '';
        byId('continue-provider').disabled = true;
      }
    }
    function getValueFromState(key) { return window.rationaleState ? window.rationaleState[key] || '' : ''; }
    function fillProviders(modeElement, providerElement, nextMode, nextProvider) {
      if (!modeElement || !providerElement) return;
      modeElement.value = nextMode;
      providerElement.innerHTML = '<option value="">Choose a provider</option>';
      const choices = nextMode === 'api' ? ['openai', 'anthropic'] : nextMode === 'cli' ? ['codex', 'claude-code'] : [];
      for (const id of choices) {
        const option = document.createElement('option'); option.value = id; option.textContent = defaults[id].label; providerElement.appendChild(option);
      }
      providerElement.disabled = choices.length === 0;
      providerElement.value = choices.includes(nextProvider) ? nextProvider : '';
    }
    function updateProviderDisplay(rootId) {
      const root = byId(rootId);
      const modeElement = root.querySelector('#mode');
      const providerElement = root.querySelector('#provider');
      const selected = defaults[providerElement.value];
      if (!selected) {
        root.querySelector('#provider-description').textContent = '';
        root.querySelector('#api-section').classList.add('hidden');
        root.querySelector('#cli-section').classList.add('hidden');
        return;
      }
      root.querySelector('#provider-description').textContent = selected.desc;
      const api = modeElement.value === 'api';
      root.querySelector('#api-section').classList.toggle('hidden', !api);
      root.querySelector('#cli-section').classList.toggle('hidden', api);
      const link = root.querySelector('#get-api-key');
      link.classList.toggle('hidden', !selected.url);
    }
    function populateModels(rootId, items, current, message) {
      const root = byId(rootId);
      const model = root.querySelector('#model');
      const wrap = root.querySelector('#custom-model-wrap');
      model.innerHTML = '';
      const hasCurrent = items.some(item => item.id === current);
      for (const item of items) {
        const option = document.createElement('option'); option.value = item.id; option.textContent = item.name + (item.id !== item.name ? ' — ' + item.id : ''); model.appendChild(option);
      }
      const custom = document.createElement('option'); custom.value = '__custom__'; custom.textContent = 'Enter a custom model ID…'; model.appendChild(custom);
      model.value = hasCurrent ? current : items[0]?.id || '__custom__';
      wrap.classList.toggle('hidden', model.value !== '__custom__');
      if (model.value === '__custom__') root.querySelector('#custom-model').value = hasCurrent ? current : '';
      root.querySelector('#model-status').textContent = message;
    }
    function setValidatedModels(message) {
      validated = message.valid === true;
      const rootId = document.getElementById('first-run').classList.contains('hidden') ? 'returning-config' : 'first-run';
      if (validated) {
        populateModels(rootId, message.models || [], message.current || '', message.message);
        if (rootId === 'first-run') byId('model-card').classList.remove('hidden');
      } else {
        if (rootId === 'first-run') byId('model-card').classList.add('hidden');
        pendingSave = '';
        byId(rootId).querySelector('#api-key-status').textContent = message.message;
      }
      if (rootId === 'first-run') byId('wizard-progress').textContent = validated ? 'Step 3 of 3' : 'Step 2 of 3';
      if (rootId === 'first-run') byId('finish').disabled = !validated;
      if (validated && pendingSave) {
        const buttonId = pendingSave;
        pendingSave = '';
        saveConfiguration(buttonId, true);
      }
    }
    function saveConfiguration(buttonId, alreadyValidated = false) {
      const rootId = buttonId === 'finish' ? 'first-run' : 'returning-config';
      const root = byId(rootId);
      const mode = root.querySelector('#mode').value;
      const provider = root.querySelector('#provider').value;
      if (!alreadyValidated && !validated) {
        pendingSave = buttonId;
        root.querySelector('#api-key-status').textContent = 'Verify the provider before saving.';
        vscode.postMessage(mode === 'api'
          ? { type: 'validateApiKey', provider, apiKey: root.querySelector('#api-key')?.value || '' }
          : { type: 'validateCli', provider });
        return;
      }
      const model = root.querySelector('#model');
      const modelId = model.value === '__custom__' ? root.querySelector('#custom-model').value.trim() : model.value;
      if (!modelId) { root.querySelector('#model-status').textContent = 'Choose a model before saving.'; return; }
      vscode.postMessage({ type: 'save', mode, provider, model: modelId, apiKey: root.querySelector('#api-key')?.value || '', githubToken: root.querySelector('#github-token').value });
      byId('status').textContent = 'Saving credentials securely…';
    }
    document.querySelectorAll('#mode').forEach(element => element.addEventListener('change', event => {
      const rootId = event.target.closest('#first-run') ? 'first-run' : 'returning-config';
      const root = byId(rootId);
      const provider = root.querySelector('#provider');
      fillProviders(root.querySelector('#mode'), provider, event.target.value, '');
      validated = false;
      updateProviderDisplay(rootId);
      if (rootId === 'first-run') {
        byId('continue-provider').disabled = true;
        byId('access-card').classList.add('hidden');
        byId('model-card').classList.add('hidden');
        byId('wizard-progress').textContent = 'Step 1 of 3';
      }
    }));
    document.querySelectorAll('#provider').forEach(element => element.addEventListener('change', event => {
      const rootId = event.target.closest('#first-run') ? 'first-run' : 'returning-config';
      validated = false;
      updateProviderDisplay(rootId);
      if (rootId === 'first-run') {
        byId('continue-provider').disabled = !event.target.value;
        byId('access-card').classList.add('hidden');
        byId('model-card').classList.add('hidden');
        byId('wizard-progress').textContent = 'Step 1 of 3';
      }
      else byId(rootId).querySelector('#api-key-status').textContent = 'Verify this provider to load its available models.';
    }));
    document.querySelectorAll('#get-api-key').forEach(button => button.addEventListener('click', event => {
      const rootId = event.target.closest('#first-run') ? 'first-run' : 'returning-config';
      const provider = byId(rootId).querySelector('#provider').value;
      vscode.postMessage({ type: 'openExternal', url: defaults[provider].url });
    }));
    document.querySelectorAll('#get-github-token').forEach(button => button.addEventListener('click', () => vscode.postMessage({ type: 'openExternal', url: 'https://github.com/settings/personal-access-tokens' })));
    byId('continue-provider').addEventListener('click', () => {
      const mode = byId('first-run').querySelector('#mode').value;
      byId('access-card').classList.remove('hidden');
      byId('wizard-progress').textContent = 'Step 2 of 3';
      updateProviderDisplay('first-run');
      if (mode === 'cli') byId('api-key-status').textContent = 'Continue to check the installed CLI and load its models.';
    });
    byId('connect').addEventListener('click', () => {
      const rootId = 'first-run';
      const mode = byId(rootId).querySelector('#mode').value;
      const provider = byId(rootId).querySelector('#provider').value;
      byId('api-key-status').textContent = 'Checking connection and loading models…';
      vscode.postMessage(mode === 'api'
        ? { type: 'validateApiKey', provider, apiKey: getValue('api-key') }
        : { type: 'validateCli', provider });
    });
    byId('refresh-models').addEventListener('click', () => {
      const root = byId('returning-config');
      root.querySelector('#model-status').textContent = 'Checking connection and loading models…';
      vscode.postMessage({ type: 'refreshModels', mode: root.querySelector('#mode').value, provider: root.querySelector('#provider').value, apiKey: root.querySelector('#api-key').value });
    });
    byId('finish').addEventListener('click', () => saveConfiguration('finish'));
    byId('save').addEventListener('click', () => saveConfiguration('save'));
    document.querySelectorAll('#model').forEach(element => element.addEventListener('change', event => event.target.closest('section, .card').querySelector('#custom-model-wrap').classList.toggle('hidden', event.target.value !== '__custom__')));
    document.querySelectorAll('#api-key').forEach(element => element.addEventListener('input', event => {
      validated = false;
      if (event.target.closest('#first-run')) {
        byId('model-card').classList.add('hidden');
        byId('finish').disabled = true;
      }
    }));
    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'state') {
        window.rationaleState = message;
        setView(message.setupComplete);
        const rootId = message.setupComplete ? 'returning-config' : 'first-run';
        byId(rootId).querySelector('#api-key-status').textContent = message.apiKeySaved ? 'An API key is saved securely in VS Code.' : 'No API key saved for this provider yet.';
        byId(rootId).querySelector('#github-status').textContent = message.githubTokenSaved ? 'A GitHub token is saved securely in VS Code.' : 'No GitHub token saved.';
        if (message.setupComplete) byId(rootId).querySelector('#model-status').textContent = 'Loading models from the selected provider…';
      }
      if (message.type === 'validation') setValidatedModels(message);
      if (message.type === 'status' || message.type === 'saveFailed') byId('status').textContent = message.message;
      if (message.type === 'models') {
        populateModels('returning-config', message.models || [], message.current, message.message);
        validated = !message.message.startsWith('Model refresh failed:');
        if (!validated) byId('returning-config').querySelector('#api-key-status').textContent = message.message;
      }
      if (message.type === 'saved') {
        byId('status').textContent = 'Configuration saved.';
        byId('save').textContent = 'Save configuration ✅';
        byId('finish').textContent = 'Finish setup ✅';
        window.rationaleState = { mode: message.mode, provider: message.provider };
        setView(true);
        if (message.mode === 'api') byId('returning-config').querySelector('#api-key-status').textContent = message.apiKeySaved ? 'Connected. API key saved securely in VS Code.' : 'No API key saved.';
        byId('returning-config').querySelector('#github-status').textContent = message.githubTokenSaved ? 'GitHub token saved securely in VS Code.' : 'No GitHub token saved.';
        byId('first-run').querySelector('#api-key').value = '';
        byId('returning-config').querySelector('#api-key').value = '';
        byId('first-run').querySelector('#github-token').value = '';
        byId('returning-config').querySelector('#github-token').value = '';
        vscode.postMessage({ type: 'refreshModels', mode: message.mode, provider: message.provider, apiKey: '' });
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
}
