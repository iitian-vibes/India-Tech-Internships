import { readFileSync } from 'node:fs';
import { parseIssueForm, validateSubmission } from './submission.mjs';
import { htmlToText } from './fetch/util.mjs';

const { ISSUE_BODY = '', ISSUE_NUMBER, ISSUE_AUTHOR, GITHUB_REPOSITORY, GH_TOKEN } = process.env;
const api = (path, init = {}) => fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, { ...init, headers: { Authorization: `Bearer ${GH_TOKEN}`, Accept: 'application/vnd.github+json', ...(init.headers ?? {}) } });

const fields = parseIssueForm(ISSUE_BODY);
let page = null;
try {
  const res = await fetch(fields.url, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 india-tech-internships-bot' } });
  page = { status: res.status, text: htmlToText(await res.text()).slice(0, 200000) };
} catch { page = null; }

const open = await (await api(`/issues?state=open&labels=submission&creator=${encodeURIComponent(ISSUE_AUTHOR)}&per_page=100`)).json();
const existing = [...JSON.parse(readFileSync('data/internships.json', 'utf8')), ...JSON.parse(readFileSync('data/submitted.json', 'utf8'))];
const r = validateSubmission({ fields, openByAuthor: Array.isArray(open) ? open.length : 0, existing, page });

const body = r.ok
  ? `✅ Automatic checks passed (section: ${r.section}). Next we verify the role on the company's page; you'll see a note here, then it goes on the list. Thanks @${ISSUE_AUTHOR}!`
  : `❌ This can't be added yet:\n\n${r.reasons.map((x) => `- ${x}`).join('\n')}\n\nEdit the issue to fix it and the checks run again.`;

await api(`/issues/${ISSUE_NUMBER}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
await api(`/issues/${ISSUE_NUMBER}/labels`, { method: 'PUT', body: JSON.stringify({ labels: ['submission', r.ok ? 'checks-passed' : 'needs-fix'] }) });
