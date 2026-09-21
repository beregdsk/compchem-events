// Deadline countdowns are computed in the browser so a static build cannot
// serve a stale "closes in 12 days". The server renders the plain date; this
// appends the relative phrase beside it, leaving the <time> element's own text
// (and therefore its machine-readable meaning) untouched.

const MS_PER_DAY = 86_400_000;
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

function todayUtcMs(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

for (const el of document.querySelectorAll<HTMLTimeElement>('time[data-countdown]')) {
  const iso = el.getAttribute('datetime');
  if (!iso || el.dataset.countdownDone === 'true') continue;

  const target = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(target)) continue;

  const days = Math.round((target - todayUtcMs()) / MS_PER_DAY);
  const phrase =
    days < 0 ? 'closed' : days === 0 ? 'closes today' : `closes ${rtf.format(days, 'day')}`;

  const note = document.createElement('span');
  note.className = 'countdown muted';
  note.textContent = ` · ${phrase}`;
  el.insertAdjacentElement('afterend', note);
  el.dataset.countdownDone = 'true';
}
