#!/usr/bin/env node
/**
 * 云端轻量守护 —— 探测数据是否变化，变化了才备份
 *
 * 设计目标：在 Vercel / GitHub Actions 上跑（关机也继续），
 * 且流量开销极小。
 *
 * 关键优化：判断"变没变"不需要下载全量数据。
 *   - 精确行数用 HEAD 请求读 content-range，响应体 0 字节
 *   - 全量数据只在「确认变化」后才下载
 *
 * 实测（6 看板 / 82 卡片）：
 *   探测一次：约 0 字节响应体
 *   全量备份：约 545KB
 *
 * 用法：
 *   node scripts/cloud-guard.mjs --mode=probe    # 只探测，输出是否变化
 *   node scripts/cloud-guard.mjs --mode=backup   # 探测 + 变化则全量备份
 */

import fs from 'node:fs';
import path from 'node:path';

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
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

const { url, key } = loadEnv();
if (!url || !key) {
  console.error('✗ 缺少 Supabase 配置');
  process.exit(1);
}

const H = { apikey: key, Authorization: `Bearer ${key}` };

/**
 * 用 HEAD + Prefer: count=exact 做精确计数。
 * 响应体为 0 字节，只读 header，流量可忽略。
 */
async function exactCount(table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=id&limit=1`, {
    method: 'HEAD',
    headers: { ...H, Prefer: 'count=exact' },
  });
  const cr = res.headers.get('content-range'); // 形如 "0-0/6"
  if (!cr) return null;
  const total = cr.split('/')[1];
  return total === '*' ? null : parseInt(total, 10);
}

/**
 * 轻量指纹：只取 id + updated_at（562 字节），以及各表行数（HEAD，0 字节）。
 *
 * 重要教训：不要为了"省流量"去 select data->columns —— PostgREST 返回的
 * 仍是完整 columns JSON（实测 555KB，和全量几乎一样）。真正有效的是
 * HEAD + Prefer: count=exact，响应体 0 字节。
 */
async function lightFingerprint() {
  const res = await fetch(
    `${url}/rest/v1/boards?select=id,updated_at&order=id`,
    { headers: H }
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map((b) => `${b.id}:${b.updated_at}`).join('|');
}

async function fullBackup(outDir) {
  const tables = ['boards', 'users', 'workspace_settings', 'crm_modules'];
  fs.mkdirSync(outDir, { recursive: true });
  const summary = {};
  for (const t of tables) {
    const res = await fetch(`${url}/rest/v1/${t}?select=*`, { headers: H });
    if (!res.ok) {
      summary[t] = 0;
      fs.writeFileSync(path.join(outDir, `${t}.json`), '[]');
      continue;
    }
    const data = await res.json();
    summary[t] = data.length;
    fs.writeFileSync(path.join(outDir, `${t}.json`), JSON.stringify(data, null, 2));
  }
  return summary;
}

async function main() {
  const mode = (process.argv.find((a) => a.startsWith('--mode=')) || '').split('=')[1] || 'probe';
  const stateFile = process.env.GUARD_STATE_FILE || '.guard-state.json';

  // 1. 极轻量探测：只拿行数
  const boardCount = await exactCount('boards');
  const userCount = await exactCount('users');

  console.log(`探测: boards=${boardCount} users=${userCount}`);

  // 2. 读取上次状态
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {}

  // 3. 行数变化就是明确信号，直接判定为变化（不下载数据）
  const countChanged =
    !prev || prev.boardCount !== boardCount || prev.userCount !== userCount;

  if (mode === 'probe') {
    console.log(countChanged ? '变化: 是（行数不同）' : '变化: 未知（行数相同，需指纹确认）');
    if (countChanged) {
      console.log(`  ${prev?.boardCount ?? '?'} → ${boardCount} 看板`);
    }
    return;
  }

  // 4. backup 模式：行数没变时，用轻量指纹确认内容是否真的变了
  let fp = null;
  if (!countChanged) {
    fp = await lightFingerprint();
    const fpChanged = !prev || !prev.fingerprint || prev.fingerprint !== fp;
    if (!fpChanged) {
      console.log('· 内容未变化，跳过备份');
      return;
    }
    console.log('内容有变化（指纹不同），开始备份');
  } else {
    fp = await lightFingerprint();
  }

  // 5. 全量备份
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(process.env.BACKUP_DIR || 'backups', stamp);
  const summary = await fullBackup(outDir);

  const boards = JSON.parse(fs.readFileSync(path.join(outDir, 'boards.json'), 'utf8'));
  const totalCards = boards.reduce(
    (s, b) => s + (b.data?.columns || []).reduce((n, c) => n + ((c?.cards || []).length), 0),
    0
  );

  // 6. 记录状态
  fs.writeFileSync(
    stateFile,
    JSON.stringify(
      {
        boardCount,
        userCount,
        fingerprint: fp,
        lastBackupAt: new Date().toISOString(),
        totalCards,
      },
      null,
      2
    )
  );

  console.log(`✓ 备份完成: ${outDir}`);
  console.log(`  看板 ${boards.length} 个，卡片 ${totalCards} 张`);

  // 7. 骤降告警
  if (prev?.totalCards > 0 && totalCards < prev.totalCards * 0.7) {
    console.warn(`\n⚠️  卡片数从 ${prev.totalCards} 降到 ${totalCards}，可能发生覆盖！\n`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error('✗ 失败:', e.message);
  process.exit(1);
});
