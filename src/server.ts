import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import { parseCsvBuffer } from './lib/parseCsv.js';
import { runImport } from './mongo/runImport.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const PORT = Number(process.env.PORT) || 3333;
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'csv_to_atlas';

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, db: MONGODB_DB });
});

app.post('/api/import', upload.single('file'), async (req, res) => {
  if (!MONGODB_URI) {
    res.status(500).json({ error: 'MONGODB_URI is not set' });
    return;
  }

  const file = req.file;
  const collectionName = String(req.body.collectionName || '').trim();
  const dropExisting = String(req.body.dropExisting || '') === 'true';

  if (!file?.buffer) {
    res.status(400).json({ error: 'Missing file field "file"' });
    return;
  }
  if (!collectionName) {
    res.status(400).json({ error: 'Missing collectionName' });
    return;
  }

  try {
    const { documents } = parseCsvBuffer(file.buffer);
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    try {
      const db = client.db(MONGODB_DB);
      const result = await runImport(db, collectionName, documents, { dropExisting });
      res.json(result);
    } finally {
      await client.close();
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`CSV-to-Atlas http://localhost:${PORT}`);
  if (!MONGODB_URI) {
    console.warn('Warning: MONGODB_URI is not set. Set it in .env to enable imports.');
  }
});
