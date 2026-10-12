import { fetchJson, iso } from './util.mjs';
export function parseAshby(json, company) {
  return (json?.jobs ?? []).filter((j) => j.isListed !== false).map((j) => ({
    jobId: String(j.id), title: String(j.title ?? '').trim(),
    locations: [j.location, ...(j.secondaryLocations ?? []).map((s) => s.location)].filter(Boolean),
    remote: Boolean(j.isRemote) || j.workplaceType === 'Remote', url: j.jobUrl, posted: iso(j.publishedAt),
    text: String(j.descriptionPlain ?? '').trim(), employmentType: j.employmentType ?? '',
    stipendHint: j.compensation?.compensationTierSummary ?? j.compensation?.scrapeableCompensationSalarySummary ?? null,
  }));
}
export async function fetchAshby(company) {
  return parseAshby(await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${company.board}?includeCompensation=true`), company);
}
