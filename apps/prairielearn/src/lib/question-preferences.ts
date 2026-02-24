/**
 * Extracts default preference values from a question's preferences schema.
 * @param schema - The preferences schema defining allowed keys and their defaults
 * @returns An object with default values for each preference key
 */
export function extractDefaultPreferences(
  schema: Record<string, { default: string | number | boolean }> | null | undefined,
): Record<string, string | number | boolean> {
  if (!schema) return {};

  const defaults: Record<string, string | number | boolean> = {};
  for (const [key, prop] of Object.entries(schema)) {
    defaults[key] = prop.default;
  }
  return defaults;
}
