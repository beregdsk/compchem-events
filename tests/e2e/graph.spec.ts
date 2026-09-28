import { expect, test, type Page } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** The two ends of the first edge: a node guaranteed to have a neighbour. */
async function linkedPair(page: Page): Promise<[string, string]> {
  const edge = page.locator('.graph__edge').first();
  return [(await edge.getAttribute('data-source'))!, (await edge.getAttribute('data-target'))!];
}

test.describe('event map', () => {
  test('enhances, and hovering a node lights up its neighbour', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/graph/');
    await expect(page.locator('figure.graph')).toHaveClass(/is-live/);
    expect(await page.locator('#event-graph a.graph-node').count()).toBeGreaterThan(1);

    const [source, target] = await linkedPair(page);
    await page.locator(`a.graph-node[data-id="${source}"] .graph-node__shape`).hover();
    await expect(page.locator('figure.graph')).toHaveClass(/is-highlighting/);
    await expect(page.locator(`a.graph-node[data-id="${target}"]`)).toHaveClass(/is-lit/);
    expect(errors).toEqual([]);
  });

  test('keyboard focus highlights too', async ({ page }) => {
    await page.goto('/graph/');
    const [source, target] = await linkedPair(page);
    await page.locator(`a.graph-node[data-id="${source}"]`).focus();
    await expect(page.locator(`a.graph-node[data-id="${target}"]`)).toHaveClass(/is-lit/);
  });

  test('dragging a node moves it and does not navigate', async ({ page }) => {
    await page.goto('/graph/');
    const shape = page.locator('#event-graph a.graph-node .graph-node__shape').first();
    const body = page.locator('#event-graph a.graph-node .graph-node__body').first();
    const before = await body.getAttribute('transform');
    const box = (await shape.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 60, { steps: 8 });
    await page.mouse.up();
    await expect(page).toHaveURL(/\/graph\/$/);
    expect(await body.getAttribute('transform')).not.toBe(before);
  });

  test('clicking a node opens its event page', async ({ page }) => {
    await page.goto('/graph/');
    const node = page.locator('#event-graph a.graph-node').first();
    const href = (await node.getAttribute('href'))!;
    await node.locator('.graph-node__shape').click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });

  test('every node links to a real event page', async ({ page, request }) => {
    await page.goto('/graph/');
    const hrefs = await page
      .locator('#event-graph a.graph-node')
      .evaluateAll((els) => els.map((el) => el.getAttribute('href')!));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^\/events\/[^/]+\/$/);
      expect((await request.get(href)).status(), href).toBe(200);
    }
  });

  test('zooming with the wheel changes the viewBox', async ({ page }) => {
    await page.goto('/graph/');
    const svg = page.locator('#event-graph');
    await svg.scrollIntoViewIfNeeded();
    const before = await svg.getAttribute('viewBox');
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(() => svg.getAttribute('viewBox')).not.toBe(before);
  });

  test('reduced motion: no simulation, highlight still works', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/graph/');
    const body = page.locator('#event-graph .graph-node__body').first();
    const before = await body.getAttribute('transform');
    await page.waitForTimeout(600);
    expect(await body.getAttribute('transform')).toBe(before);
    const [source, target] = await linkedPair(page);
    await page.locator(`a.graph-node[data-id="${source}"] .graph-node__shape`).hover();
    await expect(page.locator(`a.graph-node[data-id="${target}"]`)).toHaveClass(/is-lit/);
  });
});

test.describe('event map without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('shows the static graph and a cluster list covering every event', async ({ page }) => {
    await page.goto('/graph/');
    const nodes = await page.locator('#event-graph a.graph-node').count();
    expect(nodes).toBeGreaterThan(0);
    await expect(page.locator('figure.graph')).not.toHaveClass(/is-live/);
    await expect(page.locator('ol.graph-clusters a')).toHaveCount(nodes);
  });
});
