'use client';

/** One authenticated SSE connection per tab, shared by board and CRM consumers. */
const listeners = new Set<() => void>();
let stream: EventSource | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener);
  if (!stream && typeof EventSource !== 'undefined') {
    stream = new EventSource('/api/sync');
    stream.onmessage = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = undefined; for (const next of listeners) next(); }, 120);
    };
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { stream?.close(); stream = undefined; clearTimeout(timer); timer = undefined; }
  };
}
