// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';

const FEED = '/feed/my/abc.ics';

function setFixture(): void {
  document.body.innerHTML = `
    <div id="saved-filter" hidden>
      <button id="save-filter">Save</button>
      <button id="forget-filter" hidden>Forget</button>
      <span id="saved-status"></span>
      <p id="my-feed" hidden><a href="/feed/events.ics">feed</a></p>
    </div>`;
}

async function setup(url: string, responses: Response[]) {
  vi.resetModules();
  window.history.replaceState(null, '', url);
  setFixture();
  const fetchMock = vi.fn(() => Promise.resolve(responses.shift()!));
  vi.stubGlobal('fetch', fetchMock);
  const popstate = vi.fn();
  window.addEventListener('popstate', popstate);
  await import('../../src/scripts/prefs');
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  return { fetchMock, popstate };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('saved filter bar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stays hidden when the API is unreachable', async () => {
    vi.resetModules();
    setFixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    await import('../../src/scripts/prefs');
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector<HTMLElement>('#saved-filter')!.hidden).toBe(true);
  });

  it('applies the saved filter on a bare visit, through the URL and popstate', async () => {
    const { popstate } = await setup('/', [json({ saved: { filter: 'topics=dft', feed: FEED } })]);
    expect(location.search).toBe('?topics=dft');
    expect(popstate).toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>('#saved-filter')!.hidden).toBe(false);
    expect(document.querySelector<HTMLAnchorElement>('#my-feed a')!.href).toBe(
      new URL(FEED, location.origin).href,
    );
  });

  it('leaves a URL that already has a filter alone', async () => {
    await setup('/?region=Europe', [json({ saved: { filter: 'topics=dft', feed: FEED } })]);
    expect(location.search).toBe('?region=Europe');
  });

  it('saves the current filter with PUT', async () => {
    const { fetchMock } = await setup('/?region=Europe', [
      json({ saved: null }),
      json({ saved: { filter: 'region=Europe', feed: FEED } }),
    ]);
    document.querySelector<HTMLButtonElement>('#save-filter')!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body as string)).toEqual({ filter: 'region=Europe' });
    await vi.waitFor(() =>
      expect(document.querySelector<HTMLElement>('#forget-filter')!.hidden).toBe(false),
    );
  });
});
