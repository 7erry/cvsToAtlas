# Cursor Skill: CSV to Atlas

This repository includes a Cursor project skill at `.cursor/skills/csv-to-atlas/SKILL.md`.

The skill guides Cursor agents through safe CSV imports into MongoDB Atlas with the `csvToAtlas` CLI. It is intended for requests about:

- Importing one or more CSV files into Atlas.
- Running analysis-only checks before an import.
- Choosing join fields for related CSV files.
- Embedding one-to-many child CSV rows into parent documents.
- Reviewing import output, inferred schemas, index recommendations, and skipped merge rows.

## CLI Entry Point

Use the project CLI through npm:

```bash
npm run import-cli -- <args>
```

For analysis-only runs, no Atlas connection string is required:

```bash
npm run import-cli -- samples/common_customer_01_customers.csv samples/common_customer_02_orders.csv --analyze
```

For real imports, set `MONGODB_URI` in `.env`. `MONGODB_DB` is optional and defaults to `csv_to_atlas`.

## Safety Expectations

The skill instructs Cursor agents to confirm the target CSV files, database, collection name, and destructive options before importing. The `--drop` flag should only be used when replacing an existing collection is intended.

Never commit `.env`, Atlas credentials, or real connection strings.
