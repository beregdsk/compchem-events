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
});
