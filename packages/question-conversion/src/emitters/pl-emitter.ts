import type {
  IRAssessment,
  IRAssessmentMeta,
  IRChoice,
  IRQuestion,
  IRQuestionBody,
  IRZone,
} from '../types/ir.js';
import type {
  PLAllowAccessRule,
  PLAssessmentInfoJson,
  PLAssessmentOutput,
  PLAssessmentQuestion,
  PLAssessmentZone,
  PLQuestionInfoJson,
  PLQuestionOutput,
} from '../types/pl-output.js';
import { slugify } from '../utils/slugify.js';
import { stableUuid } from '../utils/uuid.js';

import type { ConversionResult, ConversionWarning, EmitOptions, OutputEmitter } from './emitter.js';

/** Emits PrairieLearn question directories and assessment config from IR. */
export class PLEmitter implements OutputEmitter {
  emit(assessment: IRAssessment, options?: EmitOptions): ConversionResult {
    const questions: PLQuestionOutput[] = [];
    const warnings: ConversionWarning[] = [];
    const usedDirNames = new Map<string, number>();

    for (let i = 0; i < assessment.questions.length; i++) {
      const question = assessment.questions[i];
      try {
        questions.push(this.emitQuestion(question, i, assessment, usedDirNames, options));
      } catch (err) {
        warnings.push({
          questionId: question.sourceId,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const assessmentOutput = this.emitAssessment(assessment, questions, options);

    return { assessmentTitle: assessment.title, assessment: assessmentOutput, questions, warnings };
  }

  private emitAssessment(
    assessment: IRAssessment,
    questions: PLQuestionOutput[],
    options?: EmitOptions,
  ): PLAssessmentOutput {
    const meta = assessment.meta;
    const assessmentType = meta?.assessmentType ?? 'Homework';
    const directoryName = slugify(assessment.title);
    const prefix = options?.questionIdPrefix ?? '';

    const uuid = stableUuid(assessment.sourceId, 'assessment');

    // Build lookups keyed by sourceId from the actually-emitted questions.
    // Using sourceId (not index) avoids misalignment when some questions fail to emit.
    const questionDirBySourceId = new Map<string, string>(
      questions.map((q) => [q.sourceId, q.directoryName]),
    );
    const questionBySourceId = new Map<string, IRQuestion>(
      assessment.questions.map((q) => [q.sourceId, q]),
    );

    // Build zones
    const zones: PLAssessmentZone[] = [];
    if (assessment.zones && assessment.zones.length > 0) {
      for (const zone of assessment.zones) {
        const zoneQuestions = this.buildZoneQuestions(zone, questionDirBySourceId, prefix);
        if (zoneQuestions.length > 0) {
          zones.push({ title: zone.title, questions: zoneQuestions });
        }
      }
    } else {
      // Single zone with all questions
      const zoneQuestions: PLAssessmentQuestion[] = questions.map((q) => ({
        id: prefix ? `${prefix}/${q.directoryName}` : q.directoryName,
        autoPoints: questionBySourceId.get(q.sourceId)?.points,
      }));
      zones.push({ title: 'Questions', questions: zoneQuestions });
    }

    const allowAccess = this.buildAllowAccess(meta, assessmentType);

    // Determine set and number from title
    const { set, number } = this.inferSetAndNumber(assessment.title, assessmentType);

    const infoJson: PLAssessmentInfoJson = {
      uuid,
      type: assessmentType,
      title: assessment.title,
      set,
      number,
      allowAccess,
      zones,
    };

    if (meta?.descriptionHtml) {
      infoJson.text = meta.descriptionHtml;
    }

    if (meta?.shuffleAnswers) {
      infoJson.shuffleQuestions = true;
    }

    return { directoryName, infoJson };
  }

  private buildAllowAccess(
    meta: IRAssessmentMeta | undefined,
    assessmentType: 'Homework' | 'Exam',
  ): PLAllowAccessRule[] {
    // Primary access rule — open window when the assessment is live
    const primary: PLAllowAccessRule = { credit: 100 };

    if (assessmentType === 'Exam' && meta?.timeLimitMinutes) {
      primary.timeLimitMin = meta.timeLimitMinutes;
    }

    if (meta?.startDate) primary.startDate = meta.startDate;

    // Use lockDate (hard close) as endDate; fall back to dueDate
    const endDate = meta?.lockDate ?? meta?.dueDate;
    if (endDate) primary.endDate = endDate;

    // hide_results: always → never show closed assessment to students
    // show_correct_answers: false → also hide
    if (meta?.hideResults || meta?.showCorrectAnswers === false) {
      primary.showClosedAssessment = false;
    }

    const rules: PLAllowAccessRule[] = [primary];

    // If correct answers become visible at a later date, add a second open-ended rule
    if (meta?.showCorrectAnswers && meta.showCorrectAnswersAt) {
      rules.push({
        showClosedAssessment: true,
        startDate: meta.showCorrectAnswersAt,
      });
    }

    return rules;
  }

  private buildZoneQuestions(
    zone: IRZone,
    dirBySourceId: Map<string, string>,
    prefix: string,
  ): PLAssessmentQuestion[] {
    const result: PLAssessmentQuestion[] = [];
    for (const q of zone.questions) {
      const dir = dirBySourceId.get(q.sourceId);
      if (dir) {
        result.push({
          id: prefix ? `${prefix}/${dir}` : dir,
          autoPoints: q.points,
        });
      }
    }
    return result;
  }

  private inferSetAndNumber(
    title: string,
    assessmentType: 'Homework' | 'Exam',
  ): { set: string; number: string } {
    // Try to extract a number from the title (e.g. "Homework 3.1" → set="Homework", number="3.1")
    const hwMatch = /^(homework|hw)\s*(\d[\d.]*)/i.exec(title);
    if (hwMatch) {
      return { set: 'Homework', number: hwMatch[2] };
    }

    const midtermMatch = /^midterm\s*#?\s*(\d+)/i.exec(title);
    if (midtermMatch) {
      return { set: 'Midterm', number: midtermMatch[1] };
    }

    const examMatch = /^(final\s*exam|exam)\s*#?\s*(\d*)/i.exec(title);
    if (examMatch) {
      return { set: 'Exam', number: examMatch[2] || '1' };
    }

    const quizMatch = /^quiz\s*#?\s*(\d+)/i.exec(title);
    if (quizMatch) {
      return { set: 'Quiz', number: quizMatch[1] };
    }

    // Fallback: use the assessment type as the set
    return { set: assessmentType, number: '1' };
  }

  private emitQuestion(
    question: IRQuestion,
    index: number,
    assessment: IRAssessment,
    usedDirNames: Map<string, number>,
    options?: EmitOptions,
  ): PLQuestionOutput {
    const directoryName = this.makeDirectoryName(question.title, index, usedDirNames);
    const topic = options?.topic ?? question.metadata?.['topic'] ?? assessment.title ?? 'Imported';
    const tags = options?.tags ?? ['imported', 'qti'];

    const uuid = stableUuid(options?.uuidNamespace ?? assessment.sourceId, question.sourceId);

    const infoJson: PLQuestionInfoJson = {
      uuid,
      title: question.title,
      topic,
      tags,
      type: 'v3',
      singleVariant: true,
    };

    // Set grading method for manual-graded questions
    if (question.body.type === 'rich-text') {
      infoJson.gradingMethod = 'Manual';
    }

    const questionHtml = this.renderQuestionHtml(question);
    const serverPy = this.renderServerPy(question);
    const clientFiles = this.collectClientFiles(question);

    return {
      directoryName,
      sourceId: question.sourceId,
      infoJson,
      questionHtml,
      serverPy: serverPy || undefined,
      clientFiles,
    };
  }

  private makeDirectoryName(
    title: string,
    index: number,
    usedDirNames: Map<string, number>,
  ): string {
    const GENERIC_TITLES = /^(question|item|problem|unnamed)$/i;
    const cleaned = title.replaceAll(/\bquestion\b/gi, '').trim();
    const isGeneric = !cleaned || GENERIC_TITLES.test(title.trim());

    const baseDir = isGeneric ? `q${index + 1}` : slugify(cleaned);
    const count = usedDirNames.get(baseDir) ?? 0;
    usedDirNames.set(baseDir, count + 1);
    return count === 0 ? baseDir : `${baseDir}-${count + 1}`;
  }

  private renderQuestionHtml(question: IRQuestion): string {
    const parts: string[] = [
      '<pl-question-panel>',
      question.promptHtml,
      '</pl-question-panel>',
      '',
    ];

    const bodyHtml = this.renderBodyHtml(question.body);
    if (bodyHtml) {
      parts.push(bodyHtml);
    }

    return parts.join('\n');
  }

  private renderBodyHtml(body: IRQuestionBody): string {
    switch (body.type) {
      case 'multiple-choice':
        return this.renderMultipleChoice(body.choices, body.display);
      case 'checkbox':
        return this.renderCheckbox(body.choices);
      case 'matching':
        return this.renderMatching(body);
      case 'fill-in-blanks':
        return this.renderFillInBlanks(body);
      case 'numeric':
        return '<pl-number-input answers-name="answer"></pl-number-input>';
      case 'string-input':
        return '<pl-string-input answers-name="answer" remove-leading-trailing="true"></pl-string-input>';
      case 'ordering':
        return this.renderOrdering(body);
      case 'rich-text':
        return '<pl-rich-text-editor answers-name="answer"></pl-rich-text-editor>';
      case 'text-only':
        return '';
      default: {
        throw new Error(`Unhandled body type: ${(body as IRQuestionBody).type}`);
      }
    }
  }

  private renderMultipleChoice(choices: IRChoice[], display?: 'dropdown'): string {
    if (display === 'dropdown') {
      const lines = ['<pl-dropdown answers-name="answer">'];
      for (const choice of choices) {
        lines.push(
          `  <pl-answer correct="${choice.correct}">${escapeHtml(choice.html)}</pl-answer>`,
        );
      }
      lines.push('</pl-dropdown>');
      return lines.join('\n');
    }

    const lines = ['<pl-multiple-choice answers-name="answer" fixed-order="true">'];
    for (const choice of choices) {
      lines.push(`  <pl-answer correct="${choice.correct}">${escapeHtml(choice.html)}</pl-answer>`);
    }
    lines.push('</pl-multiple-choice>');
    return lines.join('\n');
  }

  private renderCheckbox(choices: IRChoice[]): string {
    const lines = ['<pl-checkbox answers-name="answer" fixed-order="true">'];
    for (const choice of choices) {
      lines.push(`  <pl-answer correct="${choice.correct}">${escapeHtml(choice.html)}</pl-answer>`);
    }
    lines.push('</pl-checkbox>');
    return lines.join('\n');
  }

  private renderMatching(body: Extract<IRQuestionBody, { type: 'matching' }>): string {
    const lines = ['<pl-matching answers-name="answer">'];
    for (const pair of body.pairs) {
      lines.push(
        `  <pl-statement match="${escapeAttr(pair.optionHtml)}">${escapeHtml(pair.statementHtml)}</pl-statement>`,
      );
    }
    for (const distractor of body.distractors) {
      lines.push(`  <pl-option>${escapeHtml(distractor.optionHtml)}</pl-option>`);
    }
    lines.push('</pl-matching>');
    return lines.join('\n');
  }

  private renderFillInBlanks(body: Extract<IRQuestionBody, { type: 'fill-in-blanks' }>): string {
    return body.blanks
      .map(
        (blank) =>
          `<p><strong>${escapeHtml(blank.id)}:</strong></p>\n<pl-string-input answers-name="${escapeAttr(blank.id)}" remove-leading-trailing="true"${blank.ignoreCase ? ' ignore-case="true"' : ''}></pl-string-input>`,
      )
      .join('\n');
  }

  private renderOrdering(body: Extract<IRQuestionBody, { type: 'ordering' }>): string {
    const lines = ['<pl-order-blocks answers-name="answer">'];
    for (const item of body.correctOrder) {
      lines.push(`  <pl-answer correct="true">${escapeHtml(item.html)}</pl-answer>`);
    }
    lines.push('</pl-order-blocks>');
    return lines.join('\n');
  }

  private renderServerPy(question: IRQuestion): string {
    const body = question.body;

    switch (body.type) {
      case 'numeric':
        return [
          'def generate(data):',
          `    data["correct_answers"]["answer"] = ${body.answer.correctValue}`,
          '',
        ].join('\n');

      case 'string-input':
        return [
          'def generate(data):',
          `    data["correct_answers"]["answer"] = ${JSON.stringify(body.correctAnswer)}`,
          '',
        ].join('\n');

      case 'fill-in-blanks':
        return [
          'def generate(data):',
          ...body.blanks.map(
            (blank) =>
              `    data["correct_answers"][${JSON.stringify(blank.id)}] = ${JSON.stringify(blank.correctText)}`,
          ),
          '',
        ].join('\n');

      default:
        // MC, checkbox, matching, ordering, rich-text, text-only
        // don't need server.py (answers are in the HTML)
        return '';
    }
  }

  private collectClientFiles(question: IRQuestion): Map<string, Buffer | string> {
    const files = new Map<string, Buffer | string>();
    for (const [filename, asset] of question.assets) {
      if (asset.type === 'base64') {
        files.set(filename, Buffer.from(asset.value, 'base64'));
      } else if (asset.type === 'file-path') {
        // Store the relative path; the CLI resolves it against web_resources/ at write time
        files.set(filename, asset.value);
      }
    }
    return files;
  }
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
