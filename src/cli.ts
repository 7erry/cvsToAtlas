import 'dotenv/config';
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';
import { mergeBatchesByJoinKey, type MergeByJoinStats } from './lib/mergeByJoinKey.js';
import { parseCsvBuffer } from './lib/parseCsv.js';
import { runImport } from './mongo/runImport.js';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'csv_to_atlas';

function parseArgs(argv: string[]): {
  csvPaths: string[];
  collectionName: string;
  joinField: string | undefined;
  drop: boolean;
} {
  let joinField: string | undefined;
  let drop = false;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--drop') {
      drop = true;
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

  if (positional.length < 2) {
    throw new Error(
      'Usage: npm run import-cli -- <file.csv> [more.csv ...] <collectionName> [--join <field>] [--drop]',
    );
  }

  const collectionName = positional[positional.length - 1];
  const csvPaths = positional.slice(0, -1);

  if (csvPaths.length > 1 && !joinField?.trim()) {
    throw new Error('Multiple CSV files require --join <field> (dotted path allowed, e.g. order.id)');
  }

  return {
    csvPaths,
    collectionName,
    joinField: joinField?.trim() || undefined,
    drop,
  };
}

async function main(): Promise<void> {
  if (!uri) {
    console.error('Set MONGODB_URI in .env');
    process.exit(1);
  }

  let csvPaths: string[];
  let collectionName: string;
  let joinField: string | undefined;
  let drop: boolean;

  try {
    const parsed = parseArgs(process.argv.slice(2));
    csvPaths = parsed.csvPaths;
    collectionName = parsed.collectionName;
    joinField = parsed.joinField;
    drop = parsed.drop;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
    return;
  }

  const batches = csvPaths.map((p) => parseCsvBuffer(readFileSync(p)).documents);
  for (let i = 0; i < csvPaths.length; i++) {
    console.error(`Parsed ${batches[i]?.length ?? 0} rows from ${csvPaths[i]}`);
  }

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
    const out = mergeStats ? { ...result, merge: mergeStats } : result;
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
