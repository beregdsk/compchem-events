import type { APIRoute } from 'astro';
import { loadEvents } from '../lib/events';
import { site } from '../../site.config';

export const STATIC_PATHS = ['/', '/archive/', '/about/', '/submit/'];

export const GET: APIRoute = () => {
  const paths = [...STATIC_PATHS, ...loadEvents().map((e) => `/events/${e.id}/`)];
  const urls = paths.map((p) => `  <url><loc>${new URL(p, site.url).href}</loc></url>`).join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
