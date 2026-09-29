import { expect, test } from '@playwright/test';

test('/groups/ renders its heading and either rows or the empty message', async ({ page }) => {
  await page.goto('/groups/');
  await expect(page.getByRole('heading', { level: 1, name: 'Groups' })).toBeVisible();
  const rows = page.locator('.group');
  if ((await rows.count()) === 0) {
    await expect(page.getByText('No groups are listed yet.')).toBeVisible();
  } else {
    expect(await rows.first().locator('.event__title a').getAttribute('href')).toMatch(
      /^https:\/\//,
    );
  }
});

test('the site navigation links to /groups/', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Groups', exact: true })).toHaveAttribute(
    'href',
    '/groups/',
  );
});
