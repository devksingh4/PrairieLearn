import { assert, describe, it } from 'vitest';

import type { QTI21ParsedItem } from '../../types/qti21.js';

import { extendedTextInteractionHandler } from './extended-text-interaction.js';

describe('extendedTextInteractionHandler', () => {
  it('produces rich-text body', () => {
    const item: QTI21ParsedItem = {
      identifier: 'q1',
      title: 'Essay',
      promptHtml: '<p>Write an essay</p>',
      interactions: [{ type: 'extendedTextInteraction', responseIdentifier: 'RESPONSE' }],
      correctResponses: [],
      metadata: {},
    };
    const result = extendedTextInteractionHandler.transform(item);
    assert.equal(result.body.type, 'rich-text');
    if (result.body.type !== 'rich-text') {
      assert.fail(`Expected matching body, got ${result.body.type}`);
    }
    assert.equal(result.body.gradingMethod, 'Manual');
  });
});
