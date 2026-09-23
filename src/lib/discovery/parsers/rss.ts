import { parseXML, type ExtractionInput } from '../html';

/** One extraction input per RSS `<item>` or Atom `<entry>`, title required. */
export function parseFeedItems(feedText: string, sourceUrl: string): ExtractionInput[] {
  const doc = parseXML(feedText);

  const inputs: ExtractionInput[] = [];
  for (const entry of [...doc.querySelectorAll('item'), ...doc.querySelectorAll('entry')]) {
    const title = entry.querySelector('title')?.textContent?.trim() ?? '';
    if (!title) continue;
    const description =
      entry.querySelector('description')?.textContent?.trim() ||
      entry.querySelector('summary')?.textContent?.trim() ||
      '';
    const linkEl = entry.querySelector('link');
    const link = linkEl?.getAttribute('href') || linkEl?.textContent?.trim() || sourceUrl;
    inputs.push({ text: `${title}\n\n${description}`, sourceUrl: link });
  }
  return inputs;
}
