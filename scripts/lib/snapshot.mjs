import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const tables = ['boards', 'users', 'workspace_settings', 'crm_modules'];
export function configuration() {
  const file = path.resolve(process.cwd(), '.env.local');
  const env = {};
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server-only SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL required; never use the public anon key for backups.');
  return { url, key };
}
export async function rpc(name, body = {}) {
  const { url, key } = configuration();
  const res = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
export const digest = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
export const cardCount = data => (data.boards || []).filter(b => !b.is_deleted).reduce((n,b) => n + (b.data?.columns || []).reduce((m,c) => m + (c.cards || []).length,0),0);
export function writeSnapshot(dir, data) {
  for (const table of tables) if (!Array.isArray(data[table])) throw new Error(`Incomplete snapshot: ${table}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const table of tables) fs.writeFileSync(path.join(dir, table + '.json'), JSON.stringify(data[table], null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, '_meta.json'), JSON.stringify({ createdAt: new Date().toISOString(), fingerprint: digest(data), totalCards: cardCount(data), counts: Object.fromEntries(tables.map(t => [t,data[t].length])) }, null, 2), { mode: 0o600 });
}
