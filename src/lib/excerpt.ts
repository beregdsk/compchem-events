/** The opening of a long text, cut at a word boundary, for cards and meta tags. */
export function excerpt(text: string, max = 280): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}
