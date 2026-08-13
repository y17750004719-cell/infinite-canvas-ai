const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const list = (value) => Array.isArray(value)
  ? Array.from(new Set(value.map((entry) => text(entry, 500)).filter(Boolean))).slice(0, 24)
  : [];

/**
 * @typedef {{
 *   version: 1,
 *   references: Array<{
 *     referenceId: string,
 *     description: string,
 *     salientSubjects: string[],
 *     visibleText: string[],
 *   }>,
 * }} AgentVisualSummary
 */

/**
 * @param {unknown} value
 * @param {string[]=} expectedReferenceIds
 * @returns {AgentVisualSummary | null}
 */
export function normalizeAgentVisualSummary(value, expectedReferenceIds) {
  if (value === null || value === undefined) return null;
  const input = record(value);
  if (!input || Number(input.version) !== 1 || !Array.isArray(input.references)) return null;
  if (input.references.length > 4) return null;
  const references = input.references.map((entry) => {
    const reference = record(entry);
    const referenceId = text(reference?.referenceId, 200);
    const description = text(reference?.description, 2000);
    if (!referenceId || !description) return null;
    return {
      referenceId,
      description,
      salientSubjects: list(reference?.salientSubjects),
      visibleText: list(reference?.visibleText),
    };
  });
  if (references.some((reference) => !reference)) return null;
  const ids = references.map((reference) => reference.referenceId);
  if (new Set(ids).size !== ids.length) return null;
  if (Array.isArray(expectedReferenceIds)) {
    const expected = Array.from(new Set(expectedReferenceIds.map((id) => text(id, 200)).filter(Boolean)));
    if (expected.length !== expectedReferenceIds.length || expected.length !== ids.length) return null;
    const actual = new Set(ids);
    if (expected.some((id) => !actual.has(id))) return null;
  }
  return { version: 1, references };
}
