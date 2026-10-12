import { isStudentRole, isTechRole, classifyLocation, hasWorkAuthBlock } from './filter.mjs';
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
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return false;
  if (looksLikeIpLiteral(host)) return false;
  return true;
}

const FETCH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 india-tech-internships-bot (+https://github.com/iitian-vibes/India-Tech-Internships-2027)';
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
export async function fetchPosting(rawUrl) {
  if (!isSafePublicUrl(rawUrl)) return null;
  let current = new URL(rawUrl);
  const seen = new Set();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (seen.has(current.href) || !isSafePublicUrl(current.href)) return null;
    seen.add(current.href);
    let res;
    try {
      res = await fetch(current.href, { redirect: 'manual', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': FETCH_USER_AGENT } });
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

export function validateSubmission({ fields, openByAuthor, existing, page }) {
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
  if (!isTechRole(fields.role)) reasons.push('This is not a tech role (software, ML, data, quant, hardware...).');
  if (!page || page.status !== 200) reasons.push('The link does not open a live posting.');
  const text = page?.text ?? '';
  if (hasWorkAuthBlock(text)) reasons.push('The posting requires existing work authorisation in another country.');
  const section = classifyLocation({ locations: [fields.location], remote: /\bremote\b/i.test(fields.location), text }, { abroad_visa: false });
  if (!section) reasons.push('The location is not open to students in India (needs an Indian city, or remote open to India or APAC).');
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (existing.some((r) => r.url === fields.url || (norm(r.company ?? '') === norm(fields.company) && norm(r.role ?? '') === norm(fields.role)))) reasons.push('This role is already on the list.');
  if (openByAuthor == null) reasons.push(RATE_LIMIT_UNKNOWN_MSG);
  else if (openByAuthor > 5) reasons.push(RATE_LIMIT_MSG);
  return { ok: reasons.length === 0, reasons, section: reasons.length ? null : section };
}

export function submissionRow(fields, section, issueNumber, author, today) {
  const slug = slugify(fields.company);
  return { id: `${slug}:submitted:${issueNumber}`, company: fields.company, company_slug: slug, role: fields.role, location: fields.location, section, url: new URL(fields.url).href, posted: today, batch: /^20\d\d$/.test(fields.batch) ? fields.batch : 'Any', stipend: fields.stipend || null, source: 'submitted', first_seen: today, submitted_by: author };
}
