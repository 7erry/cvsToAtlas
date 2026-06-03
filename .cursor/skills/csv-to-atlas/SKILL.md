---
name: csv-to-atlas
description: Import CSV files into MongoDB Atlas using the csvToAtlas CLI. Use when the user mentions csvToAtlas, CSV-to-Atlas, importing CSV files to Atlas, MongoDB CSV imports, join fields, or embedding related CSV rows.
---

# CSV to Atlas

## Instructions

Use this skill when helping with the `csvToAtlas` CLI workflow for analyzing CSV files, importing them into MongoDB Atlas, merging related CSVs, or embedding one-to-many rows.

## Safety First

- Treat Atlas imports as write operations. Confirm the target CSV files, database, collection name, and whether replacement is intended before running imports.
- Never print or commit `MONGODB_URI`, `.env`, credentials, or real connection strings.
- Use `--drop` only when the user explicitly wants to replace an existing collection.
- Prefer an analysis-only run before importing multiple related CSVs or when the join field is uncertain.

## Setup Checks

1. Verify the project has the `csvToAtlas` CLI available. In this repo, use:

```bash
npm run import-cli -- <args>
```

2. For real Atlas imports, ensure `.env` contains `MONGODB_URI`. `MONGODB_DB` is optional and defaults to `csv_to_atlas`.
3. For analysis-only runs, `MONGODB_URI` is not required.

## Analysis Workflow

Analyze CSVs before importing when there are multiple files, unknown relationships, or no collection name yet:

```bash
npm run import-cli -- path/to/first.csv path/to/second.csv --analyze
```

Use the JSON output to identify:

- `files`: parsed headers and row counts.
- `commonFields`: ranked join candidates.
- `suggestedJoinField`: best inferred join field.
- `suggestedCollectionName`: safe collection name inferred from file names or join fields.

## Import Patterns

Single CSV import:

```bash
npm run import-cli -- path/to/file.csv collection_name
```

Replace an existing collection only after explicit confirmation:

```bash
npm run import-cli -- path/to/file.csv collection_name --drop
```

Multiple related CSVs merged by one join field:

```bash
npm run import-cli -- path/to/customers.csv path/to/orders.csv collection_name --join customerId
```

Let the CLI infer the collection name and join field from analysis:

```bash
npm run import-cli -- path/to/customers.csv path/to/orders.csv --drop
```

Embed child CSV rows into parent documents for one-to-many relationships:

```bash
npm run import-cli -- path/to/orders.csv path/to/payments.csv orders --join orderId --parent orders.csv --embed payments.csv:payments
```

Repeat `--embed` for multiple child CSVs. The parent CSV cannot also be embedded.

## CSV Modeling Rules

- Dotted headers create nested objects: `address.city` becomes `{ address: { city } }`.
- Numeric path segments create indexed arrays: `items.0.sku` becomes `items[0].sku`.
- Headers ending in `[]` parse the cell as one JSON value at that path: `tags[]` with `["a","b"]` becomes an array.
- Empty cells become `null`.
- Values that look like numbers, booleans, JSON objects, or JSON arrays are coerced automatically.

## Result Review

After an import, summarize the important JSON fields:

- `collectionName`: collection written to.
- `insertedCount`: document count inserted.
- `indexesCreated`: indexes created in Atlas.
- `recommendedIndexes`: index recommendations and reasons.
- `schemaSummary`: inferred MongoDB document shape.
- `merge`: merge or embed stats, including skipped rows.

If rows were skipped because of missing join keys or missing parents, call that out and suggest checking the join field or parent/child selection.
