import { deepMerge } from './nested.js';

/**
 * Reads a value from a document using a dotted path (e.g. "customer.id").
 */
export function getValueAtPath(obj: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export type MergeByJoinStats = {
  joinField: string;
  inputFileCount: number;
  totalRowsRead: number;
  rowsSkippedMissingJoinKey: number;
  mergedDocumentCount: number;
};

/**
 * Merges several CSV-derived document lists into one list: rows sharing the same join
 * field value are combined with deepMerge (nested objects and arrays align by index).
 */
export function mergeBatchesByJoinKey(
  batches: Record<string, unknown>[][],
  joinField: string,
): { documents: Record<string, unknown>[]; stats: MergeByJoinStats } {
  const field = joinField.trim();
  if (!field) {
    throw new Error('joinField must be a non-empty dotted path');
  }

  const map = new Map<string, Record<string, unknown>>();
  let totalRowsRead = 0;
  let rowsSkippedMissingJoinKey = 0;

  for (const batch of batches) {
    for (const doc of batch) {
      totalRowsRead += 1;
      const keyVal = getValueAtPath(doc, field);
      if (keyVal === null || keyVal === undefined) {
        rowsSkippedMissingJoinKey += 1;
        continue;
      }
      const key = String(keyVal);
      const existing = map.get(key);
      map.set(key, existing ? deepMerge(existing, doc) : doc);
    }
  }

  const documents = [...map.values()];
  return {
    documents,
    stats: {
      joinField: field,
      inputFileCount: batches.length,
      totalRowsRead,
      rowsSkippedMissingJoinKey,
      mergedDocumentCount: documents.length,
    },
  };
}
