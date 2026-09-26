import { chromium } from 'playwright';

/**
 * Renders a page with a real browser instead of a plain HTTP fetch — for
 * sites whose bot-protection specifically targets non-browser clients.
 * Confirmed live: ACS's `all-events.html` returns an Incapsula challenge
 * shell to a plain fetch but real content (474 events) to an actual
 * browser. Uses the system's installed Chrome (`channel: 'chrome'`) rather
 * than a bundled Chromium, matching what's already on the host.
 *
 * Used only as a fallback (see `looksLikeBotChallenge` in `fetch.ts`) —
 * never the default fetch path, since launching a browser is meaningfully
 * slower and heavier than a plain fetch.
 */
export async function fetchWithBrowser(url: string, userAgent: string): Promise<string> {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const page = await browser.newPage({ userAgent });
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      return await page.content();
    } finally {
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
