import dns from 'node:dns';
import net from 'node:net';
import { isStudentRole, isEngineeringRole, classifyLocation, hasWorkAuthBlock, fieldOf } from './filter.mjs';
import { htmlToText } from './fetch/util.mjs';

const LABELS = { 'Company': 'company', 'Role title (exactly as on the posting)': 'role', 'Link to the posting': 'url', 'Location': 'location', 'Stipend (only if the posting says)': 'stipend', 'Graduation year it is for (optional)': 'batch', 'Company careers site': 'careers_site' };

export function parseIssueForm(body = '') {
  const out = { company: '', role: '', url: '', location: '', stipend: '', batch: '', careers_site: '' };
  for (const part of body.split(/^### /m).slice(1)) {
    const [label, ...rest] = part.split('\n');
    const key = LABELS[label.trim()];
    if (!key) continue;
    const v = rest.join('\n').trim();
    out[key] = v === '_No response_' ? '' : v;
  }
  return out;
}

// --- host/URL safety helpers ---

const ATS_HOSTS = [/(^|\.)greenhouse\.io$/, /^jobs\.lever\.co$/, /^jobs\.ashbyhq\.com$/, /\.myworkdayjobs\.com$/, /\.darwinbox\.in$/, /\.keka\.com$/, /\.freshteam\.com$/, /\.zohorecruit\.(com|in)$/, /^careers\.smartrecruiters\.com$/, /\.recruitee\.com$/, /\.teamtailor\.com$/];

// Aggregators, listing sites and generic user-content hosts. A submitter controls `careers_site`, so these
// cannot be allowed through just because careers_site is set to the same host (fix round 1, finding 2).
const DENY_HOSTS = ['unstop.com', 'linkedin.com', 'internshala.com', 'naukri.com', 'indeed.com', 'wellfound.com', 'angel.co', 'glassdoor.com', 'glassdoor.co.in', 'cutshort.io', 'instahyre.com', 'foundit.in', 'shine.com', 'hirist.tech', 'iimjobs.com', 'githubusercontent.com', 'github.io', 'github.com', 'gist.github.com', 'vercel.app', 'netlify.app', 'pages.dev', 'notion.site', 'docs.google.com', 'sites.google.com', 'forms.gle', 'bit.ly', 'tinyurl.com'];

export function isDenyHost(hostname = '') {
  const h = hostname.toLowerCase();
  return DENY_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

// Two-part public suffixes where the registrable domain needs 3 labels, not 2 (careers.tata.co.in -> tata.co.in,
// not co.in). Not an exhaustive public-suffix list; covers the ccTLD patterns relevant to Indian company domains
// plus the handful of other common ones named in the fix.
const TWO_PART_SUFFIXES = new Set(['co.in', 'org.in', 'net.in', 'ac.in', 'gov.in', 'co.uk', 'com.au', 'com.sg', 'co.jp']);
export function rootOf(host = '') {
  const labels = host.toLowerCase().split('.');
  if (labels.length >= 3) {
    const lastTwo = labels.slice(-2).join('.');
    if (TWO_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  }
  return labels.slice(-2).join('.');
}

export const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
function looksLikeIpLiteral(hostname) {
  // Covers IPv4 literals and any IPv6 literal (WHATWG URL keeps the brackets in .hostname, e.g. "[::1]"; a bare
  // IPv6 hostname always contains ':'). Blocking ALL IP literals is a strict superset of "block private ranges"
  // and sidesteps DNS-rebinding games entirely.
  return IPV4_RE.test(hostname) || hostname.includes(':');
}

export function isSafePublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:') return false;
  // Fix round 2, finding 1: a trailing dot ("localhost.") is a different string but the same FQDN to any
  // resolver, and survives `new URL()` unchanged — strip it before the hostname checks below.
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (looksLikeIpLiteral(host)) return false;
  return true;
}

// --- DNS-resolution-based SSRF guard (fix round 2, finding 1) ---
//
// isSafePublicUrl only looks at the URL string: a hostname like "127.0.0.1.nip.io" or any attacker-controlled
// DNS name string-matches as "public" while actually resolving to a private/loopback/link-local address
// (DNS rebinding also lets a hostname resolve to a public address at check time and a private one at fetch
// time). isPrivateAddress is the pure classifier; fetchPosting below calls it against every address a hostname
// resolves to, on every hop, right before issuing that hop's request.

const IPV4_PRIVATE_RANGES = [
  ['0.0.0.0', 8],        // "this network"
  ['10.0.0.0', 8],        // RFC1918
  ['100.64.0.0', 10],     // CGNAT (RFC6598)
  ['127.0.0.0', 8],        // loopback
  ['169.254.0.0', 16],     // link-local (incl. cloud metadata, 169.254.169.254)
  ['172.16.0.0', 12],      // RFC1918
  ['192.168.0.0', 16],     // RFC1918
  ['224.0.0.0', 4],        // multicast
];

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function inCidr(intIp, baseIp, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (intIp & mask) === (ipv4ToInt(baseIp) & mask);
}

function isPrivateIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparsable -> fail closed
  return IPV4_PRIVATE_RANGES.some(([base, bits]) => inCidr(n, base, bits));
}

export function isPrivateAddress(ip) {
  if (!ip) return true;
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (!net.isIPv6(ip)) return true; // not an IP at all -> fail closed
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]); // IPv4-mapped IPv6
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // link-local, fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // unique-local, fc00::/7
  if (lower.startsWith('ff')) return true; // multicast, ff00::/8
  return false;
}

const FETCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 india-tech-internships-bot (+https://github.com/iitian-vibes/India-Tech-Internships)';
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

async function readCapped(body, maxBytes) {
  if (!body) return '';
  const reader = body.getReader();
  let received = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.length;
      if (received > maxBytes) {
        const keep = value.length - (received - maxBytes);
        if (keep > 0) chunks.push(value.subarray(0, keep));
        try { await reader.cancel(); } catch {}
        break;
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock?.(); } catch {}
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

// The one place that fetches a posting, used by both validate-submission.mjs (at check time) and
// approve-sweep.mjs (re-checked at approval time), fix round 1 finding 6.
//
// Fix round 2, finding 1: a string-only host check (isSafePublicUrl) is necessary but not sufficient — the
// hostname still has to actually resolve, and it's resolved and re-checked separately before EVERY hop
// (including every redirect target), because a redirect can point anywhere and DNS can answer differently
// between hops. `lookup`/`fetchImpl` are injectable so tests never touch the real network/DNS.
export async function fetchPosting(rawUrl, { lookup = dns.promises.lookup, fetchImpl = fetch } = {}) {
  if (!isSafePublicUrl(rawUrl)) return null;
  let current = new URL(rawUrl);
  const seen = new Set();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (seen.has(current.href) || !isSafePublicUrl(current.href)) return null;
    seen.add(current.href);

    let addrs;
    try { addrs = await lookup(current.hostname, { all: true }); } catch { return null; }
    if (!addrs?.length || addrs.some((a) => isPrivateAddress(a.address))) return null;

    let res;
    try {
      res = await fetchImpl(current.href, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': FETCH_USER_AGENT } });
    } catch { return null; }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) return { status: res.status, text: '' };
      try { current = new URL(loc, current); } catch { return null; }
      continue;
    }
    const body = await readCapped(res.body, MAX_BODY_BYTES);
    return { status: res.status, text: htmlToText(body).slice(0, 200000) };
  }
  return null; // too many redirects
}

// --- messages shared with the scripts that call validateSubmission ---

export const RATE_LIMIT_MSG = 'You have more than 5 open submissions; please wait for those to be reviewed.';
export const RATE_LIMIT_UNKNOWN_MSG = 'Could not check your open submissions right now; edit the issue to retry.';
const BAD_CHARS_MSG = 'The link contains characters that are not allowed.';
const AGGREGATOR_DENY_MSG = "Aggregator and user-content links are not accepted; link the company's own posting.";
const AGGREGATOR_GENERIC_MSG = "The link must be on the company's own site or job board (aggregators like Unstop or LinkedIn are not accepted).";

// A raw URL string containing any of these survives `new URL()` (which silently drops/normalises them) but can
// inject extra markdown rows/links into the generated README, fix round 1 finding 1.
const RAW_BAD_CHARS = /[\s|<>"`]/;

function ownSiteMatch(urlHost, careersRoot, slug) {
  if (!careersRoot || !slug) return false;
  if (rootOf(urlHost) !== careersRoot) return false;
  const firstLabel = careersRoot.split('.')[0];
  return firstLabel.includes(slug);
}

function atsPathMatch(url, slug) {
  if (!slug) return false;
  if (!ATS_HOSTS.some((re) => re.test(url.hostname))) return false;
  const segments = url.pathname.toLowerCase().split('/').filter(Boolean);
  return segments.some((seg) => seg.includes(slug));
}

export function validateSubmission({ fields, openByAuthor, existing, page, companies }) {
  const reasons = [];
  const rawUrl = fields.url ?? '';
  const hasBadChars = RAW_BAD_CHARS.test(rawUrl);
  let url = null;
  if (hasBadChars) {
    reasons.push(BAD_CHARS_MSG);
  } else {
    try { url = new URL(rawUrl); } catch { reasons.push('The link is not a valid URL.'); }
  }
  if (url && url.protocol !== 'https:') reasons.push('The link must start with https.');
  if (url) {
    if (isDenyHost(url.hostname)) {
      reasons.push(AGGREGATOR_DENY_MSG);
    } else {
      const slug = slugify(fields.company ?? '').replace(/-/g, '');
      let careersRoot = null;
      try { careersRoot = rootOf(new URL(fields.careers_site).hostname); } catch {}
      const pathA = ownSiteMatch(url.hostname, careersRoot, slug);
      const pathB = atsPathMatch(url, slug);
      if (!pathA && !pathB) reasons.push(AGGREGATOR_GENERIC_MSG);
    }
  }
  if (!fields.company || !fields.role) reasons.push('Company and role are required.');
  if (!isStudentRole(fields.role, '')) reasons.push('This is not an internship or new-grad role.');
  // Task A, item 5: isEngineeringRole also accepts core-engineering branches (mechanical, electrical,
  // civil, aerospace...), not just software/ML/quant, so the prestige list covers every engineering student.
  if (!isEngineeringRole(fields.role)) reasons.push('This is not an engineering role (software, ML, data, quant, mechanical, electrical, core engineering...).');
  if (!page || page.status !== 200) reasons.push('The link does not open a live posting.');
  const text = page?.text ?? '';
  if (hasWorkAuthBlock(text)) reasons.push('The posting requires existing work authorisation in another country.');
  const section = classifyLocation({ locations: [fields.location], remote: /\bremote\b/i.test(fields.location), text }, { abroad_visa: false });
  if (!section) reasons.push('The location is not open to students in India (needs an Indian city, or remote open to India or APAC).');
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (existing.some((r) => r.url === fields.url || (norm(r.company ?? '') === norm(fields.company) && norm(r.role ?? '') === norm(fields.role)))) reasons.push('This role is already on the list.');
  if (openByAuthor == null) reasons.push(RATE_LIMIT_UNKNOWN_MSG);
  else if (openByAuthor > 5) reasons.push(RATE_LIMIT_MSG);
  // Task A, item 5: the prestige list is a curated allowlist, so a submission for a company not already
  // in data/companies.json still runs every other check normally, but is flagged separately — the checks
  // passing doesn't mean it's auto-added; a maintainer decides whether the company itself belongs on the
  // list. Only computed (and only present in the result) when a `companies` list is actually passed in,
  // so every existing caller/test that doesn't pass one keeps the exact old result shape.
  const result = { ok: reasons.length === 0, reasons, section: reasons.length ? null : section };
  if (companies) result.isNewCompany = !companies.some((c) => c.slug === slugify(fields.company ?? ''));
  return result;
}

export function submissionRow(fields, section, issueNumber, author, today) {
  const slug = slugify(fields.company);
  // No matched company record exists for an ad-hoc submission (it may not even be on the allowlist yet —
  // see isNewCompany above), so `field` is classified from the role title alone via fieldOf's company-less
  // fallback, same keyword logic used for bot rows with no allowlist match.
  const field = fieldOf({ role: fields.role }, undefined);
  return { id: `${slug}:submitted:${issueNumber}`, company: fields.company, company_slug: slug, role: fields.role, location: fields.location, section, url: new URL(fields.url).href, posted: today, batch: /^20\d\d$/.test(fields.batch) ? fields.batch : 'Any', stipend: fields.stipend || null, source: 'submitted', first_seen: today, submitted_by: author, field };
}
