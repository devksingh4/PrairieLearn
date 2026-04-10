import { assert, describe, it } from 'vitest';

import type { QTI21ParsedItem } from '../../types/qti21.js';

import { orderInteractionHandler } from './order-interaction.js';

describe('orderInteractionHandler', () => {
  it('throws when item has no orderInteraction', () => {
    const item: QTI21ParsedItem = {
      identifier: 'q1',
      title: 'Order',
      promptHtml: '',
      interactions: [],
      correctResponses: [],
      metadata: {},
    };
    assert.throws(() => orderInteractionHandler.transform(item), /no orderInteraction/);
  });

  it('produces ordering body with correct sequence', () => {
    const item: QTI21ParsedItem = {
      identifier: 'q1',
      title: 'Order',
      promptHtml: '<p>Put in order</p>',
      interactions: [
        {
          type: 'orderInteraction',
          responseIdentifier: 'RESPONSE',
          shuffle: true,
          choices: [
            { identifier: 'C', html: 'Third' },
            { identifier: 'A', html: 'First' },
            { identifier: 'B', html: 'Second' },
          ],
        },
      ],
      correctResponses: [{ responseIdentifier: 'RESPONSE', values: ['A', 'B', 'C'] }],
      metadata: {},
    };
    const result = orderInteractionHandler.transform(item);
    assert.equal(result.body.type, 'ordering');
    if (result.body.type === 'ordering') {
      assert.equal(result.body.correctOrder.length, 3);
      assert.equal(result.body.correctOrder[0].html, 'First');
      assert.equal(result.body.correctOrder[1].html, 'Second');
      assert.equal(result.body.correctOrder[2].html, 'Third');
    }
  });
});
