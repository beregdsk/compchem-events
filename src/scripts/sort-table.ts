// Progressive enhancement: header buttons sort a `data-sortable` table by
// each cell's `data-sort`. Without JS the table keeps its server order.
import { compareSortKeys } from '../lib/sort-keys';

for (const table of document.querySelectorAll<HTMLTableElement>('table[data-sortable]')) {
  const body = table.tBodies[0];
  if (!body) continue;
  let current = -1;
  let ascending = false;
  for (const button of table.querySelectorAll<HTMLButtonElement>('button[data-sort-col]')) {
    button.addEventListener('click', () => {
      const col = Number(button.dataset.sortCol);
      // A new column starts descending (biggest first), the name column A–Z.
      ascending = col === current ? !ascending : col === 0;
      current = col;
      const key = (row: HTMLTableRowElement) =>
        (row.cells[col] as HTMLElement | undefined)?.dataset.sort ?? '';
      const rows = [...body.rows].sort((a, b) => compareSortKeys(key(a), key(b), ascending));
      body.append(...rows);
      for (const th of table.tHead?.rows[0]?.cells ?? []) th.removeAttribute('aria-sort');
      button.parentElement?.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
    });
  }
}
