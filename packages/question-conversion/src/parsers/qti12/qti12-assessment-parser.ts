import type {
  IRAssessment,
  IRAssessmentMeta,
  IRFeedback,
  IRQuestion,
  IRZone,
  AssetReference,
} from '../../types/ir.js';
import type {
  QTI12CorrectCondition,
  QTI12ParsedItem,
  QTI12ResponseLabel,
  QTI12ResponseLid,
} from '../../types/qti12.js';
import { createQTI12Registry } from '../../transforms/qti12/index.js';
import type { TransformRegistry } from '../../transforms/transform-registry.js';
import {
  cleanQuestionHtml,
  convertLatexItemizeToMarkdown,
  ensureResponsiveImages,
  extractInlineImages,
  resolveImsFileRefs,
  unescapeHtml,
} from '../../utils/html.js';
import type { InputParser, ParseOptions } from '../parser.js';
import {
  attr,
  ensureArray,
  getNestedValue,
  parseMetadata,
  parseXml,
  textContent,
} from './xml-helpers.js';

/**
 * Maps IMS Common Cartridge cc_profile values (used in course exports) to the
 * question_type strings used in quiz exports. Allows a single set of handlers.
 */
const CC_PROFILE_TO_QUESTION_TYPE: Record<string, string> = {
  'cc.multiple_choice.v0p1': 'multiple_choice_question',
  'cc.true_false.v0p1': 'true_false_question',
  'cc.multiple_response.v0p1': 'multiple_answers_question',
  'cc.essay.v0p1': 'essay_question',
  'cc.fib.v0p1': 'fill_in_multiple_blanks_question',
  'cc.short_answer.v0p1': 'short_answer_question',
  'cc.matching.v0p1': 'matching_question',
  'cc.order.v0p1': 'ordering_question',
};

/**
 * Parser for QTI 1.2 assessment profile XML (Canvas quiz/course exports).
 *
 * Structure: <questestinterop> → <assessment> → <section> → <item>
 * Items use response_lid with render_choice.
 */
export class QTI12AssessmentParser implements InputParser {
  readonly formatId = 'qti12-assessment';
  private registry: TransformRegistry<QTI12ParsedItem>;

  constructor(registry?: TransformRegistry<QTI12ParsedItem>) {
    this.registry = registry ?? createQTI12Registry();
  }

  canParse(xmlContent: string): boolean {
    return (
      xmlContent.includes('ims_qtiasiv1p2') &&
      (xmlContent.includes('<assessment') || xmlContent.includes(':assessment'))
    );
  }

  parse(xmlContent: string, options?: ParseOptions): IRAssessment {
    const parsed = parseXml(xmlContent);
    const root = parsed['questestinterop'] as Record<string, unknown> | undefined;
    if (!root) {
      throw new Error('Invalid QTI 1.2 XML: missing <questestinterop> root element');
    }

    const assessment = root['assessment'] as Record<string, unknown> | undefined;
    if (!assessment) {
      throw new Error('Invalid QTI 1.2 assessment XML: missing <assessment> element');
    }

    const assessmentIdent = attr(assessment, 'ident');
    const assessmentTitle = attr(assessment, 'title');
    const meta = this.parseAssessmentMeta(assessment, options);
    const { questions, zones } = this.buildQuestionsAndZones(assessment, options);

    return {
      sourceId: assessmentIdent,
      title: assessmentTitle,
      questions,
      zones: zones.length > 0 ? zones : undefined,
      meta,
    };
  }

  private parseAssessmentMeta(
    assessment: Record<string, unknown>,
    options?: ParseOptions,
  ): IRAssessmentMeta {
    const qtimetadata = assessment['qtimetadata'];
    const metadata = parseMetadata(qtimetadata);
    const meta: IRAssessmentMeta = {};

    const timeLimit = metadata['qmd_timelimit'];
    if (timeLimit) {
      meta.timeLimitMinutes = parseInt(timeLimit, 10);
    }

    const maxAttempts = metadata['cc_maxattempts'];
    if (maxAttempts) {
      if (maxAttempts === 'unlimited') {
        meta.maxAttempts = -1;
      } else {
        const parsed = parseInt(maxAttempts, 10);
        if (!isNaN(parsed)) meta.maxAttempts = parsed;
      }
    }

    // Enrich with Canvas assessment_meta.xml if provided
    if (options?.assessmentMetaXml) {
      this.applyCanvasAssessmentMeta(options.assessmentMetaXml, meta, options.timezone ?? 'UTC');
    }

    // Infer assessment type: timed or single-attempt → Exam, otherwise Homework
    if (meta.timeLimitMinutes || meta.maxAttempts === 1) {
      meta.assessmentType = 'Exam';
    } else {
      meta.assessmentType = 'Homework';
    }

    return meta;
  }

  /**
   * Parse Canvas assessment_meta.xml and merge additional fields into meta.
   */
  private applyCanvasAssessmentMeta(xml: string, meta: IRAssessmentMeta, timezone: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = parseXml(xml);
    } catch {
      return;
    }

    // Canvas wraps in <quiz> element
    const quiz = (parsed['quiz'] ?? parsed) as Record<string, unknown>;

    const shuffleAnswers = textContent(quiz['shuffle_answers']);
    if (shuffleAnswers === 'true') {
      meta.shuffleAnswers = true;
    }

    // allowed_attempts: -1 = unlimited, positive = specific count
    const allowedAttempts = textContent(quiz['allowed_attempts']);
    if (allowedAttempts != null && allowedAttempts !== '') {
      const n = parseInt(allowedAttempts, 10);
      if (!isNaN(n)) {
        meta.maxAttempts = n; // -1 = unlimited, overrides cc_maxattempts
      }
    }

    const pointsPossible = textContent(quiz['points_possible']);
    if (pointsPossible) {
      const n = parseFloat(pointsPossible);
      if (!isNaN(n)) meta.pointsPossible = n;
    }

    const description = textContent(quiz['description']);
    if (description) {
      meta.descriptionHtml = unescapeHtml(description);
    }

    // quiz_type: "assignment" → Homework, "practice_quiz" → Homework, "graded_survey" → Exam
    const quizType = textContent(quiz['quiz_type']);
    if (quizType === 'graded_survey') {
      meta.assessmentType = 'Exam';
    }

    // Time limit in minutes (assessment_meta stores it directly, QTI uses qmd_timelimit)
    const timeLimit = textContent(quiz['time_limit']);
    if (timeLimit) {
      const n = parseInt(timeLimit, 10);
      if (!isNaN(n) && n > 0) meta.timeLimitMinutes = n;
    }

    // Access dates — prefer lock_at over due_at as the hard close
    const lockAt = normalizeDate(textContent(quiz['lock_at']), timezone);
    const dueAt = normalizeDate(textContent(quiz['due_at']), timezone);
    if (lockAt) {
      meta.lockDate = lockAt;
    } else if (dueAt) {
      meta.lockDate = dueAt;
    }
    if (dueAt) meta.dueDate = dueAt;

    const unlockAt = normalizeDate(textContent(quiz['unlock_at']), timezone);
    if (unlockAt) meta.startDate = unlockAt;

    // Correct answer visibility
    const showCorrectAnswers = textContent(quiz['show_correct_answers']);
    if (showCorrectAnswers === 'true') {
      meta.showCorrectAnswers = true;
    } else if (showCorrectAnswers === 'false') {
      meta.showCorrectAnswers = false;
    }

    const showCorrectAnswersAt = normalizeDate(textContent(quiz['show_correct_answers_at']), timezone);
    if (showCorrectAnswersAt) meta.showCorrectAnswersAt = showCorrectAnswersAt;

    // hide_results: "always" means never show results to students
    const hideResults = textContent(quiz['hide_results']);
    if (hideResults === 'always') meta.hideResults = true;

    // IP filter — CIDR ranges (comma-separated in Canvas)
    const ipFilter = textContent(quiz['ip_filter']);
    if (ipFilter) meta.ipFilter = ipFilter;

    // Scoring policy
    const scoringPolicy = textContent(quiz['scoring_policy']);
    if (scoringPolicy === 'keep_highest' || scoringPolicy === 'keep_latest') {
      meta.scoringPolicy = scoringPolicy;
    }
  }

  /**
   * Build flat question list and zone structure from sections.
   * Named sub-sections under root_section become zones.
   */
  private buildQuestionsAndZones(
    assessment: Record<string, unknown>,
    options?: ParseOptions,
  ): { questions: IRQuestion[]; zones: IRZone[] } {
    const allQuestions: IRQuestion[] = [];
    const zones: IRZone[] = [];

    const rootSections = ensureArray(assessment['section'] as unknown);
    for (const rootSection of rootSections) {
      if (rootSection == null || typeof rootSection !== 'object') continue;
      const rootRec = rootSection as Record<string, unknown>;

      // Check for named sub-sections (zones)
      const subSections = ensureArray(rootRec['section'] as unknown);
      const hasNamedSubSections = subSections.some((s) => {
        if (s == null || typeof s !== 'object') return false;
        const title = attr(s as Record<string, unknown>, 'title');
        return title && title !== 'root_section';
      });

      if (hasNamedSubSections) {
        // Build zones from named sub-sections
        for (const subSection of subSections) {
          if (subSection == null || typeof subSection !== 'object') continue;
          const subRec = subSection as Record<string, unknown>;
          const zoneTitle = attr(subRec, 'title');
          const items = this.collectItems(subRec);
          const questions = items
            .map((item) => this.parseItem(item))
            .map((item) => this.transformItem(item, options))
            .filter((q): q is IRQuestion => q !== null);
          if (questions.length > 0) {
            zones.push({ title: zoneTitle || 'Questions', questions });
            allQuestions.push(...questions);
          }
        }

        // Also collect any direct items under root_section (not in sub-sections)
        const directItems = ensureArray(rootRec['item'] as unknown).filter(
          (i): i is Record<string, unknown> => i != null && typeof i === 'object',
        );
        if (directItems.length > 0) {
          const questions = directItems
            .map((item) => this.parseItem(item))
            .map((item) => this.transformItem(item, options))
            .filter((q): q is IRQuestion => q !== null);
          if (questions.length > 0) {
            zones.unshift({ title: 'Questions', questions });
            allQuestions.unshift(...questions);
          }
        }
      } else {
        // No named sub-sections — flat list
        const items = this.collectItems(rootRec);
        const questions = items
          .map((item) => this.parseItem(item))
          .map((item) => this.transformItem(item, options))
          .filter((q): q is IRQuestion => q !== null);
        allQuestions.push(...questions);
      }
    }

    return { questions: allQuestions, zones };
  }

  /** Recursively collect all items from sections (Canvas nests items in sub-sections). */
  private collectItems(parent: Record<string, unknown>): Record<string, unknown>[] {
    const items: Record<string, unknown>[] = [];

    // Direct items under this element
    const directItems = ensureArray(parent['item'] as unknown);
    items.push(
      ...directItems.filter(
        (i): i is Record<string, unknown> => i != null && typeof i === 'object',
      ),
    );

    // Recurse into sections
    const sections = ensureArray(parent['section'] as unknown);
    for (const section of sections) {
      if (section != null && typeof section === 'object') {
        items.push(...this.collectItems(section as Record<string, unknown>));
      }
    }

    return items;
  }

  private parseItem(itemEl: Record<string, unknown>): QTI12ParsedItem {
    const ident = attr(itemEl, 'ident');
    const title = attr(itemEl, 'title');

    // Parse metadata
    const itemMetadata = getNestedValue(itemEl, 'itemmetadata', 'qtimetadata');
    const metadata = parseMetadata(itemMetadata);
    const questionType =
      metadata['question_type'] ?? CC_PROFILE_TO_QUESTION_TYPE[metadata['cc_profile'] ?? ''] ?? 'unknown';
    const pointsPossible = metadata['points_possible']
      ? parseFloat(metadata['points_possible'])
      : undefined;

    // Parse prompt HTML
    const presentation = itemEl['presentation'] as Record<string, unknown> | undefined;
    const rawPrompt = textContent(getNestedValue(presentation, 'material', 'mattext'));
    const promptHtml = convertLatexItemizeToMarkdown(cleanQuestionHtml(unescapeHtml(rawPrompt)));

    // Parse response_lid elements
    const responseLidEls = ensureArray(presentation?.['response_lid'] as unknown);
    const responseLids: QTI12ResponseLid[] = responseLidEls
      .filter((el): el is Record<string, unknown> => el != null && typeof el === 'object')
      .map((el) => this.parseResponseLid(el));

    // Parse correct conditions from resprocessing
    const correctConditions = this.parseCorrectConditions(itemEl);

    // Parse feedbacks
    const feedbacks = this.parseFeedbacks(itemEl);

    return {
      ident,
      title,
      questionType,
      pointsPossible,
      promptHtml,
      responseLids,
      responseStrs: [],
      correctConditions,
      feedbacks,
      metadata,
    };
  }

  private parseResponseLid(el: Record<string, unknown>): QTI12ResponseLid {
    const ident = attr(el, 'ident');
    const rcardinality = (attr(el, 'rcardinality') || 'Single') as 'Single' | 'Multiple';

    // Material text (used for matching/FITB left-side label)
    const materialText = textContent(getNestedValue(el, 'material', 'mattext')) || undefined;

    // Parse response labels from render_choice
    const renderChoice = el['render_choice'] as Record<string, unknown> | undefined;
    const labelEls = ensureArray(renderChoice?.['response_label'] as unknown);
    const labels: QTI12ResponseLabel[] = labelEls
      .filter((l): l is Record<string, unknown> => l != null && typeof l === 'object')
      .map((l) => ({
        ident: attr(l, 'ident'),
        text: textContent(getNestedValue(l, 'material', 'mattext')),
        textType:
          attr(getNestedValue(l, 'material', 'mattext') as Record<string, unknown>, 'texttype') ||
          'text/plain',
      }));

    return { ident, rcardinality, materialText, labels };
  }

  private parseCorrectConditions(itemEl: Record<string, unknown>): QTI12CorrectCondition[] {
    const resprocessing = itemEl['resprocessing'] as Record<string, unknown> | undefined;
    if (!resprocessing) return [];

    const conditions: QTI12CorrectCondition[] = [];
    const respconditions = ensureArray(resprocessing['respcondition'] as unknown);

    for (const cond of respconditions) {
      if (cond == null || typeof cond !== 'object') continue;
      const condRec = cond as Record<string, unknown>;

      // Only look at conditions that set SCORE to 100 (or any positive value)
      const setvar = condRec['setvar'];
      if (setvar != null) {
        const scoreText = textContent(setvar);
        if (scoreText && parseFloat(scoreText) <= 0) continue;
      }

      const conditionvar = condRec['conditionvar'] as Record<string, unknown> | undefined;
      if (!conditionvar) continue;

      this.extractVarEquals(conditionvar, conditions, false);
    }

    return conditions;
  }

  private extractVarEquals(
    conditionvar: Record<string, unknown>,
    conditions: QTI12CorrectCondition[],
    negate: boolean,
  ): void {
    // Direct varequal elements
    const varequals = ensureArray(conditionvar['varequal'] as unknown);
    for (const ve of varequals) {
      if (ve == null || typeof ve !== 'object') continue;
      const veRec = ve as Record<string, unknown>;
      const responseIdent = attr(veRec, 'respident');
      const correctLabelIdent = textContent(veRec);
      if (responseIdent && correctLabelIdent) {
        conditions.push({ responseIdent, correctLabelIdent, negate });
      }
    }

    // Handle <and> grouping
    const andEl = conditionvar['and'] as Record<string, unknown> | undefined;
    if (andEl) {
      this.extractVarEquals(andEl, conditions, negate);

      // Handle <not><varequal> inside <and>
      const notEls = ensureArray(andEl['not'] as unknown);
      for (const notEl of notEls) {
        if (notEl != null && typeof notEl === 'object') {
          this.extractVarEquals(notEl as Record<string, unknown>, conditions, true);
        }
      }
    }

    // Handle <not> at top level
    const notEls = ensureArray(conditionvar['not'] as unknown);
    for (const notEl of notEls) {
      if (notEl != null && typeof notEl === 'object') {
        this.extractVarEquals(notEl as Record<string, unknown>, conditions, !negate);
      }
    }
  }

  private parseFeedbacks(itemEl: Record<string, unknown>): Map<string, string> {
    const feedbacks = new Map<string, string>();
    const fbEls = ensureArray(itemEl['itemfeedback'] as unknown);
    for (const fb of fbEls) {
      if (fb == null || typeof fb !== 'object') continue;
      const fbRec = fb as Record<string, unknown>;
      const ident = attr(fbRec, 'ident');
      const text = textContent(getNestedValue(fbRec, 'flow_mat', 'material', 'mattext'));
      if (ident) {
        feedbacks.set(ident, unescapeHtml(text));
      }
    }
    return feedbacks;
  }

  private transformItem(item: QTI12ParsedItem, options?: ParseOptions): IRQuestion | null {
    const handler = this.registry.get(item.questionType);
    if (!handler) {
      // Skip unsupported question types
      return null;
    }

    const result = handler.transform(item);

    // Resolve $IMS-CC-FILEBASE$ references → clientFilesQuestion/
    const { html: imsResolved, fileRefs } = resolveImsFileRefs(item.promptHtml);

    // Handle inline base64 images
    const { html: cleanedPrompt, files } = extractInlineImages(imsResolved);
    const responsivePrompt = ensureResponsiveImages(cleanedPrompt);

    const assets = new Map<string, AssetReference>();

    // Add IMS file references as file-path assets
    for (const [filename, relativePath] of fileRefs) {
      assets.set(filename, {
        type: 'file-path',
        value: relativePath,
      });
    }

    for (const [filename, buffer] of files) {
      assets.set(filename, {
        type: 'base64',
        value: buffer.toString('base64'),
        contentType: `image/${filename.split('.').pop()}`,
      });
    }
    if (result.assets) {
      for (const [k, v] of result.assets) {
        assets.set(k, v);
      }
    }

    // Build feedback
    const feedback: IRFeedback = {};
    const correctFb = item.feedbacks.get('correct_fb');
    const incorrectFb = item.feedbacks.get('general_incorrect_fb');
    if (correctFb) feedback.correct = correctFb;
    if (incorrectFb) feedback.incorrect = incorrectFb;
    const hasFeedback = feedback.correct || feedback.incorrect;

    return {
      sourceId: item.ident,
      title: item.title || item.ident,
      promptHtml: responsivePrompt,
      body: result.body,
      points: item.pointsPossible,
      feedback: hasFeedback ? feedback : undefined,
      assets,
      metadata: {
        ...item.metadata,
        ...(options?.defaultTopic ? { topic: options.defaultTopic } : {}),
      },
    };
  }
}

/**
 * Normalize a date string to ISO 8601 local-time format expected by PrairieLearn.
 *
 * PrairieLearn interprets dates in infoAssessment.json as course-local time (no offset needed).
 *
 * Two Canvas formats:
 *  - "2025-10-29T06:00:00"      — already local time, return as-is
 *  - "2025-09-04 06:00:00 UTC"  — explicit UTC, convert to course timezone
 *
 * Returns undefined for empty/blank strings.
 */
function normalizeDate(value: string, timezone: string): string | undefined {
  if (!value) return undefined;
  // Already ISO 8601 with T separator — Canvas-local time, use as-is
  // Check that T is in position 10 (YYYY-MM-DDThh:mm:ss) to avoid false match on "UTC"
  if (value.charAt(10) === 'T') return value;
  // "YYYY-MM-DD HH:MM:SS UTC" — convert from UTC to course timezone
  const utcMatch = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/.exec(value);
  if (utcMatch) {
    const utcDate = new Date(`${utcMatch[1]}T${utcMatch[2]}Z`);
    return formatDateInTimezone(utcDate, timezone);
  }
  return undefined;
}

/**
 * Format a Date as "YYYY-MM-DDTHH:MM:SS" in the given IANA timezone.
 * Uses Intl.DateTimeFormat with en-CA locale (YYYY-MM-DD date format).
 */
function formatDateInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}
