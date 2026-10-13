import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('companies.json entries have the required fields', () => {
  const cs = JSON.parse(readFileSync('data/companies.json', 'utf8'));
  for (const c of cs) {
    assert.ok(c.name && c.slug && c.ats, `incomplete: ${JSON.stringify(c)}`);
    assert.ok(['greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters'].includes(c.ats), `bad ats ${c.ats}`);
    assert.ok(c.ats === 'workday' ? c.workday?.host && c.workday?.tenant && c.workday?.site : c.board, `missing board for ${c.slug}`);
    assert.equal(typeof c.abroad_visa, 'boolean');
    // Task A, item 1: every allowlisted company carries a `field` so it has somewhere to land in the
    // by-field README (Software & AI / Quant / Core Engineering / Research).
    assert.ok(['software-ai', 'quant', 'core', 'research'].includes(c.field), `missing/bad field for ${c.slug}: ${c.field}`);
  }
  assert.equal(new Set(cs.map((c) => c.slug)).size, cs.length, 'duplicate slug');
});
