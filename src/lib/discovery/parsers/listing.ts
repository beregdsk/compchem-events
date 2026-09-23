import { extractLinks, parseHTML } from '../html';

/** Same-host event-page links found on a listing page. */
export function findEventPageLinks(html: string, listingUrl: string): string[] {
  return extractLinks(parseHTML(html), listingUrl);
}
