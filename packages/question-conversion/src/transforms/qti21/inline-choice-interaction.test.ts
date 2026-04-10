import { assert, describe, it } from 'vitest';

import type { QTI21ParsedItem } from '../../types/qti21.js';

import { inlineChoiceInteractionHandler } from './inline-choice-interaction.js';

describe('inlineChoiceInteractionHandler', () => {
  it('throws when item has no inlineChoiceInteraction', () => {
    const item: QTI21ParsedItem = {
      identifier: 'q1',
      title: 'Dropdown',
      promptHtml: '',
      interactions: [],
      correctResponses: [],
      metadata: {},
    };
    assert.throws(
      () => inlineChoiceInteractionHandler.transform(item),
      /no inlineChoiceInteraction/,
    );
  });

  it('produces multiple-choice with dropdown display', () => {
    const item: QTI21ParsedItem = {
      identifier: 'q1',
      title: 'Dropdown',
      promptHtml: '<p>Select the correct answer</p>',
      interactions: [
        {
          type: 'inlineChoiceInteraction',
          responseIdentifier: 'RESPONSE',
          choices: [
            { identifier: 'A', text: 'Option A' },
            { identifier: 'B', text: 'Option B' },
          ],
        },
      ],
      correctResponses: [{ responseIdentifier: 'RESPONSE', values: ['A'] }],
      metadata: {},
    };
    const result = inlineChoiceInteractionHandler.transform(item);
    assert.equal(result.body.type, 'multiple-choice');
    if (result.body.type === 'multiple-choice') {
      assert.equal(result.body.display, 'dropdown');
      assert.isTrue(result.body.choices[0].correct);
      assert.isFalse(result.body.choices[1].correct);
    }
  });
});
