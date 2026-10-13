const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', hellip: '…' };
const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
export function htmlToText(html = '') {
  let s = decode(String(html));          // Greenhouse double-escapes: first pass turns &lt;p&gt; into <p>
  s = s.replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, '');
  s = decode(s);                           // second pass for entities inside the content
  return s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}
export async function fetchJson(url, { timeoutMs = 20000, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'User-Agent': 'india-tech-internships-bot (+https://github.com/iitian-vibes/India-Tech-Internships)', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}
export const iso = (v) => { if (v == null || v === '') return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };
