import { describe, expect, it } from 'vitest';
import {
  extractLinks,
  htmlToText,
  parseHTML,
  parseXML,
  splitTelegramPosts,
} from '../../src/lib/discovery/html';

const listingHtml = `
<html><body>
  <a href="/events/a">Event A</a>
  <a href="https://example.org/events/b">Event B</a>
  <a href="https://other-host.example/events/c">Off-host</a>
  <a href="/events/a">Duplicate of A</a>
  <a href="mailto:someone@example.org">Email</a>
  <a href="#top">Anchor only</a>
</body></html>`;

describe('extractLinks', () => {
  it('returns absolute, deduplicated, same-host https/http links', () => {
    const links = extractLinks(parseHTML(listingHtml), 'https://example.org/events/');
    expect(links).toEqual(['https://example.org/events/a', 'https://example.org/events/b']);
  });
});

describe('htmlToText', () => {
  it('strips scripts and styles and collapses whitespace', () => {
    const html = `<html><body>
      <style>.x { color: red; }</style>
      <h1>Title</h1>
      <p>Some   text.</p>
      <script>alert('x')</script>
    </body></html>`;
    const text = htmlToText(parseHTML(html));
    expect(text).toContain('Title');
    expect(text).toContain('Some text.');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('alert');
  });

  it('separates adjacent block elements with no whitespace between their tags (Fix G)', () => {
    const html = '<html><body><h1>Title</h1><p>Details.</p></body></html>';
    const text = htmlToText(parseHTML(html));
    expect(text).not.toContain('TitleDetails.');
    expect(text.split(/\s+/)).toEqual(expect.arrayContaining(['Title', 'Details.']));
  });
});

describe('splitTelegramPosts', () => {
  it('extracts one extraction input per message, dropping empty ones', () => {
    const html = `
      <div class="tgme_widget_message" data-post="samplechannel/101">
        <div class="tgme_widget_message_text">First post about a workshop.</div>
      </div>
      <div class="tgme_widget_message" data-post="samplechannel/102">
        <div class="tgme_widget_message_text">  </div>
      </div>
      <div class="tgme_widget_message" data-post="samplechannel/103">
        <div class="tgme_widget_message_text">Second post.</div>
      </div>`;
    const posts = splitTelegramPosts(parseHTML(html));
    expect(posts).toEqual([
      { sourceUrl: 'https://t.me/samplechannel/101', text: 'First post about a workshop.' },
      { sourceUrl: 'https://t.me/samplechannel/103', text: 'Second post.' },
    ]);
  });
});

describe('parseXML', () => {
  it('parses RSS items via querySelectorAll', () => {
    const xml = `<rss><channel><item><title>T</title></item></channel></rss>`;
    const doc = parseXML(xml);
    expect(doc.querySelectorAll('item')).toHaveLength(1);
    expect(doc.querySelector('title')?.textContent).toBe('T');
  });
});
