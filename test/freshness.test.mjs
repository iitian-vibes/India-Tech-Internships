import { test } from 'node:test';
import assert from 'node:assert/strict';
import { staleBanner, applyBanner } from '../scripts/freshness.mjs';

test('no banner within 36 hours, banner after', () => {
  const meta = { updated_at: '2026-10-12T03:00:00Z' };
  assert.equal(staleBanner(meta, new Date('2026-10-13T14:00:00Z')), null);
  assert.match(staleBanner(meta, new Date('2026-10-13T16:00:00Z')), /update delayed/);
});

test('applyBanner inserts after the title and removes cleanly', () => {
  const md = '# Title\n\nBody\n';
  const withB = applyBanner(md, '> ⚠️ update delayed');
  assert.equal(withB, '# Title\n<!-- freshness -->\n> ⚠️ update delayed\n<!-- /freshness -->\n\nBody\n');
  assert.equal(applyBanner(withB, null), md);
});
