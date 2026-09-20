export interface ReportFormConfig {
  /** Base URL of the external report form. */
  url: string;
  /** Query-parameter name that carries the event id. */
  eventIdParam: string;
  /** Query-parameter name that carries the event page URL. */
  eventUrlParam: string;
}

export interface SiteConfig {
  name: string;
  tagline: string;
  /** Production origin, no trailing slash. Used for canonical URLs and iCalendar UIDs. */
  url: string;
  contactEmail: string;
  repoUrl: string;
  reportForm: ReportFormConfig;
  submissionFormUrl: string;
}

export const site: SiteConfig = {
  name: 'CompChem Events',
  tagline: 'Conferences, workshops and schools in computational chemistry',
  url: 'https://placeholder.example',
  contactEmail: 'placeholder@example.org',
  repoUrl: 'https://github.com/PLACEHOLDER-OWNER/PLACEHOLDER-REPO',
  reportForm: {
    url: 'https://placeholder.example/report',
    eventIdParam: 'event_id',
    eventUrlParam: 'event_url',
  },
  submissionFormUrl: 'https://placeholder.example/submit',
};

/** Host portion of the production URL, used for iCalendar UIDs. */
export const siteDomain = new URL(site.url).host;
