import path from 'path';
import { getValueAtPath } from './mergeByJoinKey.js';

const JOIN_FIELD_NAME = /(^|\.)(id|_id|uuid|sku|email|code|account|customerId|orderId)$/i;
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
]);

export type CsvFileProfile = {
  fileName: string;
  headers: string[];
  rowCount: number;
  documents: Record<string, unknown>[];
};

export type CommonFieldCandidate = {
  field: string;
  fileCount: number;
  nonNullValues: number;
  uniqueValues: number;
  score: number;
  reason: string;
};

export type CsvImportAnalysis = {
  files: {
    fileName: string;
    headers: string[];
    rowCount: number;
  }[];
  commonFields: CommonFieldCandidate[];
  suggestedJoinField?: string;
  suggestedCollectionName: string;
};

function normalizeHeader(header: string): string {
  const trimmed = header.trim();
  return trimmed.endsWith('[]') ? trimmed.slice(0, -2).trim() : trimmed;
}

function uniqueHeaders(headers: string[]): string[] {
  return [...new Set(headers.map(normalizeHeader).filter(Boolean))];
}

function isUsefulJoinName(field: string): boolean {
  return JOIN_FIELD_NAME.test(field);
}

function fieldStats(
  profiles: CsvFileProfile[],
  field: string,
): { nonNullValues: number; uniqueValues: number } {
  const values = new Set<string>();
  let nonNullValues = 0;

  for (const profile of profiles) {
    for (const document of profile.documents) {
      const value = getValueAtPath(document, field);
      if (value === null || value === undefined) continue;
      nonNullValues += 1;
      values.add(JSON.stringify(value));
    }
  }

  return { nonNullValues, uniqueValues: values.size };
}

function fieldReason(field: string, appearsInEveryFile: boolean): string {
  if (isUsefulJoinName(field) && appearsInEveryFile) {
    return 'Identifier-like field appears in every CSV';
  }

  if (appearsInEveryFile) {
    return 'Field appears in every CSV';
  }

  return 'Field appears in multiple CSVs';
}

function rankCommonFields(profiles: CsvFileProfile[]): CommonFieldCandidate[] {
  const filesByField = new Map<string, Set<string>>();

  for (const profile of profiles) {
    for (const header of uniqueHeaders(profile.headers)) {
      const fileNames = filesByField.get(header) ?? new Set<string>();
      fileNames.add(profile.fileName);
      filesByField.set(header, fileNames);
    }
  }

  const candidates: CommonFieldCandidate[] = [];
  for (const [field, fileNames] of filesByField) {
    if (fileNames.size < 2) continue;

    const appearsInEveryFile = fileNames.size === profiles.length;
    const { nonNullValues, uniqueValues } = fieldStats(profiles, field);
    const uniqueRatio = nonNullValues > 0 ? uniqueValues / nonNullValues : 0;
    const score =
      (appearsInEveryFile ? 100 : fileNames.size * 10) +
      (isUsefulJoinName(field) ? 50 : 0) +
      uniqueRatio * 25;

    candidates.push({
      field,
      fileCount: fileNames.size,
      nonNullValues,
      uniqueValues,
      score: Number(score.toFixed(2)),
      reason: fieldReason(field, appearsInEveryFile),
    });
  }

  return candidates.sort(
    (a, b) =>
      b.score - a.score ||
      b.fileCount - a.fileCount ||
      b.uniqueValues - a.uniqueValues ||
      a.field.localeCompare(b.field),
  );
}

function tokenizeFileName(fileName: string): string[] {
  const parsed = path.parse(fileName);
  return parsed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .split('_')
    .filter((token) => token && !/^\d+$/.test(token) && !GENERIC_FILE_TOKENS.has(token));
}

function sanitizeCollectionName(rawName: string): string {
  const cleaned = rawName
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);

  if (!cleaned) return 'imported_records';
  return /^[a-z_]/.test(cleaned) ? cleaned : `imported_${cleaned}`;
}

function suggestCollectionName(profiles: CsvFileProfile[], commonFields: CommonFieldCandidate[]): string {
  const fileTokens = profiles.map((profile) => [...new Set(tokenizeFileName(profile.fileName))]);
  const tokenFileCounts = new Map<string, number>();
  for (const tokens of fileTokens) {
    for (const token of tokens) {
      tokenFileCounts.set(token, (tokenFileCounts.get(token) ?? 0) + 1);
    }
  }

  const tokens = fileTokens.flatMap((profileTokens) =>
    profileTokens.filter((token) => tokenFileCounts.get(token) !== profiles.length),
  );
  const distinctTokens = [...new Set(tokens)];
  if (distinctTokens.length > 0) {
    return sanitizeCollectionName(distinctTokens.slice(0, 4).join('_'));
  }

  const joinField = commonFields[0]?.field;
  if (joinField) {
    return sanitizeCollectionName(`${joinField.replace(/\./g, '_')}_records`);
  }

  return 'imported_records';
}

/**
 * Inspects parsed CSV files and suggests the safest join field plus a MongoDB collection name.
 */
export function analyzeCsvFiles(profiles: CsvFileProfile[]): CsvImportAnalysis {
  const commonFields = profiles.length > 1 ? rankCommonFields(profiles) : [];
  return {
    files: profiles.map(({ fileName, headers, rowCount }) => ({ fileName, headers, rowCount })),
    commonFields,
    suggestedJoinField: commonFields[0]?.field,
    suggestedCollectionName: suggestCollectionName(profiles, commonFields),
  };
}
