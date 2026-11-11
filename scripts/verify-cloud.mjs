import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const U = env.NEXT_PUBLIC_SUPABASE_URL;
const K = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const H = { apikey: K, Authorization: 'Bearer ' + K };

const boards = await (await fetch(U + '/rest/v1/boards?select=id,title,data', { headers: H })).json();
let total = 0;
let latest = '';
for (const x of boards) {
  for (const c of (x.data?.columns || [])) {
    for (const cd of (c.cards || [])) {
      total++;
      if (cd.updatedAt && cd.updatedAt > latest) latest = cd.updatedAt;
    }
  }
}
console.log('看板数量: ' + boards.length);
console.log('卡片总数: ' + total);
console.log('最新卡片时间: ' + latest);

const s = await (await fetch(U + '/rest/v1/workspace_settings?select=workspace_background,portal_background,crm_background,login_background', { headers: H })).json();
console.log('');
console.log('云端背景设置:');
for (const [k, v] of Object.entries(s[0])) {
  console.log('  ' + k + ' = ' + v);
}

const users = await (await fetch(U + '/rest/v1/users?select=id,name', { headers: H })).json();
console.log('');
console.log('用户: ' + users.map((u) => u.name).join(', '));

const crm = await (await fetch(U + '/rest/v1/crm_modules?select=id', { headers: H })).json();
console.log('CRM 模块: ' + crm.length + ' 个');
