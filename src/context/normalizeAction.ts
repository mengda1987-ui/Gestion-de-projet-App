import type { Action } from './actions';

/** Randomness and wall-clock reads are confined to the dispatch boundary. */
export function normalizeAction(input: Action): Action {
  if (input._meta) return input;
  const meta = { id: crypto.randomUUID(), at: new Date().toISOString() };
  const action = { ...input, _meta: meta } as Action;
  switch (action.type) {
    case 'CREATE_BOARD': action.payload = { ...action.payload, id: meta.id }; break;
    case 'ADD_COLUMN': action.payload = { ...action.payload, id: action.payload.id || meta.id }; break;
    case 'ADD_CARD': action.payload = { ...action.payload, card: { ...action.payload.card, id: action.payload.card.id || meta.id } }; break;
    case 'ADD_LABEL': action.payload = { label: { ...action.payload.label, id: action.payload.label.id || meta.id } }; break;
    case 'ADD_CHECKLIST': action.payload = { ...action.payload, id: action.payload.id || meta.id }; break;
    case 'ADD_CHECKLIST_ITEM': action.payload = { ...action.payload, itemId: action.payload.itemId || meta.id }; break;
  }
  return action;
}

/** Each reducer invocation gets an independent, deterministic ID sequence. */
export function actionClock(action: Action, namespace: number) {
  let index = 0;
  const seed = action._meta?.id || '00000000-0000-4000-8000-000000000000';
  return {
    now: action._meta?.at || '1970-01-01T00:00:00.000Z',
    generateId: () => {
      const suffix = (BigInt('0x' + seed.replace(/-/g, '').slice(-12)) + BigInt(namespace * 100000 + ++index)) % (1n << 48n);
      return seed.slice(0, 24) + suffix.toString(16).padStart(12, '0');
    },
  };
}
