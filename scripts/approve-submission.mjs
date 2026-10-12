import { readFileSync, writeFileSync } from 'node:fs';
import { parseIssueForm, validateSubmission, submissionRow } from './submission.mjs';
import { htmlToText } from './fetch/util.mjs';

const { ISSUE_BODY = '', ISSUE_NUMBER, ISSUE_AUTHOR } = process.env;
const fields = parseIssueForm(ISSUE_BODY);
let page = null;
try {
  const res = await fetch(fields.url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  page = { status: res.status, text: htmlToText(await res.text()) };
} catch {}

const submitted = JSON.parse(readFileSync('data/submitted.json', 'utf8'));
const existing = [...JSON.parse(readFileSync('data/internships.json', 'utf8')), ...submitted];
const r = validateSubmission({ fields, openByAuthor: 0, existing, page });
if (!r.ok) { console.error(`Re-check failed at approval: ${r.reasons.join(' ')}`); process.exit(1); }

const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
submitted.push(submissionRow(fields, r.section, Number(ISSUE_NUMBER), ISSUE_AUTHOR, today));
writeFileSync('data/submitted.json', JSON.stringify(submitted, null, 2) + '\n');
