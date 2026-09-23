import { describe, expect, it } from 'vitest';
import { extractionInputsFromChannel } from '../../../src/lib/discovery/parsers/telegram';

describe('extractionInputsFromChannel', () => {
  it('returns one extraction input per post', () => {
    const html = `
      <div class="tgme_widget_message" data-post="chan/1">
        <div class="tgme_widget_message_text">Announcing a workshop.</div>
      </div>`;
    const inputs = extractionInputsFromChannel(html);
    expect(inputs).toEqual([{ sourceUrl: 'https://t.me/chan/1', text: 'Announcing a workshop.' }]);
  });
});
