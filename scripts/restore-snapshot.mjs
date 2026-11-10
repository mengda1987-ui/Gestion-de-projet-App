#!/usr/bin/env node
/**
 * 从本地快照恢复数据到 Supabase
 *
 * 背景：2026-11-05 数据覆盖事故后，Supabase 免费版无备份可用。
 * 本脚本用于把 scripts/backup-snapshot.mjs 生成的快照写回云端。
 *
 * 用法：
 *   node scripts/restore-snapshot.mjs --list                 # 列出所有快照
 *   node scripts/restore-snapshot.mjs --show <时间戳>        # 查看快照内容摘要
 *   node scripts/restore-snapshot.mjs --from <时间戳>        # 预览恢复（不写入）
 *   node scripts/restore-snapshot.mjs --from <时间戳> --yes  # 实际执行恢复
 *   node scripts/restore-snapshot.mjs --from <时间戳> --yes --only boards
 *
 * 安全措施：
 *   - 不加 --yes 只做预览，绝不写入
 *   - 执行前自动把「当前云端状态」另存一份，便于反悔
 *   - 恢复 boards 时只写回原有 id，不删除快照之外的看板
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  const env = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return {
    url: env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    key: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

const { url, key } = loadEnv();
const root = path.join(os.homedir(), 'Backups', 'trello-app');
const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
};

function listSnapshots() {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n))
    .sort()
    .reverse();
}

function readSnapshot(stamp) {
  const dir = path.join(root, stamp);
  if (!fs.existsSync(dir)) throw new Error(`快照不存在: ${dir}`);
  const out = {};
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith('.json') && !f.startsWith('_')) {
      out[f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    }
  }
  let meta = {};
  const metaPath = path.join(dir, '_meta.json');
  if (fs.existsSync(metaPath)) meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  return { data: out, meta };
}

function countCards(boards) {
  return (boards || []).reduce(
    (s, b) => s + (b.data?.columns || []).reduce((n, c) => n + ((c?.cards || []).length), 0),
    0
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i > -1 ? argv[i + 1] : undefined;
  };
  const only = arg('--only');
  const yes = argv.includes('--yes');

  if (argv.includes('--list') || argv.length === 0) {
    const list = listSnapshots();
    if (list.length === 0) {
      console.log('没有任何快照。请先运行: node scripts/backup-snapshot.mjs');
      return;
    }
    console.log(`共 ${list.length} 份快照（新的在前）：\n`);
    for (const s of list) {
      try {
        const { data, meta } = readSnapshot(s);
        console.log(`  ${s}   看板 ${data.boards?.length ?? 0} / 卡片 ${countCards(data.boards)}   ${meta.createdAt || ''}`);
      } catch {
        console.log(`  ${s}   (读取失败)`);
      }
    }
    console.log('\n预览恢复: node scripts/restore-snapshot.mjs --from <时间戳>');
    console.log('实际恢复: node scripts/restore-snapshot.mjs --from <时间戳> --yes');
    return;
  }

  const stamp = arg('--from') || arg('--show');
  if (!stamp) {
    console.error('请指定 --from <时间戳>，或 --list 查看可用快照');
    process.exit(1);
  }

  const { data, meta } = readSnapshot(stamp);
  console.log(`快照: ${stamp}`);
  console.log(`  创建时间: ${meta.createdAt || '未知'}`);
  console.log(`  看板: ${data.boards?.length ?? 0} 个，卡片: ${countCards(data.boards)} 张`);
  console.log(`  用户: ${data.users?.length ?? 0} 个`);
  console.log(`  CRM 模块: ${data.crm_modules?.length ?? 0} 个`);
  console.log(`  背景: ${data.workspace_settings?.[0]?.workspace_background || '(无)'}`);

  if (argv.includes('--show')) return;

  // 读取云端当前状态用于对比
  const res = await fetch(`${url}/rest/v1/boards?select=id,title,data`, { headers });
  const remote = await res.json();
  console.log(`\n云端当前: 看板 ${remote.length} 个，卡片 ${countCards(remote)} 张`);

  const tables = only ? only.split(',') : ['boards', 'users', 'workspace_settings', 'crm_modules'];

  if (!yes) {
    console.log('\n以上为预览，未做任何修改。');
    console.log(`如确认恢复，请执行:`);
    console.log(`  node scripts/restore-snapshot.mjs --from ${stamp} --yes\n`);
    return;
  }

  // 恢复前先把当前云端状态存一份，便于反悔
  const safetyStamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safetyDir = path.join(root, `${safetyStamp}-BEFORE-RESTORE`);
  fs.mkdirSync(safetyDir, { recursive: true });
  for (const t of ['boards', 'users', 'workspace_settings', 'crm_modules']) {
    const r = await fetch(`${url}/rest/v1/${t}?select=*`, { headers });
    if (r.ok) {
      fs.writeFileSync(path.join(safetyDir, `${t}.json`), JSON.stringify(await r.json(), null, 2));
    }
  }
  console.log(`\n已保存恢复前状态: ${safetyDir}`);

  for (const t of tables) {
    const rows = data[t];
    if (!rows || rows.length === 0) {
      console.log(`  跳过 ${t}（快照中无数据）`);
      continue;
    }
    const r = await fetch(`${url}/rest/v1/${t}`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!r.ok) {
      console.error(`  ✗ ${t} 恢复失败: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
      process.exitCode = 1;
    } else {
      console.log(`  ✓ ${t} 已恢复 ${rows.length} 行`);
    }
  }
  console.log('\n恢复完成。请刷新页面确认。');
}

main().catch((e) => {
  console.error('✗ 恢复失败:', e.message);
  process.exit(1);
});
