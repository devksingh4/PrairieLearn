import { readFileSync } from 'node:fs';
import path from 'node:path';

import { assert, describe, it } from 'vitest';

import { QTI12AssessmentParser } from './qti12-assessment-parser.js';

const FIXTURES = path.join(import.meta.dirname, '../../test-fixtures/qti12');

function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), 'utf-8');
}

const parser = new QTI12AssessmentParser();

describe('QTI12AssessmentParser', () => {
  describe('canParse', () => {
    it('returns true for QTI 1.2 assessment XML', () => {
      assert.isTrue(parser.canParse(readFixture('canvas-mc.xml')));
    });

    it('returns false for non-QTI XML', () => {
      assert.isFalse(parser.canParse('<html><body>hello</body></html>'));
    });
  });

  describe('correct condition parsing', () => {
    it('ignores feedback-only respconditions (no setvar) when determining correct answers', () => {
      // Canvas QTI emits a displayfeedback respcondition (no setvar) for EVERY answer,
      // then a separate setvar=100 condition for the correct answer only.
      // Without the fix, every answer's feedback condition would be treated as correct.
      const xml = `<?xml version="1.0"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Q">
    <section ident="root_section">
      <item ident="q1" title="Q1">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Pick&lt;/p&gt;</mattext></material>
          <response_lid ident="response1" rcardinality="Single">
            <render_choice>
              <response_label ident="a1"><material><mattext>Washington</mattext></material></response_label>
              <response_label ident="a2"><material><mattext>Jefferson</mattext></material></response_label>
              <response_label ident="a3"><material><mattext>Lincoln</mattext></material></response_label>
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <respcondition continue="Yes">
            <conditionvar><varequal respident="response1">a1</varequal></conditionvar>
            <displayfeedback feedbacktype="Response" linkrefid="a1_fb"/>
          </respcondition>
          <respcondition continue="Yes">
            <conditionvar><varequal respident="response1">a2</varequal></conditionvar>
            <displayfeedback feedbacktype="Response" linkrefid="a2_fb"/>
          </respcondition>
          <respcondition continue="Yes">
            <conditionvar><varequal respident="response1">a3</varequal></conditionvar>
            <displayfeedback feedbacktype="Response" linkrefid="a3_fb"/>
          </respcondition>
          <respcondition continue="No">
            <conditionvar><varequal respident="response1">a2</varequal></conditionvar>
            <setvar varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
      </item>
    </section>
  </assessment>
</questestinterop>`;
      const result = parser.parse(xml);
      const q = result.questions[0];
      assert.equal(q.body.type, 'multiple-choice');
      if (q.body.type === 'multiple-choice') {
        assert.isFalse(q.body.choices[0].correct, 'Washington should not be correct');
        assert.isTrue(q.body.choices[1].correct, 'Jefferson should be correct');
        assert.isFalse(q.body.choices[2].correct, 'Lincoln should not be correct');
      }
    });

    it('ignores feedback-only respconditions for true/false (prevents both choices being marked correct)', () => {
      const xml = `<?xml version="1.0"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Q">
    <section ident="root_section">
      <item ident="q1" title="TF">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>true_false_question</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;The sky is blue.&lt;/p&gt;</mattext></material>
          <response_lid ident="response1" rcardinality="Single">
            <render_choice>
              <response_label ident="t1"><material><mattext>True</mattext></material></response_label>
              <response_label ident="f1"><material><mattext>False</mattext></material></response_label>
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <respcondition continue="Yes">
            <conditionvar><varequal respident="response1">t1</varequal></conditionvar>
            <displayfeedback feedbacktype="Response" linkrefid="t1_fb"/>
          </respcondition>
          <respcondition continue="Yes">
            <conditionvar><varequal respident="response1">f1</varequal></conditionvar>
            <displayfeedback feedbacktype="Response" linkrefid="f1_fb"/>
          </respcondition>
          <respcondition continue="No">
            <conditionvar><varequal respident="response1">t1</varequal></conditionvar>
            <setvar varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
      </item>
    </section>
  </assessment>
</questestinterop>`;
      const result = parser.parse(xml);
      const q = result.questions[0];
      assert.equal(q.body.type, 'multiple-choice');
      if (q.body.type === 'multiple-choice') {
        assert.isTrue(q.body.choices[0].correct, 'True should be correct');
        assert.isFalse(q.body.choices[1].correct, 'False should not be correct');
      }
    });
  });

  describe('feedback parsing', () => {
    it('extracts correct_fb and general_incorrect_fb via flow_mat path', () => {
      const xml = `<?xml version="1.0"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Q">
    <section ident="root_section">
      <item ident="q1" title="Q1">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Pick&lt;/p&gt;</mattext></material>
          <response_lid ident="response1" rcardinality="Single">
            <render_choice>
              <response_label ident="a1"><material><mattext>A</mattext></material></response_label>
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <respcondition continue="No">
            <conditionvar><varequal respident="response1">a1</varequal></conditionvar>
            <setvar varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
        <itemfeedback ident="correct_fb">
          <flow_mat><material><mattext texttype="text/html">&lt;p&gt;Well done!&lt;/p&gt;</mattext></material></flow_mat>
        </itemfeedback>
        <itemfeedback ident="general_incorrect_fb">
          <flow_mat><material><mattext texttype="text/html">&lt;p&gt;Try again.&lt;/p&gt;</mattext></material></flow_mat>
        </itemfeedback>
      </item>
    </section>
  </assessment>
</questestinterop>`;
      const result = parser.parse(xml);
      const q = result.questions[0];
      assert.equal(q.feedback?.correct, '<p>Well done!</p>');
      assert.equal(q.feedback?.incorrect, '<p>Try again.</p>');
    });

    it('falls back to per-answer {ident}_fb feedback when global idents are absent', () => {
      // This is the Canvas pattern for true/false and MC questions with per-answer feedback.
      // The correct answer's {ident}_fb becomes feedback.correct; an incorrect one becomes feedback.incorrect.
      const xml = `<?xml version="1.0"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Q">
    <section ident="root_section">
      <item ident="q1" title="Coconuts">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>true_false_question</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Are coconuts migratory?&lt;/p&gt;</mattext></material>
          <response_lid ident="response1" rcardinality="Single">
            <render_choice>
              <response_label ident="7877"><material><mattext>True</mattext></material></response_label>
              <response_label ident="5840"><material><mattext>False</mattext></material></response_label>
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <respcondition continue="Yes">
            <conditionvar><varequal respident="response1">7877</varequal></conditionvar>
            <displayfeedback feedbacktype="Response" linkrefid="7877_fb"/>
          </respcondition>
          <respcondition continue="Yes">
            <conditionvar><varequal respident="response1">5840</varequal></conditionvar>
            <displayfeedback feedbacktype="Response" linkrefid="5840_fb"/>
          </respcondition>
          <respcondition continue="No">
            <conditionvar><varequal respident="response1">7877</varequal></conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
        <itemfeedback ident="7877_fb">
          <flow_mat><material><mattext texttype="text/html">&lt;p&gt;Indeed, coconuts are migratory.&lt;/p&gt;</mattext></material></flow_mat>
        </itemfeedback>
        <itemfeedback ident="5840_fb">
          <flow_mat><material><mattext texttype="text/html">&lt;p&gt;Incorrect, coconuts migrate.&lt;/p&gt;</mattext></material></flow_mat>
        </itemfeedback>
      </item>
    </section>
  </assessment>
</questestinterop>`;
      const result = parser.parse(xml);
      const q = result.questions[0];
      assert.deepEqual(q.feedback?.perAnswer, {
        True: '<p>Indeed, coconuts are migratory.</p>',
        False: '<p>Incorrect, coconuts migrate.</p>',
      });
    });

    it('extracts feedback via material → mattext when flow_mat is absent', () => {
      const xml = `<?xml version="1.0"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Q">
    <section ident="root_section">
      <item ident="q1" title="Q1">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Pick&lt;/p&gt;</mattext></material>
          <response_lid ident="response1" rcardinality="Single">
            <render_choice>
              <response_label ident="a1"><material><mattext>A</mattext></material></response_label>
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <respcondition continue="No">
            <conditionvar><varequal respident="response1">a1</varequal></conditionvar>
            <setvar varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
        <itemfeedback ident="correct_fb">
          <material><mattext texttype="text/html">&lt;p&gt;Correct!&lt;/p&gt;</mattext></material>
        </itemfeedback>
      </item>
    </section>
  </assessment>
</questestinterop>`;
      const result = parser.parse(xml);
      const q = result.questions[0];
      assert.equal(q.feedback?.correct, '<p>Correct!</p>');
    });
  });

  describe('multiple choice', () => {
    it('parses a multiple choice question', () => {
      const result = parser.parse(readFixture('canvas-mc.xml'));
      assert.equal(result.sourceId, 'assess1');
      assert.equal(result.title, 'Test Quiz');
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.sourceId, 'q1');
      assert.equal(q.title, 'Hashing Question');
      assert.equal(q.body.type, 'multiple-choice');

      if (q.body.type === 'multiple-choice') {
        assert.equal(q.body.choices.length, 3);
        assert.isTrue(q.body.choices[0].correct);
        assert.equal(q.body.choices[0].html, 'Double hashing');
        assert.isFalse(q.body.choices[1].correct);
        assert.isFalse(q.body.choices[2].correct);
      }
    });

    it('cleans up prompt HTML', () => {
      const result = parser.parse(readFixture('canvas-mc.xml'));
      const q = result.questions[0];
      assert.equal(
        q.promptHtml,
        '<p>Which collision resolution method tries different sequences?</p>',
      );
    });
  });

  describe('true/false', () => {
    it('parses a true/false question', () => {
      const result = parser.parse(readFixture('canvas-tf.xml'));
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'multiple-choice');
      if (q.body.type === 'multiple-choice') {
        assert.equal(q.body.choices.length, 2);
        assert.equal(q.body.choices[0].html, 'True');
        assert.isTrue(q.body.choices[0].correct);
        assert.equal(q.body.choices[1].html, 'False');
        assert.isFalse(q.body.choices[1].correct);
      }
    });
  });

  describe('multiple answers (checkbox)', () => {
    it('parses a multiple answers question', () => {
      const result = parser.parse(readFixture('canvas-checkbox.xml'));
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'checkbox');
      if (q.body.type === 'checkbox') {
        assert.equal(q.body.choices.length, 3);
        assert.isTrue(q.body.choices[0].correct);
        assert.isTrue(q.body.choices[1].correct);
        assert.isFalse(q.body.choices[2].correct);
      }
    });
  });

  describe('matching', () => {
    it('parses a matching question', () => {
      const result = parser.parse(readFixture('canvas-matching.xml'));
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'matching');
      if (q.body.type === 'matching') {
        assert.equal(q.body.pairs.length, 2);
        assert.equal(q.body.pairs[0].statementHtml, 'Big O');
        assert.equal(q.body.pairs[0].optionHtml, 'Upper Bound');
        assert.equal(q.body.pairs[1].statementHtml, 'Big Theta');
        assert.equal(q.body.pairs[1].optionHtml, 'Tight Bound');
        assert.equal(q.body.distractors.length, 1);
        assert.equal(q.body.distractors[0].optionHtml, 'Lower Bound');
      }
    });
  });

  describe('fill in blanks', () => {
    it('parses a fill-in-the-blanks question', () => {
      const result = parser.parse(readFixture('canvas-fitb.xml'));
      assert.equal(result.questions.length, 1);

      const q = result.questions[0];
      assert.equal(q.body.type, 'fill-in-blanks');
      if (q.body.type === 'fill-in-blanks') {
        assert.equal(q.body.blanks.length, 2);
        assert.equal(q.body.blanks[0].id, 'capital1');
        assert.equal(q.body.blanks[0].correctText, 'bogota');
        assert.equal(q.body.blanks[1].id, 'capital2');
        assert.equal(q.body.blanks[1].correctText, 'tallinn');
      }
    });
  });

  describe('named zones (sub-sections)', () => {
    it('parses questions into zones when named sub-sections exist', () => {
      const result = parser.parse(readFixture('canvas-zones.xml'));
      assert.equal(result.questions.length, 2);
      assert.isDefined(result.zones);
      assert.equal(result.zones!.length, 2);
      assert.equal(result.zones![0].title, 'Part 1');
      assert.equal(result.zones![1].title, 'Part 2');
      assert.equal(result.zones![0].questions[0].sourceId, 'q1');
      assert.equal(result.zones![1].questions[0].sourceId, 'q2');
    });
  });

  describe('assessment_meta.xml enrichment', () => {
    const BASE_QTI = `<?xml version="1.0"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Homework 0">
    <qtimetadata>
      <qtimetadatafield><fieldlabel>cc_maxattempts</fieldlabel><fieldentry>unlimited</fieldentry></qtimetadatafield>
    </qtimetadata>
    <section ident="root_section"/>
  </assessment>
</questestinterop>`;

    const EXAM_QTI = `<?xml version="1.0"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a2" title="Midterm 1">
    <qtimetadata>
      <qtimetadatafield><fieldlabel>qmd_timelimit</fieldlabel><fieldentry>60</fieldentry></qtimetadatafield>
      <qtimetadatafield><fieldlabel>cc_maxattempts</fieldlabel><fieldentry>1</fieldentry></qtimetadatafield>
    </qtimetadata>
    <section ident="root_section"/>
  </assessment>
</questestinterop>`;

    const HOMEWORK_META = `<?xml version="1.0" encoding="UTF-8"?>
<quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
  <description>&lt;p&gt;Do the work.&lt;/p&gt;</description>
  <lock_at>2025-09-05T05:59:59</lock_at>
  <unlock_at>2025-09-01T00:00:00</unlock_at>
  <due_at>2025-09-04T23:59:59</due_at>
  <shuffle_answers>true</shuffle_answers>
  <scoring_policy>keep_latest</scoring_policy>
  <hide_results></hide_results>
  <quiz_type>assignment</quiz_type>
  <points_possible>5.0</points_possible>
  <show_correct_answers>true</show_correct_answers>
  <show_correct_answers_at>2025-09-06T00:00:00</show_correct_answers_at>
  <allowed_attempts>-1</allowed_attempts>
  <time_limit></time_limit>
</quiz>`;

    const EXAM_META = `<?xml version="1.0" encoding="UTF-8"?>
<quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
  <description></description>
  <lock_at>2025-10-15T05:59:59</lock_at>
  <unlock_at>2025-10-13T06:00:00</unlock_at>
  <due_at>2025-10-15T05:59:59</due_at>
  <shuffle_answers>true</shuffle_answers>
  <scoring_policy>keep_highest</scoring_policy>
  <hide_results>always</hide_results>
  <quiz_type>assignment</quiz_type>
  <points_possible>20.0</points_possible>
  <show_correct_answers>false</show_correct_answers>
  <allowed_attempts>1</allowed_attempts>
  <time_limit>60</time_limit>
  <ip_filter>129.123.86.0/24,129.123.175.192/27</ip_filter>
</quiz>`;

    it('parses homework meta: shuffle, dates, description, points, show answers', () => {
      const result = parser.parse(BASE_QTI, { assessmentMetaXml: HOMEWORK_META });
      const m = result.meta!;
      assert.isTrue(m.shuffleAnswers);
      assert.equal(m.maxAttempts, -1);
      assert.equal(m.pointsPossible, 5);
      assert.equal(m.descriptionHtml!, '<p>Do the work.</p>');
      assert.equal(m.lockDate, '2025-09-05T05:59:59');
      assert.equal(m.dueDate, '2025-09-04T23:59:59');
      assert.equal(m.startDate, '2025-09-01T00:00:00');
      assert.isTrue(m.showCorrectAnswers);
      assert.equal(m.showCorrectAnswersAt, '2025-09-06T00:00:00');
      assert.equal(m.scoringPolicy, 'keep_latest');
      assert.equal(m.assessmentType, 'Homework');
    });

    it('parses exam meta: time limit, ip filter, hide results, allowed_attempts=1', () => {
      const result = parser.parse(EXAM_QTI, { assessmentMetaXml: EXAM_META });
      const m = result.meta!;
      assert.equal(m.timeLimitMinutes, 60);
      assert.equal(m.maxAttempts, 1);
      assert.equal(m.pointsPossible, 20);
      assert.isTrue(m.hideResults);
      assert.isFalse(m.showCorrectAnswers);
      assert.equal(m.ipFilter, '129.123.86.0/24,129.123.175.192/27');
      assert.equal(m.scoringPolicy, 'keep_highest');
      assert.equal(m.assessmentType, 'Exam');
    });

    it('lockDate takes precedence over dueDate', () => {
      const result = parser.parse(BASE_QTI, { assessmentMetaXml: HOMEWORK_META });
      // lock_at is 2025-09-05, due_at is 2025-09-04 — lockDate should win for endDate
      assert.equal(result.meta!.lockDate, '2025-09-05T05:59:59');
      assert.equal(result.meta!.dueDate, '2025-09-04T23:59:59');
    });

    it('works without assessment_meta.xml (no options)', () => {
      const result = parser.parse(BASE_QTI);
      assert.isDefined(result.meta);
      assert.equal(result.meta!.assessmentType, 'Homework');
    });
  });

  describe('date normalization and timezone handling', () => {
    const BASE_QTI = `<?xml version="1.0"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Test">
    <qtimetadata>
      <qtimetadatafield><fieldlabel>cc_maxattempts</fieldlabel><fieldentry>unlimited</fieldentry></qtimetadatafield>
    </qtimetadata>
    <section ident="root_section"/>
  </assessment>
</questestinterop>`;

    it('passes through ISO 8601 dates unchanged (already local time)', () => {
      const meta = `<?xml version="1.0"?><quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
        <lock_at>2025-11-02T05:59:59</lock_at>
        <unlock_at>2025-10-29T06:00:00</unlock_at>
        <due_at>2025-11-02T05:59:59</due_at>
        <allowed_attempts>-1</allowed_attempts>
      </quiz>`;
      const result = parser.parse(BASE_QTI, {
        assessmentMetaXml: meta,
        timezone: 'America/Denver',
      });
      assert.equal(result.meta!.lockDate, '2025-11-02T05:59:59');
      assert.equal(result.meta!.startDate, '2025-10-29T06:00:00');
    });

    it('converts UTC format dates to Mountain Time (UTC-7 in summer)', () => {
      // "2025-09-04 06:00:00 UTC" = 2025-09-03 midnight Mountain (UTC-6 = MDT)
      const meta = `<?xml version="1.0"?><quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
        <show_correct_answers_at>2025-09-04 06:00:00 UTC</show_correct_answers_at>
        <allowed_attempts>-1</allowed_attempts>
      </quiz>`;
      const result = parser.parse(BASE_QTI, {
        assessmentMetaXml: meta,
        timezone: 'America/Denver',
      });
      // 06:00 UTC = 00:00 MDT (UTC-6 in September)
      assert.equal(result.meta!.showCorrectAnswersAt, '2025-09-04T00:00:00');
    });

    it('converts UTC format dates to Eastern Time', () => {
      // "2025-09-04 06:00:00 UTC" = 2025-09-04 02:00 EDT (UTC-4 in September)
      const meta = `<?xml version="1.0"?><quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
        <show_correct_answers_at>2025-09-04 06:00:00 UTC</show_correct_answers_at>
        <allowed_attempts>-1</allowed_attempts>
      </quiz>`;
      const result = parser.parse(BASE_QTI, {
        assessmentMetaXml: meta,
        timezone: 'America/New_York',
      });
      // 06:00 UTC = 02:00 EDT (UTC-4 in September)
      assert.equal(result.meta!.showCorrectAnswersAt, '2025-09-04T02:00:00');
    });

    it('defaults to UTC when no timezone provided', () => {
      const meta = `<?xml version="1.0"?><quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
        <show_correct_answers_at>2025-09-04 06:00:00 UTC</show_correct_answers_at>
        <allowed_attempts>-1</allowed_attempts>
      </quiz>`;
      const result = parser.parse(BASE_QTI, { assessmentMetaXml: meta });
      // No timezone → default UTC → time stays as 06:00
      assert.equal(result.meta!.showCorrectAnswersAt, '2025-09-04T06:00:00');
    });
  });

  describe('shuffle propagation', () => {
    const BASE_QTI = `<?xml version="1.0"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="a1" title="Quiz 1">
    <section ident="root_section">
      <item ident="q1" title="Q1">
        <itemmetadata><qtimetadata>
          <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>multiple_choice_question</fieldentry></qtimetadatafield>
          <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>1</fieldentry></qtimetadatafield>
        </qtimetadata></itemmetadata>
        <presentation>
          <material><mattext texttype="text/html">&lt;p&gt;Pick one&lt;/p&gt;</mattext></material>
          <response_lid ident="response1" rcardinality="Single">
            <render_choice>
              <response_label ident="a"><material><mattext>A</mattext></material></response_label>
              <response_label ident="b"><material><mattext>B</mattext></material></response_label>
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <respcondition><conditionvar><varequal respident="response1">a</varequal></conditionvar><setvar>100</setvar></respcondition>
        </resprocessing>
      </item>
    </section>
  </assessment>
</questestinterop>`;

    it('sets shuffleAnswers=true on all questions when assessment meta has shuffle_answers=true', () => {
      const meta = `<?xml version="1.0"?><quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
        <shuffle_answers>true</shuffle_answers>
        <allowed_attempts>-1</allowed_attempts>
      </quiz>`;
      const result = parser.parse(BASE_QTI, { assessmentMetaXml: meta });
      assert.isTrue(result.questions[0].shuffleAnswers);
    });

    it('leaves shuffleAnswers undefined on questions when shuffle_answers is not set', () => {
      const meta = `<?xml version="1.0"?><quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
        <allowed_attempts>-1</allowed_attempts>
      </quiz>`;
      const result = parser.parse(BASE_QTI, { assessmentMetaXml: meta });
      assert.isUndefined(result.questions[0].shuffleAnswers);
    });

    it('parses shuffle_questions=true into meta.shuffleQuestions', () => {
      const meta = `<?xml version="1.0"?><quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
        <shuffle_questions>true</shuffle_questions>
        <allowed_attempts>-1</allowed_attempts>
      </quiz>`;
      const result = parser.parse(BASE_QTI, { assessmentMetaXml: meta });
      assert.isTrue(result.meta!.shuffleQuestions);
    });

    it('leaves meta.shuffleQuestions undefined when shuffle_questions is not set', () => {
      const meta = `<?xml version="1.0"?><quiz xmlns="http://canvas.instructure.com/xsd/cccv1p0">
        <allowed_attempts>-1</allowed_attempts>
      </quiz>`;
      const result = parser.parse(BASE_QTI, { assessmentMetaXml: meta });
      assert.isUndefined(result.meta!.shuffleQuestions);
    });
  });
});
