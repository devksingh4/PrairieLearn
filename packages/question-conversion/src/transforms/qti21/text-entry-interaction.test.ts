import { describe, it, assert } from 'vitest';

import type { QTI21ParsedItem } from '../../types/qti21.js';
import { textEntryInteractionHandler } from './text-entry-interaction.js';

describe('textEntryInteractionHandler', () => {
  it('throws when item has no textEntryInteraction', () => {
    const item: QTI21ParsedItem = {
      identifier: 'q1',
      title: 'Text Entry',
      promptHtml: '',
      interactions: [],
      correctResponses: [],
      metadata: {},
    };
    assert.throws(() => textEntryInteractionHandler.transform(item), /no textEntryInteraction/);
  });

  it('produces string-input body', () => {
    const item: QTI21ParsedItem = {
      identifier: 'q1',
      title: 'Text Entry',
      promptHtml: '<p>What is 2+2?</p>',
      interactions: [{ type: 'textEntryInteraction', responseIdentifier: 'RESPONSE' }],
      correctResponses: [{ responseIdentifier: 'RESPONSE', values: ['4'] }],
      metadata: {},
    };
    const result = textEntryInteractionHandler.transform(item);
    assert.equal(result.body.type, 'string-input');
    if (result.body.type === 'string-input') {
      assert.equal(result.body.correctAnswer, '4');
    }
  });
});
