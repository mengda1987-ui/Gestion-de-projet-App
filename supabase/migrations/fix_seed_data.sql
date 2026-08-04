-- Fix existing seed data: rename "position" to "order" in columns JSONB
UPDATE boards
SET data = jsonb_set(
  jsonb_set(
    jsonb_set(data, '{columns,0,order}', data#>'{columns,0,position}', true),
    '{columns,1,order}', data#>'{columns,1,position}', true
  ),
  '{columns,2,order}', data#>'{columns,2,position}', true
)
WHERE data->'columns'->0->>'position' IS NOT NULL;

-- Remove old "position" keys
UPDATE boards
SET data = jsonb_set(
  jsonb_set(
    jsonb_set(data, '{columns,0}', (data->'columns'->0) - 'position', true),
    '{columns,1}', (data->'columns'->1) - 'position', true
  ),
  '{columns,2}', (data->'columns'->2) - 'position', true
)
WHERE data->'columns'->0->>'position' IS NOT NULL;
