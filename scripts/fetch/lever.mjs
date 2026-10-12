import { fetchJson, iso } from './util.mjs';
export function parseLever(json, company) {
  if (!Array.isArray(json)) return [];
  return json.map((j) => {
    const c = j.categories ?? {};
    const locations = c.allLocations?.length ? c.allLocations : (c.location ? [c.location] : []);
    return { jobId: String(j.id), title: String(j.text ?? '').trim(), locations, remote: j.workplaceType === 'remote', url: j.hostedUrl, posted: iso(j.createdAt), text: [j.descriptionPlain, j.additionalPlain].filter(Boolean).join('\n').trim(), employmentType: c.commitment ?? '', stipendHint: null };
  });
}
export async function fetchLever(company) {
  return parseLever(await fetchJson(`https://api.lever.co/v0/postings/${company.board}?mode=json`), company);
}
