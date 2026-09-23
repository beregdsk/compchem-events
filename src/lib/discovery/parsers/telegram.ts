import { parseHTML, splitTelegramPosts, type ExtractionInput } from '../html';

/** Every post is exactly as hostile as a web page — same extraction pipeline, no exceptions. */
export function extractionInputsFromChannel(html: string): ExtractionInput[] {
  return splitTelegramPosts(parseHTML(html));
}
