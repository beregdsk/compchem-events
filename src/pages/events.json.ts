import type { APIRoute } from 'astro';
import { loadEvents } from '../lib/events';
import type { LoadedEvent } from '../lib/types';

export function eventsExport(events: LoadedEvent[], generatedAt: Date): object {
  return {
    schema_version: 1,
    generated_at: generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    count: events.length,
    events: events.map(({ fixture, ...rest }) => {
      void fixture;
      return rest;
    }),
  };
}

export const GET: APIRoute = () =>
  new Response(JSON.stringify(eventsExport(loadEvents(), new Date()), null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
