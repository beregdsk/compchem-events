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

test.describe('graph view', () => {
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

  test('zooming with ctrl+wheel changes the viewBox', async ({ page }) => {
    await page.goto('/graph/');
    const svg = page.locator('#event-graph');
    await svg.scrollIntoViewIfNeeded();
    const before = await svg.getAttribute('viewBox');
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -400);
    await page.keyboard.up('Control');
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

test.describe('graph view without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('shows the static graph with every event linked', async ({ page }) => {
    await page.goto('/graph/');
    const nodes = await page.locator('#event-graph a.graph-node').count();
    expect(nodes).toBeGreaterThan(0);
    await expect(page.locator('figure.graph')).not.toHaveClass(/is-live/);
  });
});

/** Centre of a node's shape, scrolled into view, in viewport pixels. */
async function centreOf(page: Page, id: string) {
  const shape = page.locator(`a.graph-node[data-id="${id}"] .graph-node__shape`);
  await shape.scrollIntoViewIfNeeded();
  const box = (await shape.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('graph view, pointer edge cases', () => {
  test('a right-button press does not start a drag', async ({ page }) => {
    await page.goto('/graph/');
    const [id] = await linkedPair(page);
    const start = await centreOf(page, id);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(start.x + 120, start.y + 60, { steps: 6 });
    const now = await centreOf(page, id);
    await page.mouse.up({ button: 'right' });
    expect(Math.hypot(now.x - start.x, now.y - start.y)).toBeLessThan(30);
  });

  test('a plain wheel scrolls the page instead of zooming', async ({ page }) => {
    await page.goto('/graph/');
    const svg = page.locator('#event-graph');
    await svg.scrollIntoViewIfNeeded();
    const before = await svg.getAttribute('viewBox');
    const scrolled = await page.evaluate(() => scrollY);
    const box = (await svg.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrolled);
    expect(await svg.getAttribute('viewBox')).toBe(before);
  });
});

test.describe('graph view on touch', () => {
  test.use({ hasTouch: true });

  test('a vertical touch drag moves the node, not the page', async ({ page }) => {
    await page.goto('/graph/');
    const [a] = await linkedPair(page);
    const { x, y } = await centreOf(page, a);
    const scrolled = await page.evaluate(() => scrollY);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + i * 12 }],
      });
    }
    await page.waitForTimeout(150);
    const box = (await page
      .locator(`a.graph-node[data-id="${a}"] .graph-node__shape`)
      .boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(box.y + box.height / 2 - y).toBeGreaterThan(80);
    expect(await page.evaluate(() => scrollY)).toBe(scrolled);
  });

  // The cluster list below the map is the phone path, so a swipe that starts
  // on the map's background has to be able to reach it.
  test('a one-finger swipe on the background scrolls the page', async ({ page }) => {
    await page.goto('/graph/');
    const svg = page.locator('#event-graph');
    await svg.scrollIntoViewIfNeeded();
    const box = (await svg.boundingBox())!;
    const start = { x: box.x + 6, y: box.y + box.height - 10 };
    const scrolled = await page.evaluate(() => scrollY);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start.x, y: start.y - i * 25 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scrolled + 100);
  });

  // A touch drag ends without a click, so nothing consumes the drag's
  // click-suppression — the next keyboard Enter on a node (no pointer events
  // of its own to reset it) would be swallowed.
  test('after a touch drag, Enter on a node still opens it', async ({ page }) => {
    await page.goto('/graph/');
    const [a, b] = await linkedPair(page);
    const { x, y } = await centreOf(page, a);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + i * 15, y: y + i * 10 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    const nodeB = page.locator(`a.graph-node[data-id="${b}"]`);
    const href = (await nodeB.getAttribute('href'))!;
    await nodeB.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });

  test('a second finger does not hijack a node drag', async ({ page }) => {
    await page.goto('/graph/');
    const [a] = await linkedPair(page);
    const finger = await centreOf(page, a);
    const svgBox = (await page.locator('#event-graph').boundingBox())!;
    const other = { x: svgBox.x + 8, y: svgBox.y + 8 };
    const cdp = await page.context().newCDPSession(page);
    const one = { ...finger, id: 1 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [one] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [one, { ...other, id: 2 }],
    });
    for (let i = 1; i <= 5; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [one, { x: other.x + i * 20, y: other.y + i * 20, id: 2 }],
      });
    }
    const now = await centreOf(page, a);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(Math.hypot(now.x - finger.x, now.y - finger.y)).toBeLessThan(15);
  });
});
