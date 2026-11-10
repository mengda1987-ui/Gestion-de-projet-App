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
  const argOf = (name, def) => {
    const i = process.argv.indexOf(name);
    return i > -1 ? parseInt(process.argv[i + 1], 10) : def;
  };
  // 保留天数（按时间清理，主策略）
  const retainDays = argOf('--days', 2);
  // 保留份数（安全上限，防止极端情况下无限增长）
  const keep = argOf('--keep', 2000);

  const root = path.join(os.homedir(), 'Backups', 'trello-app');

  // 内容未变时不重复写盘：对比上一份快照的摘要，
  // 避免 5 分钟间隔下产生大量完全相同的副本、挤掉更早的时间点。
  // 仍会在 _meta.json 记 lastCheckedAt，可看出守护是活的。
  try {
    const prevDirs = fs.existsSync(root)
      ? fs.readdirSync(root).filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n)).sort().reverse()
      : [];
    if (prevDirs.length > 0) {
      const prevDir = path.join(root, prevDirs[0]);
      const prevMeta = JSON.parse(fs.readFileSync(path.join(prevDir, '_meta.json'), 'utf8'));

      // 拉一次云端做指纹比对（只取 id + 卡片数，开销很小）
      const res = await fetch(`${url}/rest/v1/boards?select=id,data`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      });
      if (res.ok) {
        const rows = await res.json();
        const fingerprint = rows
          .map((b) => `${b.id}:${countCards([b])}`)
          .sort()
          .join('|');

        // 用同样算法算上一份的指纹
        const prevBoards = JSON.parse(fs.readFileSync(path.join(prevDir, 'boards.json'), 'utf8'));
        const prevFingerprint = prevBoards
          .map((b) => `${b.id}:${countCards([b])}`)
          .sort()
          .join('|');

        if (fingerprint === prevFingerprint && prevMeta.fingerprint) {
          // 内容没变，只更新时间戳，不新建目录
          prevMeta.lastCheckedAt = new Date().toISOString();
          prevMeta.checkCount = (prevMeta.checkCount || 1) + 1;
          fs.writeFileSync(path.join(prevDir, '_meta.json'), JSON.stringify(prevMeta, null, 2));
          console.log(`· 内容未变化，跳过写入（上一份: ${prevDirs[0]}，已检查 ${prevMeta.checkCount} 次）`);
          return;
        }
      }
    }
  } catch {
    // 指纹比对失败不影响正常备份
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
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
  const fingerprint = boards
    .map((b) => `${b.id}:${countCards([b])}`)
    .sort()
    .join('|');
  const meta = {
    createdAt: new Date().toISOString(),
    counts: summary,
    totalCards: cardCount,
    fingerprint,
    checkCount: 1,
    source: url,
  };
  fs.writeFileSync(path.join(dir, '_meta.json'), JSON.stringify(meta, null, 2));

  console.log(`✓ 备份完成: ${dir}`);
  console.log(`  看板 ${boards.length} 个，卡片 ${cardCount} 张`);

  // 清理旧备份
  //
  // 2026-11-10 改为按「时间」清理而不是按「份数」：
  // 按份数会有问题——变更频繁时 500 份可能只覆盖不到 2 天，
  // 而按天数能保证「始终保留最近 N 天」，且占用随使用强度自适应，
  // 数据安静时不会白占几百 MB。
  const all = fs.readdirSync(root)
    .filter((n) => /^\d{4}-\d{2}-\d{2}T/.test(n))
    .sort()
    .reverse();

  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const expired = all.filter((name) => {
    const t = new Date(name.replace(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/, '$1T$2:$3:$4Z')).getTime();
    return Number.isFinite(t) && t < cutoff;
  });

  // 超额（极端情况：短时间内爆炸式变更）时按天数删完还有剩余，再按份数兜底
  const remaining = all.filter((n) => !expired.includes(n));
  const overLimit = remaining.length > keep ? remaining.slice(keep) : [];
  const toDelete = [...expired, ...overLimit];

  for (const old of toDelete) {
    fs.rmSync(path.join(root, old), { recursive: true, force: true });
  }
  if (toDelete.length > 0) {
    const freedKb = toDelete.length * 780;
    console.log(
      `  已清理 ${toDelete.length} 份超期备份（保留最近 ${retainDays} 天），释放约 ${(freedKb / 1024).toFixed(0)} MB`
    );
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
