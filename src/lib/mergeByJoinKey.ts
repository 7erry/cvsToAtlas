import { deepMerge } from './nested.js';

const GENERIC_FILE_TOKENS = new Set([
  'common',
  'csv',
  'data',
  'file',
  'files',
  'join',
  'multi',
  'sample',
  'samples',
  'row',
  'rows',
  'table',
  'tables',
]);

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

function sanitizePathSegment(rawName: string): string {
  const cleaned = rawName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!cleaned) return 'embeddedRows';
  return /^[a-z_]/.test(cleaned) ? cleaned : `embedded_${cleaned}`;
}

function fileNameTokens(fileName: string): string[] {
  const baseName = fileName
    .replace(/^.*[/\\]/, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase();

  return baseName
    .replace(/[^a-z0-9]+/g, '_')
    .split('_')
    .filter((token) => token && !/^\d+$/.test(token) && !GENERIC_FILE_TOKENS.has(token));
}

/**
 * Builds the array field used when a CSV is embedded as one-to-many child rows.
 */
export function suggestedEmbeddedFieldName(fileName: string): string {
  const tokens = fileNameTokens(fileName);
  const meaningful = tokens.length > 1 ? tokens.slice(1) : tokens;
  return sanitizePathSegment(meaningful.join('_') || 'embeddedRows');
}

function withoutValueAtPath(obj: Record<string, unknown>, path: string): Record<string, unknown> {
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) return { ...obj };

  const cloneAny = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(cloneAny);
    if (value === null || typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = cloneAny(child);
    }
    return out;
  };

  const cloneValue = (value: unknown, depth: number): unknown => {
    if (Array.isArray(value)) return value.map((item) => cloneValue(item, depth));
    if (value === null || typeof value !== 'object') return value;

    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === parts[depth]) {
        if (depth === parts.length - 1) continue;
        out[key] = cloneValue(child, depth + 1);
        continue;
      }
      out[key] = cloneAny(child);
    }
    return out;
  };

  return cloneValue(obj, 0) as Record<string, unknown>;
}

export type MergeByJoinStats = {
  joinField: string;
  inputFileCount: number;
  totalRowsRead: number;
  rowsSkippedMissingJoinKey: number;
  rowsSkippedMissingParent?: number;
  mergedDocumentCount: number;
  embedded?: {
    fileName: string;
    fieldName: string;
    rowsEmbedded: number;
  }[];
};

export type CsvMergeProfile = {
  fileName: string;
  documents: Record<string, unknown>[];
};

export type EmbeddedCsvSpec = {
  fileName: string;
  fieldName?: string;
};

export type MergeProfilesByJoinOptions = {
  parentFileName?: string;
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

/**
 * Merges CSV-derived document lists while optionally embedding selected CSV files
 * as one-to-many child arrays on parent documents.
 */
export function mergeProfilesByJoinKey(
  profiles: CsvMergeProfile[],
  joinField: string,
  embeddedCsvs: EmbeddedCsvSpec[] = [],
  options: MergeProfilesByJoinOptions = {},
): { documents: Record<string, unknown>[]; stats: MergeByJoinStats } {
  const field = joinField.trim();
  if (!field) {
    throw new Error('joinField must be a non-empty dotted path');
  }

  if (embeddedCsvs.length === 0) {
    return mergeBatchesByJoinKey(
      profiles.map((profile) => profile.documents),
      field,
    );
  }

  const embeddedByName = new Map(
    embeddedCsvs.map((spec) => [
      spec.fileName.replace(/^.*[/\\]/, ''),
      {
        fileName: spec.fileName.replace(/^.*[/\\]/, ''),
        fieldName: spec.fieldName?.trim() || suggestedEmbeddedFieldName(spec.fileName),
      },
    ]),
  );
  const parentFileName = options.parentFileName?.replace(/^.*[/\\]/, '').trim();
  if (parentFileName && embeddedByName.has(parentFileName)) {
    throw new Error('The parent CSV cannot also be selected as an embedded CSV');
  }
  if (parentFileName && !profiles.some((profile) => profile.fileName === parentFileName)) {
    throw new Error(`Parent CSV "${parentFileName}" was not found in the uploaded files`);
  }
  const parentProfiles = profiles.filter((profile) => !embeddedByName.has(profile.fileName));
  const childProfiles = profiles.filter((profile) => embeddedByName.has(profile.fileName));

  if (childProfiles.length === 0) {
    throw new Error('No uploaded CSV matched the embedded file selection');
  }
  if (parentProfiles.length === 0) {
    throw new Error('At least one CSV must remain as the parent collection shape');
  }

  const map = new Map<string, Record<string, unknown>>();
  let totalRowsRead = 0;
  let rowsSkippedMissingJoinKey = 0;
  let rowsSkippedMissingParent = 0;
  const embeddedStats = childProfiles.map((profile) => ({
    fileName: profile.fileName,
    fieldName: embeddedByName.get(profile.fileName)?.fieldName ?? suggestedEmbeddedFieldName(profile.fileName),
    rowsEmbedded: 0,
  }));

  for (const profile of parentProfiles) {
    for (const doc of profile.documents) {
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

  for (const profile of childProfiles) {
    const embedded = embeddedByName.get(profile.fileName);
    const stats = embeddedStats.find((item) => item.fileName === profile.fileName);
    if (!embedded || !stats) continue;

    for (const doc of profile.documents) {
      totalRowsRead += 1;
      const keyVal = getValueAtPath(doc, field);
      if (keyVal === null || keyVal === undefined) {
        rowsSkippedMissingJoinKey += 1;
        continue;
      }

      const parent = map.get(String(keyVal));
      if (!parent) {
        rowsSkippedMissingParent += 1;
        continue;
      }

      const child = withoutValueAtPath(doc, field);
      const current = parent[embedded.fieldName];
      if (Array.isArray(current)) current.push(child);
      else if (current === undefined || current === null) parent[embedded.fieldName] = [child];
      else parent[embedded.fieldName] = [current, child];
      stats.rowsEmbedded += 1;
    }
  }

  const documents = [...map.values()];
  return {
    documents,
    stats: {
      joinField: field,
      inputFileCount: profiles.length,
      totalRowsRead,
      rowsSkippedMissingJoinKey,
      rowsSkippedMissingParent,
      mergedDocumentCount: documents.length,
      embedded: embeddedStats,
    },
  };
}
