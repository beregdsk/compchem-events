// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

function setFixture(): void {
  document.body.innerHTML = `
    <p id="interest" data-event-id="cecam-workshop-2026" hidden>
      <button type="button" aria-pressed="false">I’m interested</button>
      <span id="interest-count"></span>
    </p>`;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

async function setup(responses: (Response | Error)[]) {
  vi.resetModules();
  setFixture();
  const fetchMock = vi.fn(() => {
    const next = responses.shift()!;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  vi.stubGlobal('fetch', fetchMock);
  await import('../../src/scripts/interest');
  await new Promise((r) => setTimeout(r, 0));
  return fetchMock;
}

const box = () => document.querySelector<HTMLElement>('#interest')!;
const button = () => box().querySelector('button')!;
const count = () => document.querySelector('#interest-count')!.textContent;

describe('interest toggle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stays hidden when the API is unreachable', async () => {
    await setup([new Error('offline')]);
    expect(box().hidden).toBe(true);
  });

  it('shows the count and marks with POST', async () => {
    const fetchMock = await setup([
      json({ count: 1, mine: false }),
      json({ count: 2, mine: true }),
    ]);
    expect(box().hidden).toBe(false);
    expect(count()).toBe('1 person interested');
    expect(fetchMock).toHaveBeenCalledWith('/api/interest/cecam-workshop-2026', { method: 'GET' });

    button().click();
    await vi.waitFor(() => expect(count()).toBe('2 people interested'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/interest/cecam-workshop-2026', {
      method: 'POST',
    });
    expect(button().getAttribute('aria-pressed')).toBe('true');
  });

  it('un-marks with DELETE when already marked', async () => {
    const fetchMock = await setup([
      json({ count: 1, mine: true }),
      json({ count: 0, mine: false }),
    ]);
    button().click();
    await vi.waitFor(() => expect(count()).toBe('Nobody has marked this yet.'));
    expect(fetchMock).toHaveBeenLastCalledWith('/api/interest/cecam-workshop-2026', {
      method: 'DELETE',
    });
  });
});
