import { htmlToText, parseHTML, parseXML, type ExtractionInput } from '../html';

/**
 * RSS/Atom `<link>` elements can carry a `rel` attribute; an Atom entry may
 * have several (e.g. `rel="self"` pointing at the feed itself, alongside
 * `rel="alternate"` pointing at the actual event page). Per the Atom spec, a
 * `<link>` with no `rel` defaults to `alternate`, so that — or an explicit
 * `alternate` — is preferred over any other rel value.
 */
interface LinkLike {
  getAttribute(name: string): string | null;
  textContent: string | null;
}
interface EntryLike {
  querySelectorAll(selector: string): Iterable<LinkLike>;
}

function pickLinkValue(entry: EntryLike): string | undefined {
  const links = [...entry.querySelectorAll('link')];
  if (links.length === 0) return undefined;
  const preferred =
    links.find((l) => {
      const rel = l.getAttribute('rel');
      return rel === null || rel === 'alternate';
    }) ?? links[0]!;
  return preferred.getAttribute('href') || preferred.textContent?.trim() || undefined;
}

/**
 * `value` is feed-supplied content the pipeline never independently fetched
 * or validated as a real URL — unlike every other source kind, where
 * `sourceUrl` is always the URL the pipeline itself just fetched. Resolve it
 * against the feed's own URL (so a relative Atom `href` works), and fall
 * back to the feed's own URL when resolution fails or the result isn't
 * http(s), rather than pass through an arbitrary unvalidated string.
 */
/**
 * An RSS/Atom description/summary is a bare HTML fragment, not a full
 * document — linkedom's HTML parser only builds a normal `<body>` when the
 * input already establishes one, so a tag-less (or root-fragment) input
 * leaves `documentElement`/`body` empty and `htmlToText` would see no text
 * at all. Wrap the fragment in a minimal document shell before parsing it.
 */
function htmlFragmentToText(fragment: string): string {
  return htmlToText(parseHTML(`<html><body>${fragment}</body></html>`));
}

function resolveItemUrl(value: string | undefined, feedUrl: string): string {
  if (value) {
    try {
      const resolved = new URL(value, feedUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:')
        return resolved.toString();
    } catch {
      // fall through to the feed's own URL
    }
  }
  return feedUrl;
}

/** One extraction input per RSS `<item>` or Atom `<entry>`, title required. */
export function parseFeedItems(feedText: string, sourceUrl: string): ExtractionInput[] {
  const doc = parseXML(feedText);

  const inputs: ExtractionInput[] = [];
  for (const entry of [...doc.querySelectorAll('item'), ...doc.querySelectorAll('entry')]) {
    const title = entry.querySelector('title')?.textContent?.trim() ?? '';
    if (!title) continue;
    // RSS/Atom description/summary fields are very commonly themselves HTML
    // (escaped entities or CDATA) — always convert to plain text before it
    // reaches the LLM, per this project's security model.
    const rawDescription =
      entry.querySelector('description')?.textContent?.trim() ||
      entry.querySelector('summary')?.textContent?.trim() ||
      '';
    const description = rawDescription ? htmlFragmentToText(rawDescription) : '';
    const link = resolveItemUrl(pickLinkValue(entry), sourceUrl);
    inputs.push({ text: `${title}\n\n${description}`, sourceUrl: link });
  }
  return inputs;
}
