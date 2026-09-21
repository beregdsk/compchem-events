// Deadline countdowns are computed in the browser so a static build cannot
// serve a stale "closes in 12 days". The server renders the plain date; this
// appends the relative phrase beside it, leaving the <time> element's own text
// (and therefore its machine-readable meaning) untouched.
//
// `src/lib/dates.ts` is the only place dates are parsed in this codebase (it
// has no imports, so it is browser-safe to import from an island); route both
// "today" and the target date through it rather than duplicating parsing here.

import { daysBetween, todayUTC } from '../lib/dates';

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

for (const el of document.querySelectorAll<HTMLTimeElement>('time[data-countdown]')) {
  const iso = el.getAttribute('datetime');
  if (!iso || el.dataset.countdownDone === 'true') continue;

  let days: number;
  try {
    days = daysBetween(todayUTC(), iso);
  } catch {
    // parseISODate throws on malformed/non-existent dates; skip rather than
    // crash the whole island over one bad datetime attribute.
    continue;
  }
  const phrase =
    days < 0 ? 'closed' : days === 0 ? 'closes today' : `closes ${rtf.format(days, 'day')}`;

  const note = document.createElement('span');
  note.className = 'countdown muted';
  note.textContent = ` · ${phrase}`;
  el.insertAdjacentElement('afterend', note);
  el.dataset.countdownDone = 'true';
}
