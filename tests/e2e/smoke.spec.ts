import { expect, test } from '@playwright/test';

test('home page loads, a topic filter reduces the list, and the URL updates', async ({ page }) => {
  await page.goto('/');

  // The filter form is hidden until JavaScript reveals it (see index.astro's
  // <noscript> fallback) — its visibility is itself proof the page loaded.
  const filters = page.locator('#filters');
  await expect(filters).toBeVisible();

  const rows = page.locator('#event-list li.event');
  const visibleRows = page.locator('#event-list li.event:visible');
  const initialCount = await rows.count();
  expect(initialCount).toBeGreaterThan(0);
  await expect(page.locator('#result-count')).toContainText(String(initialCount));

  // Not every topic narrows the list (one that every event shares wouldn't),
  // so try topics in order until one visibly does.
  const topicCheckboxes = page.locator('#filters input[name="topic"]');
  const topicCount = await topicCheckboxes.count();
  expect(topicCount).toBeGreaterThan(0);

  let reduced = false;
  for (let i = 0; i < topicCount && !reduced; i++) {
    const checkbox = topicCheckboxes.nth(i);
    const value = await checkbox.getAttribute('value');
    await checkbox.check();

    const visibleCount = await visibleRows.count();
    if (visibleCount < initialCount) {
      reduced = true;
      // The URL param is `topics` (comma-joined), distinct from the form
      // field's `topic` name — see src/lib/filter.ts.
      await expect(page).toHaveURL(new RegExp(`topics=${value}`));
      await expect(page.locator('#result-count')).toContainText(String(visibleCount));
    } else {
      await checkbox.uncheck();
    }
  }

  expect(reduced).toBe(true);
});
