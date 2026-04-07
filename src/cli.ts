import 'dotenv/config';
import { readFileSync } from 'fs';
import { MongoClient } from 'mongodb';
import { parseCsvBuffer } from './lib/parseCsv.js';
import { runImport } from './mongo/runImport.js';

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'csv_to_atlas';

async function main(): Promise<void> {
  if (!uri) {
    console.error('Set MONGODB_URI in .env');
    process.exit(1);
  }

  const file = process.argv[2];
  const collectionName = process.argv[3];
  const drop = process.argv.includes('--drop');

  if (!file || !collectionName) {
    console.error('Usage: npm run import-cli -- <path.csv> <collectionName> [--drop]');
    process.exit(1);
  }

  const buf = readFileSync(file);
  const { documents, headers } = parseCsvBuffer(buf);
  console.error(`Parsed ${documents.length} rows, columns: ${headers.join(', ')}`);

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const result = await runImport(db, collectionName, documents, { dropExisting: drop });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
