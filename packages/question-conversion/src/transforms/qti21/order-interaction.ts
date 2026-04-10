import type { QTI21ParsedItem } from '../../types/qti21.js';
import type { TransformHandler, TransformResult } from '../transform-registry.js';

export const orderInteractionHandler: TransformHandler<QTI21ParsedItem> = {
  questionType: 'orderInteraction',

  transform(item: QTI21ParsedItem): TransformResult {
    const interaction = item.interactions.find((i) => i.type === 'orderInteraction');
    if (!interaction || interaction.type !== 'orderInteraction') {
      throw new Error(`Item "${item.identifier}" has no orderInteraction`);
    }

    const correctResponse = item.correctResponses.find(
      (r) => r.responseIdentifier === interaction.responseIdentifier,
    );
    if (!correctResponse) {
      throw new Error(
        `Item "${item.identifier}" has no correctResponse for "${interaction.responseIdentifier}"`,
      );
    }

    const choiceMap = new Map(interaction.choices.map((c) => [c.identifier, c.html]));

    const correctOrder = correctResponse.values.map((id) => {
      const html = choiceMap.get(id);
      if (!html) {
        throw new Error(`Item "${item.identifier}" references unknown order choice "${id}"`);
      }
      return { id, html };
    });

    return { body: { type: 'ordering', correctOrder } };
  },
};
