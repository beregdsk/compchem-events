import type { APIRoute } from 'astro';
import { loadEvents } from '../lib/events';
import { compareISO } from '../lib/dates';
import type { LoadedEvent } from '../lib/types';
import { site } from '../../site.config';

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface FeedScope {
  /** Shown after the site name, e.g. `newly added events`. */
  title: string;
  /** The feed's own path, for its `rel="self"` link and its id. */
  path: string;
  /** Path whose URL is the feed's permanent `<id>`. Unique per feed. */
  idPath: string;
}

const ALL_EVENTS: FeedScope = { title: 'newly added events', path: '/feed.xml', idPath: '/' };

export function atomFeed(
  events: LoadedEvent[],
  generatedAt: Date,
  scope: FeedScope = ALL_EVENTS,
): string {
  const newest = [...events].sort((a, b) => compareISO(b.added, a.added)).slice(0, 50);
  const selfUrl = new URL(scope.path, site.url).href;
  const entries = newest
    .map((e) => {
      const url = new URL(`/events/${e.id}/`, site.url).href;
      return [
        '  <entry>',
        `    <title>${xml(e.title)}</title>`,
        `    <link href="${xml(url)}"/>`,
        `    <id>${xml(url)}</id>`,
        `    <updated>${e.added}T00:00:00Z</updated>`,
        `    <summary>${xml(e.description)}</summary>`,
        '  </entry>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    `  <title>${xml(site.name)} — ${xml(scope.title)}</title>`,
    `  <link href="${xml(selfUrl)}" rel="self"/>`,
    `  <link href="${xml(site.url)}"/>`,
    `  <id>${xml(new URL(scope.idPath, site.url).href)}</id>`,
    `  <updated>${generatedAt.toISOString().replace(/\.\d{3}Z$/, 'Z')}</updated>`,
    '  <author>',
    `    <name>${xml(site.name)}</name>`,
    '  </author>',
    entries,
    '</feed>',
    '',
  ].join('\n');
}

export const GET: APIRoute = () =>
  new Response(atomFeed(loadEvents(), new Date()), {
    headers: { 'Content-Type': 'application/atom+xml; charset=utf-8' },
  });
