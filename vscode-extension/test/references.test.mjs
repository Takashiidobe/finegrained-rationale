import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatRationale } from '../frontend/src/references.ts';

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
  assert.match(result.markdown, /\[\^2\]: \[Issue\]\(<https:\/\/github.com\/owner\/repo\/issues\/42#issuecomment-123>\)/);
  assert.ok(result.markdown.includes('ARGUS sentence `12_5_3_0`: “The old implementation silently drops the custom firewall.”'));
  assert.deepEqual(result.evidence, {});
});

test('uncited summaries list classified evidence separately instead of claiming exact attribution', () => {
  const result = formatRationale({ components: { NEED: 'A summarized motivation.' }, references: [need, goal] });
  assert.equal(result.components.NEED, 'A summarized motivation.');
  assert.deepEqual(result.evidence.NEED, [1, 2]);
  assert.ok(result.markdown.includes('A summarized motivation.\n\nARGUS NEED evidence: [^1] [^2]'));
  assert.ok(!result.markdown.includes('ARGUS GOAL evidence:'));
});

test('invented IDs and citations with the wrong component label never become source links', () => {
  const result = formatRationale({ components: { ALTERNATIVES: `Unknown.[^made-up][^${need.id}]` }, references: [need] });
  assert.equal(result.components.ALTERNATIVES, 'Unknown.');
  assert.equal(result.references.length, 0);
  assert.ok(!result.markdown.includes('[^'));
});

test('empty evidence and older summaries produce normal Markdown without dangling footnotes', () => {
  for (const summary of [{}, { components: { NEED: 'Existing summary.' } }, { components: {}, references: [need] }]) {
    const result = formatRationale(summary);
    assert.equal(result.references.length, 0);
    assert.ok(!result.markdown.includes('## References'));
    assert.ok(result.markdown.includes('Not identified.'));
  }
});

test('source quotes remain literal Markdown text and unsafe URLs are excluded', () => {
  const result = formatRationale({ components: { NEED: 'Motivation.' }, references: [
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
  assert.equal(result.components.NEED, 'Repeated.[^1][^1]');
  assert.equal(result.references.length, 1);
  assert.equal((result.markdown.match(/\[\^1\]:/g) || []).length, 1);
});
