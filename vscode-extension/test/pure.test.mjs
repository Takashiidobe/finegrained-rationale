import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UV_SHA256, uvAssetName, uvTarget } from '../frontend/src/uv.ts';
import { checkCliVersion, MIN_CLI_VERSIONS } from '../frontend/src/cliVersion.ts';
import { summarizeFailure } from '../frontend/src/failure.ts';
import { getGitHubCommitUrl, isCommitHash, parseGitHubRemote } from '../frontend/src/commitInput.ts';

test('commit input accepts full and abbreviated hashes but rejects refs and shell input', () => {
  for (const value of ['abc1234', 'A'.repeat(40), ' abc1234\n']) assert.equal(isCommitHash(value), true);
  for (const value of ['', 'abc123', 'a'.repeat(41), 'HEAD', 'main', 'abc1234;whoami']) assert.equal(isCommitHash(value), false);
});

test('GitHub commit URLs are normalized before being passed to the backend', () => {
  assert.equal(getGitHubCommitUrl(' https://github.com/owner/repo/commit/ABC1234/\n'), 'https://github.com/owner/repo/commit/abc1234');
  assert.equal(getGitHubCommitUrl('https://github.com/owner/repo/commit/abc1234?diff=split#diff-123'), 'https://github.com/owner/repo/commit/abc1234');
  for (const value of ['abc1234', 'https://github.com/owner/repo', 'https://github.com/owner/repo/pull/123', 'https://github.com.evil.com/owner/repo/commit/abc1234']) {
    assert.equal(getGitHubCommitUrl(value), undefined);
  }
});

test('GitHub origin parsing supports HTTPS and SSH and rejects other hosts', () => {
  for (const remote of ['https://github.com/owner/repo.git', 'https://github.com/owner/repo/', 'git@github.com:owner/repo.git', 'ssh://git@github.com/owner/repo.git\n']) {
    assert.deepEqual(parseGitHubRemote(remote), { owner: 'owner', repo: 'repo' });
  }
  for (const remote of ['https://gitlab.com/owner/repo.git', 'https://notgithub.com/owner/repo.git', 'https://evil.com/github.com/owner/repo.git', '/local/repo']) {
    assert.equal(parseGitHubRemote(remote), undefined);
  }
});

test('uvTarget maps supported platforms to uv release triples', () => {
  assert.equal(uvTarget('linux', 'x64', false), 'x86_64-unknown-linux-gnu');
  assert.equal(uvTarget('linux', 'arm64', true), 'aarch64-unknown-linux-musl');
  assert.equal(uvTarget('darwin', 'arm64', false), 'aarch64-apple-darwin');
  assert.equal(uvTarget('win32', 'x64', false), 'x86_64-pc-windows-msvc');
  assert.equal(uvTarget('linux', 'ppc64', false), undefined);
  assert.equal(uvTarget('freebsd', 'x64', false), undefined);
});

test('every supported uv target has a pinned checksum', () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const arch of ['x64', 'arm64']) {
      for (const musl of platform === 'linux' ? [false, true] : [false]) {
        const target = uvTarget(platform, arch, musl);
        assert.match(UV_SHA256[target] ?? '', /^[0-9a-f]{64}$/, target);
      }
    }
  }
  assert.equal(uvAssetName('x86_64-pc-windows-msvc'), 'uv-x86_64-pc-windows-msvc.zip');
  assert.equal(uvAssetName('aarch64-apple-darwin'), 'uv-aarch64-apple-darwin.tar.gz');
});

test('checkCliVersion accepts the minimum and newer versions', () => {
  assert.deepEqual(checkCliVersion('codex', 'codex-cli 0.159.2\n'), { ok: true, version: '0.159.2' });
  assert.deepEqual(checkCliVersion('codex', 'codex-cli 1.0.0'), { ok: true, version: '1.0.0' });
  assert.deepEqual(checkCliVersion('claude-code', '2.1.285 (Claude Code)'), { ok: true, version: '2.1.285' });
  assert.deepEqual(checkCliVersion('claude-code', '2.2.0 (Claude Code)'), { ok: true, version: '2.2.0' });
});

test('checkCliVersion rejects older and unparseable versions with an update hint', () => {
  const old = checkCliVersion('codex', 'codex-cli 0.98.10');
  assert.equal(old.ok, false);
  assert.match(old.message, /0\.98\.10/);
  assert.match(old.message, new RegExp(MIN_CLI_VERSIONS.codex.replace(/\./g, '\\.')));
  const oldClaude = checkCliVersion('claude-code', '2.1.9 (Claude Code)');
  assert.equal(oldClaude.ok, false);
  assert.match(oldClaude.message, /claude update/);
  assert.equal(checkCliVersion('codex', 'garbage').ok, false);
});

test('summarizeFailure prefers the structured backend error', () => {
  const stderr = 'Traceback (most recent call last):\n  ...\nRuntimeError: boom\nARGUS_ERROR {"type": "RuntimeError", "message": "Codex CLI failed: unknown flag"}\n';
  assert.equal(summarizeFailure(stderr, 1), 'Codex CLI failed: unknown flag');
});

test('summarizeFailure falls back to the uv error block or last stderr line', () => {
  assert.equal(
    summarizeFailure('Resolved 3 packages\nerror: Failed to download `openai`\n  Caused by: connection refused\n', 2),
    'error: Failed to download `openai` Caused by: connection refused',
  );
  assert.equal(summarizeFailure('warning\nModuleNotFoundError: No module named openai\n', 1), 'ModuleNotFoundError: No module named openai');
  assert.equal(summarizeFailure('', 3), 'Process exited with code 3.');
});
