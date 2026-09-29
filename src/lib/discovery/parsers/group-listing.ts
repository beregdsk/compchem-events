import { parseHTML } from '../html';
import { inChrome } from './listing';

/**
 * A name that might be a registry entry, and where it came from. `text` is
 * a name as written (a group, an organisation, a person, or for an event's
 * organiser possibly several); `link` and `context` (the heading it sat
 * under, an affiliation) are unverified hints only.
 */
export interface GroupLead {
  text: string;
  link?: string;
  context?: string;
  /** The event, position or listing page the lead came from. */
  origin: string;
  /** From a group-listing source: already one name, never sent to the split call. */
  fromListing: boolean;
}

const CONTEXT_SELECTOR = 'h1, h2, h3, h4, h5, h6, caption';

/** The nearest heading or table caption before `el` in document order. */
function contextOf(el: Element): string | undefined {
  const table = el.closest('table');
  const caption = table?.querySelector('caption')?.textContent?.trim();
  if (caption) return caption.replace(/\s+/g, ' ');
  let found: string | undefined;
  for (const h of el.ownerDocument.querySelectorAll(CONTEXT_SELECTOR)) {
    // DOCUMENT_POSITION_FOLLOWING (4): `el` comes after `h`.
    if (h.compareDocumentPosition(el) & 4) found = h.textContent?.trim().replace(/\s+/g, ' ');
  }
  return found || undefined;
}

/**
 * One lead per link to another site in the page's main content. Deterministic,
 * no model: the listing is only a pointer, every field is later taken from
 * the group's own site.
 */
export function parseGroupListing(html: string, listingUrl: string): GroupLead[] {
  const doc = parseHTML(html);
  const listingHost = new URL(listingUrl).host;
  const leads: GroupLead[] = [];
  const seen = new Set<string>();
  for (const a of doc.querySelectorAll('a[href]')) {
    if (inChrome(a)) continue;
    const href = a.getAttribute('href') ?? '';
    if (href.trim().startsWith('#')) continue;
    let url: URL;
    try {
      url = new URL(href, listingUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (url.host === listingHost) continue;
    const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < 2 || seen.has(url.href)) continue;
    seen.add(url.href);
    url.hash = '';
    leads.push({
      text,
      link: url.href,
      context: contextOf(a),
      origin: listingUrl,
      fromListing: true,
    });
  }
  return leads;
}
