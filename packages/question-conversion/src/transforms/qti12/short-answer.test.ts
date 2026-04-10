import { describe, it, assert } from 'vitest';

import type { QTI12ParsedItem } from '../../types/qti12.js';
import { shortAnswerHandler } from './short-answer.js';

describe('shortAnswerHandler', () => {
  it('produces string-input body from correct condition', () => {
    const item: QTI12ParsedItem = {
      ident: 'q1',
      title: 'Short Answer',
      questionType: 'short_answer_question',
      promptHtml: '<p>What is 2+2?</p>',
      responseLids: [],
      responseStrs: [{ ident: 'response1', rcardinality: 'Single', labels: [] }],
      correctConditions: [{ responseIdent: 'response1', correctLabelIdent: '4' }],
      feedbacks: new Map(),
      metadata: {},
    };
    const result = shortAnswerHandler.transform(item);
    assert.equal(result.body.type, 'string-input');
    if (result.body.type === 'string-input') {
      assert.equal(result.body.correctAnswer, '4');
      assert.isTrue(result.body.ignoreCase);
    }
  });

  it('falls back to general_fb when no correct condition', () => {
    const item: QTI12ParsedItem = {
      ident: 'q1',
      title: 'Short Answer',
      questionType: 'short_answer_question',
      promptHtml: '<p>Name something</p>',
      responseLids: [],
      responseStrs: [],
      correctConditions: [],
      feedbacks: new Map([['general_fb', 'expected answer']]),
      metadata: {},
    };
    const result = shortAnswerHandler.transform(item);
    if (result.body.type === 'string-input') {
      assert.equal(result.body.correctAnswer, 'expected answer');
    }
  });
});
