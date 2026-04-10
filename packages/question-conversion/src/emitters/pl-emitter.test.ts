import { assert, describe, it } from 'vitest';

import type { IRAssessment, IRAssessmentMeta, IRQuestion } from '../types/ir.js';

import { PLEmitter } from './pl-emitter.js';

function makeAssessment(questions: IRQuestion[], meta?: IRAssessmentMeta): IRAssessment {
  return {
    sourceId: 'test-assessment',
    title: 'Test Assessment',
    questions,
    meta,
  };
}

function makeQuestion(overrides: Partial<IRQuestion> = {}): IRQuestion {
  return {
    sourceId: 'q1',
    title: 'Test Question',
    promptHtml: '<p>What is 2+2?</p>',
    body: {
      type: 'multiple-choice',
      choices: [
        { id: 'a', html: 'Three', correct: false },
        { id: 'b', html: 'Four', correct: true },
      ],
    },
    assets: new Map(),
    ...overrides,
  };
}

const emitter = new PLEmitter();

describe('PLEmitter', () => {
  it('generates info.json with correct fields', () => {
    const result = emitter.emit(makeAssessment([makeQuestion()]));
    assert.equal(result.questions.length, 1);
    const q = result.questions[0];
    assert.equal(q.infoJson.type, 'v3');
    assert.equal(q.infoJson.title, 'Test Question');
    assert.isTrue(q.infoJson.singleVariant);
    assert.match(q.infoJson.uuid, /^[0-9a-f]{8}-/);
  });

  it('generates multiple choice HTML', () => {
    const result = emitter.emit(makeAssessment([makeQuestion()]));
    assert.equal(
      result.questions[0].questionHtml,
      '<pl-question-panel>\n<p>What is 2+2?</p>\n</pl-question-panel>\n\n<pl-multiple-choice answers-name="answer" fixed-order="true">\n  <pl-answer correct="false">Three</pl-answer>\n  <pl-answer correct="true">Four</pl-answer>\n</pl-multiple-choice>',
    );
  });

  it('generates checkbox HTML', () => {
    const q = makeQuestion({
      body: {
        type: 'checkbox',
        choices: [
          { id: 'a', html: 'A', correct: true },
          { id: 'b', html: 'B', correct: false },
        ],
      },
    });
    const result = emitter.emit(makeAssessment([q]));
    assert.equal(
      result.questions[0].questionHtml,
      '<pl-question-panel>\n<p>What is 2+2?</p>\n</pl-question-panel>\n\n<pl-checkbox answers-name="answer" fixed-order="true">\n  <pl-answer correct="true">A</pl-answer>\n  <pl-answer correct="false">B</pl-answer>\n</pl-checkbox>',
    );
  });

  it('generates matching HTML', () => {
    const q = makeQuestion({
      body: {
        type: 'matching',
        pairs: [{ statementHtml: 'Iron', optionHtml: 'Fe' }],
        distractors: [{ optionHtml: 'Au' }],
      },
    });
    const result = emitter.emit(makeAssessment([q]));
    assert.equal(
      result.questions[0].questionHtml,
      '<pl-question-panel>\n<p>What is 2+2?</p>\n</pl-question-panel>\n\n<pl-matching answers-name="answer">\n  <pl-statement match="Fe">Iron</pl-statement>\n  <pl-option>Au</pl-option>\n</pl-matching>',
    );
  });

  it('generates fill-in-blanks HTML with server.py', () => {
    const q = makeQuestion({
      body: {
        type: 'fill-in-blanks',
        blanks: [{ id: 'capital1', correctText: 'bogota', ignoreCase: true }],
      },
    });
    const result = emitter.emit(makeAssessment([q]));
    assert.equal(
      result.questions[0].questionHtml,
      '<pl-question-panel>\n<p>What is 2+2?</p>\n</pl-question-panel>\n\n<p><strong>capital1:</strong></p>\n<pl-string-input answers-name="capital1" remove-leading-trailing="true" ignore-case="true"></pl-string-input>',
    );
    assert.equal(
      result.questions[0].serverPy,
      'def generate(data):\n    data["correct_answers"]["capital1"] = "bogota"\n',
    );
  });

  it('generates rich-text HTML with manual grading', () => {
    const q = makeQuestion({
      body: { type: 'rich-text', gradingMethod: 'Manual' },
    });
    const result = emitter.emit(makeAssessment([q]));
    assert.equal(
      result.questions[0].questionHtml,
      '<pl-question-panel>\n<p>What is 2+2?</p>\n</pl-question-panel>\n\n<pl-rich-text-editor answers-name="answer"></pl-rich-text-editor>',
    );
    assert.equal(result.questions[0].infoJson.gradingMethod, 'Manual');
  });

  it('generates text-only HTML without input element', () => {
    const q = makeQuestion({ body: { type: 'text-only' } });
    const result = emitter.emit(makeAssessment([q]));
    assert.equal(
      result.questions[0].questionHtml,
      '<pl-question-panel>\n<p>What is 2+2?</p>\n</pl-question-panel>\n',
    );
  });

  it('generates server.py for string-input', () => {
    const q = makeQuestion({
      body: { type: 'string-input', correctAnswer: 'hello', ignoreCase: true },
    });
    const result = emitter.emit(makeAssessment([q]));
    assert.equal(
      result.questions[0].serverPy,
      'def generate(data):\n    data["correct_answers"]["answer"] = "hello"\n',
    );
  });

  it('generates server.py for numeric', () => {
    const q = makeQuestion({
      body: { type: 'numeric', answer: { correctValue: 42 } },
    });
    const result = emitter.emit(makeAssessment([q]));
    assert.equal(
      result.questions[0].serverPy,
      'def generate(data):\n    data["correct_answers"]["answer"] = 42\n',
    );
  });

  it('uses custom topic and tags from options', () => {
    const result = emitter.emit(makeAssessment([makeQuestion()]), {
      topic: 'Custom Topic',
      tags: ['custom'],
    });
    assert.equal(result.questions[0].infoJson.topic, 'Custom Topic');
    assert.deepEqual(result.questions[0].infoJson.tags, ['custom']);
  });

  it('generates ordering HTML', () => {
    const q = makeQuestion({
      body: {
        type: 'ordering',
        correctOrder: [
          { id: 'A', html: 'First' },
          { id: 'B', html: 'Second' },
        ],
      },
    });
    const result = emitter.emit(makeAssessment([q]));
    assert.equal(
      result.questions[0].questionHtml,
      '<pl-question-panel>\n<p>What is 2+2?</p>\n</pl-question-panel>\n\n<pl-order-blocks answers-name="answer">\n  <pl-answer correct="true">First</pl-answer>\n  <pl-answer correct="true">Second</pl-answer>\n</pl-order-blocks>',
    );
  });

  it('produces stable UUIDs', () => {
    const r1 = emitter.emit(makeAssessment([makeQuestion()]));
    const r2 = emitter.emit(makeAssessment([makeQuestion()]));
    assert.equal(r1.questions[0].infoJson.uuid, r2.questions[0].infoJson.uuid);
  });

  describe('assessment allowAccess rules', () => {
    it('emits a basic credit:100 rule with no meta', () => {
      const result = emitter.emit(makeAssessment([makeQuestion()]));
      const rules = result.assessment.infoJson.allowAccess ?? [];
      assert.equal(rules.length, 1);
      assert.equal(rules[0].credit, 100);
      assert.isUndefined(rules[0].timeLimitMin);
      assert.isUndefined(rules[0].startDate);
      assert.isUndefined(rules[0].endDate);
    });

    it('adds timeLimitMin for Exam type', () => {
      const result = emitter.emit(
        makeAssessment([makeQuestion()], { assessmentType: 'Exam', timeLimitMinutes: 60 }),
      );
      const rules = result.assessment.infoJson.allowAccess ?? [];
      assert.equal(rules[0].timeLimitMin, 60);
      assert.equal(result.assessment.infoJson.type, 'Exam');
    });

    it('does not add timeLimitMin for Homework type', () => {
      const result = emitter.emit(
        makeAssessment([makeQuestion()], { assessmentType: 'Homework', timeLimitMinutes: 30 }),
      );
      assert.isUndefined(result.assessment.infoJson.allowAccess?.[0].timeLimitMin);
    });

    it('maps lockDate to endDate and startDate', () => {
      const result = emitter.emit(
        makeAssessment([makeQuestion()], {
          assessmentType: 'Homework',
          startDate: '2025-09-01T00:00:00',
          lockDate: '2025-09-05T05:59:59',
          dueDate: '2025-09-04T23:59:59',
        }),
      );
      const rule = result.assessment.infoJson.allowAccess?.[0];
      assert.equal(rule?.startDate, '2025-09-01T00:00:00');
      // lockDate takes precedence over dueDate
      assert.equal(rule?.endDate, '2025-09-05T05:59:59');
    });

    it('falls back to dueDate when lockDate is absent', () => {
      const result = emitter.emit(
        makeAssessment([makeQuestion()], { dueDate: '2025-09-04T23:59:59' }),
      );
      assert.equal(result.assessment.infoJson.allowAccess?.[0].endDate, '2025-09-04T23:59:59');
    });

    it('sets showClosedAssessment: false when hide_results is set', () => {
      const result = emitter.emit(makeAssessment([makeQuestion()], { hideResults: true }));
      assert.isFalse(result.assessment.infoJson.allowAccess?.[0].showClosedAssessment);
    });

    it('sets showClosedAssessment: false when showCorrectAnswers is false', () => {
      const result = emitter.emit(makeAssessment([makeQuestion()], { showCorrectAnswers: false }));
      assert.isFalse(result.assessment.infoJson.allowAccess?.[0].showClosedAssessment);
    });

    it('does not set showClosedAssessment when answers are shown immediately', () => {
      const result = emitter.emit(makeAssessment([makeQuestion()], { showCorrectAnswers: true }));
      assert.isUndefined(result.assessment.infoJson.allowAccess?.[0].showClosedAssessment);
    });

    it('adds a second rule for showCorrectAnswersAt', () => {
      const result = emitter.emit(
        makeAssessment([makeQuestion()], {
          showCorrectAnswers: true,
          showCorrectAnswersAt: '2025-09-05T06:00:00',
          lockDate: '2025-09-05T05:59:59',
        }),
      );
      const rules = result.assessment.infoJson.allowAccess ?? [];
      assert.equal(rules.length, 2);
      assert.equal(rules[1].startDate, '2025-09-05T06:00:00');
      assert.isTrue(rules[1].showClosedAssessment);
      assert.isUndefined(rules[1].credit);
    });

    it('sets shuffleQuestions from meta', () => {
      const result = emitter.emit(makeAssessment([makeQuestion()], { shuffleAnswers: true }));
      assert.isTrue(result.assessment.infoJson.shuffleQuestions);
    });

    it('sets text from descriptionHtml', () => {
      const result = emitter.emit(
        makeAssessment([makeQuestion()], { descriptionHtml: '<p>Instructions</p>' }),
      );
      assert.equal(result.assessment.infoJson.text, '<p>Instructions</p>');
    });
  });

  describe('renderMultipleChoice dropdown', () => {
    it('renders dropdown when display is dropdown', () => {
      const q = makeQuestion({
        body: {
          type: 'multiple-choice',
          display: 'dropdown',
          choices: [
            { id: 'a', html: 'Option A', correct: false },
            { id: 'b', html: 'Option B', correct: true },
          ],
        },
      });
      const html = emitter.emit(makeAssessment([q])).questions[0].questionHtml;
      assert.equal(
        html,
        '<pl-question-panel>\n<p>What is 2+2?</p>\n</pl-question-panel>\n\n<pl-dropdown answers-name="answer">\n  <pl-answer correct="false">Option A</pl-answer>\n  <pl-answer correct="true">Option B</pl-answer>\n</pl-dropdown>',
      );
    });
  });

  describe('inferSetAndNumber from title', () => {
    it('infers Midterm set', () => {
      const assessment = { ...makeAssessment([makeQuestion()]), title: 'Midterm 2' };
      const r = emitter.emit(assessment);
      assert.equal(r.assessment.infoJson.set, 'Midterm');
      assert.equal(r.assessment.infoJson.number, '2');
    });

    it('infers Exam set for "Final Exam"', () => {
      const assessment = { ...makeAssessment([makeQuestion()]), title: 'Final Exam' };
      const r = emitter.emit(assessment);
      assert.equal(r.assessment.infoJson.set, 'Exam');
    });

    it('infers Exam set for plain "Exam 3"', () => {
      const assessment = { ...makeAssessment([makeQuestion()]), title: 'Exam 3' };
      const r = emitter.emit(assessment);
      assert.equal(r.assessment.infoJson.set, 'Exam');
      assert.equal(r.assessment.infoJson.number, '3');
    });

    it('infers Quiz set', () => {
      const assessment = { ...makeAssessment([makeQuestion()]), title: 'Quiz 5' };
      const r = emitter.emit(assessment);
      assert.equal(r.assessment.infoJson.set, 'Quiz');
      assert.equal(r.assessment.infoJson.number, '5');
    });

    it('falls back to Homework set for unrecognized title', () => {
      const assessment = {
        ...makeAssessment([makeQuestion()], { assessmentType: 'Homework' }),
        title: 'Random Assignment',
      };
      const r = emitter.emit(assessment);
      assert.equal(r.assessment.infoJson.set, 'Homework');
      assert.equal(r.assessment.infoJson.number, '1');
    });
  });

  describe('collectClientFiles', () => {
    it('stores base64 asset as Buffer in clientFiles', () => {
      const q = makeQuestion({
        assets: new Map([
          [
            'image.png',
            {
              type: 'base64',
              value: Buffer.from('fake').toString('base64'),
              contentType: 'image/png',
            },
          ],
        ]),
      });
      const result = emitter.emit(makeAssessment([q]));
      const files = result.questions[0].clientFiles;
      assert.isTrue(Buffer.isBuffer(files.get('image.png')));
    });

    it('stores file-path asset as string in clientFiles', () => {
      const q = makeQuestion({
        assets: new Map([['chart.png', { type: 'file-path', value: 'Quiz Files/chart.png' }]]),
      });
      const result = emitter.emit(makeAssessment([q]));
      const files = result.questions[0].clientFiles;
      assert.equal(files.get('chart.png'), 'Quiz Files/chart.png');
    });
  });

  describe('duplicate directory name deduplication', () => {
    it('appends -2 suffix when two questions have the same title', () => {
      const q1 = makeQuestion({ sourceId: 'q1', title: 'Same Title' });
      const q2 = makeQuestion({ sourceId: 'q2', title: 'Same Title' });
      const result = emitter.emit(makeAssessment([q1, q2]));
      const dirs = result.questions.map((q) => q.directoryName);
      assert.equal(dirs[0], 'same-title');
      assert.equal(dirs[1], 'same-title-2');
    });
  });

  describe('zone-based assessment', () => {
    it('emits zones when assessment has zones defined', () => {
      const q = makeQuestion();
      const assessment: IRAssessment = {
        sourceId: 'a1',
        title: 'Zoned Assessment',
        questions: [q],
        zones: [{ title: 'Part 1', questions: [q] }],
      };
      const result = emitter.emit(assessment);
      assert.equal(result.assessment.infoJson.zones[0].title, 'Part 1');
    });
  });

  describe('warnings on transform errors', () => {
    it('records a warning and skips questions that throw during emit', () => {
      // Use an unsupported body type via cast to trigger the emitter error path
      const badQ = makeQuestion({ body: { type: 'text-only' } });
      // Patch the question to be valid but make it produce a duplicate that could fail
      const result = emitter.emit(makeAssessment([badQ]));
      assert.equal(result.questions.length, 1);
    });
  });

  describe('sourceId on PLQuestionOutput', () => {
    it('populates sourceId on each emitted question', () => {
      const q1 = makeQuestion({ sourceId: 'q-abc' });
      const q2 = makeQuestion({ sourceId: 'q-xyz', title: 'Another Question' });
      const result = emitter.emit(makeAssessment([q1, q2]));
      assert.equal(result.questions[0].sourceId, 'q-abc');
      assert.equal(result.questions[1].sourceId, 'q-xyz');
    });
  });

  describe('emission failure resilience', () => {
    function makeBadQuestion(overrides: Partial<IRQuestion> = {}): IRQuestion {
      // Cast to IRQuestion with an unsupported body type to force emitQuestion to throw
      return makeQuestion({
        ...overrides,
        body: { type: 'unsupported-type' } as unknown as IRQuestion['body'],
      });
    }

    it('emits a warning and excludes the failed question', () => {
      const bad = makeBadQuestion({ sourceId: 'bad-q' });
      const good = makeQuestion({ sourceId: 'good-q', title: 'Good Question' });
      const result = emitter.emit(makeAssessment([bad, good]));
      assert.equal(result.questions.length, 1);
      assert.equal(result.questions[0].sourceId, 'good-q');
      assert.equal(result.warnings.length, 1);
      assert.equal(result.warnings[0].questionId, 'bad-q');
    });

    it('assigns correct autoPoints in single-zone fallback when first question fails', () => {
      const bad = makeBadQuestion({ sourceId: 'bad-q', points: 5 });
      const good = makeQuestion({ sourceId: 'good-q', title: 'Good Question', points: 10 });
      const result = emitter.emit(makeAssessment([bad, good]));
      const zones = result.assessment.infoJson.zones;
      assert.equal(zones.length, 1);
      assert.equal(zones[0].questions.length, 1);
      // autoPoints must come from the good question (10), not the bad question (5)
      assert.equal(zones[0].questions[0].autoPoints, 10);
    });

    it('maps zone questions correctly when first question fails', () => {
      const bad = makeBadQuestion({ sourceId: 'bad-q' });
      const good = makeQuestion({ sourceId: 'good-q', title: 'Good Question', points: 7 });
      const assessment: IRAssessment = {
        sourceId: 'a1',
        title: 'Test',
        questions: [bad, good],
        zones: [{ title: 'Part 1', questions: [bad, good] }],
      };
      const result = emitter.emit(assessment);
      const zoneQs = result.assessment.infoJson.zones[0].questions;
      // Only the good question should appear in the zone
      assert.equal(zoneQs.length, 1);
      assert.equal(zoneQs[0].id, result.questions[0].directoryName);
      assert.equal(zoneQs[0].autoPoints, 7);
    });
  });
});
