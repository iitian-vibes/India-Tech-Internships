# Contributing

Found a tech internship or new-grad role that is not on the list yet? Submit it, you will be credited by name on the issue once it is added.

## What qualifies

A role goes on the list only if all four of these are true:

1. **It is a live posting on the company's own site.** The link has to be the company's own careers page or a job board it owns (Greenhouse, Lever, Ashby, Workday, Darwinbox, Keka, Freshteam, Zoho Recruit, SmartRecruiters, Recruitee, Teamtailor). Aggregators and listing sites (Unstop, LinkedIn, Internshala and similar) are not accepted, because the list has to be independently verifiable against the source, and the posting has to actually exist at that URL right now.
2. **It is an internship or new-grad tech role.** Software, ML, data, quant, hardware, security, DevOps and similar. Senior, staff, lead and PhD-only roles do not qualify, and neither do non-tech internships (HR, marketing, sales, design, content).
3. **It does not require existing work authorisation somewhere else.** If the posting says you must already be authorised to work in the US, UK, EU, Canada or Australia, or that it needs security clearance, it is not something a student in India can apply to.
4. **It is open to students in India.** Based in an Indian city, or remote and explicitly open to India or APAC. A role based only abroad with no visa sponsorship does not qualify.

If a posting is ambiguous on any of these (for example, the location is unclear, or it is not obvious whether it is an internship), it is left out rather than guessed. Submit it again once the posting is clearer.

### Example that would be accepted

Company: Zepto. Role: SDE Intern. Link: `https://jobs.lever.co/zepto/abc`. Location: Mumbai. This is a tech internship, on the company's own job board, with no work authorisation requirement, open to students in Mumbai.

### Example that would be rejected

Company: Zepto. Role: SDE Intern. Link: `https://unstop.com/internship/sde-intern-zepto`. Same role, but the link is to an aggregator rather than Zepto's own posting, so it is rejected with "Aggregator and user-content links are not accepted; link the company's own posting." Resubmit with the direct Lever/Greenhouse/Ashby/company link instead.

## How to submit

Open an issue using the [submission form](https://github.com/iitian-vibes/India-Tech-Internships-2027/issues/new?template=submit-internship.yml). Fill in the company, the exact role title, the direct link to the posting, the location, and the company's careers site. Stipend and graduation year are optional, fill them in only if the posting states them.

## What happens next

1. A bot checks the link within a few minutes of you opening or editing the issue, and replies on the issue with either "checks passed" or the specific reason it did not pass.
2. If the automatic checks pass, a maintainer verifies the role by hand against the company's own page.
3. Once verified and approved, a bot adds it to `data/submitted.json`, regenerates the README, and closes the issue with a thank-you crediting your GitHub username.

You can have at most 5 open submissions at a time; a 6th will close itself automatically so it does not sit as an open issue. Repeated spam submissions get the account blocked by the maintainer.

## Code contributions

Changes to the code (scripts, workflows, templates) go through a pull request against `main`, reviewed by [@Arun-Raghav-S](https://github.com/Arun-Raghav-S), and merged with squash merge only (the repo has merge commits and rebase merging turned off). `README.md` is generated from the data files and scripts, never edit it by hand, your changes will be overwritten on the next run.

### Maintainer note: labels

If the repo's labels (`submission`, `checks-passed`, `needs-fix`, `verified`, `approved`, `health`) are ever missing or deleted, re-create them with `./scripts/setup-labels.sh` (idempotent, safe to re-run).

By contributing data, you agree it is licensed under CC BY 4.0. By contributing code, you agree it is licensed under MIT, matching the rest of the repository.
