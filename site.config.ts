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
  /** Where the Donate page sends people. */
  donateUrl: string;
}

export const site: SiteConfig = {
  name: 'CompChem Observer',
  tagline: 'Conferences, workshops and schools in computational chemistry',
  url: 'https://compchem.observer',
  contactEmail: 'contacts@compchem.observer',
  repoUrl: 'https://github.com/beregdsk/compchem-observer',
  reportForm: {
    url: 'https://tally.so/r/ODvo7M',
    eventIdParam: 'event_id',
    eventUrlParam: 'event_url',
  },
  submissionFormUrl: 'https://tally.so/r/RGpV04',
  donateUrl: 'https://www.donationalerts.com/r/beregdsk',
};

/** Host portion of the production URL, used for iCalendar UIDs. */
export const siteDomain = new URL(site.url).host;
