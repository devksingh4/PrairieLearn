import { createQTI21Registry } from '../../transforms/qti21/index.js';
import type { TransformRegistry } from '../../transforms/transform-registry.js';
import type { AssetReference, IRAssessment, IRQuestion } from '../../types/ir.js';
import type {
  QTI21AssociableChoice,
  QTI21CorrectResponse,
  QTI21InlineChoice,
  QTI21Interaction,
  QTI21ParsedItem,
  QTI21SimpleChoice,
} from '../../types/qti21.js';
import { ensureResponsiveImages, extractInlineImages } from '../../utils/html.js';
import type { InputParser, ParseOptions } from '../parser.js';

import { attr21, ensureArray21, parseQti21Xml, textContent21 } from './xml-helpers.js';

/**
 * Parser for QTI 2.1 assessment items.
 *
 * QTI 2.1 uses <assessmentItem> as the root element for individual items,
 * with interaction types like choiceInteraction, textEntryInteraction, etc.
 */
export class QTI21Parser implements InputParser {
  readonly formatId = 'qti21';
  private registry: TransformRegistry<QTI21ParsedItem>;

  constructor(registry?: TransformRegistry<QTI21ParsedItem>) {
    this.registry = registry ?? createQTI21Registry();
  }

  canParse(xmlContent: string): boolean {
    return (
      xmlContent.includes('imsqti_v2p1') ||
      xmlContent.includes('imsqti_v2p2') ||
      xmlContent.includes('<assessmentItem')
    );
  }

  parse(xmlContent: string, options?: ParseOptions): IRAssessment {
    const parsed = parseQti21Xml(xmlContent);

    // Single assessment item
    const assessmentItem = parsed['assessmentItem'] as Record<string, unknown> | undefined;
    if (assessmentItem) {
      const item = this.parseAssessmentItem(
        Array.isArray(assessmentItem) ? assessmentItem[0] : assessmentItem,
      );
      const question = this.transformItem(item, options);
      return {
        sourceId: item.identifier,
        title: item.title,
        questions: question ? [question] : [],
      };
    }

    // Assessment test with multiple items
    const assessmentTest = parsed['assessmentTest'] as Record<string, unknown> | undefined;
    if (assessmentTest) {
      return this.parseAssessmentTest(assessmentTest, options);
    }

    throw new Error('Invalid QTI 2.1 XML: missing <assessmentItem> or <assessmentTest>');
  }

  private parseAssessmentTest(
    testEl: Record<string, unknown>,
    options?: ParseOptions,
  ): IRAssessment {
    const identifier = attr21(testEl, 'identifier');
    const title = attr21(testEl, 'title');

    // Collect items from test parts/sections
    const items: QTI21ParsedItem[] = [];
    this.collectItemsFromTest(testEl, items);

    const questions = items
      .map((item) => this.transformItem(item, options))
      .filter((q): q is IRQuestion => q !== null);

    return { sourceId: identifier, title, questions };
  }

  private collectItemsFromTest(parent: Record<string, unknown>, items: QTI21ParsedItem[]): void {
    // Check for direct assessmentItem children
    const itemEls = ensureArray21(parent['assessmentItem'] as unknown);
    for (const itemEl of itemEls) {
      if (itemEl != null && typeof itemEl === 'object') {
        items.push(this.parseAssessmentItem(itemEl as Record<string, unknown>));
      }
    }

    // Recurse into sections
    const sections = ensureArray21(parent['assessmentSection'] as unknown);
    for (const section of sections) {
      if (section != null && typeof section === 'object') {
        this.collectItemsFromTest(section as Record<string, unknown>, items);
      }
    }

    // Check testPart
    const testParts = ensureArray21(parent['testPart'] as unknown);
    for (const part of testParts) {
      if (part != null && typeof part === 'object') {
        this.collectItemsFromTest(part as Record<string, unknown>, items);
      }
    }
  }

  private parseAssessmentItem(itemEl: Record<string, unknown>): QTI21ParsedItem {
    const identifier = attr21(itemEl, 'identifier');
    const title = attr21(itemEl, 'title');

    // Parse responseDeclarations for correct responses
    const correctResponses = this.parseResponseDeclarations(itemEl);

    // Parse itemBody for interactions and prompt
    const itemBody = itemEl['itemBody'] as Record<string, unknown> | undefined;
    const promptHtml = this.extractPromptHtml(itemBody);
    const interactions = this.parseInteractions(itemBody);

    return {
      identifier,
      title,
      promptHtml,
      interactions,
      correctResponses,
      metadata: {},
    };
  }

  private parseResponseDeclarations(itemEl: Record<string, unknown>): QTI21CorrectResponse[] {
    const declarations = ensureArray21(itemEl['responseDeclaration'] as unknown);
    const responses: QTI21CorrectResponse[] = [];

    for (const decl of declarations) {
      if (decl == null || typeof decl !== 'object') continue;
      const declRec = decl as Record<string, unknown>;
      const responseIdentifier = attr21(declRec, 'identifier');

      const correctResponse = declRec['correctResponse'] as Record<string, unknown> | undefined;
      if (!correctResponse) continue;

      const values = ensureArray21(correctResponse['value'] as unknown)
        .map((v) => textContent21(v))
        .filter((v) => v !== '');

      responses.push({ responseIdentifier, values });
    }

    return responses;
  }

  private extractPromptHtml(itemBody: Record<string, unknown> | undefined): string {
    if (!itemBody) return '';
    // Look for prompt element or p elements before interactions
    const prompt = itemBody['prompt'] as Record<string, unknown> | undefined;
    if (prompt) {
      return textContent21(prompt);
    }
    // Fall back to any direct text or p content
    const pContent = itemBody['p'];
    if (pContent) {
      if (typeof pContent === 'string') return pContent;
      return textContent21(pContent);
    }
    return textContent21(itemBody);
  }

  private parseInteractions(itemBody: Record<string, unknown> | undefined): QTI21Interaction[] {
    if (!itemBody) return [];
    const interactions: QTI21Interaction[] = [];

    // choiceInteraction
    for (const ci of ensureArray21(itemBody['choiceInteraction'] as unknown)) {
      if (ci == null || typeof ci !== 'object') continue;
      const ciRec = ci as Record<string, unknown>;
      const choices: QTI21SimpleChoice[] = ensureArray21(ciRec['simpleChoice'] as unknown)
        .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object')
        .map((c) => ({
          identifier: attr21(c, 'identifier'),
          html: textContent21(c),
        }));

      interactions.push({
        type: 'choiceInteraction',
        responseIdentifier: attr21(ciRec, 'responseIdentifier'),
        maxChoices: Number.parseInt(attr21(ciRec, 'maxChoices') || '1', 10),
        shuffle: attr21(ciRec, 'shuffle') === 'true',
        choices,
      });
    }

    // textEntryInteraction
    for (const tei of ensureArray21(itemBody['textEntryInteraction'] as unknown)) {
      if (tei == null || typeof tei !== 'object') continue;
      const teiRec = tei as Record<string, unknown>;
      interactions.push({
        type: 'textEntryInteraction',
        responseIdentifier: attr21(teiRec, 'responseIdentifier'),
        expectedLength: Number.parseInt(attr21(teiRec, 'expectedLength') || '0', 10) || undefined,
      });
    }

    // extendedTextInteraction
    for (const eti of ensureArray21(itemBody['extendedTextInteraction'] as unknown)) {
      if (eti == null || typeof eti !== 'object') continue;
      const etiRec = eti as Record<string, unknown>;
      interactions.push({
        type: 'extendedTextInteraction',
        responseIdentifier: attr21(etiRec, 'responseIdentifier'),
        expectedLength: Number.parseInt(attr21(etiRec, 'expectedLength') || '0', 10) || undefined,
      });
    }

    // matchInteraction
    for (const mi of ensureArray21(itemBody['matchInteraction'] as unknown)) {
      if (mi == null || typeof mi !== 'object') continue;
      const miRec = mi as Record<string, unknown>;
      const matchSets = ensureArray21(miRec['simpleMatchSet'] as unknown);
      const sourceChoices: QTI21AssociableChoice[] = this.parseAssociableChoices(matchSets[0]);
      const targetChoices: QTI21AssociableChoice[] = this.parseAssociableChoices(matchSets[1]);

      interactions.push({
        type: 'matchInteraction',
        responseIdentifier: attr21(miRec, 'responseIdentifier'),
        shuffle: attr21(miRec, 'shuffle') === 'true',
        sourceChoices,
        targetChoices,
      });
    }

    // orderInteraction
    for (const oi of ensureArray21(itemBody['orderInteraction'] as unknown)) {
      if (oi == null || typeof oi !== 'object') continue;
      const oiRec = oi as Record<string, unknown>;
      const choices: QTI21SimpleChoice[] = ensureArray21(oiRec['simpleChoice'] as unknown)
        .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object')
        .map((c) => ({
          identifier: attr21(c, 'identifier'),
          html: textContent21(c),
        }));

      interactions.push({
        type: 'orderInteraction',
        responseIdentifier: attr21(oiRec, 'responseIdentifier'),
        shuffle: attr21(oiRec, 'shuffle') === 'true',
        choices,
      });
    }

    // inlineChoiceInteraction
    for (const ici of ensureArray21(itemBody['inlineChoiceInteraction'] as unknown)) {
      if (ici == null || typeof ici !== 'object') continue;
      const iciRec = ici as Record<string, unknown>;
      const choices: QTI21InlineChoice[] = ensureArray21(iciRec['inlineChoice'] as unknown)
        .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object')
        .map((c) => ({
          identifier: attr21(c, 'identifier'),
          text: textContent21(c),
        }));

      interactions.push({
        type: 'inlineChoiceInteraction',
        responseIdentifier: attr21(iciRec, 'responseIdentifier'),
        choices,
      });
    }

    return interactions;
  }

  private parseAssociableChoices(matchSet: unknown): QTI21AssociableChoice[] {
    if (matchSet == null || typeof matchSet !== 'object') return [];
    const setRec = matchSet as Record<string, unknown>;
    return ensureArray21(setRec['simpleAssociableChoice'] as unknown)
      .filter((c): c is Record<string, unknown> => c != null && typeof c === 'object')
      .map((c) => ({
        identifier: attr21(c, 'identifier'),
        html: textContent21(c),
        matchMax: Number.parseInt(attr21(c, 'matchMax') || '0', 10) || undefined,
      }));
  }

  private transformItem(item: QTI21ParsedItem, options?: ParseOptions): IRQuestion | null {
    if (item.interactions.length === 0) return null;

    // Use the first interaction's type to find the handler
    const interaction = item.interactions[0];
    const handler = this.registry.get(interaction.type);
    if (!handler) return null;

    const result = handler.transform(item);

    const { html: cleanedPrompt, files } = extractInlineImages(item.promptHtml);
    const responsivePrompt = ensureResponsiveImages(cleanedPrompt);

    const assets = new Map<string, AssetReference>();
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

    return {
      sourceId: item.identifier,
      title: item.title || item.identifier,
      promptHtml: responsivePrompt,
      body: result.body,
      assets,
      metadata: {
        ...item.metadata,
        ...(options?.defaultTopic ? { topic: options.defaultTopic } : {}),
      },
    };
  }
}
