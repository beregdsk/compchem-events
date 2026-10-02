import type { APIRoute } from 'astro';
import { eventsCalendar } from '../lib/event-calendar';
import { loadEvents, upcomingEvents } from '../lib/events';

export const GET: APIRoute = () =>
  new Response(eventsCalendar(upcomingEvents(loadEvents()), new Date()), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
