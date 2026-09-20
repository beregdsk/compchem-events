import {
  EMPTY_FILTER,
  isEmptyFilter,
  matchesFilter,
  parseFilterState,
  rowFromDataset,
  serialiseFilterState,
  type FilterRow,
  type FilterState,
} from '../lib/filter';

const form = document.querySelector<HTMLFormElement>('#filters');
const list = document.querySelector<HTMLUListElement>('#event-list');
const countEl = document.querySelector<HTMLElement>('#result-count');
const clearButton = document.querySelector<HTMLButtonElement>('#clear-filters');

if (form && list && countEl) {
  // Filtering is a JavaScript feature, so the controls only appear once it runs.
  form.hidden = false;

  const rows: { el: HTMLElement; row: FilterRow }[] = [
    ...list.querySelectorAll<HTMLElement>('li.event'),
  ].map((el) => ({ el, row: rowFromDataset({ ...el.dataset }) }));

  const field = <T extends HTMLElement>(name: string): T | null =>
    form.querySelector<T>(`[name="${name}"]`);

  function readForm(): FilterState {
    const topics = [...form!.querySelectorAll<HTMLInputElement>('input[name="topic"]:checked')].map(
      (i) => i.value,
    );
    return {
      q: field<HTMLInputElement>('q')?.value.trim() ?? '',
      topics,
      region: field<HTMLSelectElement>('region')?.value ?? '',
      country: field<HTMLSelectElement>('country')?.value ?? '',
      format: field<HTMLSelectElement>('format')?.value ?? '',
      type: field<HTMLSelectElement>('type')?.value ?? '',
      from: field<HTMLInputElement>('from')?.value ?? '',
      to: field<HTMLInputElement>('to')?.value ?? '',
      deadline: field<HTMLInputElement>('deadline')?.checked ?? false,
    };
  }

  function writeForm(state: FilterState): void {
    const q = field<HTMLInputElement>('q');
    if (q) q.value = state.q;
    for (const box of form!.querySelectorAll<HTMLInputElement>('input[name="topic"]')) {
      box.checked = state.topics.includes(box.value);
    }
    for (const name of ['region', 'country', 'format', 'type', 'from', 'to'] as const) {
      const el = field<HTMLSelectElement | HTMLInputElement>(name);
      if (el) el.value = state[name];
    }
    const deadline = field<HTMLInputElement>('deadline');
    if (deadline) deadline.checked = state.deadline;
  }

  function apply(state: FilterState, mode: 'none' | 'push' | 'replace'): void {
    let shown = 0;
    for (const { el, row } of rows) {
      const match = matchesFilter(row, state);
      el.hidden = !match;
      if (match) shown += 1;
    }

    countEl!.textContent = isEmptyFilter(state)
      ? `${shown} upcoming ${shown === 1 ? 'event' : 'events'}`
      : `${shown} of ${rows.length} ${rows.length === 1 ? 'event' : 'events'} match`;

    if (mode === 'none') return;
    const params = serialiseFilterState(state).toString();
    const next = params ? `${location.pathname}?${params}` : location.pathname;
    const current = `${location.pathname}${location.search}`;
    // A no-op interaction must not create a history entry.
    if (next === current) return;
    if (mode === 'replace') history.replaceState(null, '', next);
    else history.pushState(null, '', next);
  }

  function syncFromUrl(): void {
    const state = parseFilterState(new URLSearchParams(location.search));
    writeForm(state);
    apply(state, 'none');
  }

  form.addEventListener('submit', (e) => e.preventDefault());
  form.addEventListener('input', (event) => {
    const target = event.target as HTMLElement | null;
    const isTextEntry = target instanceof HTMLInputElement && target.type === 'text';
    apply(readForm(), isTextEntry ? 'replace' : 'push');
  });
  clearButton?.addEventListener('click', () => {
    writeForm(EMPTY_FILTER);
    apply(EMPTY_FILTER, 'push');
  });
  window.addEventListener('popstate', syncFromUrl);

  syncFromUrl();
}
