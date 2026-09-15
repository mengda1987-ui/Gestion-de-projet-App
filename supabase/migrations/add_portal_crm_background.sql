-- 为门户页和 CRM 增加可自定义背景字段
ALTER TABLE public.workspace_settings
ADD COLUMN IF NOT EXISTS portal_background text DEFAULT '#f5f5f7';

ALTER TABLE public.workspace_settings
ADD COLUMN IF NOT EXISTS crm_background text DEFAULT '#f5f5f7';
