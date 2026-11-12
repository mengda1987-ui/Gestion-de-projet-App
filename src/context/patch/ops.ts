import type { Action } from '../actions';
import type { Board } from '@/types';
import { diffEntities, type EntityOp } from './delta';
export interface BoardPatchPayload { ops: EntityOp[]; intent?: 'user_edit' }
const local = new Set(['SET_CURRENT_USER', 'SET_APP_SECTION', 'SET_VIEW_MODE', 'SET_FILTERS', 'TOGGLE_DARK_MODE', 'SET_DARK_MODE', 'SET_ONLINE_USERS', 'SET_CURRENT_BOARD', 'APPLY_REMOTE_UPDATE', 'APPLY_EXTERNAL_STATE', 'LOAD_ALL_DATA', 'UPDATE_USER', 'ADD_USER', 'DELETE_USER']);
export function isLocalOnlyAction(action: Action): boolean { return local.has(action.type); }
export function actionToPatch(action: Action, board: Board, before?: Board): BoardPatchPayload | null {
  if (!before || isLocalOnlyAction(action)) return null;
  const ops = diffEntities(before, board);
  return ops.length ? { ops, intent: 'user_edit' } : null;
}
