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

function inChrome(a: Element): boolean {
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
function looksLikeEventPage(url: URL, listing: URL): boolean {
  if (FILE_EXTENSION.test(url.pathname)) return false;
  const segments = url.pathname.toLowerCase().split('/').filter(Boolean);
  if (segments.some((s) => NON_EVENT_SEGMENT.has(s) || /(?:^|-)past(?:-|$)/.test(s))) return false;
  if (/past/i.test(url.search)) return false;
  const path = withoutTrailingSlash(url.pathname);
  const listingPath = withoutTrailingSlash(listing.pathname);
  return !(path === '/' || path === listingPath || listingPath.startsWith(`${path}/`));
}

/**
 * Same-host links from a listing page that plausibly lead to one event:
 * site chrome, downloads, site pages and self/ancestor links are dropped,
 * and tracking parameters stripped. Deliberately structural only — no
 * topic keywords — since a missed event is worse than a wasted fetch, and
 * every fetched page still passes the pipeline's relevance pre-filter.
 */
export function findEventPageLinks(html: string, listingUrl: string): string[] {
  const listing = new URL(listingUrl);
  const links = new Set<string>();
  for (const link of extractLinks(parseHTML(html), listingUrl, inChrome)) {
    const url = new URL(link);
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
    }
    if (looksLikeEventPage(url, listing)) links.add(url.toString());
  }
  return [...links];
}
