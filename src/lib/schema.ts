/**
 * Lightweight schema tree used to suggest indexes and show inferred structure.
 */
export type SchemaNode =
  | { kind: 'scalar'; types: Set<string> }
  | { kind: 'object'; fields: Map<string, SchemaNode> }
  | { kind: 'array'; element: SchemaNode | null };

function scalarTypes(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function mergeScalar(a: SchemaNode, value: unknown): SchemaNode {
  if (a.kind !== 'scalar') return mergeNode(a, value);
  const t = scalarTypes(value);
  const next = new Set(a.types);
  next.add(t);
  return { kind: 'scalar', types: next };
}

function mergeNode(node: SchemaNode | null, value: unknown): SchemaNode {
  if (value === null || value === undefined) {
    if (!node) return { kind: 'scalar', types: new Set(['null']) };
    if (node.kind === 'scalar') {
      node.types.add('null');
      return node;
    }
    return node;
  }

  if (Array.isArray(value)) {
    let elem: SchemaNode | null = null;
    if (node?.kind === 'array') elem = node.element;
    for (const item of value) {
      elem = elem ? mergeNode(elem, item) : mergeNode(null, item);
    }
    return { kind: 'array', element: elem };
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const fields =
      node?.kind === 'object' ? new Map(node.fields) : new Map<string, SchemaNode>();
    for (const k of Object.keys(obj)) {
      const prev = fields.get(k) ?? null;
      fields.set(k, mergeNode(prev, obj[k]));
    }
    return { kind: 'object', fields };
  }

  return mergeScalar(node ?? { kind: 'scalar', types: new Set() }, value);
}

/**
 * Accumulates inferred types from a batch of documents (nested objects and arrays).
 */
export function inferSchema(docs: Record<string, unknown>[]): SchemaNode | null {
  let root: SchemaNode | null = null;
  for (const doc of docs) {
    root = mergeNode(root, doc);
  }
  return root;
}

function flattenPaths(node: SchemaNode, prefix: string, out: string[]): void {
  if (node.kind === 'scalar') {
    if (prefix) out.push(prefix);
    return;
  }
  if (node.kind === 'array') {
    if (node.element?.kind === 'object') {
      for (const [k, child] of node.element.fields) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (child.kind === 'object') flattenPaths(child, p, out);
        else if (child.kind === 'array') flattenPaths(child, p, out);
        else if (child.kind === 'scalar') out.push(p);
      }
    }
    return;
  }
  for (const [k, child] of node.fields) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (child.kind === 'object') flattenPaths(child, p, out);
    else if (child.kind === 'array') flattenPaths(child, p, out);
    else if (child.kind === 'scalar') out.push(p);
  }
}

/**
 * Returns dotted field paths suitable for MongoDB index keys (scalar leaves).
 */
export function schemaIndexCandidates(node: SchemaNode | null): string[] {
  if (!node) return [];
  const paths: string[] = [];
  flattenPaths(node, '', paths);
  return paths.filter((p) => p !== '(root)' && !p.startsWith('_id'));
}
