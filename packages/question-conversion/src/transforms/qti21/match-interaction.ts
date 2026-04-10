import type { QTI21ParsedItem } from '../../types/qti21.js';
import type { TransformHandler, TransformResult } from '../transform-registry.js';

export const matchInteractionHandler: TransformHandler<QTI21ParsedItem> = {
  questionType: 'matchInteraction',

  transform(item: QTI21ParsedItem): TransformResult {
    const interaction = item.interactions.find((i) => i.type === 'matchInteraction');
    if (!interaction || interaction.type !== 'matchInteraction') {
      throw new Error(`Item "${item.identifier}" has no matchInteraction`);
    }

    const correctResponse = item.correctResponses.find(
      (r) => r.responseIdentifier === interaction.responseIdentifier,
    );

    // QTI 2.1 match correct values are "sourceId targetId" pairs
    const correctPairings = new Map<string, string>();
    for (const value of correctResponse?.values ?? []) {
      const parts = value.split(/\s+/);
      if (parts.length === 2) {
        correctPairings.set(parts[0], parts[1]);
      }
    }

    const targetMap = new Map(interaction.targetChoices.map((t) => [t.identifier, t.html]));

    const matchedTargets = new Set<string>();
    const pairs = interaction.sourceChoices.map((source) => {
      const targetId = correctPairings.get(source.identifier);
      const optionHtml = targetId ? (targetMap.get(targetId) ?? '') : '';
      if (targetId) matchedTargets.add(targetId);
      return { statementHtml: source.html, optionHtml };
    });

    const distractors = interaction.targetChoices
      .filter((t) => !matchedTargets.has(t.identifier))
      .map((t) => ({ optionHtml: t.html }));

    return { body: { type: 'matching', pairs, distractors } };
  },
};
