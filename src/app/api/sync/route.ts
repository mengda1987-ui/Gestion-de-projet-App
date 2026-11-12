import { route, adminClient } from '@/lib/api/security';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export const GET = route(async (request, user) => {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = () => { if (!closed) controller.enqueue(encoder.encode('data: invalidate\n\n')); };
      const db = adminClient();
      let channel = db.channel('server-sync-' + crypto.randomUUID());
      for (const table of ['boards', 'crm_modules', 'users', 'workspace_settings']) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, send);
      channel.subscribe(status => { if (status === 'SUBSCRIBED') send(); });
      const heartbeat = setInterval(() => {
        void Promise.resolve(db.from('users').select('role,is_deleted,session_version').eq('id', user.uid).maybeSingle()).then(({ data, error }) => {
          if (closed) return;
          if (error || !data || data.is_deleted || data.role !== user.role || Number(data.session_version) !== (user.sessionVersion ?? 0) || Date.now() >= user.exp * 1000) { cleanup(); return; }
          send();
        }).catch(() => cleanup());
      }, 15000);
      const lifetime = setTimeout(() => cleanup(), 50000);
      cleanup = () => { if (closed) return; closed = true; clearInterval(heartbeat); clearTimeout(lifetime); void db.removeChannel(channel).catch(() => {}); try { controller.close(); } catch {} };
      request.signal.addEventListener('abort', cleanup, { once: true });
      send();
    }, cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
});
