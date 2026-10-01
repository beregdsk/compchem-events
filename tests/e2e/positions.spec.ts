import { expect, test } from '@playwright/test';

for (const js of [true, false]) {
  test.describe(`positions pages (JavaScript ${js ? 'on' : 'off'})`, () => {
    test.use({ javaScriptEnabled: js });

    test('/positions/ lists open positions or says there are none', async ({ page }) => {
      await page.goto('/positions/');
      await expect(page.getByRole('heading', { level: 1, name: 'Positions' })).toBeVisible();
      const rows = page.locator('.position');
      if ((await rows.count()) === 0) {
        await expect(page.getByText('No open positions right now.')).toBeVisible();
      } else {
        const href = await rows.first().locator('.event__title a').getAttribute('href');
        expect(href).toMatch(/^https:\/\//);
      }
      await expect(page.getByRole('link', { name: 'Archive of positions' })).toHaveAttribute(
        'href',
        '/positions/archive/',
      );
    });

    test('/positions/archive/ renders', async ({ page }) => {
      await page.goto('/positions/archive/');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Archive of positions' }),
      ).toBeVisible();
    });
  });
}

test('the home page links to positions apart from its action row', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('nav[aria-label="Sections"] a[href="/positions/"]')).toHaveCount(1);
  await expect(page.locator('ul.actions a[href="/positions/"]')).toHaveCount(0);
});
