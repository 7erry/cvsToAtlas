import { parse } from 'csv-parse/sync';
import { rowToDocument } from './csvRows.js';

/**
 * Parses CSV text into header names and one document per data row.
 */
export function parseCsvBuffer(buffer: Buffer): {
  headers: string[];
  documents: Record<string, unknown>[];
} {
  const text = buffer.toString('utf8');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    return { headers: [], documents: [] };
  }

  const headers = Object.keys(records[0]);
  const documents = records.map((row) =>
    rowToDocument(headers, headers.map((h) => String(row[h] ?? ''))),
  );
  return { headers, documents };
}
