import { readFileSync, writeFileSync } from 'node:fs';
import { istStamp } from './render.mjs';
export function staleBanner(meta, now = new Date()) {
  if (!meta?.updated_at) return null;
  const hours = (now.getTime() - Date.parse(meta.updated_at)) / 3600e3;
  return hours > 36 ? `> ⚠️ **update delayed.** This list was last refreshed ${istStamp(meta.updated_at)}. Links may have closed since; check the posting before applying.` : null;
}
const RE = /\n<!-- freshness -->\n[\s\S]*?\n<!-- \/freshness -->/;
export function applyBanner(readme, banner) {
  const clean = readme.replace(RE, '');
  if (!banner) return clean;
  return clean.replace(/^(# .*)$/m, `$1\n<!-- freshness -->\n${banner}\n<!-- /freshness -->`);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const meta = JSON.parse(readFileSync('data/meta.json', 'utf8'));
  const before = readFileSync('README.md', 'utf8');
  const after = applyBanner(before, staleBanner(meta));
  if (after !== before) { writeFileSync('README.md', after); console.log('README freshness banner changed'); }
}
