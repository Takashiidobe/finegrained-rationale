import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const { build } = require('../frontend/node_modules/esbuild');
const bundle = await build({ entryPoints: [fileURLToPath(new URL('../frontend/src/savedRationale.ts', import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, URL });
const { isRationaleFile, parseSavedRationale } = module.exports;

const body = `
## GOAL

Edited goal.[^1]

## NEED

A reason.

ARGUS NEED evidence: [^1]

## ALTERNATIVE

Not identified.

## References

[^1]: [Issue \\#42](<https://github.com/owner/repo/issues/42#issuecomment-123>) — “Keep the \\*custom\\* implementation.”
`;

test('saved commit rationale reopens with edits, citations, and evidence', () => {
  const result = parseSavedRationale(`---\nrepository: "owner/repo"\ncommit: "https://github.com/owner/repo/commit/abc1234"\ncommit_sha: "abc1234"\n---\n# Rationale\n${body}`, '/repo/.rationale/owner/repo/commit-abc1234.md');
  assert.equal(result.components.GOAL, 'Edited goal.[^1]');
  assert.equal(result.components.NEED, 'No evidence found.');
  assert.equal(result.references[0].url, 'https://github.com/owner/repo/issues/42#issuecomment-123');
  assert.equal(result.references[0].sentence, 'Keep the *custom* implementation.');
  assert.equal(result.evidence.NEED, undefined);
  assert.equal(result.commitSha, 'abc1234');
});

test('saved selection rationale restores its source commits and range', () => {
  const result = parseSavedRationale(`---\nrepository: "owner/repo"\nfile: "src/app.ts"\nstart_line: 2\nend_line: 5\n---\n# Rationale\n- [abc1234](https://github.com/owner/repo/commit/abc1234) — 4 selected lines\n${body}`, '/repo/.rationale/owner/repo/selection-123.md');
  assert.equal(result.title, 'Selected code: src/app.ts:2-5');
  assert.equal(result.sourceCommits[0].sha, 'abc1234');
  assert.equal(result.sourceCommits[0].lines, 4);
});

test('visualizer accepts only rationale paths and rejects unrelated Markdown', () => {
  assert.equal(isRationaleFile('/repo/.rationale/owner/repo/commit-abc1234.md'), true);
  assert.equal(isRationaleFile('C:\\repo\\.rationale\\owner\\repo\\selection-123.md'), true);
  assert.equal(isRationaleFile('/repo/README.md'), false);
  assert.equal(isRationaleFile('/repo/docs/commit-abc1234.md'), false);
  assert.throws(() => parseSavedRationale('# README', '/repo/README.md'), /metadata/);
});
