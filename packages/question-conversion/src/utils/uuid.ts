import { v5 as uuidv5 } from 'uuid';

const NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'; // UUID NAMESPACE_URL

/**
 * Generate a deterministic UUID v5 from source identifiers.
 * Produces the same UUID for the same inputs across runs.
 */
export function stableUuid(sourceId: string, ...parts: string[]): string {
  const seed = [sourceId, ...parts].join('::');
  return uuidv5(seed, NAMESPACE);
}
