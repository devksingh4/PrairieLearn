import type { QTI21ParsedItem } from '../../types/qti21.js';
import { TransformRegistry } from '../transform-registry.js';
import { choiceInteractionHandler } from './choice-interaction.js';
import { extendedTextInteractionHandler } from './extended-text-interaction.js';
import { inlineChoiceInteractionHandler } from './inline-choice-interaction.js';
import { matchInteractionHandler } from './match-interaction.js';
import { orderInteractionHandler } from './order-interaction.js';
import { textEntryInteractionHandler } from './text-entry-interaction.js';

/** Create a TransformRegistry pre-populated with all QTI 2.1 handlers. */
export function createQTI21Registry(): TransformRegistry<QTI21ParsedItem> {
  const registry = new TransformRegistry<QTI21ParsedItem>();
  registry.register(choiceInteractionHandler);
  registry.register(textEntryInteractionHandler);
  registry.register(extendedTextInteractionHandler);
  registry.register(matchInteractionHandler);
  registry.register(orderInteractionHandler);
  registry.register(inlineChoiceInteractionHandler);
  return registry;
}
