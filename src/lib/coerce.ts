/**
 * Turns a raw CSV cell string into a boolean, number, parsed JSON, or string.
 * Empty strings become null so MongoDB can store sparse fields cleanly.
 */
export function coerceCell(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return null;

  const lower = s.toLowerCase();
  if (lower === 'true') return true;
  if (lower === 'false') return false;

  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
    const n = Number(s);
    if (!Number.isNaN(n)) return n;
  }

  if (
    (s.startsWith('{') && s.endsWith('}')) ||
    (s.startsWith('[') && s.endsWith(']'))
  ) {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      /* fall through */
    }
  }

  return s;
}
