import type { QTI21ParsedItem } from '../../types/qti21.js';
import type { TransformHandler, TransformResult } from '../transform-registry.js';

export const extendedTextInteractionHandler: TransformHandler<QTI21ParsedItem> = {
  questionType: 'extendedTextInteraction',

  transform(_item: QTI21ParsedItem): TransformResult {
    return { body: { type: 'rich-text', gradingMethod: 'Manual' } };
  },
};
