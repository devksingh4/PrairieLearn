import { assert, describe, it } from 'vitest';

import type { QTI21ParsedItem } from '../../types/qti21.js';

import { choiceInteractionHandler } from './choice-interaction.js';

function makeItem(maxChoices = 1): QTI21ParsedItem {
  return {
    identifier: 'q1',
    title: 'Choice Question',
    promptHtml: '<p>Pick one</p>',
    interactions: [
      {
        type: 'choiceInteraction',
        responseIdentifier: 'RESPONSE',
        maxChoices,
        shuffle: false,
        choices: [
          { identifier: 'A', html: 'Option A' },
          { identifier: 'B', html: 'Option B' },
          { identifier: 'C', html: 'Option C' },
        ],
      },
    ],
    correctResponses: [{ responseIdentifier: 'RESPONSE', values: ['B'] }],
    metadata: {},
  };
}

describe('choiceInteractionHandler', () => {
  it('produces multiple-choice for maxChoices=1', () => {
    const result = choiceInteractionHandler.transform(makeItem(1));
    assert.equal(result.body.type, 'multiple-choice');
    if (result.body.type === 'multiple-choice') {
      assert.equal(result.body.choices.length, 3);
      assert.isFalse(result.body.choices[0].correct);
      assert.isTrue(result.body.choices[1].correct);
    }
  });

  it('throws when item has no choiceInteraction', () => {
    const item = makeItem();
    item.interactions = [];
    assert.throws(() => choiceInteractionHandler.transform(item), /no choiceInteraction/);
  });

  it('produces checkbox for maxChoices > 1', () => {
    const item = makeItem(2);
    item.correctResponses = [{ responseIdentifier: 'RESPONSE', values: ['A', 'C'] }];
    const result = choiceInteractionHandler.transform(item);
    assert.equal(result.body.type, 'checkbox');
    if (result.body.type === 'checkbox') {
      assert.isTrue(result.body.choices[0].correct);
      assert.isFalse(result.body.choices[1].correct);
      assert.isTrue(result.body.choices[2].correct);
    }
  });
});
