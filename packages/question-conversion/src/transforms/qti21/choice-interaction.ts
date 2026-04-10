import type { QTI21ParsedItem } from '../../types/qti21.js';
import type { TransformHandler, TransformResult } from '../transform-registry.js';

export const choiceInteractionHandler: TransformHandler<QTI21ParsedItem> = {
  questionType: 'choiceInteraction',

  transform(item: QTI21ParsedItem): TransformResult {
    const interaction = item.interactions.find((i) => i.type === 'choiceInteraction');
    if (!interaction || interaction.type !== 'choiceInteraction') {
      throw new Error(`Item "${item.identifier}" has no choiceInteraction`);
    }

    const correctResponse = item.correctResponses.find(
      (r) => r.responseIdentifier === interaction.responseIdentifier,
    );
    const correctValues = new Set(correctResponse?.values ?? []);

    const choices = interaction.choices.map((c) => ({
      id: c.identifier,
      html: c.html,
      correct: correctValues.has(c.identifier),
    }));

    // maxChoices > 1 means checkbox (select multiple)
    if (interaction.maxChoices !== 1) {
      return { body: { type: 'checkbox', choices } };
    }

    return { body: { type: 'multiple-choice', choices } };
  },
};
