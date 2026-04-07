/**
 * Path segment: string keys for objects, numbers for array indices.
 */
export type PathSegment = string | number;

export type ParsedHeader = {
  /** Path where the cell value is written */
  segments: PathSegment[];
  /**
   * True when the header ended with [] — the whole cell is one value (often a JSON array)
   * assigned at the path (e.g. tags[] -> tags, lineItems[] -> lineItems).
   */
  arrayCell: boolean;
};

function splitDotPath(path: string): PathSegment[] {
  const h = path.trim();
  if (h === '') return [];
  return h.split('.').map((part) => {
    const n = Number(part);
    if (part !== '' && Number.isInteger(n) && String(n) === part) return n;
    return part;
  });
}

/**
 * Splits a CSV header into path segments. Dots nest objects; numeric parts index arrays.
 * A trailing [] means the cell holds one JSON/array value at that path (e.g. tags[], items[]).
 */
export function parseHeader(header: string): ParsedHeader {
  const raw = header.trim();
  const arrayCell = raw.endsWith('[]');
  const base = arrayCell ? raw.slice(0, -2).trim() : raw;
  return {
    segments: splitDotPath(base),
    arrayCell,
  };
}

function ensureContainer(
  parent: Record<string, unknown>,
  key: string,
  nextSegment: PathSegment | undefined,
): unknown {
  if (!(key in parent)) {
    if (nextSegment === undefined) {
      parent[key] = {};
      return parent[key];
    }
    parent[key] = typeof nextSegment === 'number' ? [] : {};
    return parent[key];
  }

  const existing = parent[key];
  if (nextSegment === undefined) return existing;

  if (typeof nextSegment === 'number') {
    if (!Array.isArray(existing)) {
      parent[key] = [];
      return parent[key];
    }
    return existing;
  }

  if (Array.isArray(existing)) {
    parent[key] = {};
    return parent[key];
  }

  if (existing !== null && typeof existing === 'object') {
    return existing;
  }

  parent[key] = {};
  return parent[key];
}

function ensureArraySlot(arr: unknown[], index: number): unknown {
  while (arr.length <= index) {
    arr.push(null);
  }
  return arr[index];
}

/**
 * Writes a value at a nested path, creating objects and arrays as needed.
 */
export function setAtPath(
  root: Record<string, unknown>,
  segments: PathSegment[],
  value: unknown,
  arrayCell: boolean,
): void {
  if (segments.length === 0) return;

  if (arrayCell) {
    let current: unknown = root;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      if (typeof seg === 'string') {
        if (!current || typeof current !== 'object' || Array.isArray(current)) return;
        const obj = current as Record<string, unknown>;
        if (isLast) {
          obj[seg] = value;
          return;
        }
        const next = segments[i + 1];
        const child = ensureContainer(obj, seg, next);
        current = child;
      } else {
        if (!Array.isArray(current)) return;
        const arr = current as unknown[];
        if (isLast) {
          arr[seg] = value;
          return;
        }
        const next = segments[i + 1];
        let slot = arr[seg];
        if (slot === null || slot === undefined) {
          slot = typeof next === 'number' ? [] : {};
          arr[seg] = slot;
        }
        current = slot;
      }
    }
    return;
  }

  let current: unknown = root;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isLast = i === segments.length - 1;
    const next = segments[i + 1];

    if (typeof seg === 'string') {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return;
      const obj = current as Record<string, unknown>;
      if (isLast) {
        obj[seg] = value;
        return;
      }
      const child = ensureContainer(obj, seg, next);
      current = child;
      continue;
    }

    if (!Array.isArray(current)) return;
    const arr = current as unknown[];
    const slot = ensureArraySlot(arr, seg);
    if (isLast) {
      arr[seg] = value;
      return;
    }
    if (slot === null || slot === undefined) {
      const container = typeof next === 'number' ? [] : {};
      arr[seg] = container;
      current = arr[seg];
    } else {
      current = slot;
    }
  }
}

/**
 * Merges two plain objects produced from CSV rows (nested keys and arrays).
 */
export function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...a };
  for (const key of Object.keys(b)) {
    const av = out[key];
    const bv = b[key];
    if (
      av !== null &&
      bv !== null &&
      typeof av === 'object' &&
      typeof bv === 'object' &&
      !Array.isArray(av) &&
      !Array.isArray(bv)
    ) {
      out[key] = deepMerge(av as Record<string, unknown>, bv as Record<string, unknown>);
    } else if (Array.isArray(av) && Array.isArray(bv)) {
      const max = Math.max(av.length, bv.length);
      const merged: unknown[] = [];
      for (let i = 0; i < max; i++) {
        const x = av[i];
        const y = bv[i];
        if (
          x !== null &&
          y !== null &&
          typeof x === 'object' &&
          typeof y === 'object' &&
          !Array.isArray(x) &&
          !Array.isArray(y)
        ) {
          merged[i] = deepMerge(x as Record<string, unknown>, y as Record<string, unknown>);
        } else {
          merged[i] = y !== undefined && y !== null ? y : x;
        }
      }
      out[key] = merged;
    } else {
      out[key] = bv;
    }
  }
  return out;
}
