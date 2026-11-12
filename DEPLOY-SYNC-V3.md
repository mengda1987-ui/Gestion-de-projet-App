# 同步/权限升级交付说明

## 先决条件与发布顺序

本次数据库与应用协议是配套升级，不可只部署一边。旧客户端写接口会被拒绝，未确认的本地记录不会被自动清除。

1. 安排维护窗口，停止旧客户端继续编辑，确认旧版本没有未保存改动。先做 Supabase 现有备份或完整数据库导出。
2. 在 Supabase SQL Editor 按顺序执行 `supabase/migrations/202611120001_sync_security_v3.sql` 和 `supabase/migrations/202611120002_icon_image_size.sql`。第二个兼容迁移同步卡片字段校验（含 `linkedContacts`）；只执行第一个会拒绝新版 ADD_CARD 请求。两个文件均可重复执行；不需要重新运行更早迁移。
3. 如果出现规范化用户名重复，迁移会整体回滚。先核实同名账号归属、修改重名，再重新运行，不会静默合并或删除账号。
4. 紧接着部署这一份应用代码，强制所有设备刷新并重新登录。SQL 执行后、应用部署前，旧版直接读取会失败；这是维护窗口，不能滚动混用新旧版本。
5. 在 Supabase 和真实 Vercel 部署上测试两设备同账号编辑、断网/唤醒、权限变更、删除与恢复。

不得向浏览器传入 service_role。新前端只调用 HttpOnly Cookie 鉴权 API；Realtime 使用 `/api/sync` SSE，由服务端订阅数据库，客户端只收失效通知，再拉取经过授权过滤的数据。15 秒轮询兜底；SSE 50 秒主动重连，服务端 maxDuration 为 60 秒。需要部署平台允许该流式路由；若不支持，仍可轮询，但不应宣称 100% 实时。

## 环境变量

- 应用服务端：`NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`、`SESSION_SECRET`（至少 16 字符的高熵随机值）。
- 可选：`NEXT_PUBLIC_SITE_URL`（正式站点 origin，用于 metadata）；`GEMINI_API_KEY`（音频功能）。
- GitHub Actions：新增 Secret `SUPABASE_SERVICE_ROLE_KEY`；保留 `SUPABASE_URL`。备份不再使用公开 anon key。
- 本地/云端备份必须使用服务端专用凭据；不得把备份或私钥提交版本库。

## 验证命令

```sh
npx tsc --noEmit
npm run lint
npm run build
npm run test:sync
node scripts/test-api-smoke.cjs
```

SQL 回归测试使用隔离的 PostgreSQL-compatible PGlite，不访问生产数据库。PGlite 仅安装在临时目录，不加入应用依赖：

```sh
npm install --prefix /tmp/trello-v3-audit-db --no-audit --no-fund --ignore-scripts @electric-sql/pglite@0.5.16
PGLITE_MODULE=/tmp/trello-v3-audit-db/node_modules/@electric-sql/pglite node scripts/test-sync-v3.cjs --database
```

该测试涵盖重复迁移、纯 Reducer、连续派发、ID 稳定、数组实体差量、显式清空、跨列移动保留远端字段、SQL 幂等/冲突恢复、非法结构拒绝、权限与最后管理员保护、限流、备份恢复事务及匿名拒绝。它不替代手机真机和 Supabase Realtime 托管环境测试。

## 数据恢复与离线限制

- `npm run backup` 使用服务端事务 RPC 导出四张业务表。指纹覆盖内容而非仅卡片数量。
- `npm run backup:list` 列出快照。`node scripts/restore-snapshot.mjs --from <目录名>` 仅预览，加入 `--yes` 才写入；支持 `--only boards,crm_modules`。
- 恢复前完整导出安全副本；恢复在单个数据库事务中执行，保留快照外的行，不做盲目全库删除；推进版本并使所有会话失效。用户须重新登录。
- 未确认的操作不会按年龄或数量裁剪。永久无效的操作保留并明确报错，不会假装已同步；需要人工检查后决定处置。
- IndexedDB 失败降级到逐条 localStorage，再失败只保留内存并告警。浏览器所有持久化存储均不可用时，关闭页面无法保证保留，界面会提示不要关闭。
- 旧版未绑定账号的共享缓存/队列不自动上传，也不自动删除。应在旧设备确认归属后单独恢复，防止把其他账号的历史数据写入当前账号。

## 尚存的依赖风险

仅执行了不带 `--force` 的非破坏性 `npm audit fix`。Next 14.2.35 和其工具链仍有需跨框架主版本处理的公告命中；未通过删锁文件、屏蔽审计或强制升级隐藏告警。零 TypeScript/ESLint/构建错误不等同于零依赖安全公告。应另设框架升级任务进行 Next/React/ESLint 迁移验证。

## 权限语义

管理员管理看板删除、排序、可见性和全局外观。成员仅能修改自己可见的板/列/卡片；包含隐藏后代的结构性操作被拒绝。旧 `data.mindmap` 仅管理员可读写；成员脑图视图从已经过滤的列、卡片、清单派生，避免旧脑图文本泄露隐藏卡片。CRM 当前为登录后共享工作区，删除模块需管理员。
