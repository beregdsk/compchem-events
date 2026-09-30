// Progressive enhancement: header buttons sort a `data-sortable` table by
// each cell's `data-sort`. Without JS the table keeps its server order.
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
      const rows = [...body.rows].sort((a, b) => {
        const x = key(a);
        const y = key(b);
        const nx = Number(x);
        const ny = Number(y);
        const numeric = x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny);
        const cmp = numeric ? nx - ny : x.localeCompare(y);
        return ascending ? cmp : -cmp;
      });
      body.append(...rows);
      for (const th of table.tHead?.rows[0]?.cells ?? []) th.removeAttribute('aria-sort');
      button.parentElement?.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
    });
  }
}
