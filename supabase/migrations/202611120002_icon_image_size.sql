-- Keep the v3 patch RPC aligned with the API validator for existing board icons.
-- The HTTP request remains capped at 4 MiB; this allows legacy persisted icons
-- to survive full-board validation while keeping all other string limits intact.
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
    ELSIF k='iconImage' AND kind='board' THEN IF jsonb_typeof(v)<>'string' OR length(v#>>'{}')>10485760 THEN RETURN false; END IF;
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