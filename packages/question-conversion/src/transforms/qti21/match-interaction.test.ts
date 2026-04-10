import { describe, it, assert } from 'vitest';

import type { QTI21ParsedItem } from '../../types/qti21.js';
import { matchInteractionHandler } from './match-interaction.js';

describe('matchInteractionHandler', () => {
  it('throws when item has no matchInteraction', () => {
    const item: QTI21ParsedItem = {
      identifier: 'q1',
      title: 'Match',
      promptHtml: '',
      interactions: [],
      correctResponses: [],
      metadata: {},
    };
    assert.throws(() => matchInteractionHandler.transform(item), /no matchInteraction/);
  });

  it('produces matching body with pairs and distractors', () => {
    const item: QTI21ParsedItem = {
      identifier: 'q1',
      title: 'Match',
      promptHtml: '<p>Match elements to symbols</p>',
      interactions: [
        {
          type: 'matchInteraction',
          responseIdentifier: 'RESPONSE',
          shuffle: false,
          sourceChoices: [
            { identifier: 'S1', html: 'Iron' },
            { identifier: 'S2', html: 'Gold' },
          ],
          targetChoices: [
            { identifier: 'T1', html: 'Fe' },
            { identifier: 'T2', html: 'Au' },
            { identifier: 'T3', html: 'Ag' },
          ],
        },
      ],
      correctResponses: [{ responseIdentifier: 'RESPONSE', values: ['S1 T1', 'S2 T2'] }],
      metadata: {},
    };
    const result = matchInteractionHandler.transform(item);
    assert.equal(result.body.type, 'matching');
    if (result.body.type === 'matching') {
      assert.equal(result.body.pairs.length, 2);
      assert.equal(result.body.pairs[0].statementHtml, 'Iron');
      assert.equal(result.body.pairs[0].optionHtml, 'Fe');
      assert.equal(result.body.pairs[1].statementHtml, 'Gold');
      assert.equal(result.body.pairs[1].optionHtml, 'Au');
      assert.equal(result.body.distractors.length, 1);
      assert.equal(result.body.distractors[0].optionHtml, 'Ag');
    }
  });
});
