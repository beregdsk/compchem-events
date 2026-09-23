import { DOMParser } from 'linkedom';

export interface ExtractionInput {
  text: string;
  sourceUrl: string;
}

export function parseHTML(html: string) {
  return new DOMParser().parseFromString(html, 'text/html');
}

export function parseXML(xml: string) {
  return new DOMParser().parseFromString(xml, 'text/xml');
}

/** Absolute, deduplicated, same-host http(s) links from every `<a href>` in `doc`. */
export function extractLinks(doc: ReturnType<typeof parseHTML>, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const links = new Set<string>();
  for (const a of doc.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || href.trim().startsWith('#')) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') continue;
    if (resolved.host !== base.host) continue;
    resolved.hash = '';
    links.add(resolved.toString());
  }
  return [...links];
}

/** Visible text only: scripts and styles removed, whitespace collapsed. */
export function htmlToText(doc: ReturnType<typeof parseHTML>): string {
  for (const el of doc.querySelectorAll('script, style')) el.remove();
  const text = doc.body?.textContent ?? doc.textContent ?? '';
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/** One extraction input per non-empty post on a `t.me/s/<channel>` preview page. */
export function splitTelegramPosts(doc: ReturnType<typeof parseHTML>): ExtractionInput[] {
  const posts: ExtractionInput[] = [];
  for (const el of doc.querySelectorAll('.tgme_widget_message')) {
    const dataPost = el.getAttribute('data-post');
    const textEl = el.querySelector('.tgme_widget_message_text');
    if (!dataPost || !textEl) continue;
    const text = (textEl.textContent ?? '').trim();
    if (!text) continue;
    posts.push({ sourceUrl: `https://t.me/${dataPost}`, text });
  }
  return posts;
}
