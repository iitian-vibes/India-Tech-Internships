import { fetchJson, htmlToText } from './util.mjs';
const day = (now, back) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); d.setUTCDate(d.getUTCDate() - back); return d.toISOString(); };
export function parsePostedOn(s, now = new Date()) {
  if (!s) return null;
  if (/today/i.test(s)) return day(now, 0);
  if (/yesterday/i.test(s)) return day(now, 1);
  if (/\+/.test(s)) return null;
  const m = s.match(/(\d+)\s+days?\s+ago/i);
  return m ? day(now, Number(m[1])) : null;
}
export function parseWorkdayList(json, company, now = new Date()) {
  const { host, site } = company.workday;
  return (json?.jobPostings ?? []).map((p) => ({
    jobId: String(p.bulletFields?.[0] ?? p.externalPath), title: String(p.title ?? '').trim(),
    locations: p.locationsText ? [p.locationsText] : [], remote: /\bremote\b/i.test(p.locationsText ?? ''),
    url: `https://${host}/en-US/${site}${p.externalPath}`, posted: parsePostedOn(p.postedOn, now),
    text: '', employmentType: '', stipendHint: null,
  }));
}
export async function fetchWorkday(company, { wantDetail = () => true, now = new Date() } = {}) {
  const { host, tenant, site } = company.workday;
  const base = `https://${host}/wday/cxs/${tenant}/${site}`;
  const out = [];
  for (let offset = 0; offset < 200; offset += 20) {
    const page = await fetchJson(`${base}/jobs`, { method: 'POST', body: { appliedFacets: {}, limit: 20, offset, searchText: 'intern' } });
    const jobs = parseWorkdayList(page, company, now);
    out.push(...jobs);
    if (jobs.length < 20 || offset + 20 >= (page.total ?? 0)) break;
  }
  for (const j of out) {
    if (!wantDetail(j.title)) continue;
    const path = j.url.split(`/${site}`)[1];
    try { j.text = htmlToText((await fetchJson(`${base}${path}`)).jobPostingInfo?.jobDescription ?? ''); } catch { j.text = ''; }
  }
  return out;
}
