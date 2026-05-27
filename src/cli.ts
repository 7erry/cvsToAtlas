import 'dotenv/config';
import { readFileSync } from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { analyzeCsvFiles, type CsvFileProfile } from './lib/analyzeCsvFiles.js';
import { mergeBatchesByJoinKey, type MergeByJoinStats } from './lib/mergeByJoinKey.js';
import { parseCsvBuffer } from './lib/parseCsv.js';
import { runImport } from './mongo/runImport.js';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'csv_to_atlas';

function parseArgs(argv: string[]): {
  csvPaths: string[];
  collectionName: string | undefined;
  joinField: string | undefined;
  analyzeOnly: boolean;
  drop: boolean;
} {
  let joinField: string | undefined;
  let analyzeOnly = false;
  let drop = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--drop') {
      drop = true;
      continue;
    }
    if (a === '--analyze' || a === '-a') {
      analyzeOnly = true;
      continue;
    }
    if (a === '--join' || a === '-j') {
      joinField = argv[++i];
      if (!joinField) {
        throw new Error('Missing value after --join');
      }
      continue;
    }
    if (a.startsWith('-')) {
      throw new Error(`Unknown option: ${a}`);
    }
    positional.push(a);
  }

  if (positional.length < 1) {
    throw new Error(
      'Usage: npm run import-cli -- <file.csv> [more.csv ...] [collectionName] [--join <field>] [--drop] [--analyze]',
    );
  }

  const lastArg = positional[positional.length - 1] ?? '';
  const lastArgLooksLikeCsv = /\.csv$/i.test(lastArg);
  const collectionName = lastArgLooksLikeCsv ? undefined : lastArg;
  const csvPaths = lastArgLooksLikeCsv ? positional : positional.slice(0, -1);

  if (csvPaths.length === 0) {
    throw new Error('Add at least one CSV path before the optional collection name');
  }

  return {
    csvPaths,
    collectionName,
    joinField: joinField?.trim() || undefined,
    analyzeOnly,
    drop,
  };
}

function profileCsvPath(csvPath: string): CsvFileProfile {
  const parsed = parseCsvBuffer(readFileSync(csvPath));
  return {
    fileName: path.basename(csvPath),
    headers: parsed.headers,
    rowCount: parsed.documents.length,
    documents: parsed.documents,
  };
}

async function main(): Promise<void> {
  let csvPaths: string[];
  let collectionName: string | undefined;
  let joinField: string | undefined;
  let analyzeOnly: boolean;
  let drop: boolean;

  try {
    const parsed = parseArgs(process.argv.slice(2));
    csvPaths = parsed.csvPaths;
    collectionName = parsed.collectionName;
    joinField = parsed.joinField;
    analyzeOnly = parsed.analyzeOnly;
    drop = parsed.drop;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
    return;
  }

  const profiles = csvPaths.map(profileCsvPath);
  const analysis = analyzeCsvFiles(profiles);
  for (const profile of profiles) {
    console.error(`Parsed ${profile.rowCount} rows from ${profile.fileName}`);
  }

  if (analyzeOnly) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  if (!uri) {
    console.error('Set MONGODB_URI in .env');
    process.exit(1);
    return;
  }

  joinField ||= analysis.suggestedJoinField;
  collectionName ||= analysis.suggestedCollectionName;

  if (csvPaths.length > 1 && !joinField) {
    throw new Error('No common join field was found. Pass --join <field> to choose one manually.');
  }

  console.error(`Using collection "${collectionName}"`);
  if (joinField) console.error(`Using join field "${joinField}"`);

  const batches = profiles.map((profile) => profile.documents);
  let documents: Record<string, unknown>[];
  let mergeStats: MergeByJoinStats | undefined;
  if (joinField) {
    const merged = mergeBatchesByJoinKey(batches, joinField);
    documents = merged.documents;
    mergeStats = merged.stats;
    console.error(
      `Merged by "${joinField}": ${mergeStats.mergedDocumentCount} documents (${mergeStats.totalRowsRead} rows read, ${mergeStats.rowsSkippedMissingJoinKey} skipped without key)`,
    );
  } else {
    documents = batches[0] ?? [];
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const result = await runImport(db, collectionName, documents, { dropExisting: drop });
    const out = mergeStats ? { ...result, merge: mergeStats, analysis } : { ...result, analysis };
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
