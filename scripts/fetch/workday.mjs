import { fetchJson, htmlToText } from './util.mjs';
import { classifyLocation } from '../filter.mjs';
const day = (now, back) => {
  // Convert UTC now to IST (add 5.5 hours)
  const istNow = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  // Get IST calendar date
  const istYear = istNow.getUTCFullYear();
  const istMonth = istNow.getUTCMonth();
  const istDate = istNow.getUTCDate();
  // Create UTC midnight for this IST date
  let d = new Date(Date.UTC(istYear, istMonth, istDate));
  // Subtract the requested days
  d.setUTCDate(d.getUTCDate() - back);
  // Subtract 5.5 hours to convert IST midnight to UTC
  d.setTime(d.getTime() - 5.5 * 60 * 60 * 1000);
  return d.toISOString();
};
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
  return (json?.jobPostings ?? []).map((p) => {
    const result = {
      jobId: String(p.bulletFields?.[0] ?? p.externalPath), title: String(p.title ?? '').trim(),
      locations: p.locationsText ? [p.locationsText] : [], remote: /\bremote\b/i.test(p.locationsText ?? ''),
      url: `https://${host}/en-US/${site}${p.externalPath}`, posted: parsePostedOn(p.postedOn, now),
      text: '', employmentType: '', stipendHint: null,
    };
    // Store externalPath as non-enumerable property for detail fetching
    Object.defineProperty(result, 'externalPath', { value: p.externalPath, enumerable: false });
    return result;
  });
}
export async function fetchWorkday(company, { wantDetail = () => true, now = new Date(), fetchJsonImpl = fetchJson } = {}) {
  const { host, tenant, site } = company.workday;
  const base = `https://${host}/wday/cxs/${tenant}/${site}`;
  const out = [];
  for (let offset = 0; offset < 200; offset += 20) {
    const page = await fetchJsonImpl(`${base}/jobs`, { method: 'POST', body: { appliedFacets: {}, limit: 20, offset, searchText: 'intern' } });
    const jobs = parseWorkdayList(page, company, now);
    out.push(...jobs);
    // Break when page is short (less than 20 results)
    if (jobs.length < 20) break;
    // Break if total is known and we've reached it
    if (page.total && offset + 20 >= page.total) break;
  }
  // Check if we hit the 200-job cap (loop exited normally)
  if (out.length >= 200) {
    console.warn(`workday ${company.slug}: capped at 200 results`);
  }
  for (const j of out) {
    if (!wantDetail(j.title)) continue;
    // A posting whose location can't classify into any section gets dropped by toRow()
    // regardless of its text, so detail-fetching it one-by-one is pure waste. This is what
    // made NVIDIA (83s) and Intel (45s) blow past build-core's 60s per-company timeout: both
    // post hundreds of "intern"-titled roles worldwide, and only a handful are India/Remote.
    if (!classifyLocation(j, company)) continue;
    const path = j.externalPath;
    try { j.text = htmlToText((await fetchJsonImpl(`${base}${path}`)).jobPostingInfo?.jobDescription ?? ''); } catch { j.text = ''; }
  }
  return out;
}
