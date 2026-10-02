import type { APIRoute, GetStaticPaths } from 'astro';
import { eventsCalendar } from '../../lib/event-calendar';
import { eventsWithTopic, loadEvents, upcomingEvents } from '../../lib/events';
import { loadTopics } from '../../lib/validation';
import type { Topic } from '../../lib/types';

export const getStaticPaths: GetStaticPaths = () =>
  loadTopics().map((topic) => ({ params: { slug: topic.slug }, props: { topic } }));

export const GET: APIRoute = ({ props }) => {
  const { topic } = props as { topic: Topic };
  const events = upcomingEvents(eventsWithTopic(loadEvents(), topic.slug));
  return new Response(eventsCalendar(events, new Date(), topic.label), {
    headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
  });
};
