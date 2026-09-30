// Comparison for sortable tables' `data-sort` keys: numbers numerically,
// text alphabetically, and an empty key (no value, shown as "—") always last,
// whichever way the column is sorted.
export function compareSortKeys(x: string, y: string, ascending: boolean): number {
  if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1;
  const nx = Number(x);
  const ny = Number(y);
  const cmp = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
  return ascending ? cmp : -cmp;
}
