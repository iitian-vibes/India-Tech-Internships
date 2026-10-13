import { fetchJson, htmlToText, iso } from './util.mjs';
import { isStudentRole, isEngineeringRole } from '../filter.mjs';

export function parseSmartRecruiters(json, company) {
  return (json?.content ?? []).map((p) => {
    const loc = p.location ?? {};
    return {
      jobId: String(p.id),
      title: String(p.name ?? '').trim(),
      locations: [loc.city, loc.region ?? loc.country].filter(Boolean),
      remote: loc.remote === true,
      url: `https://jobs.smartrecruiters.com/${company.board}/${p.id}`,
      posted: iso(p.releasedDate),
      text: '',
      employmentType: p.typeOfEmployment?.label ?? '',
      stipendHint: null,
    };
  });
}

export async function fetchSmartRecruiters(company) {
  const base = `https://api.smartrecruiters.com/v1/companies/${company.board}/postings`;
  const out = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await fetchJson(`${base}?limit=100&offset=${offset}`);
    const jobs = parseSmartRecruiters(page, company);
    out.push(...jobs);
    if (jobs.length === 0) break;
    if (offset + 100 >= (page.totalFound ?? 0)) break;
  }
  if (out.length >= 1000) {
    console.warn(`smartrecruiters ${company.slug}: capped at 1000 results`);
  }
  for (const j of out) {
    // Fix round 2, item 3: was isTechRole, which skipped the detail fetch (body text + work-auth check)
    // for every core-engineering title (mechanical, electrical, civil...) since they don't match isTechRole.
    if (!(isStudentRole(j.title) && isEngineeringRole(j.title))) continue;
    try {
      const detail = await fetchJson(`${base}/${j.jobId}`);
      const sections = detail?.jobAd?.sections ?? {};
      j.text = htmlToText(Object.values(sections).map((s) => s?.text ?? '').join('\n'));
    } catch { j.text = ''; }
  }
  return out;
}
