import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabaseAdmin';
import { requireSession, getSession } from '@/lib/auth/session';
import { resolveUserColumns, hasUserColumn, getUserById } from '@/lib/auth/usersSchema';
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  normalizeName,
  nameKey,
} from '@/lib/auth/password';

/**
 * /api/members —— 成员（users 表）唯一读写入口
 *
 * 背景（审计 C3）：users 表原本对 anon 全开放，任何人可 SELECT password。
 * 收紧 RLS 后前端不能再直连 users，所有读写收敛到这里：
 *
 *   GET    /api/members            任意已登录用户 → 公开字段列表（永不含口令）
 *   POST   /api/members            仅 admin  → 新建成员（服务端 scrypt 哈希）
 *   PATCH  /api/members            本人改自己 / admin 改任意
 *   DELETE /api/members?id=<uuid>  仅 admin  → 软删除（is_deleted）
 *
 * 越权防护：
 *   - role 只能由 admin 修改，且不允许把最后一个 admin 降级
 *   - 改口令必须提供旧口令（admin 重置他人除外）
 *   - 响应中永不包含 password / password_hash
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SELECT_BASE = 'id, name, email, avatar, color, role, lang, created_at';

/**
 * 构造当前实际可用的 select 列（迁移前 is_deleted 不存在，不能硬编码）。
 */
async function publicSelect(admin: any): Promise<string> {
  const cols = await resolveUserColumns(admin);
  const hasDeleted = cols.split(',').map((s: string) => s.trim()).includes('is_deleted');
  return hasDeleted ? `${SELECT_BASE}, is_deleted` : SELECT_BASE;
}

function publicMember(row: any) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || '',
    avatar: row.avatar || '',
    color: row.color || '#3B82F6',
    role: row.role === 'admin' ? 'admin' : 'member',
    lang: row.lang || 'zh',
  };
}

function err(status: number, code: string, message?: string) {
  return NextResponse.json({ error: code, message }, { status });
}

/** 把 requireSession/requireAdmin 抛出的异常统一转成响应 */
function guard(fn: () => any) {
  try {
    return { session: fn(), response: null as null | NextResponse };
  } catch (e: any) {
    const status = e?.status === 403 ? 403 : 401;
    return { session: null, response: err(status, e?.message || 'UNAUTHORIZED') };
  }
}

// ---------------------------------------------------------------------------
// GET：成员列表（公开字段）
// ---------------------------------------------------------------------------
export async function GET() {
  const { response } = guard(requireSession);
  if (response) return response;

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  let query = admin.from('users').select((await publicSelect(admin)) as any);
  // 迁移前没有 is_deleted 列，此时无法也无需过滤
  if (await hasUserColumn(admin, 'is_deleted')) {
    query = query.or('is_deleted.is.null,is_deleted.eq.false');
  }
  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) {
    console.error('[members] 读取失败:', error.message);
    return err(500, 'Database error');
  }

  return NextResponse.json({ members: (data || []).map(publicMember) });
}

// ---------------------------------------------------------------------------
// POST：新建成员（仅 admin）
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const { session, response } = guard(requireSession);
  if (response) return response;
  if (session!.role !== 'admin') return err(403, 'FORBIDDEN');

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  let body: any;
  try {
    body = await request.json();
  } catch {
    return err(400, 'BAD_REQUEST');
  }

  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (!name) return err(400, 'BAD_REQUEST', '名字不能为空');
  if (name.length > 60) return err(400, 'BAD_REQUEST', '名字过长');

  const pwErr = validatePasswordStrength(password);
  if (pwErr) return err(400, 'WEAK_PASSWORD', pwErr);

  // 重名检查（规范化后比较，避免 `%` / 大小写绕开）
  const normalized = normalizeName(name);
  const { data: existing, error: exErr } = await admin
    .from('users')
    .select('id, name')
    .ilike('name', normalized.replace(/[%_\\]/g, '\\$&'))
    .limit(50);

  if (exErr) {
    console.error('[members] 重名检查失败:', exErr.message);
    return err(500, 'Database error');
  }
  if ((existing || []).some((u: any) => normalizeName(u.name) === normalized)) {
    return err(409, 'NAME_TAKEN', '该名字已存在');
  }

  // 迁移前若 password_hash / name_key / is_deleted 列不存在，则跳过这些字段，
  // 保证「先部署代码」阶段仍能正常添加成员（口令暂时以旧字段存储）。
  const hasHash = await hasUserColumn(admin, 'password_hash');
  const hasKey = await hasUserColumn(admin, 'name_key');
  const hasDeleted = await hasUserColumn(admin, 'is_deleted');

  const row: Record<string, unknown> = {
    name,
    email: typeof body?.email === 'string' ? body.email.trim().slice(0, 200) : '',
    avatar: typeof body?.avatar === 'string' ? body.avatar.slice(0, 2000) : '',
    color: typeof body?.color === 'string' ? body.color.slice(0, 32) : '#3B82F6',
    // 角色只能由 admin 在创建时指定，默认 member
    role: body?.role === 'admin' ? 'admin' : 'member',
    lang: body?.lang === 'en' ? 'en' : 'zh',
  };
  if (hasHash) {
    row.password_hash = hashPassword(password);
    row.password = null;
  } else {
    // 迁移未执行：退回旧字段（登录时会被识别为需升级）
    row.password = password;
  }
  if (hasKey) row.name_key = nameKey(normalized);
  if (hasDeleted) row.is_deleted = false;

  const { data, error } = await admin
    .from('users')
    .insert(row)
    .select((await publicSelect(admin)) as any)
    .single();

  if (error) {
    console.error('[members] 新建失败:', error.message);
    return err(500, 'Database error');
  }

  return NextResponse.json({ member: publicMember(data) }, { status: 201 });
}


// ---------------------------------------------------------------------------
// PATCH：更新成员（本人改自己 / admin 改任意）
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  const { session, response } = guard(requireSession);
  if (response) return response;

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  let body: any;
  try {
    body = await request.json();
  } catch {
    return err(400, 'BAD_REQUEST');
  }

  const targetId = typeof body?.id === 'string' ? body.id : session!.uid;
  const isAdmin = session!.role === 'admin';
  const isSelf = targetId === session!.uid;

  // 非管理员只能改自己
  if (!isAdmin && !isSelf) return err(403, 'FORBIDDEN');

  // 取目标用户当前状态（用于权限与口令校验）
  const target = await getUserById(admin, targetId);
  if (!target || target.is_deleted === true) return err(404, 'NOT_FOUND');

  const patch: Record<string, unknown> = {};

  // --- 普通字段 ---
  if (typeof body?.name === 'string') {
    const name = body.name.trim();
    if (!name) return err(400, 'BAD_REQUEST', '名字不能为空');
    if (name.length > 60) return err(400, 'BAD_REQUEST', '名字过长');
    const normalized = normalizeName(name);
    if (normalized !== normalizeName(target.name)) {
      const { data: dup } = await admin
        .from('users')
        .select('id, name')
        .ilike('name', normalized.replace(/[%_\\]/g, '\\$&'))
        .limit(50);
      if ((dup || []).some((u: any) => u.id !== targetId && normalizeName(u.name) === normalized)) {
        return err(409, 'NAME_TAKEN', '该名字已存在');
      }
    }
    patch.name = name;
    patch.name_key = nameKey(normalized);
  }

  if (typeof body?.email === 'string') patch.email = body.email.trim().slice(0, 200);
  if (typeof body?.avatar === 'string') patch.avatar = body.avatar.slice(0, 2000);
  if (typeof body?.color === 'string') patch.color = body.color.slice(0, 32);
  if (body?.lang === 'en' || body?.lang === 'zh') patch.lang = body.lang;

  // --- 角色：只有 admin 能改，且不能把最后一个 admin 降级 ---
  if (body?.role === 'admin' || body?.role === 'member') {
    if (!isAdmin) return err(403, 'FORBIDDEN', '只有管理员可以修改角色');
    if (target.role === 'admin' && body.role === 'member') {
      let q = admin
        .from('users')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin');
      if (await hasUserColumn(admin, 'is_deleted')) {
        q = q.or('is_deleted.is.null,is_deleted.eq.false');
      }
      const { count } = await q;
      if ((count ?? 0) <= 1) {
        return err(409, 'LAST_ADMIN', '不能降级最后一个管理员');
      }
    }
    patch.role = body.role;
  }

  // --- 口令 ---
  if (typeof body?.password === 'string' && body.password.length > 0) {
    const pwErr = validatePasswordStrength(body.password);
    if (pwErr) return err(400, 'WEAK_PASSWORD', pwErr);

    // 非管理员改自己（或 admin 改自己）必须提供旧口令
    const mustVerifyOld = isSelf;
    if (mustVerifyOld) {
      const oldPw = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
      const { ok } = verifyPassword(oldPw, target.password_hash, target.password);
      if (!ok) return err(403, 'INVALID_PASSWORD', '当前密码不正确');
    }
    patch.password_hash = hashPassword(body.password);
    patch.password = null; // 清掉历史明文
  }

  if (Object.keys(patch).length === 0) {
    return err(400, 'BAD_REQUEST', '没有可更新的字段');
  }

  const { data, error } = await admin
    .from('users')
    .update(patch)
    .eq('id', targetId)
    .select((await publicSelect(admin)) as any)
    .single();

  if (error) {
    console.error('[members] 更新失败:', error.message);
    return err(500, 'Database error');
  }

  return NextResponse.json({ member: publicMember(data) });
}


// ---------------------------------------------------------------------------
// DELETE：软删除成员（仅 admin）
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const { session, response } = guard(requireSession);
  if (response) return response;
  if (session!.role !== 'admin') return err(403, 'FORBIDDEN');

  const admin = getAdminClient();
  if (!admin) return err(503, 'SERVER_NOT_CONFIGURED');

  const id = request.nextUrl.searchParams.get('id') || '';
  if (!id) return err(400, 'BAD_REQUEST', '缺少 id');

  // 不允许删除自己
  if (id === session!.uid) return err(409, 'SELF_DELETE', '不能删除自己');

  const target = await getUserById(admin, id);
  if (!target || target.is_deleted === true) return err(404, 'NOT_FOUND');

  // 不能删除最后一个管理员
  if (target.role === 'admin') {
    let q = admin
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin');
    if (await hasUserColumn(admin, 'is_deleted')) {
      q = q.or('is_deleted.is.null,is_deleted.eq.false');
    }
    const { count } = await q;
    if ((count ?? 0) <= 1) return err(409, 'LAST_ADMIN', '不能删除最后一个管理员');
  }

  // 软删除：保留行与历史，避免不可恢复（审计 M7）
  // 迁移前没有 is_deleted 列时，拒绝删除而不是退化成物理删除 ——
  // 宁可让管理员看到「请先执行迁移」，也不做不可逆操作。
  if (!(await hasUserColumn(admin, 'is_deleted'))) {
    return err(409, 'MIGRATION_REQUIRED', '请先执行 lock_down_users_rls.sql 启用软删除');
  }

  const { error } = await admin
    .from('users')
    .update({ is_deleted: true })
    .eq('id', id);

  if (error) {
    console.error('[members] 删除失败:', error.message);
    return err(500, 'Database error');
  }

  return NextResponse.json({ success: true, id });
}

// ---------------------------------------------------------------------------
// 健康检查：用于前端判断服务端是否就绪（不返回任何敏感信息）
// ---------------------------------------------------------------------------
export async function HEAD() {
  const session = getSession();
  return new NextResponse(null, { status: session ? 204 : 401 });
}

