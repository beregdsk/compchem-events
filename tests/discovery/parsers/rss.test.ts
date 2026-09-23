import { describe, expect, it } from 'vitest';
import { parseFeedItems } from '../../../src/lib/discovery/parsers/rss';

const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Workshop on Molecular Dynamics</title>
    <description>A three-day workshop in Testville.</description>
    <link>https://example.org/md-workshop</link>
  </item>
  <item>
    <title>No description item</title>
    <link>https://example.org/no-description</link>
  </item>
</channel></rss>`;

const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom Entry Title</title>
    <summary>Atom summary text.</summary>
    <link href="https://example.org/atom-entry"/>
  </entry>
</feed>`;

describe('parseFeedItems', () => {
  it('extracts RSS items with title, description and link', () => {
    const inputs = parseFeedItems(rss, 'https://example.org/feed.xml');
    expect(inputs).toHaveLength(2);
    expect(inputs[0]!.sourceUrl).toBe('https://example.org/md-workshop');
    expect(inputs[0]!.text).toContain('Workshop on Molecular Dynamics');
    expect(inputs[0]!.text).toContain('A three-day workshop in Testville.');
    expect(inputs[1]!.text).toContain('No description item');
  });

  it('extracts Atom entries, reading link from the href attribute', () => {
    const inputs = parseFeedItems(atom, 'https://example.org/feed.xml');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.sourceUrl).toBe('https://example.org/atom-entry');
    expect(inputs[0]!.text).toContain('Atom Entry Title');
    expect(inputs[0]!.text).toContain('Atom summary text.');
  });

  it('skips items with no title', () => {
    const feed = `<rss><channel><item><description>No title here.</description></item></channel></rss>`;
    expect(parseFeedItems(feed, 'https://example.org/feed.xml')).toEqual([]);
  });

  it('converts an HTML description to plain text (Fix B)', () => {
    const feed = `<rss><channel><item>
      <title>HTML Description Item</title>
      <description>&lt;p&gt;Details &lt;a href="https://example.org/x"&gt;here&lt;/a&gt;.&lt;/p&gt;</description>
      <link>https://example.org/html-desc</link>
    </item></channel></rss>`;
    const inputs = parseFeedItems(feed, 'https://example.org/feed.xml');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.text).toContain('Details');
    expect(inputs[0]!.text).toContain('here');
    expect(inputs[0]!.text).not.toContain('<p>');
    expect(inputs[0]!.text).not.toContain('<a href');
  });

  it('resolves a relative Atom link href against the feed URL (Fix C)', () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Relative Link Entry</title>
        <link href="/events/x"/>
      </entry>
    </feed>`;
    const inputs = parseFeedItems(feed, 'https://example.org/feeds/feed.xml');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.sourceUrl).toBe('https://example.org/events/x');
  });

  it('falls back to the feed URL when the link value cannot be parsed as a URL (Fix C)', () => {
    const feed = `<rss><channel><item>
      <title>Malformed Link Item</title>
      <link>http://[invalid</link>
    </item></channel></rss>`;
    const inputs = parseFeedItems(feed, 'https://example.org/feed.xml');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.sourceUrl).toBe('https://example.org/feed.xml');
  });

  it('falls back to the feed URL when the resolved link is not http(s) (Fix C)', () => {
    const feed = `<rss><channel><item>
      <title>Mailto Link Item</title>
      <link>mailto:someone@example.org</link>
    </item></channel></rss>`;
    const inputs = parseFeedItems(feed, 'https://example.org/feed.xml');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.sourceUrl).toBe('https://example.org/feed.xml');
  });

  it('prefers a rel="alternate" link over a rel="self" link in an Atom entry (Fix C)', () => {
    const feed = `<feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Multi Link Entry</title>
        <link rel="self" href="https://example.org/feed.xml"/>
        <link rel="alternate" href="https://example.org/the-actual-event"/>
      </entry>
    </feed>`;
    const inputs = parseFeedItems(feed, 'https://example.org/feed.xml');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.sourceUrl).toBe('https://example.org/the-actual-event');
  });
});
