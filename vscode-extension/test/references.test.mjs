import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRationale, referenceLabel } from '../frontend/src/references.ts';

const need = {
  id: 'abc1234-12_5_3_0', sentenceId: '12_5_3_0', source: 'ISSUE',
  url: 'https://github.com/owner/repo/issues/42#issuecomment-123',
  sentence: 'The old implementation silently drops the custom firewall.', labels: ['NEED'],
};
const goal = { ...need, id: 'abc1234-12_1_1_0', sentenceId: '12_1_1_0', source: 'COMMIT_MESSAGE', url: 'https://github.com/owner/repo/commit/abc1234', sentence: 'Preserve the custom firewall.', labels: ['GOAL', 'NEED'] };

test('claims get numbered footnotes with original source anchors, IDs, and quoted evidence', () => {
  const result = formatRationale({
    components: { GOAL: `Preserve the firewall.[^${goal.id}]`, NEED: `The firewall was lost.[^${need.id}] This fixes it.[^${goal.id}]` },
    references: [need, goal],
  });
  assert.equal(result.components.GOAL, 'Preserve the firewall.[^1]');
  assert.equal(result.components.NEED, 'The firewall was lost.[^2] This fixes it.[^1]');
  assert.equal(result.references.length, 2);
  assert.ok(result.markdown.includes('[^2]: [Issue \\#42](<https://github.com/owner/repo/issues/42#issuecomment-123>)'));
  assert.ok(result.markdown.includes('— “The old implementation silently drops the custom firewall.”'));
  assert.deepEqual(result.evidence, {});
});

test('uncited claims are rejected even when matching evidence exists', () => {
  for (const references of [[], [need, goal]]) {
    const result = formatRationale({ components: { NEED: 'A summarized motivation.' }, references });
    assert.equal(result.components.NEED, 'No evidence found.');
    assert.equal(result.references.length, 0);
    assert.deepEqual(result.evidence, {});
    assert.ok(!result.markdown.includes('ARGUS NEED evidence:'));
  }
});

test('a cited claim cannot support an uncited claim in the same component', () => {
  for (const text of [`Supported.[^${need.id}] Invented motivation.`, `Invented motivation. Supported.[^${need.id}]`]) {
    const result = formatRationale({ components: { NEED: text }, references: [need] });
    assert.equal(result.components.NEED, 'No evidence found.');
    assert.equal(result.references.length, 0);
  }
});

test('invented IDs and citations with the wrong component label never become source links', () => {
  const result = formatRationale({ components: { ALTERNATIVES: `Unknown.[^made-up][^${need.id}]` }, references: [need] });
  assert.equal(result.components.ALTERNATIVES, 'No evidence found.');
  assert.equal(result.references.length, 0);
  assert.ok(!result.markdown.includes('[^'));
});

test('empty evidence and older summaries produce normal Markdown without dangling footnotes', () => {
  for (const summary of [{}, { components: { NEED: 'Existing summary.' } }, { components: {}, references: [need] }]) {
    const result = formatRationale(summary);
    assert.equal(result.references.length, 0);
    assert.ok(!result.markdown.includes('## References'));
    assert.ok(result.markdown.includes('No evidence found.'));
  }
});

test('source quotes remain literal Markdown text and unsafe URLs are excluded', () => {
  const result = formatRationale({ components: { NEED: `Motivation.[^${need.id}]` }, references: [
    { ...need, sentence: 'A [link](javascript:bad)\n\n[^fake]: injected <script> *bold* `code`' },
    { ...goal, url: 'javascript:alert(1)' },
    { ...goal, url: 'https://github.com.evil.com/x' },
  ] });
  assert.equal(result.references.length, 1);
  assert.ok(result.markdown.includes('A \\[link\\](javascript:bad) \\[^fake\\]: injected \\<script\\> \\*bold\\* \\`code\\`'));
  assert.ok(!result.markdown.includes('\n[^fake]:'));
});

test('duplicate references reuse one definition', () => {
  const duplicate = { ...need, id: 'def5678-12_5_3_0' };
  const result = formatRationale({ components: { NEED: `Repeated.[^${need.id}][^${duplicate.id}]` }, references: [need, duplicate] });
  assert.equal(result.components.NEED, 'Repeated.[^1], [^1]');
  assert.equal(result.references.length, 1);
  assert.equal((result.markdown.match(/\[\^1\]:/g) || []).length, 1);
});

test('issue and PR labels include their number and preserve other source labels', () => {
  assert.equal(referenceLabel('ISSUE', need.url), 'Issue #42');
  assert.equal(referenceLabel('PR_COMMENT', 'https://github.com/owner/repo/pull/17#discussion_r123'), 'PR #17');
  assert.equal(referenceLabel('COMMIT_MESSAGE', goal.url), 'Commit message');
  assert.equal(referenceLabel('ISSUE', 'invalid'), 'Issue');
  const pr = { ...need, source: 'PR', url: 'https://github.com/owner/repo/pull/17#discussion_r123' };
  const result = formatRationale({ components: { NEED: `Reason.[^${pr.id}]` }, references: [pr] });
  assert.ok(result.markdown.includes('[PR \\#17](<https://github.com/owner/repo/pull/17#discussion_r123>)'));
});

test('spaces before citations preserve supported claims without accepting uncited neighbors', () => {
  const result = formatRationale({ components: { NEED: `Reason. [^${need.id}]` }, references: [need] });
  assert.equal(result.components.NEED, 'Reason.[^1]');
  assert.equal(result.references[0].url, need.url);
  const unsupported = formatRationale({ components: { NEED: `Invented. Reason. [^${need.id}]` }, references: [need] });
  assert.equal(unsupported.components.NEED, 'No evidence found.');
});
