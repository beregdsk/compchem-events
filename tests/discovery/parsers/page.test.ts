import { describe, expect, it } from 'vitest';
import { extractionInputFromPage } from '../../../src/lib/discovery/parsers/page';

describe('extractionInputFromPage', () => {
  it('converts the page to plain text and keeps its own URL as the source', () => {
    const html = '<html><body><h1>Event Title</h1><script>evil()</script><p>Details.</p></body></html>';
    const input = extractionInputFromPage(html, 'https://example.org/event');
    expect(input.sourceUrl).toBe('https://example.org/event');
    expect(input.text).toContain('Event Title');
    expect(input.text).toContain('Details.');
    expect(input.text).not.toContain('evil()');
  });
});
