import { XMLParser } from 'fast-xml-parser';

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  isArray: (name: string) => ARRAY_TAGS.has(name),
  trimValues: true,
  processEntities: false,
};

const ARRAY_TAGS = new Set([
  'assessmentItem',
  'simpleChoice',
  'simpleAssociableChoice',
  'inlineChoice',
  'gapText',
  'value',
  'responseDeclaration',
  'choiceInteraction',
  'textEntryInteraction',
  'extendedTextInteraction',
  'matchInteraction',
  'orderInteraction',
  'inlineChoiceInteraction',
  'simpleMatchSet',
  'assessmentItemRef',
  'assessmentSection',
]);

const parser = new XMLParser(PARSER_OPTIONS);

export function parseQti21Xml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

/** Get attribute from element. */
export function attr21(element: unknown, name: string): string {
  if (element == null || typeof element !== 'object') return '';
  return String((element as Record<string, unknown>)[`@_${name}`] ?? '').trim();
}

/** Get text content from a value. */
export function textContent21(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object' && '#text' in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)['#text']).trim();
  }
  return '';
}

export function ensureArray21<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
