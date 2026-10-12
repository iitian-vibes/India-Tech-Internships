import { readFileSync } from 'node:fs';
import { parseIssueForm, validateSubmission, fetchPosting, RATE_LIMIT_MSG } from './submission.mjs';

const { ISSUE_BODY = '', ISSUE_NUMBER, ISSUE_AUTHOR, GITHUB_REPOSITORY, GH_TOKEN } = process.env;
const api = (path, init = {}) => fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, { ...init, headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', ...(init.headers ?? {}) } });

const fields = parseIssueForm(ISSUE_BODY);
const page = await fetchPosting(fields.url);

// Fix round 1, finding 8: the rate-limit check must fail CLOSED (treated as a rejection), not open (treated as
// "no open submissions"), when the API call to count the author's open submissions itself fails.
let openByAuthor = null;
try {
  const res = await api(`/issues?state=open&labels=submission&creator=${encodeURIComponent(ISSUE_AUTHOR)}&per_page=100`);
  if (res.ok) {
    const open = await res.json();
    if (Array.isArray(open)) openByAuthor = open.length;
  }
} catch { /* openByAuthor stays null */ }

const existing = [...JSON.parse(readFileSync('data/internships.json', 'utf8')), ...JSON.parse(readFileSync('data/submitted.json', 'utf8'))];
const r = validateSubmission({ fields, openByAuthor, existing, page });

const body = r.ok
  ? `✅ Automatic checks passed (section: ${r.section}). Next we verify the role on the company's page; you'll see a note here, then it goes on the list. Thanks @${ISSUE_AUTHOR}!`
  : `❌ This can't be added yet:\n\n${r.reasons.map((x) => `- ${x}`).join('\n')}\n\nEdit the issue to fix it and the checks run again.`;

await api(`/issues/${ISSUE_NUMBER}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
await api(`/issues/${ISSUE_NUMBER}/labels`, { method: 'PUT', body: JSON.stringify({ labels: ['submission', r.ok ? 'checks-passed' : 'needs-fix'] }) });

// Spam gate (spec 5.3): over 5 open submissions from one author closes the issue outright rather than leaving
// it open for them to keep editing/retrying.
if (!r.ok && r.reasons.includes(RATE_LIMIT_MSG)) {
  await api(`/issues/${ISSUE_NUMBER}`, { method: 'PATCH', body: JSON.stringify({ state: 'closed', state_reason: 'not_planned' }) });
}
