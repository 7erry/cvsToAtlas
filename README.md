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

### Multiple related CSVs (merge into one collection)

Use one **join field** (dotted path allowed) so rows with the same value are merged into a single document with `deepMerge`:

```bash
npm run import-cli -- samples/multi_join_01_orders.csv samples/multi_join_02_payments.csv merged_orders --join orderId --drop
```

With a single `--join`, you can also **deduplicate** rows inside one CSV that share the same key.

**Web UI:** choose multiple CSV files, set **Join field**, then import.

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
| `samples/multi_join_01_orders.csv` + `multi_join_02_payments.csv` | Same `orderId` — merge with `--join orderId` |

**Merge behavior:** rows from every CSV that share the same join value (after CSV parsing) are combined into one document. Nested objects merge; arrays are aligned by index. Rows missing the join field are skipped (see `merge` stats in the JSON response).

## Security

Do not commit `.env` or real connection strings. Rotate Atlas credentials if they were exposed.
