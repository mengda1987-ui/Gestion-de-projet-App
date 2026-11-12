export type JsonObject = Record<string, any>;
export type EntityOp =
  | { op: 'set'; path: string[]; value: unknown }
  | { op: 'insert'; path: string[]; value: JsonObject; afterId: string | null }
  | { op: 'remove'; path: string[] }
  | { op: 'unset'; path: string[] }
  | { op: 'move'; path: string[]; fromPath: string[]; id: string; afterId: string | null }
  | { op: 'add_value' | 'remove_value'; path: string[]; value: string }
  | { op: 'order'; path: string[]; ids: string[] };

const ignored = new Set(['version', 'updatedAt', 'createdAt', 'isDeleted']);
const object = (v: any): v is JsonObject => v !== null && typeof v === 'object' && !Array.isArray(v);
const entities = (v: any): v is JsonObject[] => Array.isArray(v) && v.every(x => object(x) && typeof x.id === 'string');
const wire = (value: any): any => value === undefined ? null : Array.isArray(value) ? value.map(wire) : object(value) ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, wire(v)])) : value;

/** ID-addressed arrays preserve independent concurrent inserts and field edits. */
export function diffEntities(before: JsonObject, after: JsonObject, path: string[] = []): EntityOp[] {
  const ops: EntityOp[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (ignored.has(key) || key === 'id') continue;
    const a = before[key], b = after[key], p = [...path, key];
    if (a === b) continue;
    if (entities(a) && entities(b)) {
      const old = new Map(a.map(x => [x.id, x]));
      const nextIds = new Set(b.map(x => x.id));
      for (const x of a) if (!nextIds.has(x.id)) ops.push({ op: 'remove', path: [...p, x.id] });
      b.forEach((x, i) => {
        const prev = old.get(x.id);
        if (prev) ops.push(...diffEntities(prev, x, [...p, x.id]));
        else ops.push({ op: 'insert', path: p, value: wire(x), afterId: b[i - 1]?.id ?? null });
      });
      const commonBefore = a.filter(x => nextIds.has(x.id)).map(x => x.id);
      const commonAfter = b.filter(x => old.has(x.id)).map(x => x.id);
      if (commonBefore.some((id, i) => id !== commonAfter[i])) ops.push({ op: 'order', path: p, ids: b.map(x => x.id) });
    } else if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every(v => typeof v === 'string')) {
      for (const value of a) if (!b.includes(value)) ops.push({ op: 'remove_value', path: p, value });
      for (const value of b) if (!a.includes(value)) ops.push({ op: 'add_value', path: p, value });
    } else if (path[path.length - 1] === 'customFields' && !(key in after)) {
      ops.push({ op: 'unset', path: p });
    } else if (object(a) && object(b) && key !== 'mmPosition') {
      ops.push(...diffEntities(a, b, p));
    } else if (JSON.stringify(wire(a)) !== JSON.stringify(wire(b))) {
      ops.push({ op: 'set', path: p, value: wire(b) });
    }
  }
  if (!path.length && Array.isArray(before.columns) && Array.isArray(after.columns)) {
    const moved = new Map<string, { fromPath: string[]; path: string[]; afterId: string | null }>();
    for (const col of after.columns) for (let i = 0; i < col.cards.length; i++) {
      const card = col.cards[i];
      const old = before.columns.find((c: any) => c.id !== col.id && c.cards.some((x: any) => x.id === card.id));
      if (old) moved.set(card.id, { fromPath: ['columns', old.id, 'cards'], path: ['columns', col.id, 'cards'], afterId: col.cards[i - 1]?.id ?? null });
    }
    return ops.flatMap(op => {
      if (op.op === 'remove' && op.path.length === 4 && moved.has(op.path[3])) return [];
      if (op.op === 'insert' && op.path.length === 3 && moved.has(op.value.id)) {
        return [{ op: 'move', ...moved.get(op.value.id)!, id: op.value.id } as EntityOp];
      }
      return [op];
    });
  }
  return ops;
}

function change(value: any, path: string[], op: EntityOp): any {
  if (!path.length) {
    if (op.op === 'set') return wire(op.value);
    if (op.op === 'add_value') return Array.isArray(value) && value.includes(op.value) ? value : [...(Array.isArray(value) ? value : []), op.value];
    if (op.op === 'remove_value') return (Array.isArray(value) ? value : []).filter(v => v !== op.value);
    if (op.op === 'insert') {
      const list = Array.isArray(value) ? [...value] : [];
      if (list.some(x => x.id === op.value.id)) return list;
      const i = op.afterId === null ? -1 : list.findIndex(x => x.id === op.afterId);
      list.splice(i + 1, 0, wire(op.value));
      return list;
    }
    if (op.op === 'order') {
      const list = Array.isArray(value) ? value : [];
      const rank = new Map(op.ids.map((id, i) => [id, i]));
      return [...list].sort((a, b) => (rank.get(a.id) ?? op.ids.length) - (rank.get(b.id) ?? op.ids.length));
    }
    return undefined;
  }
  const [key, ...rest] = path;
  if (Array.isArray(value)) {
    if (op.op === 'remove' && !rest.length) return value.filter(x => x.id !== key);
    return value.map(x => x.id === key ? change(x, rest, op) : x);
  }
  const result = { ...(value || {}) };
  if ((op.op === 'remove' || op.op === 'unset') && !rest.length) delete result[key];
  else result[key] = change(result[key], rest, op);
  return result;
}

export function applyEntityOps<T>(value: T, ops: EntityOp[]): T {
  const result = ops.reduce((current, op) => {
    if (op.op !== 'move') return change(current, op.path, op);
    let list: any = current;
    for (const key of op.fromPath) list = Array.isArray(list) ? list.find(x => x.id === key) : list?.[key];
    const entity = Array.isArray(list) ? list.find(x => x.id === op.id) : undefined;
    if (!entity) return current;
    const removed = change(current, [...op.fromPath, op.id], { op: 'remove', path: [...op.fromPath, op.id] });
    return change(removed, op.path, { op: 'insert', path: op.path, value: entity, afterId: op.afterId });
  }, value);
  if (result && Array.isArray((result as any).columns)) {
    return { ...result, columns: (result as any).columns.map((col: any, order: number) => ({ ...col, order, cards: col.cards.map((card: any, order: number) => ({ ...card, order })) })) };
  }
  return result;
}
