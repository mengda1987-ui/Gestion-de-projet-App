#!/usr/bin/env node
/**
 * 快照备份脚本 —— 从 Supabase 导出全量数据到本地带时间戳的 JSON 文件
 *
 * 背景：2026-11-05 发生数据覆盖事故，Supabase 免费版无备份无 PITR，
 * 数据无法恢复。本脚本用于建立独立于 Supabase 的本地备份，确保任何时候
 * 都能回到任意一个历史时间点。
 *
 * 用法：
 *   node scripts/backup-snapshot.mjs              # 备份一次
 *   node scripts/backup-snapshot.mjs --keep 30    # 只保留最近 30 份
 *
 * 输出：~/Backups/trello-app/<时间戳>/boards.json 等
 * 建议配合 cron / launchd 每小时执行一次（见 scripts/install-backup-cron.sh）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// 从 .env.local 读取配置，避免把密钥写死在脚本里
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
if (!url || !key) {
  console.error('✗ 缺少 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY（检查 .env.local）');
  process.exit(1);
}

async function fetchTable(table, query = 'select=*') {
  const res = await fetch(`${url}/rest/v1/${table}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    // 表不存在时返回空数组而不是中断整个备份
    if (res.status === 404 || txt.includes('PGRST205')) {
      return { ok: false, data: [], error: 'table-not-found' };
    }
    throw new Error(`${table}: HTTP ${res.status} ${txt.slice(0, 200)}`);
  }
  return { ok: true, data: await res.json() };
}

function countCards(boards) {
  return (boards || []).reduce(
    (s, b) => s + (b.data?.columns || []).reduce((n, c) => n + ((c?.cards || []).length), 0),
    0
  );
}

async function main() {
  const keepArgIdx = process.argv.indexOf('--keep');
  const keep = keepArgIdx > -1 ? parseInt(process.argv[keepArgIdx + 1], 10) : 50;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const root = path.join(os.homedir(), 'Backups', 'trello-app');
  const dir = path.join(root, stamp);
  fs.mkdirSync(dir, { recursive: true });

  const tables = ['boards', 'users', 'workspace_settings', 'crm_modules'];
  const summary = {};

  for (const t of tables) {
    const r = await fetchTable(t);
    fs.writeFileSync(path.join(dir, `${t}.json`), JSON.stringify(r.data, null, 2));
    summary[t] = r.ok ? r.data.length : `跳过(${r.error})`;
  }

  // 写入摘要，便于快速判断这份备份是否健康
  const boards = JSON.parse(fs.readFileSync(path.join(dir, 'boards.json'), 'utf8'));
  const cardCount = countCards(boards);
  const meta = {
    createdAt: new Date().toISOString(),
    counts: summary,
    totalCards: cardCount,
    source: url,
  };
  fs.writeFileSync(path.join(dir, '_meta.json'), JSON.stringify(meta, null, 2));

  console.log(`✓ 备份完成: ${dir}`);
  console.log(`  看板 ${boards.length} 个，卡片 ${cardCount} 张`);

  // 清理旧备份
  const all = fs.readdirSync(root)
    .filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n))
    .sort()
    .reverse();
  if (all.length > keep) {
    for (const old of all.slice(keep)) {
      fs.rmSync(path.join(root, old), { recursive: true, force: true });
    }
    console.log(`  已清理 ${all.length - keep} 份旧备份（保留最近 ${keep} 份）`);
  }

  // 健康告警：卡片数比上一份骤降 30% 以上时明确警告
  const prev = all.find((n) => n !== stamp);
  if (prev) {
    try {
      const prevMeta = JSON.parse(fs.readFileSync(path.join(root, prev, '_meta.json'), 'utf8'));
      const diff = cardCount - prevMeta.totalCards;
      if (prevMeta.totalCards > 0 && diff < -prevMeta.totalCards * 0.3) {
        console.warn(`\n⚠️  警告：卡片数从 ${prevMeta.totalCards} 降到 ${cardCount}（少了 ${-diff} 张）`);
        console.warn(`   可能发生了数据覆盖，请立即检查！上一份备份: ${path.join(root, prev)}\n`);
        process.exitCode = 2;
      }
    } catch {}
  }
}

main().catch((e) => {
  console.error('✗ 备份失败:', e.message);
  process.exit(1);
});
