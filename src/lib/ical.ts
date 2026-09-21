import { addDays, type ISODate } from './dates';

export interface VEventInput {
  uid: string;
  summary: string;
  description?: string;
  /** First day of the event. */
  start: ISODate;
  /** Last day of the event. `buildCalendar` converts this to an exclusive DTEND. */
  end: ISODate;
  url?: string;
  location?: string;
  cancelled?: boolean;
}

/** RFC 5545 section 3.3.11. Backslash must be escaped first. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\\n')
    .replace(/[\r\n]/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

const encoder = new TextEncoder();

/**
 * RFC 5545 section 3.1: lines are folded at 75 octets, continuations starting
 * with a single space. Folds between code points so multi-byte characters
 * survive, and counts octets rather than characters.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;

  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  let isFirst = true;

  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // Continuation lines carry a leading space, so they have one fewer octet.
    const limit = isFirst ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
      isFirst = false;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);

  return (
    parts[0] +
    parts
      .slice(1)
      .map((p) => `\r\n ${p}`)
      .join('')
  );
}

function stampOf(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

export function icalDate(d: ISODate): string {
  return d.replace(/-/g, '');
}

export function buildCalendar(name: string, events: VEventInput[], stamp: Date): string {
  const dtstamp = stampOf(stamp);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CompChem Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];

  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${icalDate(e.start)}`,
      // DTEND is exclusive: the day after the last day of the event.
      `DTEND;VALUE=DATE:${icalDate(addDays(e.end, 1))}`,
      `SUMMARY:${escapeText(e.summary)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.cancelled) lines.push('STATUS:CANCELLED');
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
