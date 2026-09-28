-- CRM modules: 让 CRM 数据支持跨设备 + 多人在线协作
-- 结构与 boards 表同构：单个模块的 stages/fields/contacts 存在 data(JSONB) 里
-- id 用 TEXT（沿用前端 generateId() 生成的 id，便于本地老数据直接迁移上云）

CREATE TABLE IF NOT EXISTS crm_modules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '📋',
  color TEXT NOT NULL DEFAULT '#007AFF',
  data JSONB DEFAULT '{}'::jsonb,
  "order" INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_modules_order_idx ON crm_modules ("order");

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE crm_modules;

-- RLS: 与应用其它表一致（应用自带密码登录，未接入 Supabase Auth）
ALTER TABLE crm_modules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public access" ON crm_modules;
CREATE POLICY "Public access" ON crm_modules
  FOR ALL USING (true) WITH CHECK (true);
