import { htmlToText, parseHTML, type ExtractionInput } from '../html';

/** The whole page, as plain text, with its own fetched URL as the source. */
export function extractionInputFromPage(html: string, url: string): ExtractionInput {
  return { text: htmlToText(parseHTML(html)), sourceUrl: url };
}
