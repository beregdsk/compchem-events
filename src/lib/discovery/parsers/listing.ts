import { daysBetween, type ISODate } from '../../dates';
import { STALE_AFTER_DAYS } from '../../positions';
import { extractLinks, parseHTML } from '../html';

/**
 * Site chrome: navigation, header, footer and sidebar links repeat on every
 * page and are never an event. Seen live on every listing source — EuChemS
 * and ECS menus alone sent dozens of award, membership and journal pages to
 * the fetcher per run, using up the per-source page cap before the actual
 * event links were reached.
 */
const CHROME_SELECTOR = [
  'nav',
  'header',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="menu"]',
  '[role="menubar"]',
].join(', ');

/**
 * Chrome containers named by a class token or id where the page doesn't
 * use semantic elements. Whole tokens only — BEM names such as
 * `tribe-events-calendar-list__event-header` wrap real event links.
 */
const CHROME_TOKENS = new Set([
  'nav',
  'navbar',
  'navigation',
  'menu',
  'main-menu',
  'sub-menu',
  'sidebar',
  'sidenav',
  'sidenavbar',
  'breadcrumb',
  'breadcrumbs',
  'header',
  'site-header',
  'footer',
  'site-footer',
]);

function isChromeContainer(el: Element): boolean {
  const tokens = [...(el.getAttribute('class') ?? '').split(/\s+/), el.id ?? ''];
  return tokens.some((t) => CHROME_TOKENS.has(t.toLowerCase()));
}

export function inChrome(a: Element): boolean {
  if (a.closest(CHROME_SELECTOR)) return true;
  for (let el = a.parentElement; el && el.tagName !== 'BODY'; el = el.parentElement) {
    if (isChromeContainer(el)) return true;
  }
  return false;
}

/** Downloads, not pages the extractor can read. */
const FILE_EXTENSION =
  /\.(?:pdf|docx?|xlsx?|pptx?|odt|zip|gz|jpe?g|png|gif|svg|webp|mp[34]|mov|ics|xml|rss|css|js)$/i;

/**
 * Path segments that name a site page, never an event. Matched as whole
 * segments, so `/events/contact-chemistry-2027/` is kept.
 */
const NON_EVENT_SEGMENT = new Set([
  'about',
  'about-us',
  'archiv',
  'accessibility',
  'account',
  'author',
  'awards',
  'careers',
  'category',
  'contact',
  'contact-us',
  'cookie-policy',
  'cookies',
  'donate',
  'feed',
  'governance',
  'impressum',
  'kategorie',
  'jobs',
  'login',
  'logout',
  'members',
  'membership',
  'newsletter',
  'newsletters',
  'people',
  'podcasts',
  'press',
  'privacy',
  'privacy-policy',
  'privacy-statement',
  'publications',
  'search',
  'site-map',
  'sitemap',
  'staff',
  'tag',
  'videos',
  'wp-admin',
  'wp-content',
  'wp-json',
  'wp-login.php',
]);

/** Query parameters that only track or carry a session; stripped so one page isn't fetched twice. */
const TRACKING_PARAM = /^(?:phpsessid|jsessionid|sid|utm_.*|fbclid|gclid)$/i;

function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/**
 * True for a link worth fetching as a possible event page from the listing
 * at `listing`. Rejects files, site pages named in `NON_EVENT_SEGMENT`,
 * anything about past events, and the listing itself or any page above it
 * (its site root, section index, or a filtered/paginated view of itself).
 */
function looksLikeEventPage(url: URL, listing: URL, allowSegments: ReadonlySet<string>): boolean {
  if (FILE_EXTENSION.test(url.pathname)) return false;
  const segments = url.pathname.toLowerCase().split('/').filter(Boolean);
  if (
    segments.some(
      (s) => (NON_EVENT_SEGMENT.has(s) && !allowSegments.has(s)) || /(?:^|-)past(?:-|$)/.test(s),
    )
  )
    return false;
  if (/past/i.test(url.search)) return false;
  // Another page of a paginated listing (WordPress-style /page/2/), not an
  // event — followed separately, via findNextListingPage.
  if (segments.some((s, i) => s === 'page' && /^\d+$/.test(segments[i + 1] ?? ''))) return false;
  const path = withoutTrailingSlash(url.pathname);
  const listingPath = withoutTrailingSlash(listing.pathname);
  return !(path === '/' || path === listingPath || listingPath.startsWith(`${path}/`));
}

/**
 * The listing's next page, when it marks one with `rel="next"` (on an
 * `<a>` or `<link>`), same host only. Sites that post an event months
 * ahead push it off page 1 long before it happens — cheminform.ru's
 * conference category had in-field events on page 3.
 */
export function findNextListingPage(html: string, listingUrl: string): string | undefined {
  const base = new URL(listingUrl);
  const href = parseHTML(html)
    .querySelector('a[rel~="next"][href], link[rel~="next"][href]')
    ?.getAttribute('href');
  if (!href) return undefined;
  try {
    const next = new URL(href, base);
    next.hash = '';
    if (next.host !== base.host || next.href === base.href) return undefined;
    return next.href;
  } catch {
    return undefined;
  }
}

/**
 * Same-host links from a listing page that plausibly lead to one event:
 * site chrome, downloads, site pages and self/ancestor links are dropped,
 * and tracking parameters stripped. Deliberately structural only — no
 * topic keywords — since a missed event is worse than a wasted fetch, and
 * every fetched page still passes the pipeline's relevance pre-filter.
 * `allowSegments` exempts named site-page segments (a job board's own
 * `/jobs/` path, say) from the site-page filter.
 */
export function findEventPageLinks(
  html: string,
  listingUrl: string,
  allowSegments: ReadonlySet<string> = new Set(),
): string[] {
  const listing = new URL(listingUrl);
  const links = new Set<string>();
  for (const link of extractLinks(parseHTML(html), listingUrl, inChrome)) {
    const url = new URL(link);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    if (looksLikeEventPage(url, listing, allowSegments)) links.add(url.toString());
  }
  return [...links];
}

/** `26.09.23 Computational Chemistry Postdoc` — CCL's yy.mm.dd prefix. */
const LEADING_DATE = /^\s*(\d{2})\.(\d{2})\.(\d{2})\b/;

function isRealISODate(d: string): boolean {
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

/**
 * Advert links on a job listing: the same structural filter as event
 * listings, minus any whose link text starts with a yy.mm.dd date older
 * than the positions page's stale threshold — an old advert must not be
 * proposed as new with today's `added`. A `/jobs/` path segment is allowed
 * (on a job board it is the adverts themselves), which lets the board's
 * own submission and info pages through the structural filter; so on a
 * page where links carry dates, only the dated links are adverts. A page
 * with no dated links is taken as undated and every link is kept.
 */
export function findPositionLinks(html: string, listingUrl: string, today: ISODate): string[] {
  const doc = parseHTML(html);
  const dated = new Map<string, string>();
  for (const a of doc.querySelectorAll('a[href]')) {
    const m = LEADING_DATE.exec(a.textContent ?? '');
    if (!m) continue;
    try {
      dated.set(new URL(a.getAttribute('href')!, listingUrl).href, `20${m[1]}-${m[2]}-${m[3]}`);
    } catch {
      // unparsable href: findEventPageLinks drops it too
    }
  }
  const links = findEventPageLinks(html, listingUrl, new Set(['jobs']));
  if (dated.size === 0) return links;
  return links.filter((link) => {
    const posted = dated.get(link);
    return (
      posted !== undefined &&
      (!isRealISODate(posted) || daysBetween(posted as ISODate, today) < STALE_AFTER_DAYS)
    );
  });
}

/** Social and licence links an aggregator carries in its footer; never an event. */
const NON_EVENT_HOSTS =
  /(^|\.)(twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com|youtube\.com|creativecommons\.org|scholar\.google\.[a-z.]+|researchgate\.net|orcid\.org)$/i;

/**
 * Links an aggregator (another site's curated list) makes to other sites:
 * each event's own page. The aggregator's own pages and site chrome are
 * dropped, so only the official pages are fetched and extracted — none of
 * the aggregator's text reaches the model.
 */
export function findAggregatorLinks(html: string, listingUrl: string): string[] {
  const listingHost = new URL(listingUrl).host;
  const links = new Set<string>();
  for (const link of extractLinks(parseHTML(html), listingUrl, inChrome, {
    allowOtherHosts: true,
  })) {
    const url = new URL(link);
    if (url.host === listingHost || NON_EVENT_HOSTS.test(url.hostname)) continue;
    if (FILE_EXTENSION.test(url.pathname)) continue;
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    links.add(url.toString());
  }
  return [...links];
}
