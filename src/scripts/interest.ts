/**
 * The "Interested" toggle on an event page. Needs the Worker's
 * `/api/interest/<id>`; when that is unreachable the control stays hidden.
 */

interface InterestState {
  count: number;
  mine: boolean;
}

const box = document.querySelector<HTMLElement>('#interest');
const button = box?.querySelector<HTMLButtonElement>('button');
const countEl = box?.querySelector<HTMLElement>('#interest-count');

function render(state: InterestState): void {
  button!.setAttribute('aria-pressed', String(state.mine));
  button!.textContent = state.mine ? 'Interested ✓' : 'I’m interested';
  countEl!.textContent =
    state.count === 0
      ? 'Nobody has marked this yet.'
      : `${state.count} ${state.count === 1 ? 'person' : 'people'} interested`;
}

async function call(endpoint: string, method: string): Promise<InterestState> {
  const res = await fetch(endpoint, { method });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as InterestState;
}

async function init(): Promise<void> {
  const endpoint = `/api/interest/${box!.dataset.eventId}`;
  let state: InterestState;
  try {
    state = await call(endpoint, 'GET');
  } catch {
    return;
  }
  render(state);
  box!.hidden = false;

  button!.addEventListener('click', async () => {
    button!.disabled = true;
    try {
      state = await call(endpoint, state.mine ? 'DELETE' : 'POST');
      render(state);
    } catch {
      countEl!.textContent = 'Could not save that; try again later.';
    } finally {
      button!.disabled = false;
    }
  });
}

if (box && button && countEl && box.dataset.eventId) void init();

export {};
