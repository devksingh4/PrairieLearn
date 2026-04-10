import { readFileSync } from 'node:fs';
import path from 'node:path';

import { assert, describe, it } from 'vitest';

import { QTI21Parser } from './qti21-parser.js';

const FIXTURES = path.join(import.meta.dirname, '../../test-fixtures/qti21');

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf-8');
}

const parser = new QTI21Parser();

describe('QTI21Parser', () => {
  describe('canParse', () => {
    it('returns true for QTI 2.1 XML', () => {
      assert.isTrue(parser.canParse(readFixture('choice-interaction.xml')));
    });

    it('returns false for QTI 1.2 XML', () => {
      assert.isFalse(
        parser.canParse(
          '<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2"></questestinterop>',
        ),
      );
    });

    it('returns true for XML with <assessmentItem tag', () => {
      assert.isTrue(parser.canParse('<assessmentItem identifier="x">'));
    });

    it('throws for XML missing both assessmentItem and assessmentTest', () => {
      assert.throws(() => parser.parse('<root><other/></root>'), /Invalid QTI 2\.1/);
    });
  });

  describe('choice interaction (single-select)', () => {
    it('parses a single-select choice interaction', () => {
      const result = parser.parse(readFixture('choice-interaction.xml'));
      assert.equal(result.sourceId, 'q1');
      assert.equal(result.title, 'Capital Question');
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'multiple-choice');
      if (q.body.type === 'multiple-choice') {
        assert.equal(q.body.choices.length, 3);
        assert.isFalse(q.body.choices[0].correct);
        assert.isTrue(q.body.choices[1].correct);
        assert.isFalse(q.body.choices[2].correct);
      }
    });
  });

  describe('choice interaction (multi-select / checkbox)', () => {
    it('parses a multi-select choice interaction as checkbox', () => {
      const result = parser.parse(readFixture('checkbox-interaction.xml'));
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'checkbox');
      if (q.body.type === 'checkbox') {
        assert.equal(q.body.choices.length, 3);
        assert.isTrue(q.body.choices[0].correct); // A=2, correct
        assert.isFalse(q.body.choices[1].correct); // B=4, wrong
        assert.isTrue(q.body.choices[2].correct); // C=7, correct
      }
    });
  });

  describe('textEntryInteraction', () => {
    it('parses a text entry interaction as string-input', () => {
      const result = parser.parse(readFixture('text-entry.xml'));
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'string-input');
      if (q.body.type === 'string-input') {
        assert.equal(q.body.correctAnswer, 'photosynthesis');
      }
    });

    it('includes prompt text', () => {
      const result = parser.parse(readFixture('text-entry.xml'));
      assert.equal(
        result.questions[0].promptHtml,
        'What process do plants use to convert sunlight into energy?',
      );
    });
  });

  describe('extendedTextInteraction', () => {
    it('parses an extended text interaction as rich-text', () => {
      const result = parser.parse(readFixture('extended-text.xml'));
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'rich-text');
      if (q.body.type === 'rich-text') {
        assert.equal(q.body.gradingMethod, 'Manual');
      }
    });
  });

  describe('matchInteraction', () => {
    it('parses a match interaction', () => {
      const result = parser.parse(readFixture('match-interaction.xml'));
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'matching');
      if (q.body.type === 'matching') {
        assert.equal(q.body.pairs.length, 2);
        assert.equal(q.body.pairs[0].statementHtml, 'France');
        assert.equal(q.body.pairs[0].optionHtml, 'Paris');
        assert.equal(q.body.pairs[1].statementHtml, 'Germany');
        assert.equal(q.body.pairs[1].optionHtml, 'Berlin');
        assert.equal(q.body.distractors.length, 1);
        assert.equal(q.body.distractors[0].optionHtml, 'Madrid');
      }
    });
  });

  describe('orderInteraction', () => {
    it('parses an order interaction', () => {
      const result = parser.parse(readFixture('order-interaction.xml'));
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'ordering');
      if (q.body.type === 'ordering') {
        assert.equal(q.body.correctOrder.length, 3);
        assert.equal(q.body.correctOrder[0].html, 'Step 1: Initialize');
        assert.equal(q.body.correctOrder[1].html, 'Step 2: Process');
        assert.equal(q.body.correctOrder[2].html, 'Step 3: Output');
      }
    });
  });

  describe('inlineChoiceInteraction', () => {
    it('parses an inline choice interaction as multiple-choice dropdown', () => {
      const result = parser.parse(readFixture('inline-choice.xml'));
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'multiple-choice');
      if (q.body.type === 'multiple-choice') {
        assert.equal(q.body.display, 'dropdown');
        assert.equal(q.body.choices.length, 3);
        assert.isFalse(q.body.choices[0].correct); // A=green
        assert.isTrue(q.body.choices[1].correct); // B=blue
        assert.isFalse(q.body.choices[2].correct); // C=red
      }
    });
  });

  describe('assessmentTest (multi-item)', () => {
    it('parses an assessmentTest with nested sections and items', () => {
      const result = parser.parse(readFixture('assessment-test.xml'));
      assert.equal(result.sourceId, 'test1');
      assert.equal(result.title, 'Sample Test');
      assert.equal(result.questions.length, 2);

      assert.equal(result.questions[0].sourceId, 'q1');
      assert.equal(result.questions[0].body.type, 'multiple-choice');
      assert.equal(result.questions[1].sourceId, 'q2');
    });
  });

  describe('unknown interaction type', () => {
    it('returns no questions for an item with no recognized interaction', () => {
      const xml = `<?xml version="1.0"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1"
  identifier="q-unknown" title="Unknown">
  <itemBody>
    <p>No interaction here.</p>
  </itemBody>
</assessmentItem>`;
      const result = parser.parse(xml);
      assert.equal(result.questions.length, 0);
    });
  });
});
