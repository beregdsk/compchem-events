import { expect, test } from '@playwright/test';

test('/topics/ lists every topic, and sorts by a column with JS on', async ({ page }) => {
  await page.goto('/topics/');
  await expect(page.getByRole('heading', { level: 1, name: 'Topics' })).toBeVisible();
  const rows = page.locator('.topics-table tbody tr');
  expect(await rows.count()).toBeGreaterThanOrEqual(20);
  await page.getByRole('button', { name: 'Topic' }).click();
  const first = await rows.first().locator('a').innerText();
  const second = await rows.nth(1).locator('a').innerText();
  expect(first.localeCompare(second)).toBeLessThanOrEqual(0);
});

test('a topic page shows statistics when a snapshot exists, and always its events', async ({
  page,
}) => {
  await page.goto('/topics/dft/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const block = page.locator('.topic-stats');
  if ((await block.count()) > 0) {
    await expect(block.getByText('OpenAlex', { exact: false }).first()).toBeVisible();
  }
  await expect(page.locator('.result-count')).toBeVisible();
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('/topics/ is readable in its default order', async ({ page }) => {
    await page.goto('/topics/');
    expect(await page.locator('.topics-table tbody tr').count()).toBeGreaterThanOrEqual(20);
  });
});
