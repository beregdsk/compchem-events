import { describe, expect, it } from 'vitest';
import {
  findEventPageLinks,
  findNextListingPage,
} from '../../../src/lib/discovery/parsers/listing';

describe('findEventPageLinks', () => {
  it('returns absolute, same-host links from a listing page', () => {
    const html = `<html><body>
      <a href="/events/a">A</a>
      <a href="https://other.example/events/b">B</a>
    </body></html>`;
    const links = findEventPageLinks(html, 'https://example.org/events/');
    expect(links).toEqual(['https://example.org/events/a']);
  });

  it('skips site chrome, downloads, site pages, past events and the listing itself', () => {
    const html = `<html><body>
      <nav><a href="/events/in-nav">Nav</a></nav>
      <header><a href="/events/in-header">Header</a></header>
      <div class="navbar"><a href="/events/in-navbar-div">Menu</a></div>
      <footer><a href="/events/in-footer">Footer</a></footer>
      <main>
        <div class="tribe-events-calendar-list__event-header">
          <a href="/event/md-school-2027/">MD School</a>
        </div>
        <a href="/events/workshop-2027?PHPSESSID=abc123&lang=en">Workshop</a>
        <a href="/events/workshop-2027?lang=en&utm_source=x">Same workshop</a>
        <a href="/wp-content/uploads/programme.pdf">Programme</a>
        <a href="/about-us/">About</a>
        <a href="/events/privacy">Privacy</a>
        <a href="/events/past-events/">Past</a>
        <a href="/events/list/?eventDisplay=past">Past list</a>
        <a href="/events/?page=2">Page 2</a>
        <a href="/">Home</a>
        <a href="/events-contact-chemistry-2027/">Keeps segment matching whole words only</a>
      </main>
    </body></html>`;
    expect(findEventPageLinks(html, 'https://example.org/events/')).toEqual([
      'https://example.org/event/md-school-2027/',
      'https://example.org/events/workshop-2027?lang=en',
      'https://example.org/events-contact-chemistry-2027/',
    ]);
  });

  it('skips German category and archive pages (TYPO3, WE-Heraeus-Stiftung)', () => {
    const html = `<main>
      <a href="/veranstaltungen/kategorie/physikschule/">Physikschule</a>
      <a href="/veranstaltungen/aktion/archiv/">vergangene Veranstaltungen</a>
      <a href="/veranstaltungen/quantum-magnonics/">Quantum Magnonics</a>
    </main>`;
    expect(
      findEventPageLinks(html, 'https://example.org/veranstaltungen/kategorie/we-heraeus-seminar/'),
    ).toEqual(['https://example.org/veranstaltungen/quantum-magnonics/']);
  });
});

describe('findNextListingPage', () => {
  const listing = 'https://example.org/category/events/';

  it('follows rel="next", and never treats a /page/N/ link as an event', () => {
    const html = `<main>
      <a href="/events/post-a/">A</a>
      <a class="page-numbers" href="/category/events/page/3/">3</a>
      <a class="next page-numbers" rel="next" href="/category/events/page/2/">Next</a>
    </main>`;
    expect(findNextListingPage(html, listing)).toBe('https://example.org/category/events/page/2/');
    expect(findEventPageLinks(html, listing)).toEqual(['https://example.org/events/post-a/']);
  });

  it('ignores a missing, off-host or self-referencing next link', () => {
    expect(findNextListingPage('<a href="/x">x</a>', listing)).toBeUndefined();
    expect(
      findNextListingPage('<a rel="next" href="https://other.example/page/2/">n</a>', listing),
    ).toBeUndefined();
    expect(findNextListingPage(`<link rel="next" href="${listing}">`, listing)).toBeUndefined();
  });
});
