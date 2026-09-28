import { expect, test } from '@playwright/test';

// Derived from the map rather than pinned to an event id, so it survives new
// data and events rolling from upcoming to past.
test('an event page lists its map neighbours as related events, and they resolve', async ({
  page,
  request,
}) => {
  await page.goto('/graph/');
  const edge = page.locator('.graph__edge').first();
  const source = (await edge.getAttribute('data-source'))!;
  const target = (await edge.getAttribute('data-target'))!;

  await page.goto(`/events/${source}/`);
  const related = page.locator('section.related');
  await expect(related.getByRole('heading', { name: 'Related events' })).toBeVisible();
  await expect(related.locator(`a[href="/events/${target}/"]`)).toBeVisible();

  const hrefs = await related
    .locator('a')
    .evaluateAll((as) => as.map((a) => a.getAttribute('href')!));
  for (const href of hrefs) expect((await request.get(href)).status()).toBe(200);
});
