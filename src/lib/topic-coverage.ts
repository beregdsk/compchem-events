// What this site itself lists per topic, shown beside the OpenAlex numbers.
import type { LoadedEvent, LoadedPosition, RawGroup } from './types';

export interface Coverage {
  events: number;
  groups: number;
  positions: number;
}

export function topicCoverage(
  slug: string,
  data: {
    upcoming: readonly LoadedEvent[];
    groups: readonly RawGroup[];
    open: readonly LoadedPosition[];
  },
): Coverage {
  const has = (x: { topics: readonly string[] }) => x.topics.includes(slug);
  return {
    events: data.upcoming.filter(has).length,
    groups: data.groups.filter(has).length,
    positions: data.open.filter(has).length,
  };
}
