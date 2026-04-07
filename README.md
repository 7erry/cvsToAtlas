# CSV-to-Atlas Smart Importer

Upload a CSV (or use the CLI) to infer nested documents and arrays from column names, import into MongoDB Atlas, and create recommended indexes.

## Setup

1. Copy `.env.example` to `.env` and set `MONGODB_URI` (and optionally `MONGODB_DB`, default `csv_to_atlas`).
2. `npm install`
3. `npm run dev` — open [http://localhost:3333](http://localhost:3333) and upload a CSV.

## CLI

```bash
npm run import-cli -- samples/01_simple_flat.csv my_collection --drop
```

`--drop` replaces an existing collection with the same name.

## Column naming

- **Dots** nest fields: `address.city` → `{ "address": { "city": "..." } }`.
- **Numbers** in the path are array indices: `items.0.sku` → `{ "items": [{ "sku": "..." }] }`.
- **Trailing `[]`** means the cell is one JSON value (often an array) at that path: `tags[]` with `["a","b"]` → `{ "tags": ["a","b"] }`.
- **Values** that look like numbers, booleans, or JSON objects/arrays are parsed automatically.

## Sample files

| File | What it exercises |
|------|-------------------|
| `samples/01_simple_flat.csv` | Flat rows |
| `samples/02_nested_address.csv` | Nested `address` and `profile` |
| `samples/03_arrays_and_json.csv` | `tags[]`, nested `specs`, JSON in cells |
| `samples/04_line_item_rows.csv` | Array rows via `lineItems.0.*` |
| `samples/05_advanced_mixed.csv` | Nested `payload`, `payload.metrics[]`, `meta` JSON |

## Security

Do not commit `.env` or real connection strings. Rotate Atlas credentials if they were exposed.
