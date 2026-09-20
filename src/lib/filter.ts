export interface FilterState {
  q: string;
  topics: string[];
  region: string;
  country: string;
  format: string;
  type: string;
  /** Inclusive lower bound of the date window, ISO `YYYY-MM-DD`. */
  from: string;
  /** Inclusive upper bound of the date window, ISO `YYYY-MM-DD`. */
  to: string;
  deadline: boolean;
}

export const EMPTY_FILTER: FilterState = {
  q: '',
  topics: [],
  region: '',
  country: '',
  format: '',
  type: '',
  from: '',
  to: '',
  deadline: false,
};

/** The shape the server encodes into each row's data attributes. */
export interface FilterRow {
  /** Lowercased title, organiser and city, concatenated. */
  search: string;
  topics: string[];
  region: string;
  country: string;
  format: string;
  type: string;
  start: string;
  end: string;
  openDeadline: boolean;
}

export function parseFilterState(params: URLSearchParams): FilterState {
  return {
    q: params.get('q')?.trim() ?? '',
    topics: (params.get('topics') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    region: params.get('region') ?? '',
    country: params.get('country') ?? '',
    format: params.get('format') ?? '',
    type: params.get('type') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    deadline: params.get('deadline') === 'open',
  };
}

export function serialiseFilterState(state: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.topics.length > 0) params.set('topics', state.topics.join(','));
  if (state.region) params.set('region', state.region);
  if (state.country) params.set('country', state.country);
  if (state.format) params.set('format', state.format);
  if (state.type) params.set('type', state.type);
  if (state.from) params.set('from', state.from);
  if (state.to) params.set('to', state.to);
  if (state.deadline) params.set('deadline', 'open');
  return params;
}

export function isEmptyFilter(state: FilterState): boolean {
  return serialiseFilterState(state).toString() === '';
}

/**
 * Spec D4: OR within a category, AND across categories.
 * The date window is an overlap test, not containment.
 */
export function matchesFilter(row: FilterRow, state: FilterState): boolean {
  if (state.q && !row.search.includes(state.q.toLowerCase())) return false;
  if (state.topics.length > 0 && !state.topics.some((t) => row.topics.includes(t))) return false;
  if (state.region && row.region !== state.region) return false;
  if (state.country && row.country !== state.country) return false;
  if (state.format && row.format !== state.format) return false;
  if (state.type && row.type !== state.type) return false;
  if (state.from && row.end < state.from) return false;
  if (state.to && row.start > state.to) return false;
  if (state.deadline && !row.openDeadline) return false;
  return true;
}

export function rowFromDataset(dataset: Record<string, string | undefined>): FilterRow {
  return {
    search: (dataset.search ?? '').toLowerCase(),
    topics: (dataset.topics ?? '').split(/\s+/).filter(Boolean),
    region: dataset.region ?? '',
    country: dataset.country ?? '',
    format: dataset.format ?? '',
    type: dataset.type ?? '',
    start: dataset.start ?? '',
    end: dataset.end ?? '',
    openDeadline: dataset.deadline === 'open',
  };
}
