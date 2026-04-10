import type { QTI21ParsedItem } from '../../types/qti21.js';
import type { TransformHandler, TransformResult } from '../transform-registry.js';

export const extendedTextInteractionHandler: TransformHandler<QTI21ParsedItem> = {
  questionType: 'extendedTextInteraction',
  transform(item: QTI21ParsedItem): TransformResult {
    const interaction = item.interactions.find((i) => i.type === 'extendedTextInteraction');
    if (!interaction || interaction.type !== 'extendedTextInteraction') {
      throw new Error(`QTI 2.1 item "${item.identifier}" has no extendedTextInteraction`);
    }
    return { body: { type: 'rich-text', gradingMethod: 'Manual' } };
  },
};
