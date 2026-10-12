import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIssueForm, validateSubmission, submissionRow, isSafePublicUrl, isDenyHost, RATE_LIMIT_MSG } from '../scripts/submission.mjs';

const body = `### Company\n\nZepto\n\n### Role title (exactly as on the posting)\n\nSDE Intern\n\n### Link to the posting\n\nhttps://jobs.lever.co/zepto/abc\n\n### Location\n\nMumbai\n\n### Stipend (only if the posting says)\n\n_No response_\n\n### Graduation year it is for (optional)\n\n2027\n\n### Company careers site\n\nhttps://www.zeptonow.com/careers`;
const fields = parseIssueForm(body);
const okPage = { status: 200, text: 'Zepto is hiring an SDE Intern in Mumbai. Students graduating in 2027.' };

test('parseIssueForm reads every field and treats _No response_ as empty', () => {
  assert.deepEqual(fields, { company: 'Zepto', role: 'SDE Intern', url: 'https://jobs.lever.co/zepto/abc', location: 'Mumbai', stipend: '', batch: '2027', careers_site: 'https://www.zeptonow.com/careers' });
});

test('a good submission passes', () => {
  const r = validateSubmission({ fields, openByAuthor: 1, existing: [], page: okPage });
  assert.deepEqual(r, { ok: true, reasons: [], section: 'india' });
});

test('each bad case is rejected with a readable reason', () => {
  const cases = [
    [{ page: { status: 404, text: '' } }, /link does not open a live posting/],
    [{ fields: { ...fields, role: 'Senior SDE' } }, /not an internship or new-grad role/],
    [{ fields: { ...fields, role: 'Marketing Intern' } }, /not a tech role/],
    [{ page: { status: 200, text: 'SDE Intern. Must be authorized to work in the United States.' } }, /requires existing work authorisation/],
    [{ existing: [{ url: 'https://jobs.lever.co/zepto/abc' }] }, /already on the list/],
    [{ fields: { ...fields, url: 'https://unstop.com/x', careers_site: 'https://unstop.com' } }, /Aggregator and user-content links are not accepted/],
    [{ fields: { ...fields, location: 'Austin, TX' }, page: { status: 200, text: 'SDE Intern in Austin' } }, /not open to students in India/],
    [{ openByAuthor: 6 }, /more than 5 open submissions/],
    [{ openByAuthor: null }, /Could not check your open submissions right now/],
    [{ fields: { ...fields, url: 'http://jobs.lever.co/zepto/abc' } }, /https/],
    // Fix round 1, finding 1: raw URL injection (embedded newline + pipe survive `new URL()`, which silently drops them)
    [{ fields: { ...fields, url: 'https://jobs.lever.co/zepto/abc\n| x | y |\n[Win](https://phish.example)' } }, /characters that are not allowed/],
    // Fix round 1, finding 2: careers_site is attacker-controlled, so a known aggregator/user-content host must be
    // rejected even when the submitter sets careers_site to the same aggregator (defeating the naive "own site" check).
    [{ fields: { ...fields, url: 'https://gist.githubusercontent.com/someone/raw/x', careers_site: 'https://gist.githubusercontent.com' } }, /Aggregator and user-content links are not accepted/],
    // Fix round 1, finding 2: two-part public-suffix root comparison (careers.tata.co.in vs phish.co.in must not collide on ".co.in")
    [{ fields: { ...fields, company: 'Tata', url: 'https://phish.co.in/job', careers_site: 'https://careers.tata.co.in' } }, /company's own site or job board/],
  ];
  for (const [over, re] of cases) {
    const r = validateSubmission({ fields, openByAuthor: 1, existing: [], page: okPage, ...over });
    assert.equal(r.ok, false, String(re));
    assert.ok(r.reasons.some((x) => re.test(x)), `${re} not in ${JSON.stringify(r.reasons)}`);
  }
});

test('a normal URL round-trips unchanged through the raw-character check', () => {
  const r = validateSubmission({ fields, openByAuthor: 1, existing: [], page: okPage });
  assert.equal(r.ok, true);
});

test('fix round 1, finding 2: own-site acceptance paths', () => {
  // Path A: own-site root match + company slug (hyphens stripped) found in the root's first label.
  const a = validateSubmission({
    fields: { ...fields, company: 'Zepto', url: 'https://careers.zeptonow.com/job/1', careers_site: 'https://zeptonow.com' },
    openByAuthor: 1, existing: [], page: okPage,
  });
  assert.equal(a.ok, true, JSON.stringify(a.reasons));

  // Path B: known ATS host + company slug present as a path segment (careers_site irrelevant/absent).
  const b = validateSubmission({
    fields: { ...fields, company: 'Zepto', url: 'https://jobs.lever.co/zepto/abc', careers_site: '' },
    openByAuthor: 1, existing: [], page: okPage,
  });
  assert.equal(b.ok, true, JSON.stringify(b.reasons));
});

test('fix round 1, finding 8: rate-limit check fails closed, not open, when the API call failed', () => {
  const r = validateSubmission({ fields, openByAuthor: null, existing: [], page: okPage });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.includes('Could not check your open submissions right now; edit the issue to retry.'));
});

test('fix round 1, finding 8: the rate-limit reason is exported so callers can special-case closing the issue', () => {
  const r = validateSubmission({ fields, openByAuthor: 6, existing: [], page: okPage });
  assert.ok(r.reasons.includes(RATE_LIMIT_MSG));
});

test('isDenyHost matches the host and any subdomain, not unrelated hosts', () => {
  assert.equal(isDenyHost('unstop.com'), true);
  assert.equal(isDenyHost('www.unstop.com'), true);
  assert.equal(isDenyHost('gist.github.com'), true);
  assert.equal(isDenyHost('githubusercontent.com'), true);
  assert.equal(isDenyHost('Arun-Raghav-S.github.io'), true);
  assert.equal(isDenyHost('careers.zeptonow.com'), false);
  assert.equal(isDenyHost('notunstop.com'), false);
});

test('fix round 1, finding 6: isSafePublicUrl rejects non-https, IP literals, and localhost', () => {
  const bad = [
    'http://example.com/x',
    'https://localhost/x',
    'https://foo.localhost/x',
    'https://10.0.0.5/x',
    'https://172.16.0.1/x',
    'https://172.31.255.255/x',
    'https://192.168.1.1/x',
    'https://169.254.169.254/x',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'not a url at all',
  ];
  for (const u of bad) assert.equal(isSafePublicUrl(u), false, u);
  const good = ['https://example.com/x', 'https://jobs.lever.co/zepto/abc', 'https://careers.zeptonow.com/job/1?x=1'];
  for (const u of good) assert.equal(isSafePublicUrl(u), true, u);
});

test('submissionRow credits the author and uses a stable id', () => {
  const r = submissionRow(fields, 'india', 42, 'student1', '2026-10-12');
  assert.equal(r.id, 'zepto:submitted:42');
  assert.equal(r.submitted_by, 'student1');
  assert.equal(r.source, 'submitted');
  assert.equal(r.stipend, null);
});

test('fix round 1, finding 1: submissionRow stores the normalised URL.href (a normal URL is unchanged)', () => {
  const r = submissionRow(fields, 'india', 42, 'student1', '2026-10-12');
  assert.equal(r.url, new URL(fields.url).href);
  assert.equal(r.url, 'https://jobs.lever.co/zepto/abc');
});
