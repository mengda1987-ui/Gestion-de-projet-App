-- 为门户页和 CRM 背景图片增加透明度字段
ALTER TABLE public.workspace_settings
ADD COLUMN IF NOT EXISTS portal_image_opacity double precision DEFAULT 1;

ALTER TABLE public.workspace_settings
ADD COLUMN IF NOT EXISTS crm_image_opacity double precision DEFAULT 1;
