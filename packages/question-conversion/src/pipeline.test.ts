import { readFileSync } from 'node:fs';
import path from 'node:path';

import { assert, describe, it } from 'vitest';

import { convert } from './pipeline.js';

const QTI12_FIXTURES = path.join(import.meta.dirname, 'test-fixtures/qti12');

describe('convert (integration)', () => {
  describe('QTI 1.2 assessment', () => {
    it('converts a multiple choice quiz end-to-end', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-mc.xml'), 'utf-8');
      const result = convert(xml, { topic: 'Data Structures' });

      assert.equal(result.questions.length, 1);
      const q = result.questions[0];
      assert.equal(q.infoJson.type, 'v3');
      assert.equal(q.infoJson.title, 'Hashing Question');
      assert.equal(q.infoJson.topic, 'Data Structures');
      assert.deepEqual(q.infoJson.tags, ['imported', 'qti']);
      assert.isTrue(q.infoJson.singleVariant);
      assert.equal(q.directoryName, 'hashing');
      assert.equal(
        q.questionHtml,
        '<pl-question-panel>\n<p>Which collision resolution method tries different sequences?</p>\n</pl-question-panel>\n\n<pl-multiple-choice answers-name="answer" fixed-order="true">\n  <pl-answer correct="true">Double hashing</pl-answer>\n  <pl-answer correct="false">Linear probing</pl-answer>\n  <pl-answer correct="false">Quadratic probing</pl-answer>\n</pl-multiple-choice>',
      );
    });

    it('converts a true/false quiz end-to-end', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-tf.xml'), 'utf-8');
      const result = convert(xml);
      assert.equal(result.questions.length, 1);
      assert.equal(
        result.questions[0].questionHtml,
        '<pl-question-panel>\nThe sky is blue.\n</pl-question-panel>\n\n<pl-multiple-choice answers-name="answer" fixed-order="true">\n  <pl-answer correct="true">True</pl-answer>\n  <pl-answer correct="false">False</pl-answer>\n</pl-multiple-choice>',
      );
    });

    it('converts a checkbox quiz end-to-end', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-checkbox.xml'), 'utf-8');
      const result = convert(xml);
      assert.equal(result.questions.length, 1);
      assert.equal(
        result.questions[0].questionHtml,
        '<pl-question-panel>\n<p>Select all correct answers</p>\n</pl-question-panel>\n\n<pl-checkbox answers-name="answer" fixed-order="true">\n  <pl-answer correct="true">Correct A</pl-answer>\n  <pl-answer correct="true">Correct B</pl-answer>\n  <pl-answer correct="false">Wrong C</pl-answer>\n</pl-checkbox>',
      );
    });

    it('converts a matching quiz end-to-end', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-matching.xml'), 'utf-8');
      const result = convert(xml);
      assert.equal(result.questions.length, 1);
      assert.equal(
        result.questions[0].questionHtml,
        '<pl-question-panel>\n<p>Match terms with definitions</p>\n</pl-question-panel>\n\n<pl-matching answers-name="answer">\n  <pl-statement match="Upper Bound">Big O</pl-statement>\n  <pl-statement match="Tight Bound">Big Theta</pl-statement>\n  <pl-option>Lower Bound</pl-option>\n</pl-matching>',
      );
    });

    it('converts a fill-in-blanks quiz end-to-end', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-fitb.xml'), 'utf-8');
      const result = convert(xml);
      assert.equal(result.questions.length, 1);
      const q = result.questions[0];
      assert.equal(
        q.questionHtml,
        '<pl-question-panel>\n<p>The capital of Colombia is <pl-string-input answers-name="capital1" correct-answer="bogota" remove-leading-trailing="true" ignore-case="true"></pl-string-input> and Estonia is <pl-string-input answers-name="capital2" correct-answer="tallinn" remove-leading-trailing="true" ignore-case="true"></pl-string-input>.</p>\n</pl-question-panel>\n',
      );
      assert.isUndefined(q.serverPy);
    });

    it('propagates access_code from assessment_meta.xml into allowAccess password', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-mc.xml'), 'utf-8');
      const meta = `<?xml version="1.0" encoding="UTF-8"?>
<quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
  <allowed_attempts>1</allowed_attempts>
  <access_code>hunter2</access_code>
</quiz>`;
      const result = convert(xml, { assessmentMetaXml: meta });
      const rules = result.assessment.infoJson.allowAccess;
      assert.isDefined(rules);
      assert.isTrue(rules!.some((r) => r.password === 'hunter2'));
    });
  });

  describe('error handling', () => {
    it('throws for unrecognized format', () => {
      assert.throws(() => convert('<html>not qti</html>'), /No parser found/);
    });
  });

  describe('deterministic output', () => {
    it('produces identical UUIDs across runs', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-mc.xml'), 'utf-8');
      const r1 = convert(xml);
      const r2 = convert(xml);
      assert.equal(r1.questions[0].infoJson.uuid, r2.questions[0].infoJson.uuid);
    });
  });
});
