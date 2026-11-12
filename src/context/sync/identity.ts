import type { Board, User } from '@/types';
/** Reuse confirmed equal subtrees without serializing every card on every poll. */
export function shareBoards(before: Board[], after: Board[]): Board[] {
  const old = new Map(before.map(b => [b.id, b]));
  const boards = after.map(b => { const prev = old.get(b.id); return prev && prev.version === b.version && prev.updatedAt === b.updatedAt ? prev : b; });
  return boards.length === before.length && boards.every((b,i) => b === before[i]) ? before : boards;
}
export function shareUsers(before: User[], after: User[]): User[] {
  return JSON.stringify(before) === JSON.stringify(after) ? before : after;
}
