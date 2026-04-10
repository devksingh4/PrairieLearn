import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, assert } from 'vitest';

import { convert } from './pipeline.js';

const QTI12_FIXTURES = path.join(import.meta.dirname, 'test-fixtures/qti12');
const QTI21_FIXTURES = path.join(import.meta.dirname, 'test-fixtures/qti21');

describe('convert (integration)', () => {
  describe('QTI 1.2 assessment', () => {
    it('converts a multiple choice quiz end-to-end', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-mc.xml'), 'utf-8');
      const result = convert(xml, { topic: 'Data Structures' });

      assert.equal(result.questions.length, 1);
      const q = result.questions[0];
      assert.equal(q.infoJson.type, 'v3');
      assert.equal(q.infoJson.topic, 'Data Structures');
      assert.include(q.questionHtml, '<pl-multiple-choice');
      assert.include(q.questionHtml, 'Double hashing');
      assert.equal(q.directoryName, 'hashing');
    });

    it('converts a true/false quiz end-to-end', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-tf.xml'), 'utf-8');
      const result = convert(xml);
      assert.equal(result.questions.length, 1);
      assert.include(result.questions[0].questionHtml, 'True');
      assert.include(result.questions[0].questionHtml, 'False');
    });

    it('converts a checkbox quiz end-to-end', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-checkbox.xml'), 'utf-8');
      const result = convert(xml);
      assert.equal(result.questions.length, 1);
      assert.include(result.questions[0].questionHtml, '<pl-checkbox');
    });

    it('converts a matching quiz end-to-end', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-matching.xml'), 'utf-8');
      const result = convert(xml);
      assert.equal(result.questions.length, 1);
      assert.include(result.questions[0].questionHtml, '<pl-matching');
      assert.include(result.questions[0].questionHtml, '<pl-statement');
    });

    it('converts a fill-in-blanks quiz end-to-end', () => {
      const xml = readFileSync(path.join(QTI12_FIXTURES, 'canvas-fitb.xml'), 'utf-8');
      const result = convert(xml);
      assert.equal(result.questions.length, 1);
      assert.include(result.questions[0].questionHtml, '<pl-string-input');
      assert.isDefined(result.questions[0].serverPy);
      assert.include(result.questions[0].serverPy!, 'bogota');
    });
  });

  describe('QTI 2.1', () => {
    it('converts a choice interaction end-to-end', () => {
      const xml = readFileSync(path.join(QTI21_FIXTURES, 'choice-interaction.xml'), 'utf-8');
      const result = convert(xml);
      assert.equal(result.questions.length, 1);
      assert.include(result.questions[0].questionHtml, '<pl-multiple-choice');
      assert.include(result.questions[0].questionHtml, 'Paris');
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
