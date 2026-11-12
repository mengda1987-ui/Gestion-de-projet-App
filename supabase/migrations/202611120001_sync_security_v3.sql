-- v3 synchronization/security upgrade. Run once BEFORE deploying the matching app.
-- Re-runnable; preserves business rows and unacknowledged work. No seed passwords.
BEGIN;
CREATE TABLE IF NOT EXISTS public.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text DEFAULT '', avatar text DEFAULT '', color text DEFAULT '#3B82F6', role text DEFAULT 'member', password text, created_at timestamptz DEFAULT now());
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS name_key text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS lang text DEFAULT 'zh';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS session_version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.users ALTER COLUMN password DROP NOT NULL;
-- Match JavaScript NFKC + whitespace folding. Abort rather than silently merging accounts.
UPDATE public.users SET name_key=md5(lower(btrim(regexp_replace(normalize(name,NFKC),'\s+',' ','g'))));
DO $$ BEGIN
 IF EXISTS(SELECT name_key FROM users GROUP BY name_key HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate normalized usernames: resolve duplicates before rerunning v3 migration'; END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_name_key ON public.users(name_key);
CREATE TABLE IF NOT EXISTS public.boards (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, background text DEFAULT '#f5f5f7', labels jsonb DEFAULT '[]', data jsonb DEFAULT '{}', created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS emoji text;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS "iconBg" text;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS "iconImage" text;
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS "visibleTo" jsonb DEFAULT '[]';
ALTER TABLE public.boards ADD COLUMN IF NOT EXISTS "order" integer;
CREATE TABLE IF NOT EXISTS public.crm_modules (id text PRIMARY KEY, name text NOT NULL DEFAULT '', name_en text NOT NULL DEFAULT '', emoji text NOT NULL DEFAULT '📋', color text NOT NULL DEFAULT '#007AFF', data jsonb DEFAULT '{}', "order" integer DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
ALTER TABLE public.crm_modules ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0;
ALTER TABLE public.crm_modules ADD COLUMN IF NOT EXISTS is_deleted boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS public.workspace_settings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_background text, login_background text, updated_at timestamptz DEFAULT now());
ALTER TABLE public.workspace_settings ADD COLUMN IF NOT EXISTS portal_background text;
ALTER TABLE public.workspace_settings ADD COLUMN IF NOT EXISTS crm_background text;
ALTER TABLE public.workspace_settings ADD COLUMN IF NOT EXISTS portal_image_opacity double precision DEFAULT 1;
ALTER TABLE public.workspace_settings ADD COLUMN IF NOT EXISTS crm_image_opacity double precision DEFAULT 1;
ALTER TABLE public.workspace_settings ADD COLUMN IF NOT EXISTS logo text DEFAULT '';
CREATE TABLE IF NOT EXISTS public.boards_history (id bigserial PRIMARY KEY, board_id uuid NOT NULL, title text, payload jsonb NOT NULL, card_count integer DEFAULT 0, reason text DEFAULT 'save', created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.crm_modules_history (id bigserial PRIMARY KEY, module_id text NOT NULL, payload jsonb NOT NULL, contact_count integer DEFAULT 0, reason text DEFAULT 'save', created_at timestamptz DEFAULT now());
ALTER TABLE public.crm_modules_history ALTER COLUMN module_id TYPE text USING module_id::text;
CREATE TABLE IF NOT EXISTS public.workspace_settings_history (id bigserial PRIMARY KEY, payload jsonb NOT NULL, reason text DEFAULT 'save', created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.sync_receipts_v3 (actor_id uuid NOT NULL, entry_id uuid NOT NULL, target text NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,entry_id));
CREATE TABLE IF NOT EXISTS public.api_quota_v3 (actor_id uuid NOT NULL, bucket text NOT NULL, starts_at timestamptz NOT NULL, count integer NOT NULL, PRIMARY KEY(actor_id,bucket));
CREATE TABLE IF NOT EXISTS public.revoked_sessions_v3 (sid uuid PRIMARY KEY,user_id uuid NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS sync_receipts_v3_created ON public.sync_receipts_v3(created_at);

CREATE OR REPLACE FUNCTION public.lookup_sync_receipt_v3(p_entry uuid,p_actor uuid,p_target text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE receipt sync_receipts_v3;
BEGIN
  SELECT * INTO receipt FROM sync_receipts_v3 WHERE actor_id=p_actor AND entry_id=p_entry;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF receipt.target<>p_target OR receipt.fingerprint<>md5(p_input::text) THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_MISMATCH'); END IF;
  RETURN receipt.result;
END $$;

CREATE OR REPLACE FUNCTION public._entity_change_v3(doc jsonb, path text[], operation jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE result jsonb := '[]'; item jsonb; key text; rest text[]; found boolean := false; pos integer; i integer := 0;
BEGIN
  IF cardinality(path)=0 THEN
    CASE operation->>'op'
    WHEN 'set' THEN RETURN operation->'value';
    WHEN 'add_value' THEN
      IF jsonb_typeof(doc)<>'array' OR jsonb_typeof(operation->'value')<>'string' THEN RAISE EXCEPTION 'BAD_PATCH'; END IF;
      IF doc @> jsonb_build_array(operation->'value') THEN RETURN doc; END IF;
      RETURN doc||jsonb_build_array(operation->'value');
    WHEN 'remove_value' THEN
      IF jsonb_typeof(doc)<>'array' OR jsonb_typeof(operation->'value')<>'string' THEN RAISE EXCEPTION 'BAD_PATCH'; END IF;
      RETURN COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(doc) x WHERE x<>operation->'value'),'[]');
    WHEN 'insert' THEN
      IF jsonb_typeof(doc)<>'array' OR jsonb_typeof(operation->'value')<>'object' THEN RAISE EXCEPTION 'BAD_PATCH'; END IF;
      IF EXISTS(SELECT 1 FROM jsonb_array_elements(doc) x WHERE x->>'id'=operation->'value'->>'id') THEN RAISE EXCEPTION 'DUPLICATE_ID'; END IF;
      IF operation->'afterId'='null'::jsonb THEN result:=jsonb_build_array(operation->'value'); found:=true; END IF;
      FOR item IN SELECT * FROM jsonb_array_elements(doc) LOOP
        result:=result||jsonb_build_array(item);
        IF item->>'id'=operation->>'afterId' THEN result:=result||jsonb_build_array(operation->'value'); found:=true; END IF;
      END LOOP;
      IF NOT found THEN result:=result||jsonb_build_array(operation->'value'); END IF;
      RETURN result;
    WHEN 'order' THEN
      IF jsonb_typeof(doc)<>'array' OR jsonb_typeof(operation->'ids')<>'array' THEN RAISE EXCEPTION 'BAD_PATCH'; END IF;
      SELECT COALESCE(jsonb_agg(x ORDER BY COALESCE((SELECT ord FROM jsonb_array_elements_text(operation->'ids') WITH ORDINALITY t(id,ord) WHERE id=x->>'id'),999999),oldord),'[]') INTO result FROM jsonb_array_elements(doc) WITH ORDINALITY t(x,oldord);
      RETURN result;
    ELSE RAISE EXCEPTION 'BAD_PATCH';
    END CASE;
  END IF;
  key:=path[1]; rest:=path[2:];
  IF jsonb_typeof(doc)='array' THEN
    FOR item IN SELECT * FROM jsonb_array_elements(doc) LOOP
      IF item->>'id'=key THEN
        found:=true;
        IF cardinality(rest)=0 AND operation->>'op'='remove' THEN CONTINUE; END IF;
        item:=public._entity_change_v3(item,rest,operation);
      END IF;
      result:=result||jsonb_build_array(item);
    END LOOP;
    IF NOT found AND operation->>'op'<>'remove' THEN RAISE EXCEPTION 'TARGET_REMOVED'; END IF;
    RETURN result;
  END IF;
  IF jsonb_typeof(doc)<>'object' OR key IN ('id','version','createdAt','updatedAt','isDeleted','__proto__','constructor','prototype') THEN RAISE EXCEPTION 'INVALID_PATH'; END IF;
  IF cardinality(rest)=0 AND operation->>'op'='unset' THEN
    IF operation->'path'->>(jsonb_array_length(operation->'path')-2)<>'customFields' THEN RAISE EXCEPTION 'INVALID_PATH'; END IF;
    RETURN doc-key;
  END IF;
  IF cardinality(rest)=0 AND operation->>'op'='remove' THEN RAISE EXCEPTION 'INVALID_PATH'; END IF;
  IF cardinality(rest)>0 AND NOT doc ? key THEN RAISE EXCEPTION 'INVALID_PATH'; END IF;
  RETURN jsonb_set(doc,ARRAY[key],public._entity_change_v3(COALESCE(doc->key,'null'),rest,operation),true);
END $$;

CREATE OR REPLACE FUNCTION public._valid_entity_v3(doc jsonb, kind text) RETURNS boolean
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE allowed text[]; required text[] := '{}'; k text; v jsonb; item jsonb; sub text; ids text[]; id text;
BEGIN
  IF jsonb_typeof(doc)<>'object' THEN RETURN false; END IF;
  CASE kind
  WHEN 'board' THEN allowed:=ARRAY['id','title','background','emoji','iconBg','iconImage','visibleTo','order','columns','labels','mindmap']; required:=ARRAY['id','title','columns','labels','mindmap'];
  WHEN 'module' THEN allowed:=ARRAY['id','name','nameEn','emoji','color','stages','fields','contacts']; required:=ARRAY['id','name','nameEn','emoji','color','stages','fields','contacts'];
  WHEN 'column' THEN allowed:=ARRAY['id','title','cards','order','position','archived','visibleTo','mmRootId','mmPosition']; required:=ARRAY['id','title','cards','order','archived'];
  WHEN 'card' THEN allowed:=ARRAY['id','title','description','coverImage','labels','assignees','dueDate','startDate','status','completed','archived','checklists','comments','attachments','order','position','mmNodeId','mmPosition','visibleTo','linkedContacts']; required:=ARRAY['id','title','description','labels','assignees','checklists','comments','attachments','status','archived','order'];
  WHEN 'checklist' THEN allowed:=ARRAY['id','name','items']; required:=ARRAY['id','name','items'];
  WHEN 'item' THEN allowed:=ARRAY['id','text','completed','dueDate','mmNodeId','mmPosition']; required:=ARRAY['id','text','completed'];
  WHEN 'comment' THEN allowed:=ARRAY['id','userId','text']; required:=ARRAY['id','userId','text'];
  WHEN 'attachment' THEN allowed:=ARRAY['id','name','url','type','size','uploadedAt']; required:=ARRAY['id','name','url','type','size'];
  WHEN 'label' THEN allowed:=ARRAY['id','name','color']; required:=allowed;
  WHEN 'node' THEN allowed:=ARRAY['id','text','description','parentId','color','collapsed','order']; required:=ARRAY['id','text','parentId','color','order'];
  WHEN 'contact' THEN allowed:=ARRAY['id','name','email','phone','company','tags','ownerId','stageId','notes','customFields']; required:=allowed;
  WHEN 'stage' THEN allowed:=ARRAY['id','name','order']; required:=allowed;
  WHEN 'field' THEN allowed:=ARRAY['id','name','type','options']; required:=ARRAY['id','name','type'];
  ELSE RETURN false;
  END CASE;
  IF NOT doc ?& required THEN RETURN false; END IF;
  FOR k,v IN SELECT * FROM jsonb_each(doc) LOOP
    IF k IN ('version','isDeleted','createdAt','updatedAt') THEN CONTINUE; END IF;
    IF NOT k=ANY(allowed) THEN RETURN false; END IF;
    IF v='null'::jsonb THEN IF k IN ('emoji','iconBg','iconImage','coverImage','visibleTo','dueDate','startDate','mmNodeId','mmRootId','mmPosition','parentId') OR (k='description' AND kind='node') THEN CONTINUE; ELSE RETURN false; END IF; END IF;
    sub:=CASE k WHEN 'columns' THEN 'column' WHEN 'cards' THEN 'card' WHEN 'checklists' THEN 'checklist' WHEN 'items' THEN 'item' WHEN 'comments' THEN 'comment' WHEN 'attachments' THEN 'attachment' WHEN 'mindmap' THEN 'node' WHEN 'contacts' THEN 'contact' WHEN 'stages' THEN 'stage' WHEN 'fields' THEN 'field' WHEN 'labels' THEN CASE WHEN kind='card' THEN NULL ELSE 'label' END ELSE NULL END;
    IF sub IS NOT NULL THEN
      IF jsonb_typeof(v)<>'array' THEN RETURN false; END IF;
      ids:='{}';
      FOR item IN SELECT * FROM jsonb_array_elements(v) LOOP
        IF NOT public._valid_entity_v3(item,sub) THEN RETURN false; END IF;
        id:=item->>'id'; IF id=ANY(ids) THEN RETURN false; END IF; ids:=array_append(ids,id);
      END LOOP;
    ELSIF k IN ('labels','assignees','linkedContacts','visibleTo','tags','options') THEN
      IF jsonb_typeof(v)<>'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x)<>'string') THEN RETURN false; END IF;
    ELSIF k IN ('order','size','position') THEN IF jsonb_typeof(v)<>'number' THEN RETURN false; END IF;
    ELSIF k IN ('archived','completed','collapsed') THEN IF jsonb_typeof(v)<>'boolean' THEN RETURN false; END IF;
    ELSIF k='mmPosition' THEN IF jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(v->'y') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    ELSIF k='customFields' THEN IF jsonb_typeof(v)<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(v) x WHERE jsonb_typeof(x.value)<>'string') THEN RETURN false; END IF;
    ELSE IF jsonb_typeof(v)<>'string' OR length(v#>>'{}')>1048576 THEN RETURN false; END IF;
    END IF;
    IF k='id' AND (length(v#>>'{}')=0 OR length(v#>>'{}')>200) THEN RETURN false; END IF;
    IF k='status' AND (v#>>'{}') NOT IN ('todo','in_progress','complete') THEN RETURN false; END IF;
    IF k='type' AND kind='field' AND (v#>>'{}') NOT IN ('text','number','date','select') THEN RETURN false; END IF;
  END LOOP;
  IF kind='board' AND EXISTS(SELECT card->>'id' FROM jsonb_array_elements(doc->'columns') col CROSS JOIN LATERAL jsonb_array_elements(col->'cards') card GROUP BY card->>'id' HAVING count(*)>1) THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION public._rank_board_v3(doc jsonb) RETURNS jsonb
LANGUAGE sql SET search_path=public,pg_temp AS $$
 SELECT jsonb_set(doc,'{columns}',COALESCE((SELECT jsonb_agg(jsonb_set(c,'{order}',to_jsonb(ci-1)) || jsonb_build_object('cards',COALESCE((SELECT jsonb_agg(card||jsonb_build_object('order',ri-1) ORDER BY ri) FROM jsonb_array_elements(c->'cards') WITH ORDINALITY t(card,ri)),'[]'::jsonb)) ORDER BY ci) FROM jsonb_array_elements(doc->'columns') WITH ORDINALITY t(c,ci)),'[]'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public._entirely_visible_v3(doc jsonb,actor uuid) RETURNS boolean
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 IF jsonb_typeof(doc)='object' THEN
  IF jsonb_array_length(COALESCE(NULLIF(doc->'visibleTo','null'),'[]'))>0 AND NOT (doc->'visibleTo') ? actor::text THEN RETURN false; END IF;
  FOR v IN SELECT value FROM jsonb_each(doc) LOOP IF jsonb_typeof(v) IN ('object','array') AND NOT public._entirely_visible_v3(v,actor) THEN RETURN false; END IF; END LOOP;
 ELSIF jsonb_typeof(doc)='array' THEN FOR v IN SELECT * FROM jsonb_array_elements(doc) LOOP IF NOT public._entirely_visible_v3(v,actor) THEN RETURN false; END IF; END LOOP;
 END IF;
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION public.apply_workspace_patch_v3(p_kind text,p_id text,p_base_version bigint,p_ops jsonb,p_entry_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor users; b boards; m crm_modules; doc jsonb; operation jsonb; path text[]; result jsonb; old_receipt sync_receipts_v3; current_version bigint; target text:=p_kind||':'||p_id; fp text:=md5(p_ops::text); cursor jsonb; part text; source_path text[]; moved jsonb;
BEGIN
  SELECT * INTO actor FROM users WHERE id=p_actor_id AND NOT is_deleted;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','UNAUTHORIZED'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_entry_id::text,0));
  SELECT * INTO old_receipt FROM sync_receipts_v3 WHERE actor_id=p_actor_id AND entry_id=p_entry_id;
  IF FOUND THEN IF old_receipt.target<>target OR old_receipt.fingerprint<>fp THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_MISMATCH'); END IF; RETURN old_receipt.result; END IF;
  IF p_kind='board' THEN
    SELECT * INTO b FROM boards WHERE id=p_id::uuid AND NOT is_deleted FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF actor.role<>'admin' AND jsonb_array_length(COALESCE(NULLIF(b."visibleTo",'null'),'[]'))>0 AND NOT b."visibleTo" ? actor.id::text THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
    current_version:=b.version;
    doc:=jsonb_build_object('id',b.id,'title',b.title,'background',b.background,'labels',COALESCE(b.labels,'[]'),'columns',COALESCE(b.data->'columns','[]'),'mindmap',COALESCE(b.data->'mindmap','[]'),'emoji',b.emoji,'iconBg',b."iconBg",'iconImage',b."iconImage",'visibleTo',b."visibleTo",'order',COALESCE(b."order",0));
  ELSIF p_kind='module' THEN
    SELECT * INTO m FROM crm_modules WHERE id=p_id AND NOT is_deleted FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    current_version:=m.version;
    doc:=jsonb_build_object('id',m.id,'name',m.name,'nameEn',m.name_en,'emoji',m.emoji,'color',m.color,'stages',COALESCE(m.data->'stages','[]'),'fields',COALESCE(m.data->'fields','[]'),'contacts',COALESCE(m.data->'contacts','[]'));
  ELSE RETURN jsonb_build_object('ok',false,'code','BAD_PATCH'); END IF;
  IF p_base_version IS DISTINCT FROM current_version THEN RETURN jsonb_build_object('ok',false,'code','VERSION_CONFLICT','currentVersion',current_version); END IF;
  IF jsonb_typeof(p_ops)<>'array' OR jsonb_array_length(p_ops) NOT BETWEEN 1 AND 10000 THEN RETURN jsonb_build_object('ok',false,'code','BAD_PATCH'); END IF;
  FOR operation IN SELECT * FROM jsonb_array_elements(p_ops) LOOP
    IF jsonb_typeof(operation->'path')<>'array' OR operation->>'op' NOT IN ('set','insert','remove','unset','order','move','add_value','remove_value') THEN RAISE EXCEPTION 'BAD_PATCH'; END IF;
    SELECT array_agg(x) INTO path FROM jsonb_array_elements_text(operation->'path') x;
    IF cardinality(path) NOT BETWEEN 1 AND 16 THEN RAISE EXCEPTION 'BAD_PATCH'; END IF;
    IF actor.role<>'admin' THEN
      IF 'visibleTo'=ANY(path) OR path[1] IN ('emoji','iconBg','iconImage','mindmap') THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
      cursor:=doc;
      FOREACH part IN ARRAY path LOOP
        IF jsonb_typeof(cursor)='array' THEN SELECT x INTO cursor FROM jsonb_array_elements(cursor) x WHERE x->>'id'=part LIMIT 1;
        ELSE cursor:=cursor->part; END IF;
        IF jsonb_typeof(cursor)='object' AND jsonb_array_length(COALESCE(NULLIF(cursor->'visibleTo','null'),'[]'))>0 AND NOT (cursor->'visibleTo') ? actor.id::text THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
        IF jsonb_typeof(cursor)='object' AND cursor ? 'userId' AND cursor->>'userId'<>actor.id::text THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
      END LOOP;
      IF operation->>'op' IN ('remove','order') AND NOT public._entirely_visible_v3(cursor,actor.id) THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
      IF operation->>'op'='insert' AND jsonb_array_length(COALESCE(NULLIF(operation->'value'->'visibleTo','null'),'[]'))>0 THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
      IF 'comments'=ANY(path) AND ((operation->>'op'='insert' AND operation->'value'->>'userId' IS DISTINCT FROM actor.id::text) OR path[cardinality(path)]='userId') THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
    END IF;
    IF operation->>'op'='set' AND path[cardinality(path)] IN ('columns','cards','contacts','checklists','comments','attachments','items','mindmap','stages','fields') THEN RAISE EXCEPTION 'INVALID_PATH'; END IF;
    IF operation->>'op'='move' THEN
      IF p_kind<>'board' OR jsonb_typeof(operation->'fromPath')<>'array' THEN RAISE EXCEPTION 'BAD_PATCH'; END IF;
      SELECT array_agg(x) INTO source_path FROM jsonb_array_elements_text(operation->'fromPath') x;
      IF cardinality(source_path)<>3 OR cardinality(path)<>3 OR source_path[1]<>'columns' OR path[1]<>'columns' OR source_path[3]<>'cards' OR path[3]<>'cards' THEN RAISE EXCEPTION 'INVALID_PATH'; END IF;
      SELECT card INTO moved FROM jsonb_array_elements(doc->'columns') col CROSS JOIN LATERAL jsonb_array_elements(col->'cards') card WHERE col->>'id'=source_path[2] AND card->>'id'=operation->>'id';
      IF moved IS NULL THEN RAISE EXCEPTION 'TARGET_REMOVED'; END IF;
      IF actor.role<>'admin' AND ((jsonb_array_length(COALESCE(NULLIF(moved->'visibleTo','null'),'[]'))>0 AND NOT (moved->'visibleTo') ? actor.id::text) OR EXISTS(SELECT 1 FROM jsonb_array_elements(doc->'columns') col WHERE col->>'id'=source_path[2] AND jsonb_array_length(COALESCE(NULLIF(col->'visibleTo','null'),'[]'))>0 AND NOT (col->'visibleTo') ? actor.id::text)) THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
      doc:=public._entity_change_v3(doc,source_path||ARRAY[operation->>'id'],jsonb_build_object('op','remove'));
      doc:=public._entity_change_v3(doc,path,jsonb_build_object('op','insert','value',moved,'afterId',operation->'afterId'));
    ELSE
      doc:=public._entity_change_v3(doc,path,operation);
    END IF;
  END LOOP;
  IF NOT public._valid_entity_v3(doc,p_kind) THEN RETURN jsonb_build_object('ok',false,'code','BAD_PATCH'); END IF;
  IF p_kind='board' THEN
    doc:=public._rank_board_v3(doc);
    INSERT INTO boards_history(board_id,title,payload,reason) VALUES(b.id,b.title,to_jsonb(b),'patch-v3');
    UPDATE boards SET title=doc->>'title',background=doc->>'background',labels=doc->'labels',data=jsonb_build_object('columns',doc->'columns','mindmap',doc->'mindmap'),emoji=doc->>'emoji',"iconBg"=doc->>'iconBg',"iconImage"=doc->>'iconImage',"visibleTo"=COALESCE(NULLIF(doc->'visibleTo','null'),'[]'),"order"=(doc->>'order')::integer,version=current_version+1,updated_by=p_actor_id,updated_at=now() WHERE id=b.id;
  ELSE
    INSERT INTO crm_modules_history(module_id,payload,reason) VALUES(m.id,to_jsonb(m),'patch-v3');
    UPDATE crm_modules SET name=doc->>'name',name_en=doc->>'nameEn',emoji=doc->>'emoji',color=doc->>'color',data=jsonb_build_object('stages',doc->'stages','fields',doc->'fields','contacts',doc->'contacts'),version=current_version+1,updated_at=now() WHERE id=m.id;
  END IF;
  result:=jsonb_build_object('ok',true,'version',current_version+1,'cards',0);
  INSERT INTO sync_receipts_v3(actor_id,entry_id,target,fingerprint,result) VALUES(p_actor_id,p_entry_id,target,fp,result);
  RETURN result;
EXCEPTION WHEN invalid_text_representation OR raise_exception THEN RETURN jsonb_build_object('ok',false,'code','BAD_PATCH','message',SQLERRM);
END $$;

CREATE OR REPLACE FUNCTION public.board_structure_v3(p_action text,p_input jsonb,p_actor_id uuid,p_entry_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor users; b boards; result jsonb; receipt sync_receipts_v3; target text:='board:'||p_action; fp text:=md5(p_input::text); bid uuid; ids uuid[]; i integer:=0;
BEGIN
  SELECT * INTO actor FROM users WHERE id=p_actor_id AND NOT is_deleted;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','UNAUTHORIZED'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('board-structure-v3',0));
  SELECT * INTO receipt FROM sync_receipts_v3 WHERE actor_id=p_actor_id AND entry_id=p_entry_id;
  IF FOUND THEN IF receipt.target<>target OR receipt.fingerprint<>fp THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_MISMATCH'); END IF; RETURN receipt.result; END IF;
  IF p_action='create' THEN
    bid:=(p_input->>'id')::uuid;
    SELECT * INTO b FROM boards WHERE id=bid FOR UPDATE;
    IF FOUND THEN RETURN jsonb_build_object('ok',false,'code',CASE WHEN b.is_deleted THEN 'NOT_FOUND' ELSE 'ID_EXISTS' END); END IF;
    INSERT INTO boards(id,title,background,data,labels,version,updated_by,"order") VALUES(bid,p_input->>'title',p_input->>'background','{"columns":[],"mindmap":[]}','[]',0,p_actor_id,(SELECT COALESCE(max("order"),-1)+1 FROM boards));
  ELSIF p_action='delete' THEN
    IF actor.role<>'admin' THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
    SELECT * INTO b FROM boards WHERE id=(p_input->>'id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
    IF NOT b.is_deleted THEN INSERT INTO boards_history(board_id,title,payload,reason) VALUES(b.id,b.title,to_jsonb(b),'delete-v3'); UPDATE boards SET is_deleted=true,deleted_at=now(),version=version+1,updated_by=p_actor_id,updated_at=now() WHERE id=b.id; END IF;
  ELSIF p_action='reorder' THEN
    IF actor.role<>'admin' THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
    FOR bid IN SELECT x::uuid FROM jsonb_array_elements_text(p_input->'orderedIds') x LOOP UPDATE boards SET "order"=i,version=version+1,updated_at=now() WHERE id=bid AND NOT is_deleted; i:=i+1; END LOOP;
  ELSE RETURN jsonb_build_object('ok',false,'code','BAD_REQUEST'); END IF;
  result:=jsonb_build_object('ok',true);
  INSERT INTO sync_receipts_v3(actor_id,entry_id,target,fingerprint,result) VALUES(p_actor_id,p_entry_id,target,fp,result);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.update_member_v3(p_id uuid,p_fields jsonb,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor users; target users;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('users-admin-v3',0));
  SELECT * INTO actor FROM users WHERE id=p_actor_id AND NOT is_deleted;
  IF NOT FOUND OR (p_id<>p_actor_id AND actor.role<>'admin') OR (actor.role<>'admin' AND (p_fields ? 'role' OR p_fields ? 'is_deleted')) THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  SELECT * INTO target FROM users WHERE id=p_id AND NOT is_deleted FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','NOT_FOUND'); END IF;
  IF target.role='admin' AND (p_fields->>'role'='member' OR p_fields->>'is_deleted'='true') AND (SELECT count(*) FROM users WHERE role='admin' AND NOT is_deleted)<=1 THEN RETURN jsonb_build_object('ok',false,'code','LAST_ADMIN'); END IF;
  UPDATE users SET name=COALESCE(p_fields->>'name',name),name_key=COALESCE(p_fields->>'name_key',name_key),email=COALESCE(p_fields->>'email',email),avatar=COALESCE(p_fields->>'avatar',avatar),color=COALESCE(p_fields->>'color',color),lang=COALESCE(p_fields->>'lang',lang),role=COALESCE(p_fields->>'role',role),password_hash=COALESCE(p_fields->>'password_hash',password_hash),password=CASE WHEN p_fields ? 'password_hash' THEN NULL ELSE password END,is_deleted=COALESCE((p_fields->>'is_deleted')::boolean,is_deleted),deleted_at=CASE WHEN p_fields->>'is_deleted'='true' THEN now() ELSE deleted_at END,session_version=session_version+CASE WHEN p_fields ?| ARRAY['role','password_hash','is_deleted'] THEN 1 ELSE 0 END WHERE id=p_id RETURNING * INTO target;
  RETURN jsonb_build_object('ok',true,'member',to_jsonb(target)-'password'-'password_hash'-'name_key');
END $$;

CREATE OR REPLACE FUNCTION public.consume_api_quota_v3(p_actor uuid,p_bucket text,p_limit integer,p_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 INSERT INTO api_quota_v3(actor_id,bucket,starts_at,count) VALUES(p_actor,p_bucket,now(),1) ON CONFLICT(actor_id,bucket) DO UPDATE SET count=CASE WHEN api_quota_v3.starts_at<now()-make_interval(secs=>p_seconds) THEN 1 ELSE api_quota_v3.count+1 END,starts_at=CASE WHEN api_quota_v3.starts_at<now()-make_interval(secs=>p_seconds) THEN now() ELSE api_quota_v3.starts_at END RETURNING count INTO n;
 RETURN n<=p_limit;
END $$;

CREATE OR REPLACE FUNCTION public.crm_structure_v3(p_action text,p_input jsonb,p_actor_id uuid,p_entry_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor users; m crm_modules; doc jsonb:=p_input->'module'; result jsonb; receipt sync_receipts_v3; target text:='module:'||p_action||':'||(p_input->>'id'); fp text:=md5(p_input::text);
BEGIN
  SELECT * INTO actor FROM users WHERE id=p_actor_id AND NOT is_deleted;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','UNAUTHORIZED'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('crm-structure-v3',0));
  SELECT * INTO receipt FROM sync_receipts_v3 WHERE actor_id=p_actor_id AND entry_id=p_entry_id;
  IF FOUND THEN IF receipt.target<>target OR receipt.fingerprint<>fp THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_MISMATCH'); END IF; RETURN receipt.result; END IF;
  SELECT * INTO m FROM crm_modules WHERE id=p_input->>'id' FOR UPDATE;
  IF p_action='create' THEN
    IF FOUND THEN RETURN jsonb_build_object('ok',false,'code','ID_EXISTS'); END IF;
    IF NOT public._valid_entity_v3(doc,'module') OR doc->>'id' IS DISTINCT FROM p_input->>'id' THEN RETURN jsonb_build_object('ok',false,'code','BAD_PATCH'); END IF;
    INSERT INTO crm_modules(id,name,name_en,emoji,color,data,"order",version) VALUES(doc->>'id',doc->>'name',doc->>'nameEn',doc->>'emoji',doc->>'color',jsonb_build_object('contacts',doc->'contacts','stages',doc->'stages','fields',doc->'fields'),(SELECT COALESCE(max("order"),-1)+1 FROM crm_modules),0);
  ELSIF p_action='delete' THEN
    IF actor.role<>'admin' THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
    IF FOUND AND NOT m.is_deleted THEN INSERT INTO crm_modules_history(module_id,payload,reason) VALUES(m.id,to_jsonb(m),'delete-v3'); UPDATE crm_modules SET is_deleted=true,version=version+1,updated_at=now() WHERE id=m.id; END IF;
  ELSE RETURN jsonb_build_object('ok',false,'code','BAD_REQUEST'); END IF;
  result:=jsonb_build_object('ok',true);
  INSERT INTO sync_receipts_v3(actor_id,entry_id,target,fingerprint,result) VALUES(p_actor_id,p_entry_id,target,fp,result);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.save_settings_v3(p_fields jsonb,p_actor_id uuid,p_entry_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r workspace_settings; result jsonb; receipt sync_receipts_v3; k text; fp text:=md5(p_fields::text); sid uuid:='00000000-0000-0000-0000-000000000001';
BEGIN
  IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_actor_id AND role='admin' AND NOT is_deleted) THEN RETURN jsonb_build_object('ok',false,'code','FORBIDDEN'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('settings-v3',0));
  SELECT * INTO receipt FROM sync_receipts_v3 WHERE actor_id=p_actor_id AND entry_id=p_entry_id;
  IF FOUND THEN IF receipt.target<>'settings' OR receipt.fingerprint<>fp THEN RETURN jsonb_build_object('ok',false,'code','IDEMPOTENCY_MISMATCH'); END IF; RETURN receipt.result; END IF;
  FOR k IN SELECT jsonb_object_keys(p_fields) LOOP IF k NOT IN ('workspace_background','login_background','portal_background','crm_background','portal_image_opacity','crm_image_opacity','logo') THEN RAISE EXCEPTION 'INVALID_FIELD'; END IF; END LOOP;
  INSERT INTO workspace_settings(id) VALUES(sid) ON CONFLICT(id) DO NOTHING;
  SELECT * INTO r FROM workspace_settings WHERE id=sid FOR UPDATE;
  INSERT INTO workspace_settings_history(payload,reason) VALUES(to_jsonb(r),'save-v3');
  UPDATE workspace_settings SET workspace_background=CASE WHEN p_fields ? 'workspace_background' THEN p_fields->>'workspace_background' ELSE workspace_background END,login_background=CASE WHEN p_fields ? 'login_background' THEN p_fields->>'login_background' ELSE login_background END,portal_background=CASE WHEN p_fields ? 'portal_background' THEN p_fields->>'portal_background' ELSE portal_background END,crm_background=CASE WHEN p_fields ? 'crm_background' THEN p_fields->>'crm_background' ELSE crm_background END,logo=CASE WHEN p_fields ? 'logo' THEN p_fields->>'logo' ELSE logo END,portal_image_opacity=CASE WHEN p_fields ? 'portal_image_opacity' THEN (p_fields->>'portal_image_opacity')::double precision ELSE portal_image_opacity END,crm_image_opacity=CASE WHEN p_fields ? 'crm_image_opacity' THEN (p_fields->>'crm_image_opacity')::double precision ELSE crm_image_opacity END,updated_at=now() WHERE id=sid RETURNING * INTO r;
  result:=jsonb_build_object('ok',true,'settings',to_jsonb(r));
  INSERT INTO sync_receipts_v3(actor_id,entry_id,target,fingerprint,result) VALUES(p_actor_id,p_entry_id,'settings',fp,result);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.export_workspace_v3() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('boards',(SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]') FROM boards b),'users',(SELECT COALESCE(jsonb_agg(to_jsonb(u) ORDER BY u.id),'[]') FROM users u),'crm_modules',(SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]') FROM crm_modules m),'workspace_settings',(SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]') FROM workspace_settings s));
$$;
CREATE OR REPLACE FUNCTION public.workspace_fingerprint_v3() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT md5(public.export_workspace_v3()::text);
$$;
CREATE OR REPLACE FUNCTION public.restore_workspace_v3(p_snapshot jsonb,p_tables text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t text; item jsonb; b boards; u users; m crm_modules; s workspace_settings;
BEGIN
 IF p_snapshot IS NULL OR p_tables IS NULL OR cardinality(p_tables)=0 THEN RAISE EXCEPTION 'INVALID_SNAPSHOT'; END IF;
 LOCK TABLE boards,users,crm_modules,workspace_settings IN SHARE ROW EXCLUSIVE MODE;
 FOREACH t IN ARRAY p_tables LOOP
  IF t NOT IN ('boards','users','crm_modules','workspace_settings') OR jsonb_typeof(p_snapshot->t)<>'array' THEN RAISE EXCEPTION 'INVALID_TABLE'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_snapshot->t) LOOP
   IF jsonb_typeof(item)<>'object' OR NOT item ? 'id' THEN RAISE EXCEPTION 'INVALID_ROW'; END IF;
   IF t='boards' THEN
    b:=jsonb_populate_record(NULL::boards,item);
    IF jsonb_typeof(b.data->'columns')<>'array' THEN RAISE EXCEPTION 'INVALID_BOARD'; END IF;
    INSERT INTO boards_history(board_id,title,payload,reason) SELECT id,title,to_jsonb(old),'restore-v3' FROM boards old WHERE id=b.id;
    INSERT INTO boards(id,title,background,labels,data,created_at,updated_at,version,is_deleted,deleted_at,updated_by,emoji,"iconBg","iconImage","visibleTo","order") VALUES(b.id,b.title,b.background,COALESCE(b.labels,'[]'),b.data,COALESCE(b.created_at,now()),now(),COALESCE(b.version,0)+1,COALESCE(b.is_deleted,false),b.deleted_at,b.updated_by,b.emoji,b."iconBg",b."iconImage",COALESCE(b."visibleTo",'[]'),COALESCE(b."order",0)) ON CONFLICT(id) DO UPDATE SET title=excluded.title,background=excluded.background,labels=excluded.labels,data=excluded.data,updated_at=now(),version=GREATEST(boards.version,excluded.version)+1,is_deleted=excluded.is_deleted,deleted_at=excluded.deleted_at,emoji=excluded.emoji,"iconBg"=excluded."iconBg","iconImage"=excluded."iconImage","visibleTo"=excluded."visibleTo","order"=excluded."order";
   ELSIF t='users' THEN
    u:=jsonb_populate_record(NULL::users,item);
    INSERT INTO users(id,name,email,avatar,color,role,password,password_hash,name_key,is_deleted,deleted_at,lang,session_version) VALUES(u.id,u.name,u.email,u.avatar,u.color,u.role,u.password,u.password_hash,u.name_key,COALESCE(u.is_deleted,false),u.deleted_at,COALESCE(u.lang,'zh'),COALESCE(u.session_version,0)+1) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,avatar=excluded.avatar,color=excluded.color,role=excluded.role,password=excluded.password,password_hash=excluded.password_hash,name_key=excluded.name_key,is_deleted=excluded.is_deleted,deleted_at=excluded.deleted_at,lang=excluded.lang;
   ELSIF t='crm_modules' THEN
    m:=jsonb_populate_record(NULL::crm_modules,item);
    IF jsonb_typeof(m.data->'contacts')<>'array' THEN RAISE EXCEPTION 'INVALID_CRM'; END IF;
    INSERT INTO crm_modules_history(module_id,payload,reason) SELECT id,to_jsonb(old),'restore-v3' FROM crm_modules old WHERE id=m.id;
    INSERT INTO crm_modules(id,name,name_en,emoji,color,data,"order",created_at,updated_at,version,is_deleted) VALUES(m.id,m.name,m.name_en,m.emoji,m.color,m.data,COALESCE(m."order",0),COALESCE(m.created_at,now()),now(),COALESCE(m.version,0)+1,COALESCE(m.is_deleted,false)) ON CONFLICT(id) DO UPDATE SET name=excluded.name,name_en=excluded.name_en,emoji=excluded.emoji,color=excluded.color,data=excluded.data,"order"=excluded."order",updated_at=now(),version=GREATEST(crm_modules.version,excluded.version)+1,is_deleted=excluded.is_deleted;
   ELSE
    s:=jsonb_populate_record(NULL::workspace_settings,item);
    INSERT INTO workspace_settings_history(payload,reason) SELECT to_jsonb(old),'restore-v3' FROM workspace_settings old WHERE id=s.id;
    INSERT INTO workspace_settings(id,workspace_background,login_background,portal_background,crm_background,portal_image_opacity,crm_image_opacity,logo,updated_at) VALUES(s.id,s.workspace_background,s.login_background,s.portal_background,s.crm_background,COALESCE(s.portal_image_opacity,1),COALESCE(s.crm_image_opacity,1),COALESCE(s.logo,''),now()) ON CONFLICT(id) DO UPDATE SET workspace_background=excluded.workspace_background,login_background=excluded.login_background,portal_background=excluded.portal_background,crm_background=excluded.crm_background,portal_image_opacity=excluded.portal_image_opacity,crm_image_opacity=excluded.crm_image_opacity,logo=excluded.logo,updated_at=now();
   END IF;
  END LOOP;
 END LOOP;
 UPDATE users SET session_version=session_version+1;
 RETURN jsonb_build_object('ok',true);
END $$;

-- No business reads or writes through public keys. Matching app uses authenticated APIs/SSE.
DO $$ DECLARE t text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['users','boards','crm_modules','workspace_settings','boards_history','crm_modules_history','workspace_settings_history','sync_receipts_v3','api_quota_v3','revoked_sessions_v3'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',t);
 END LOOP;
 FOR f IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (p.proname LIKE '%\_v3' ESCAPE '\' OR p.proname IN ('apply_board_patch','apply_board_meta','soft_delete_board','create_board','soft_delete_board_by_id','reorder_boards','save_workspace_settings','upsert_crm_modules','delete_crm_modules','snapshot_board','prune_history','count_all_cards','workspace_stats')) LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
   EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['boards','users','workspace_settings','crm_modules'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t) THEN EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',t); END IF;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
