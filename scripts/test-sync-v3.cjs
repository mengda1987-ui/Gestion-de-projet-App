const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
function load(file) {
  let full = path.resolve(root, file);
  if (!path.extname(full)) full = ['.ts', '.tsx'].map(ext => full + ext).find(fs.existsSync);
  if (cache.has(full)) return cache.get(full).exports;
  const mod = { exports: {} }; cache.set(full, mod);
  const js = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const localRequire = name => {
    if (name === './sync/useBoardSync') return {};
    if (name === 'next/server') return { NextResponse: { json: (body, init) => ({ body, init }) } };
    if (name === '@/lib/auth/session') return { getSession: async () => null };
    if (name === '@/lib/supabaseAdmin') return { getAdminClient: () => null };
    if (name.startsWith('@/')) return load('src/' + name.slice(2));
    if (name.startsWith('.')) return load(path.resolve(path.dirname(full), name));
    return require(name);
  };
  vm.runInThisContext('(function(require,module,exports){' + js + '\n})', { filename: full })(localRequire, mod, mod.exports);
  return mod.exports;
}
const { normalizeAction } = load('src/context/normalizeAction.ts');
const { boardReducer } = load('src/context/BoardContext.tsx');
const { createInitialState } = load('src/context/types.ts');
const { diffEntities, applyEntityOps } = load('src/context/patch/delta.ts');
const { actionToPatch } = load('src/context/patch/ops.ts');
const { formatPatchError } = load('src/context/patch/client.ts');
const { mapBoardRow } = load('src/context/sync/boardApi.ts');
const { ApiFailure, patchValidationFailure, validateEntity, validateOps } = load('src/lib/api/security.ts');
let state = createInitialState();
state.currentUser = { id: crypto.randomUUID(), role: 'admin' };
function apply(action) {
  const normalized = normalizeAction(action);
  const predicted = boardReducer(state, normalized), actual = boardReducer(state, normalized);
  assert.deepEqual(predicted, actual, action.type + ' must be deterministic');
  if (state.board.id && predicted.board.id === state.board.id) {
    // Match fetch(JSON.stringify(...)): undefined optional fields arrive as null.
    const payload = actionToPatch(normalized, predicted.board, state.board);
    const ops = JSON.parse(JSON.stringify(payload?.ops || []));
    const user = { uid: state.currentUser.id, role: state.currentUser.role };
    if (ops.length) validateOps(ops, 'board', user, state.board);
    const result = applyEntityOps(state.board, ops);
    // Validate both the raw in-memory object (as /api/board/patch does on mapBoardRow)
    // and its JSON-serialized wire form.
    validateEntity(result, 'board');
    validateEntity(JSON.parse(JSON.stringify(result)), 'board');
    // wire nulls are intentionally different from local undefined; compare the entity content.
    const clean = o => JSON.parse(JSON.stringify(o, (key, v) => ['createdAt', 'updatedAt', 'version'].includes(key) ? undefined : v === undefined ? null : v));
    assert.deepEqual(clean(result), clean(predicted.board), action.type + ' delta roundtrip');
  }
  state = predicted;
}
apply({ type: 'CREATE_BOARD', payload: { title: 'Test', background: '#fff' } });
const mappedNullIconBoard = mapBoardRow({
  id: state.board.id,
  title: '孟达个人',
  background: '#f5f5f7',
  emoji: '⚡',
  iconBg: '#007AFF',
  iconImage: null,
  labels: [],
  visibleTo: [],
  order: 0,
  version: 58,
  is_deleted: false,
  data: {
    columns: [{
      id: 'col-live-1',
      title: 'Todo',
      archived: false,
      order: 0,
      cards: [{
        id: 'card-legacy-deleted',
        title: 'Legacy',
        description: '',
        labels: [],
        assignees: [],
        checklists: [],
        comments: [],
        attachments: [],
        status: 'todo',
        archived: false,
        order: 0,
        deleted: true,
        urgent: false,
      }],
    }],
    mindmap: [],
  },
});
assert.equal(Object.hasOwn(mappedNullIconBoard, 'iconImage'), true);
assert.equal(mappedNullIconBoard.iconImage, undefined);
assert.doesNotThrow(() => validateEntity(mappedNullIconBoard, 'board'), 'in-memory board from mapBoardRow with undefined iconImage and legacy card flags must pass validateEntity');
const uiAddAction = normalizeAction({ type: 'ADD_CARD', payload: { columnId: 'col-live-1', card: { id: 'card-ui-1', title: '1' } } });
const uiAddCardState = boardReducer({ ...state, board: mappedNullIconBoard, boards: [mappedNullIconBoard] }, uiAddAction);
const uiWireOps = JSON.parse(JSON.stringify(actionToPatch(uiAddAction, uiAddCardState.board, mappedNullIconBoard).ops));
const uiAddCardInsert = uiWireOps.find(op => op.op === 'insert' && op.path[2] === 'cards');
assert.deepEqual(uiAddCardInsert.value.linkedContacts, [], 'ADD_CARD must serialize omitted linkedContacts as an empty string array, not null');
assert.doesNotThrow(() => validateOps(uiWireOps, 'board', { uid: state.currentUser.id, role: 'admin' }, mappedNullIconBoard));
const uiCandidate = applyEntityOps(mappedNullIconBoard, uiWireOps);
assert.doesNotThrow(() => validateEntity(uiCandidate, 'board'), 'resulting board after real UI ADD_CARD on mapBoardRow board must pass validateEntity without JSON.stringify');
const legacyIcon = 'data:image/png;base64,' + 'A'.repeat(1024 * 1024 + 16);
const setLargeIconAction = normalizeAction({ type: 'SET_BOARD_ICON', payload: { boardId: state.board.id, iconImage: legacyIcon } });
const beforeLargeIcon = state.board;
apply(setLargeIconAction);
const largeIconPatch = actionToPatch(setLargeIconAction, state.board, beforeLargeIcon);
assert.ok(largeIconPatch.ops.some(op => op.op === 'set' && op.path.join('.') === 'iconImage' && op.value.length > 1024 * 1024), 'SET_BOARD_ICON must generate a valid large-icon field patch');
assert.doesNotThrow(() => validateOps(JSON.parse(JSON.stringify(largeIconPatch.ops)), 'board', { uid: state.currentUser.id, role: 'admin' }, beforeLargeIcon), 'server patch validator must accept real SET_BOARD_ICON data URL patch');
assert.doesNotThrow(() => validateEntity(JSON.parse(JSON.stringify(state.board)), 'board'), 'legacy icon over 1 MiB must not block board validation');
assert.doesNotThrow(() => validateEntity({ ...state.board, iconImage: null }, 'board'), 'null icon image must remain valid');
assert.doesNotThrow(() => validateEntity({ ...state.board, iconImage: undefined, iconBg: undefined, emoji: undefined }, 'board'), 'undefined optional icon fields must remain valid');
assert.doesNotThrow(() => validateOps([{ op: 'set', path: ['iconImage'], value: null }], 'board', { uid: state.currentUser.id, role: 'admin' }, state.board), 'server patch validator must accept clearing the icon image');
assert.throws(() => validateEntity({ ...state.board, iconImage: 'x'.repeat(10 * 1024 * 1024 + 1) }, 'board'), error => error.code === 'INVALID_FIELD' && /board\.iconImage/.test(error.message), 'icon images above the explicit 10 MiB limit must be rejected');
const iconMigration = fs.readFileSync(path.join(root, 'supabase/migrations/202611120002_icon_image_size.sql'), 'utf8');
assert.match(iconMigration, /k='iconImage' AND kind='board'/, 'database migration must special-case board icon size');
assert.match(iconMigration, />10485760/, 'database migration must use the 10 MiB icon limit');
assert.match(iconMigration, /'deleted','urgent'/, 'database migration must allow legacy card deleted and urgent flags');
assert.match(iconMigration, /'linkedContacts'/, 'database migration must allow null linkedContacts from wire-serialized cards');
const addColumnAction = normalizeAction({ type: 'ADD_COLUMN', payload: { title: 'List' } });
const beforeAddColumn = state.board;
apply(addColumnAction);
const addColumnPatch = actionToPatch(addColumnAction, state.board, beforeAddColumn);
assert.ok(addColumnPatch.ops.some(op => op.op === 'insert' && op.path.join('.') === 'columns'));
const col = state.board.columns[0].id;
const addCardAction = normalizeAction({ type: 'ADD_CARD', payload: { columnId: col, card: { title: 'Task', deleted: false, coverImage: null, dueDate: null, startDate: null, visibleTo: [], linkedContacts: [], mmPosition: null } } });
const beforeAddCard = state.board;
apply(addCardAction);
const addCardPatch = actionToPatch(addCardAction, state.board, beforeAddCard);
assert.ok(addCardPatch.ops.some(op => op.op === 'insert' && op.path.join('.') === `columns.${col}.cards`));
assert.equal(addCardPatch.ops.some(op => op.path[0] === 'iconImage'), false, 'ADD_CARD patch must not resend an unchanged large board icon');
assert.doesNotThrow(() => validateEntity(JSON.parse(JSON.stringify(state.board)), 'board'), 'ADD_CARD must succeed on a board with a legacy large icon');
const addCardInsert = addCardPatch.ops.find(op => op.op === 'insert' && op.path.join('.') === `columns.${col}.cards`);
assert.equal(Object.hasOwn(state.board.columns.find(c => c.id === col).cards[0], 'deleted'), false, 'ADD_CARD reducer must not persist legacy deleted flag');
assert.equal(Object.hasOwn(addCardInsert.value, 'deleted'), false, 'ADD_CARD patch must omit legacy deleted flag');
const legacyAddCardPatch = JSON.parse(JSON.stringify(addCardPatch.ops));
legacyAddCardPatch.find(op => op.op === 'insert' && op.path.join('.') === `columns.${col}.cards`).value.deleted = false;
assert.doesNotThrow(() => validateOps(legacyAddCardPatch, 'board', { uid: state.currentUser.id, role: 'admin' }, beforeAddCard), 'backend must accept queued boolean deleted flag');
const card = state.board.columns[0].cards[0].id;
const updateCardAction = normalizeAction({ type: 'UPDATE_CARD', payload: { cardId: card, updates: { description: 'Updated', coverImage: null, dueDate: null, startDate: null, visibleTo: null, linkedContacts: [], completed: true, deleted: false } } });
const beforeUpdateCard = state.board;
apply(updateCardAction);
const updateCardPatch = actionToPatch(updateCardAction, state.board, beforeUpdateCard);
assert.ok(updateCardPatch.ops.length > 0, 'UPDATE_CARD must produce frontend operations');
assert.equal(updateCardPatch.ops.some(op => op.op === 'set' && op.path.at(-1) === 'deleted'), false, 'UPDATE_CARD patch must omit legacy deleted field');
assert.doesNotThrow(() => validateOps(JSON.parse(JSON.stringify(updateCardPatch.ops)), 'board', { uid: state.currentUser.id, role: 'admin' }, beforeUpdateCard));
assert.doesNotThrow(() => validateOps([{ op: 'set', path: ['columns', col, 'cards', card, 'deleted'], value: false }], 'board', { uid: state.currentUser.id, role: 'admin' }, beforeUpdateCard), 'backend must accept legacy boolean deleted update');
assert.throws(
  () => validateEntity({ id: 'bad-card', title: 'Bad', description: '', labels: [], assignees: [], checklists: [], comments: [], attachments: [], status: 'todo', archived: false, order: 'first' }, 'card'),
  error => error.code === 'INVALID_FIELD' && /card\.order/.test(error.message),
  'invalid order type must report the exact card field',
);
assert.throws(
  () => validateEntity({ id: 'bad-card', title: 'Bad', description: '', labels: [], assignees: [], checklists: [], comments: [], attachments: [], status: 'todo', archived: false, order: 0, unknownField: true }, 'card'),
  error => error.code === 'INVALID_FIELD' && /card\.unknownField/.test(error.message),
  'unknown card field must report its exact name',
);
const routeFailure = patchValidationFailure(new ApiFailure(400, 'INVALID_FIELD', 'INVALID_FIELD: card.order must be a valid number'), 'ops');
assert.equal(routeFailure.status, 422);
assert.equal(routeFailure.code, 'BAD_PATCH');
assert.match(routeFailure.message, /INVALID_FIELD: card\.order must be a valid number/);
assert.match(formatPatchError({ message: 'INVALID_FIELD: card.unknown is not allowed', details: { field: 'card.unknown' } }), /INVALID_FIELD: card\.unknown is not allowed.*card\.unknown/);
apply({ type: 'ADD_CHECKLIST', payload: { cardId: card, name: 'Steps' } });
const cl = state.board.columns[0].cards[0].checklists[0].id;
apply({ type: 'ADD_CHECKLIST_ITEM', payload: { cardId: card, checklistId: cl, text: 'Step' } });
assert.equal(state.board.columns[0].cards[0].checklists[0].items.length, 1);
apply({ type: 'ADD_LABEL', payload: { label: { name: 'Urgent', color: '#ff0000' } } });
assert.equal(state.board.labels.length, 1);
assert.ok(state.board.labels[0].id);
apply({ type: 'UPDATE_COLUMN', payload: { columnId: col, updates: { title: 'Renamed' } } });
assert.equal(state.board.mindmap.find(n => n.id === state.board.columns[0].mmRootId).text, 'Renamed');
apply({ type: 'UPDATE_MINDMAP_NODE', payload: { nodeId: state.board.columns[0].cards[0].mmNodeId, updates: { text: 'Renamed Task' } } });
assert.equal(state.board.columns[0].cards[0].title, 'Renamed Task');
const beforeUi = state.boards;
apply({ type: 'SET_FILTERS', payload: { search: 'x' } });
assert.equal(state.boards, beforeUi, 'UI change must preserve boards identity');
const original = { id: 'x', comments: [], checklists: [{ id: 'cl', name: 'Tasks', items: [{ id: 'i', text: 'a', completed: false }] }] };
const a = { ...original, comments: [{ id: 'a', userId: 'u', text: 'A' }] };
const b = { ...original, comments: [{ id: 'b', userId: 'v', text: 'B' }] };
const merged = applyEntityOps(a, diffEntities(original, b));
assert.deepEqual(new Set(merged.comments.map(c => c.id)), new Set(['a', 'b']));
const clear = diffEntities({ id: 'x', dueDate: '2026-11-30' }, { id: 'x', dueDate: undefined });
assert.deepEqual(clear, [{ op: 'set', path: ['dueDate'], value: null }]);
apply({ type: 'ADD_COLUMN', payload: { title: 'Target' } });
const sourceId = state.board.columns.find(c => c.cards.length).id;
const targetId = state.board.columns.find(c => !c.cards.length).id;
const moveAction = normalizeAction({ type: 'MOVE_CARD', payload: { fromColumnId: sourceId, toColumnId: targetId, fromIndex: 0, toIndex: 0 } });
const beforeMove = state.board;
apply(moveAction);
const movePatch = actionToPatch(moveAction, state.board, beforeMove);
assert.ok(movePatch.ops.some(op => op.op === 'move'), 'MOVE_CARD must produce a move operation');
assert.doesNotThrow(() => validateOps(JSON.parse(JSON.stringify(movePatch.ops)), 'board', { uid: state.currentUser.id, role: 'admin' }, beforeMove));
assert.equal(state.board.columns.find(c => c.id === targetId).cards[0].id, card);
apply({ type: 'UPDATE_CHECKLIST_ITEM', payload: { cardId: card, checklistId: cl, itemId: state.board.columns.find(c => c.id === targetId).cards[0].checklists[0].items[0].id, updates: { mmPosition: { x: 2, y: 5 } } } });
const positionDelta = diffEntities({ id:'x', mmPosition: {x:0,y:0} }, { id:'x', mmPosition:{x:3,y:4} });
assert.deepEqual(positionDelta,[{op:'set',path:['mmPosition'],value:{x:3,y:4}}]);
assert.deepEqual(diffEntities({id:'x',customFields:{a:'a',b:'b'}},{id:'x',customFields:{b:'b'}}),[{op:'unset',path:['customFields','a']}]);
const labelDelta = diffEntities({id:'x',labels:['old']},{id:'x',labels:['old','new']});
assert.deepEqual(applyEntityOps({id:'x',labels:['old','remote']},labelDelta).labels,['old','remote','new']);
console.log('PASS deterministic reducers, checklist sequences, labels, brain-map links, UI identity, concurrent inserts and explicit clears');
if (process.argv.includes('--database')) {
  const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
  (async () => {
    const db = new PGlite();
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE PUBLICATION supabase_realtime;');
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/202611120001_sync_security_v3.sql'), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const oldDbCardResult = await db.query("SELECT public._valid_entity_v3($1::jsonb, 'board') AS valid", [JSON.stringify(uiCandidate)]);
    assert.equal(oldDbCardResult.rows[0].valid, false, 'actual ADD_CARD result on a legacy board is rejected by migration 001');
    assert.deepEqual(uiAddCardInsert.value.linkedContacts, [], 'the actual new-card wire payload includes linkedContacts as an empty array');
    const legacySqlCard = uiCandidate.columns.flatMap(column => column.cards).find(card => Object.hasOwn(card, 'deleted') || Object.hasOwn(card, 'urgent'));
    assert.ok(legacySqlCard, 'ADD_CARD keeps existing legacy card fields in the resulting board');
    assert.equal(Object.hasOwn(legacySqlCard, 'deleted'), true, 'migration 001 rejects the existing card deleted field');
    assert.equal(Object.hasOwn(legacySqlCard, 'urgent'), true, 'migration 001 rejects the existing card urgent field');
    await db.exec(iconMigration);
    const compatibleDbCardResult = await db.query("SELECT public._valid_entity_v3($1::jsonb, 'board') AS valid", [JSON.stringify(uiCandidate)]);
    assert.equal(compatibleDbCardResult.rows[0].valid, true, 'actual ADD_CARD result on a legacy board passes the compatibility migration');
    const validLargeIconBoard = { id: 'board-large-icon', title: 'Test', iconImage: legacyIcon, columns: [], labels: [], mindmap: [] };
    const largeIconSqlResult = await db.query("SELECT public._valid_entity_v3($1::jsonb, 'board') AS valid", [JSON.stringify(validLargeIconBoard)]);
    assert.equal(largeIconSqlResult.rows[0].valid, true, 'SQL validator accepts board icon above 1 MiB');
    const nullIconSqlResult = await db.query("SELECT public._valid_entity_v3($1::jsonb, 'board') AS valid", [JSON.stringify({ ...validLargeIconBoard, iconImage: null })]);
    assert.equal(nullIconSqlResult.rows[0].valid, true, 'SQL validator accepts null board icon');
    const legacyCardBoardSqlResult = await db.query("SELECT public._valid_entity_v3($1::jsonb, 'board') AS valid", [JSON.stringify({
      ...uiCandidate,
      columns: [...uiCandidate.columns, { id: 'col-legacy-pos', title: '张总', archived: false, position: 0, cards: [] }],
    })]);
    assert.equal(legacyCardBoardSqlResult.rows[0].valid, true, 'SQL validator accepts board with legacy deleted/urgent card flags, legacy position-only column, and wire-null optional fields');
    const oversizedIconSqlResult = await db.query("SELECT public._valid_entity_v3($1::jsonb, 'board') AS valid", [JSON.stringify({ ...validLargeIconBoard, iconImage: 'x'.repeat(10 * 1024 * 1024 + 1) })]);
    assert.equal(oversizedIconSqlResult.rows[0].valid, false, 'SQL validator rejects board icon above 10 MiB');
    const uid = crypto.randomUUID(), member = crypto.randomUUID(), board = crypto.randomUUID();
    await db.query("INSERT INTO users(id,name,role) VALUES($1,'Admin','admin'),($2,'Member','member')", [uid, member]);
    const rpc = async (name, args) => (await db.query('SELECT public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') AS result', args)).rows[0].result;
    const created = await rpc('board_structure_v3', ['create', { id: board, title: 'Test', background: '#fff' }, uid, crypto.randomUUID()]);
    assert.equal(created.ok, true);
    const column = { id: 'col', title: 'List', cards: [], archived: false, order: 0 };
    const entry = crypto.randomUUID(), ops = [{ op: 'insert', path: ['columns'], value: column, afterId: null }];
    const first = await rpc('apply_workspace_patch_v3', ['board', board, 0, ops, entry, uid]);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.deepEqual(await rpc('apply_workspace_patch_v3', ['board', board, 0, ops, entry, uid]), first);
    const e2 = crypto.randomUUID(), rename = [{ op: 'set', path: ['columns', 'col', 'title'], value: 'New' }];
    assert.equal((await rpc('apply_workspace_patch_v3', ['board', board, 0, rename, e2, uid])).code, 'VERSION_CONFLICT');
    assert.equal((await rpc('apply_workspace_patch_v3', ['board', board, 1, rename, e2, uid])).ok, true, 'conflict must not poison idempotency');
    assert.deepEqual(await rpc('lookup_sync_receipt_v3',[entry,uid,'board:'+board,ops]),first);
    const corrupt = [{ op: 'set', path: ['columns', 'col', 'cards'], value: {} }];
    assert.equal((await rpc('apply_workspace_patch_v3', ['board', board, 2, corrupt, crypto.randomUUID(), uid])).ok, false);
    const forbidden = [{ op: 'set', path: ['visibleTo'], value: [uid] }];
    assert.equal((await rpc('apply_workspace_patch_v3', ['board', board, 2, forbidden, crypto.randomUUID(), member])).code, 'FORBIDDEN');
    let version=2;
    const patch=async(operations,actor=uid)=>{const result=await rpc('apply_workspace_patch_v3',['board',board,version,operations,crypto.randomUUID(),actor]);assert.equal(result.ok,true,JSON.stringify(result));version=result.version;return result;};
    const fullCard={id:'card',title:'Original',description:'',status:'todo',archived:false,labels:[],assignees:[],checklists:[],comments:[],attachments:[],order:0};
    await patch([{op:'insert',path:['columns','col','cards'],value:fullCard,afterId:null}],member);
    await patch([{op:'insert',path:['columns'],value:{...column,id:'target'},afterId:'col'}]);
    await patch([{op:'set',path:['columns','col','cards','card','description'],value:'remote edit'}]);
    await patch([{op:'move',fromPath:['columns','col','cards'],path:['columns','target','cards'],id:'card',afterId:null}]);
    let saved=(await db.query('SELECT data FROM boards WHERE id=$1',[board])).rows[0].data;
    assert.equal(saved.columns[1].cards[0].description,'remote edit','move preserves latest remote card');
    await patch([{op:'add_value',path:['columns','target','cards','card','labels'],value:'one'}]);
    await patch([{op:'add_value',path:['columns','target','cards','card','labels'],value:'two'}]);
    await patch([{op:'set',path:['columns','target','cards','card','mmPosition'],value:{x:2,y:5}}]);
    const mod={id:'module',name:'CRM',nameEn:'CRM',emoji:'x',color:'#fff',contacts:[],stages:[],fields:[]};
    assert.equal((await rpc('crm_structure_v3',['create',{id:mod.id,module:mod},uid,crypto.randomUUID()])).ok,true);
    const contact={id:'contact',name:'Contact',email:'',phone:'',company:'',tags:[],ownerId:'',stageId:'',notes:'',customFields:{a:'a',b:'b'}};
    assert.equal((await rpc('apply_workspace_patch_v3',['module',mod.id,0,[{op:'insert',path:['contacts'],value:contact,afterId:null}],crypto.randomUUID(),uid])).ok,true);
    assert.equal((await rpc('apply_workspace_patch_v3',['module',mod.id,1,[{op:'unset',path:['contacts','contact','customFields','a']}],crypto.randomUUID(),uid])).ok,true);
    const settingsEntry=crypto.randomUUID(),settings={logo:'data:image/png;base64,AAAA'};
    assert.equal((await rpc('save_settings_v3',[settings,uid,settingsEntry])).ok,true);
    assert.equal((await rpc('save_settings_v3',[settings,uid,settingsEntry])).ok,true);
    const snapshot=await rpc('export_workspace_v3',[]);
    assert.equal(snapshot.boards.length,1); assert.equal(snapshot.crm_modules.length,1);
    const fingerprint=await rpc('workspace_fingerprint_v3',[]);
    await patch([{op:'set',path:['columns','target','cards','card','title'],value:'changed'}]);
    assert.notEqual(await rpc('workspace_fingerprint_v3',[]),fingerprint);
    assert.equal((await rpc('restore_workspace_v3',[snapshot,['boards','users','crm_modules','workspace_settings']])).ok,true);
    saved=(await db.query('SELECT data FROM boards WHERE id=$1',[board])).rows[0].data;
    assert.equal(saved.columns[1].cards[0].title,'Original');
    const badSnapshot={...snapshot,crm_modules:[{id:'broken',data:{contacts:{}}}]};
    await assert.rejects(rpc('restore_workspace_v3',[badSnapshot,['boards','crm_modules']]));
    assert.equal((await rpc('update_member_v3', [uid, { role: 'member' }, uid])).code, 'LAST_ADMIN');
    const quota = await Promise.all([1,2,3].map(() => rpc('consume_api_quota_v3', [uid, 'test', 2, 3600])));
    assert.deepEqual(quota, [true, true, false]);
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM boards'));
    await assert.rejects(db.query('SELECT public.export_workspace_v3()'));
    await db.exec('RESET ROLE');
    await db.close();
    console.log('PASS migration twice, SQL patch, durable idempotency, conflict retry, concurrent moves, invalid shapes, ACL, last-admin transaction, quota, transactional backup/restore and anonymous denial');
  })().catch(err => { console.error(err); process.exitCode = 1; });
}
