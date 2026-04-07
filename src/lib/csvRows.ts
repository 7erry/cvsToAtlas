import { coerceCell } from './coerce.js';
import { parseHeader, setAtPath } from './nested.js';

/**
 * Builds one MongoDB-ready document from a CSV row using header paths and coercion.
 */
export function rowToDocument(
  headers: string[],
  values: string[],
): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  const max = Math.min(headers.length, values.length);

  for (let i = 0; i < max; i++) {
    const parsed = parseHeader(headers[i]);
    if (parsed.segments.length === 0) continue;
    const value = coerceCell(values[i] ?? '');
    setAtPath(root, parsed.segments, value, parsed.arrayCell);
  }

  return root;
}
