import { isStudentRole, isTechRole, classifyLocation, hasWorkAuthBlock } from './filter.mjs';

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

const ATS_HOSTS = [/(^|\.)greenhouse\.io$/, /^jobs\.lever\.co$/, /^jobs\.ashbyhq\.com$/, /\.myworkdayjobs\.com$/, /\.darwinbox\.in$/, /\.keka\.com$/, /\.freshteam\.com$/, /\.zohorecruit\.(com|in)$/, /^careers\.smartrecruiters\.com$/, /\.recruitee\.com$/, /\.teamtailor\.com$/];
const rootOf = (host) => host.split('.').slice(-2).join('.');
export const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function validateSubmission({ fields, openByAuthor, existing, page }) {
  const reasons = [];
  let url;
  try { url = new URL(fields.url); } catch { reasons.push('The link is not a valid URL.'); }
  if (url && url.protocol !== 'https:') reasons.push('The link must start with https.');
  if (url) {
    let careersRoot = null;
    try { careersRoot = rootOf(new URL(fields.careers_site).hostname); } catch {}
    const own = careersRoot && rootOf(url.hostname) === careersRoot;
    if (!own && !ATS_HOSTS.some((re) => re.test(url.hostname))) reasons.push("The link must be on the company's own site or job board (aggregators like Unstop or LinkedIn are not accepted).");
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
  if (openByAuthor > 5) reasons.push('You have more than 5 open submissions; please wait for those to be reviewed.');
  return { ok: reasons.length === 0, reasons, section: reasons.length ? null : section };
}

export function submissionRow(fields, section, issueNumber, author, today) {
  const slug = slugify(fields.company);
  return { id: `${slug}:submitted:${issueNumber}`, company: fields.company, company_slug: slug, role: fields.role, location: fields.location, section, url: fields.url, posted: today, batch: /^20\d\d$/.test(fields.batch) ? fields.batch : 'Any', stipend: fields.stipend || null, source: 'submitted', first_seen: today, submitted_by: author };
}
