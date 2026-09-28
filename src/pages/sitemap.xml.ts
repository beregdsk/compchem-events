import type { APIRoute } from 'astro';
import { loadEvents, seriesEditions } from '../lib/events';
import { loadTopics } from '../lib/validation';
import { site } from '../../site.config';

export const STATIC_PATHS = [
  '/',
  '/archive/',
  '/about/',
  '/sources/',
  '/donate/',
  '/submit/',
  '/graph/',
  '/topics/',
];

export const GET: APIRoute = () => {
  const events = loadEvents();
  const paths = [
    ...STATIC_PATHS,
    ...loadTopics().map((t) => `/topics/${t.slug}/`),
    ...[...seriesEditions(events).keys()].map((slug) => `/series/${slug}/`),
    ...events.map((e) => `/events/${e.id}/`),
  ];
  const urls = paths.map((p) => `  <url><loc>${new URL(p, site.url).href}</loc></url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
