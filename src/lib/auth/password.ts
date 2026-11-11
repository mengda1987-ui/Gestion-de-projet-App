/**
 * 口令哈希（scrypt，零外部依赖，仅用 node:crypto）
 *
 * 背景（审计 C3）：原实现是明文存储 + 明文比较，任何拿到 anon key 的人
 * 都能把全站口令读走。这里改为 scrypt，并支持「双轨渐进式迁移」：
 *
 *   1) 新口令 → 只写 password_hash
 *   2) 老数据（只有明文 password）→ 校验时回退明文比对，
 *      校验通过后立即升级为 password_hash 并清空 password（无感迁移）
 *
 * 存储格式： scrypt$<N>$<r>$<p>$<salt_b64>$<hash_b64>
 *
 * 注意：本文件只在服务端（API Route / Node 运行时）使用，不得引入客户端组件。
 */
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'node:crypto';

// OWASP 建议：N=16384(2^14), r=8, p=1, keylen=64
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;
// scrypt 的 maxmem 默认 32MB，N=16384,r=8 需要 128*N*r = 16MB，留足余量
const MAXMEM = 128 * N * R * 2;

const PREFIX = 'scrypt';

/** 生成口令哈希 */
export function hashPassword(plain: string): string {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('password must be a non-empty string');
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain.normalize('NFKC'), salt, KEYLEN, {
    N, r: R, p: P, maxmem: MAXMEM,
  });
  return [
    PREFIX, N, R, P,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * 校验口令。
 * @param plain  用户提交的明文
 * @param stored 数据库中的 password_hash（可能为 null）
 * @param legacyPlain 数据库中的旧明文 password（迁移期兼容）
 */
export function verifyPassword(
  plain: string,
  stored: string | null | undefined,
  legacyPlain: string | null | undefined,
): { ok: boolean; needsUpgrade: boolean } {
  if (typeof plain !== 'string' || plain.length === 0) {
    return { ok: false, needsUpgrade: false };
  }

  // 1) 已有 scrypt 哈希 → 走哈希校验
  if (stored && stored.startsWith(PREFIX + '$')) {
    try {
      const parts = stored.split('$');
      if (parts.length !== 6) return { ok: false, needsUpgrade: false };
      const [, n, r, p, saltB64, hashB64] = parts;
      const salt = Buffer.from(saltB64, 'base64');
      const expected = Buffer.from(hashB64, 'base64');
      const actual = scryptSync(plain.normalize('NFKC'), salt, expected.length, {
        N: Number(n), r: Number(r), p: Number(p),
        maxmem: 128 * Number(n) * Number(r) * 2,
      });
      const ok = expected.length === actual.length && timingSafeEqual(expected, actual);
      return { ok, needsUpgrade: false };
    } catch {
      return { ok: false, needsUpgrade: false };
    }
  }

  // 2) 老数据：明文比对（迁移期临时兼容），通过后标记需要升级
  if (typeof legacyPlain === 'string' && legacyPlain.length > 0) {
    const a = Buffer.from(plain.normalize('NFKC'));
    const b = Buffer.from(legacyPlain.normalize('NFKC'));
    const ok = a.length === b.length && timingSafeEqual(a, b);
    return { ok, needsUpgrade: ok };
  }

  return { ok: false, needsUpgrade: false };
}

/** 是否已是 scrypt 哈希（用于判断是否需要迁移） */
export function isHashed(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX + '$');
}

/** 口令强度校验（服务端强制，不依赖前端） */
export function validatePasswordStrength(plain: string): string | null {
  if (typeof plain !== 'string' || plain.length === 0) return '密码不能为空';
  if (plain.length < 8) return '密码至少需要 8 个字符';
  if (plain.length > 200) return '密码过长';
  if (/^\d+$/.test(plain)) return '密码不能是纯数字';
  return null;
}

/**
 * 用户名的规范化键：用于唯一性判断与登录匹配。
 * 说明：原实现用 ilike(name, input)，用户输入 % 或 _ 会被当成通配符，
 * 可能匹配到别人的账号（审计 C3 提到的「身份串号」）。
 * 这里改为「规范化后精确匹配」，并在 SQL 层用同样规则建唯一索引。
 */
export function normalizeName(name: string): string {
  return String(name || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** 用规范化名字生成稳定查找键（与 SQL 迁移里的 md5() 保持一致） */
export function nameKey(name: string): string {
  return createHash('md5').update(normalizeName(name), 'utf8').digest('hex');
}
