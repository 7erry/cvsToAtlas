/**
 * Heuristics for recommended single-field indexes based on path names and sample values.
 */

const ID_LIKE =
  /(^|\.)(id|_id|uuid|sku|email|code|slug|username|account|customerId|orderId|tenantId)$/i;

function isLikelyIdentifierPath(path: string): boolean {
  return ID_LIKE.test(path);
}

function countUniqueAtPath(
  docs: Record<string, unknown>[],
  path: string,
): { nonNull: number; unique: number } {
  const parts = path.split('.');
  const values = new Set<string>();
  let nonNull = 0;
  for (const doc of docs) {
    let cur: unknown = doc;
    for (const p of parts) {
      if (cur === null || cur === undefined || typeof cur !== 'object') {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[p];
    }
    if (cur === null || cur === undefined) continue;
    nonNull += 1;
    values.add(JSON.stringify(cur));
  }
  return { nonNull, unique: values.size };
}

export type RecommendedIndex = {
  key: Record<string, 1 | -1>;
  options: { name: string; unique?: boolean };
  reason: string;
};

/**
 * Builds a small list of useful indexes: identifier-like paths and high-cardinality scalars.
 */
export function recommendIndexes(
  candidates: string[],
  docs: Record<string, unknown>[],
): RecommendedIndex[] {
  const seen = new Set<string>();
  const out: RecommendedIndex[] = [];

  const sorted = [...candidates].sort((a, b) => {
    const aId = isLikelyIdentifierPath(a) ? 0 : 1;
    const bId = isLikelyIdentifierPath(b) ? 0 : 1;
    return aId - bId || a.localeCompare(b);
  });

  for (const path of sorted) {
    if (seen.has(path)) continue;
    const { nonNull, unique } = countUniqueAtPath(docs, path);
    if (nonNull < Math.min(1, docs.length)) continue;

    const idLike = isLikelyIdentifierPath(path);
    const uniqueRatio = nonNull > 0 ? unique / nonNull : 0;

    if (idLike || uniqueRatio > 0.85) {
      const name = `idx_${path.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 48)}`;
      const isUnique = idLike && unique === nonNull && nonNull === docs.length;
      seen.add(path);
      out.push({
        key: { [path]: 1 },
        options: { name, ...(isUnique ? { unique: true } : {}) },
        reason: idLike
          ? 'Identifier-like field name'
          : 'High cardinality in sample rows',
      });
    }

    if (out.length >= 8) break;
  }

  return out;
}
