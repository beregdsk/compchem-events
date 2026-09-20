# Curation policy

This page is published on the site at `/policy/`. It explains what we list, what we don't, and how listings are checked. Keep it plain and factual.

## What we list

Events whose main subject is computational or theoretical chemistry, including electronic structure, molecular and materials simulation, ML for chemistry and materials, cheminformatics and computational drug design. Accepted formats are conferences, workshops, schools, symposia, hackathons and webinar series.

Broader meetings (for example a general chemistry congress) are listed only if they have a clearly identified computational or theoretical programme, and the listing should point to that programme where possible.

## Inclusion criteria

An event needs all of the following:

1. **An official page** with a named organiser, dates, and a location or online format.
2. **A named organising body or committee** that a reader can identify (a university, institute, society, network or company).
3. **A scientific programme**: named invited speakers, a topical scope, or a published call for abstracts.
4. **Transparent costs**: fees, if any, are stated or clearly obtainable.

## Reasons we decline or remove a listing

No single item is decisive; use judgement and record the reasons.

- The organiser is on `data/blocklist.yaml` (see below).
- Very broad, unrelated scope ("all of science and engineering") with computational chemistry as one tag among dozens.
- No identifiable committee, or a committee with no verifiable affiliations.
- Unsolicited invitation-style promotion, guaranteed acceptance of all abstracts, or pressure to pay quickly.
- Journal or proceedings claims that cannot be verified, or misuse of indexing names.
- Repeated city and date combinations across unrelated series by the same organiser.
- The event page is missing, unreachable, or contradicts the listing.

## Blocklist

`data/blocklist.yaml` lists organiser domains that are not listed. Each entry has the domain, the date added, and at least one **public evidence link** (for example a recognised checklist, a published report, or documented complaints). Entries require maintainer approval in a PR. We describe conduct and evidence, not motives. Anyone can request a review by opening an issue.

## Verification

- Every listing carries a `last_verified` date. It means a person or the discovery agent's reviewer compared the listing with the organiser's official page on that date.
- Events not verified within 90 days before they start are shown with a note asking readers to check the official page.
- Weekly link checks flag dead pages. Dead links are investigated by a maintainer, not deleted automatically.
- Automatically discovered events are never published without human review.

## Neutrality

- Ordering is by date or deadline only. No paid placement affects ordering or inclusion.
- If sponsorship or paid listings are ever added, they must be labelled as such and kept visually separate. This is a policy change and needs a public discussion first.

## Corrections and reports

- Every event page has a "Suggest a correction" link (public GitHub issue) and a "Report this event" link (private form).
- Reports are read by maintainers only. We do not publish reporter identities or report contents.
- A single report does not remove an event. Maintainers check the evidence and record the outcome in the PR or issue that changes the listing.
- Organisers can ask for corrections to their own listing at any time.

## Copyright and text reuse

Descriptions are written in our own words. We link to official pages instead of copying their text, logos or images.

## Disputes

If an organiser or contributor disagrees with a decision, they can open an issue. A second maintainer reviews it where possible, and the outcome is recorded publicly (without private report details).
