import 'dotenv/config';
import express, { type Request } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { mergeBatchesByJoinKey, type MergeByJoinStats } from './lib/mergeByJoinKey.js';
import { parseCsvBuffer } from './lib/parseCsv.js';
import { runImport } from './mongo/runImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function uploadedCsvFiles(req: Request): Express.Multer.File[] {
  const raw = req.files as Record<string, Express.Multer.File[]> | undefined;
  return [...(raw?.file ?? []), ...(raw?.files ?? [])];
}

const PORT = Number(process.env.PORT) || 3333;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'csv_to_atlas';

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: MONGODB_DB });
});

app.post(
  '/api/import',
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 30 },
  ]),
  async (req, res) => {
    if (!MONGODB_URI) {
      res.status(500).json({ error: 'MONGODB_URI is not set' });
      return;
    }

    const files = uploadedCsvFiles(req);
    const collectionName = String(req.body.collectionName || '').trim();
    const dropExisting = String(req.body.dropExisting || '') === 'true';
    const joinField = String(req.body.joinField || '').trim();

    if (files.length === 0) {
      res.status(400).json({ error: 'Add at least one CSV (field name "files" or legacy "file")' });
      return;
    }
    if (files.length > 1 && !joinField) {
      res.status(400).json({
        error:
          'joinField is required when uploading multiple CSV files (dotted path, e.g. orderId or customer.id)',
      });
      return;
    }
    if (!collectionName) {
      res.status(400).json({ error: 'Missing collectionName' });
      return;
    }

    try {
      const batches = files.map((f) => parseCsvBuffer(f.buffer).documents);
      let documents: Record<string, unknown>[];
      let merge: MergeByJoinStats | undefined;
      if (joinField) {
        const merged = mergeBatchesByJoinKey(batches, joinField);
        documents = merged.documents;
        merge = merged.stats;
      } else {
        documents = batches[0] ?? [];
      }

      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      try {
        const db = client.db(MONGODB_DB);
        const result = await runImport(db, collectionName, documents, { dropExisting });
        res.json(merge ? { ...result, merge } : result);
      } finally {
        await client.close();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  },
);

app.listen(PORT, () => {
  console.log(`CSV-to-Atlas http://localhost:${PORT}`);
  if (!MONGODB_URI) {
    console.warn('Warning: MONGODB_URI is not set. Set it in .env to enable imports.');
  }
});
