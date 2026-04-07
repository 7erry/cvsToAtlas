import type { Collection, Db } from 'mongodb';
import type { SchemaNode } from '../lib/schema.js';
import { inferSchema, schemaIndexCandidates } from '../lib/schema.js';
import { recommendIndexes, type RecommendedIndex } from '../lib/indexes.js';

export type ImportResult = {
  collectionName: string;
  insertedCount: number;
  indexesCreated: { name: string; key: Record<string, 1 | -1>; unique?: boolean }[];
  schemaSummary: string;
  recommendedIndexes: RecommendedIndex[];
};

function schemaToLines(node: SchemaNode | null, indent = 0): string[] {
  if (!node) return ['(empty)'];
  const pad = '  '.repeat(indent);
  if (node.kind === 'scalar') {
    return [`${pad}[${[...node.types].sort().join(', ')}]`];
  }
  if (node.kind === 'array') {
    const inner = node.element
      ? schemaToLines(node.element, indent + 1)
      : [`${pad}  (unknown element)`];
    return [`${pad}array`, ...inner];
  }
  const lines: string[] = [`${pad}object`];
  for (const [k, child] of [...node.fields.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${pad}  ${k}:`);
    lines.push(...schemaToLines(child, indent + 2));
  }
  return lines;
}

/**
 * Inserts documents into a new or existing collection and creates recommended indexes.
 */
export async function runImport(
  db: Db,
  collectionName: string,
  documents: Record<string, unknown>[],
  options: { dropExisting?: boolean } = {},
): Promise<ImportResult> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,119}$/.test(collectionName)) {
    throw new Error(
      'Collection name must start with letter or underscore and contain only letters, numbers, underscores.',
    );
  }

  const exists = (await db.listCollections({ name: collectionName }).toArray()).length > 0;
  if (exists && options.dropExisting) {
    await db.collection(collectionName).drop();
  }

  await db.createCollection(collectionName);
  const col: Collection = db.collection(collectionName);

  const schema = inferSchema(documents);
  const candidates = schemaIndexCandidates(schema);
  const recommended = recommendIndexes(candidates, documents);

  if (documents.length > 0) {
    await col.insertMany(documents, { ordered: false });
  }

  const indexesCreated: ImportResult['indexesCreated'] = [];
  for (const rec of recommended) {
    try {
      await col.createIndex(rec.key, rec.options);
      indexesCreated.push({
        name: rec.options.name,
        key: rec.key,
        ...(rec.options.unique ? { unique: true } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('already exists') && !msg.includes('duplicate key')) {
        throw e;
      }
    }
  }

  const schemaSummary = schemaToLines(schema).join('\n');

  return {
    collectionName,
    insertedCount: documents.length,
    indexesCreated,
    schemaSummary,
    recommendedIndexes: recommended,
  };
}
