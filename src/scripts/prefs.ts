/**
 * The saved filter on the list page. Needs the Worker's `/api/prefs`; when
 * that is unreachable the bar stays hidden and the page works as before.
 *
 * It talks to the filters island only through the URL: applying a saved
 * filter replaces the query string and fires `popstate`, which the island
 * already handles.
 */

interface SavedFilter {
  filter: string;
  feed: string;
}

const bar = document.querySelector<HTMLElement>('#saved-filter');
const statusEl = bar?.querySelector<HTMLElement>('#saved-status');
const saveButton = bar?.querySelector<HTMLButtonElement>('#save-filter');
const forgetButton = bar?.querySelector<HTMLButtonElement>('#forget-filter');
const feed = bar?.querySelector<HTMLElement>('#my-feed');

function show(saved: SavedFilter | null, message: string): void {
  statusEl!.textContent = message;
  forgetButton!.hidden = saved === null;
  feed!.hidden = saved === null;
  // Absolute, because the link is meant to be copied into a calendar app.
  if (saved) feed!.querySelector('a')!.href = new URL(saved.feed, location.origin).href;
}

async function request(method: string, body?: unknown): Promise<SavedFilter | null> {
  const res = await fetch('/api/prefs', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = (await res.json()) as { saved?: SavedFilter | null; error?: string };
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.saved ?? null;
}

async function init(): Promise<void> {
  let saved: SavedFilter | null;
  try {
    saved = await request('GET');
  } catch {
    return;
  }
  bar!.hidden = false;

  if (saved && location.search === '') {
    history.replaceState(null, '', `${location.pathname}?${saved.filter}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    show(saved, 'Showing your saved filter.');
  } else {
    show(saved, saved ? 'You have a saved filter.' : '');
  }

  saveButton!.addEventListener('click', async () => {
    const filter = location.search.slice(1);
    if (!filter) {
      show(saved, 'Choose a filter first, then save it.');
      return;
    }
    try {
      saved = await request('PUT', { filter });
      show(saved, 'Saved. This browser opens the list with this filter.');
    } catch (err) {
      show(saved, `Could not save: ${(err as Error).message}`);
    }
  });

  forgetButton!.addEventListener('click', async () => {
    try {
      saved = await request('DELETE');
      show(null, 'Forgotten. Your personal calendar link no longer works.');
    } catch (err) {
      show(saved, `Could not forget: ${(err as Error).message}`);
    }
  });
}

if (bar && statusEl && saveButton && forgetButton && feed) void init();

export {};
