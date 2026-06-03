import 'dotenv/config';
import express, { type Request } from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { analyzeCsvFiles, type CsvFileProfile } from './lib/analyzeCsvFiles.js';
import {
  mergeProfilesByJoinKey,
  type EmbeddedCsvSpec,
  type MergeByJoinStats,
} from './lib/mergeByJoinKey.js';
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

function profileUploadedFiles(files: Express.Multer.File[]): CsvFileProfile[] {
  return files.map((file) => {
    const parsed = parseCsvBuffer(file.buffer);
    return {
      fileName: file.originalname,
      headers: parsed.headers,
      rowCount: parsed.documents.length,
      documents: parsed.documents,
    };
  });
}

function parseEmbeddedCsvSpecs(raw: unknown): EmbeddedCsvSpec[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values
    .map((value) => String(value).trim())
    .filter(Boolean)
    .map((value) => {
      const separator = value.lastIndexOf(':');
      if (separator <= 0) return { fileName: value };
      return {
        fileName: value.slice(0, separator),
        fieldName: value.slice(separator + 1),
      };
    });
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
  '/api/analyze',
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: 30 },
  ]),
  (req, res) => {
    const files = uploadedCsvFiles(req);

    if (files.length === 0) {
      res.status(400).json({ error: 'Add at least one CSV (field name "files" or legacy "file")' });
      return;
    }

    try {
      res.json(analyzeCsvFiles(profileUploadedFiles(files)));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: message });
    }
  },
);

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
    let collectionName = String(req.body.collectionName || '').trim();
    const dropExisting = String(req.body.dropExisting || '') === 'true';
    let joinField = String(req.body.joinField || '').trim();
    const embeddedCsvs = parseEmbeddedCsvSpecs(req.body.embeddedFiles);

    if (files.length === 0) {
      res.status(400).json({ error: 'Add at least one CSV (field name "files" or legacy "file")' });
      return;
    }
    try {
      const profiles = profileUploadedFiles(files);
      const analysis = analyzeCsvFiles(profiles);
      joinField ||= analysis.suggestedJoinField ?? '';
      collectionName ||= analysis.suggestedCollectionName;

      if (files.length > 1 && !joinField) {
        res.status(400).json({
          error:
            'No common join field was found. Set joinField manually (dotted path, e.g. orderId or customer.id).',
          analysis,
        });
        return;
      }
      if (!collectionName) {
        res.status(400).json({ error: 'Missing collectionName', analysis });
        return;
      }

      const batches = profiles.map((profile) => profile.documents);
      let documents: Record<string, unknown>[];
      let merge: MergeByJoinStats | undefined;
      if (joinField) {
        const merged = mergeProfilesByJoinKey(
          profiles.map((profile) => ({
            fileName: profile.fileName,
            documents: profile.documents,
          })),
          joinField,
          embeddedCsvs,
        );
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
        res.json(merge ? { ...result, merge, analysis } : { ...result, analysis });
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
