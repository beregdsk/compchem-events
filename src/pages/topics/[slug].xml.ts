import type { APIRoute, GetStaticPaths } from 'astro';
import { atomFeed } from '../feed.xml';
import { eventsWithTopic, loadEvents } from '../../lib/events';
import { loadTopics } from '../../lib/validation';
import type { Topic } from '../../lib/types';

export const getStaticPaths: GetStaticPaths = () =>
  loadTopics().map((topic) => ({ params: { slug: topic.slug }, props: { topic } }));

export const GET: APIRoute = ({ props }) => {
  const { topic } = props as { topic: Topic };
  const feed = atomFeed(eventsWithTopic(loadEvents(), topic.slug), new Date(), {
    title: `newly added ${topic.label.toLowerCase()} events`,
    path: `/topics/${topic.slug}.xml`,
    idPath: `/topics/${topic.slug}/`,
  });
  return new Response(feed, {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
};
