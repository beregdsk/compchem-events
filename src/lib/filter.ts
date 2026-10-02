import { hasOpenDeadline, hasOpenTravelGrant } from './deadlines';
import type { ISODate } from './dates';
import type { LoadedEvent } from './types';

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
  /** Only events with an open travel-grant deadline. */
  grant: boolean;
  /** `free` or `paid`; empty for any. An event with no `fee` matches only "any". */
  fee: string;
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
  grant: false,
  fee: '',
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
  openGrant: boolean;
  fee: string;
}

/** The row for one event on `today`: the page encodes it, the Worker's filtered feed matches it. */
export function filterRowFromEvent(event: LoadedEvent, today: ISODate): FilterRow {
  return {
    search: [event.title, event.organizer ?? '', event.location?.city ?? '']
      .join(' ')
      .toLowerCase(),
    topics: event.topics,
    region: event.region,
    country: event.location?.country ?? '',
    format: event.format,
    type: event.type,
    start: event.start_date,
    end: event.end_date,
    openDeadline: hasOpenDeadline(event, today),
    openGrant: hasOpenTravelGrant(event, today),
    fee: event.fee ?? '',
  };
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
    grant: params.get('grant') === 'open',
    fee: params.get('fee') ?? '',
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
  if (state.grant) params.set('grant', 'open');
  if (state.fee) params.set('fee', state.fee);
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
  if (state.grant && !row.openGrant) return false;
  if (state.fee && row.fee !== state.fee) return false;
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
    openGrant: dataset.grant === 'open',
    fee: dataset.fee ?? '',
  };
}
