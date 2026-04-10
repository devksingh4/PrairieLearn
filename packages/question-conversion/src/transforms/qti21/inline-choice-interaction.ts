import type { QTI21ParsedItem } from '../../types/qti21.js';
import type { TransformHandler, TransformResult } from '../transform-registry.js';

export const inlineChoiceInteractionHandler: TransformHandler<QTI21ParsedItem> = {
  questionType: 'inlineChoiceInteraction',

  transform(item: QTI21ParsedItem): TransformResult {
    const interaction = item.interactions.find((i) => i.type === 'inlineChoiceInteraction');
    if (!interaction || interaction.type !== 'inlineChoiceInteraction') {
      throw new Error(`Item "${item.identifier}" has no inlineChoiceInteraction`);
    }

    const correctResponse = item.correctResponses.find(
      (r) => r.responseIdentifier === interaction.responseIdentifier,
    );
    const correctValues = new Set(correctResponse?.values);

    const choices = interaction.choices.map((c) => ({
      id: c.identifier,
      html: c.text,
      correct: correctValues.has(c.identifier),
    }));

    return { body: { type: 'multiple-choice', choices, display: 'dropdown' } };
  },
};
