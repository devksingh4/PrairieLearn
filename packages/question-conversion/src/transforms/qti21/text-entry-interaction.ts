import type { QTI21ParsedItem } from '../../types/qti21.js';
import type { TransformHandler, TransformResult } from '../transform-registry.js';

export const textEntryInteractionHandler: TransformHandler<QTI21ParsedItem> = {
  questionType: 'textEntryInteraction',

  transform(item: QTI21ParsedItem): TransformResult {
    const interaction = item.interactions.find((i) => i.type === 'textEntryInteraction');
    if (!interaction || interaction.type !== 'textEntryInteraction') {
      throw new Error(`Item "${item.identifier}" has no textEntryInteraction`);
    }

    const correctResponse = item.correctResponses.find(
      (r) => r.responseIdentifier === interaction.responseIdentifier,
    );
    const correctAnswer = correctResponse?.values[0] ?? '';

    return {
      body: {
        type: 'string-input',
        correctAnswer,
        ignoreCase: true,
      },
    };
  },
};
