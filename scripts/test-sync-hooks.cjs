const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const storage = new Map();
global.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,String(v)), removeItem: k=>storage.delete(k), key: i=>[...storage.keys()][i], get length(){return storage.size;} };
global.window = { localStorage: global.localStorage, addEventListener() {}, removeEventListener() {} };
global.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
global.BroadcastChannel = undefined;
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = fs.readFileSync(path.join(root,'src/context/sync/useBoardSync.ts'),'utf8');
function moduleLoader(overrides) {
 const cache=new Map();
 return function load(file) {
  let full=path.resolve(root,file); if(!path.extname(full))full=['.ts','.tsx'].map(e=>full+e).find(fs.existsSync);
  if(cache.has(full))return cache.get(full).exports;
  const m={exports:{}};cache.set(full,m);
  const code=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{target:7,module:1,jsx:4,esModuleInterop:true}}).outputText;
  const req=name=>{if(overrides[name])return overrides[name];if(name==='./sync/useBoardSync')return {};if(name.startsWith('@/'))return load('src/'+name.slice(2));if(name.startsWith('.'))return load(path.resolve(path.dirname(full),name));return require(name);};
  vm.runInThisContext('(function(require,module,exports){'+code+'\n})',{filename:full})(req,m,m.exports);return m.exports;
 };
}
const load=moduleLoader({});
const {boardReducer}=load('src/context/BoardContext.tsx'),{createInitialState}=load('src/context/types.ts'),{normalizeAction}=load('src/context/normalizeAction.ts'),{applyEntityOps}=load('src/context/patch/delta.ts');
const outbox=load('src/context/patch/outbox.ts');
async function test(){
 const uid=crypto.randomUUID(); let state=createInitialState();state.currentUser={id:uid,role:'admin'};
 for(const a of [{type:'CREATE_BOARD',payload:{title:'Board',background:'#fff'}},{type:'ADD_COLUMN',payload:{title:'List'}}])state=boardReducer(state,normalizeAction(a));
 state=boardReducer(state,normalizeAction({type:'ADD_CARD',payload:{columnId:state.board.columns[0].id,card:{title:'Card'}}}));state._loaded=true;
 let cloud=structuredClone(state), version=0, sent=[],fail=false,conflict=true, captureFetch;
 const effects=[],refs=[],values=[];let cursor=0;
 const react={useRef:v=>{const i=cursor++;return refs[i]||=( {current:v} )},useState:v=>{const i=cursor++;values[i]??=v;return [values[i],v=>{values[i]=typeof v==='function'?v(values[i]):v;}];},useCallback:f=>{cursor++;return f;},useEffect:f=>{cursor++;effects.push(f);}};
 const snapshot=s=>({boards:s.boards,users:s.users,workspaceBackground:s.workspaceBackground,loginBackground:s.loginBackground,portalBackground:s.portalBackground,crmBackground:s.crmBackground,portalImageOpacity:1,crmImageOpacity:1,logo:''});
 const api={buildSnapshot:snapshot,readLocalBackup:()=>null,writeLocalBackup:()=>'',fetchRemoteSnapshot:async()=>captureFetch?new Promise(resolve=>{captureFetch.resolve=resolve;}):({snapshot:snapshot(cloud)})};
 const patch={submitEntry:async entry=>{
  sent.push(entry);
  if(fail)return {ok:false,code:'ERROR'};
  if(conflict){conflict=false;version++;cloud.board={...cloud.board,version};cloud.boards=[cloud.board];return {ok:false,code:'VERSION_CONFLICT',currentVersion:version};}
  cloud.board={...applyEntityOps(cloud.board,entry.payload.ops),version:++version};cloud.boards=[cloud.board];return {ok:true,version,cards:1};
 }};
 const mod={exports:{}};
 const code=ts.transpileModule(source,{compilerOptions:{target:7,module:1}}).outputText;
 const req=name=>name==='react'?react:name==='./boardApi'?api:name==='../patch/outbox'?outbox:name==='../patch/client'?patch:name==='@/lib/syncEvents'?{subscribeSync:()=>()=>{}}:name.startsWith('.')?load(path.resolve(root,'src/context/sync',name)):load('src/'+name.slice(2));
 vm.runInThisContext('(function(require,module,exports){'+code+'\n})')(req,mod,mod.exports);
 const render=()=>{cursor=0;effects.length=0;return mod.exports.useBoardSync({state,rawDispatch:a=>{state=boardReducer(state,a);},reducer:boardReducer});};
 const hook=render();
 const accountEffect=effects.find(f=>f.toString().includes('pending.current.clear()'));assert.ok(accountEffect);accountEffect();
 await tick();await tick();
 const card=state.board.columns[0].cards[0].id;
 hook.dispatchWithSync({type:'ADD_CHECKLIST',payload:{cardId:card,id:'checklist',name:'Tasks'}});
 hook.dispatchWithSync({type:'ADD_CHECKLIST_ITEM',payload:{cardId:card,checklistId:'checklist',text:'One',itemId:'item'}});
 await hook.drainOutbox();await tick();await hook.drainOutbox();
 assert.equal(cloud.board.columns[0].cards[0].checklists[0].items.length,1);
 assert.equal((await outbox.listAll(uid)).length,0);
 fail=true;hook.dispatchWithSync({type:'UPDATE_CARD',payload:{cardId:card,updates:{description:'Offline retained'}}});
 await hook.drainOutbox();assert.equal((await outbox.listAll(uid)).length,1);
 fail=false;await hook.drainOutbox();assert.equal(cloud.board.columns[0].cards[0].description,'Offline retained');
 assert.equal((await outbox.listAll(uid)).length,0);
 const hiddenEntry={id:crypto.randomUUID(),accountId:crypto.randomUUID(),boardId:'other',baseVersion:0,payload:{ops:[]},createdAt:1,attempts:0};
 await outbox.enqueue(hiddenEntry);assert.equal((await outbox.listAll(uid)).length,0);assert.equal((await outbox.listAll(hiddenEntry.accountId)).length,1);
 await outbox.dequeue(hiddenEntry.id);
 hook.dispatchWithSync({type:'SET_CURRENT_USER',payload:null});
 assert.equal(state.currentUser,null);assert.equal(state.boards.length,0);
 for(const r of refs)if(r?.current && typeof r.current==='object' && typeof r.current.hasRef==='function')clearTimeout(r.current);
 console.log('PASS real synchronization hook: consecutive actions, conflict replay, offline retention/retry, account-isolated queue and logout reset');
}
test().catch(e=>{console.error(e);process.exitCode=1;});
