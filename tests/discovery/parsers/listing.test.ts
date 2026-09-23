import { describe, expect, it } from 'vitest';
import { findEventPageLinks } from '../../../src/lib/discovery/parsers/listing';

describe('findEventPageLinks', () => {
  it('returns absolute, same-host links from a listing page', () => {
    const html = `<html><body>
      <a href="/events/a">A</a>
      <a href="https://other.example/events/b">B</a>
    </body></html>`;
    const links = findEventPageLinks(html, 'https://example.org/events/');
    expect(links).toEqual(['https://example.org/events/a']);
  });
});
