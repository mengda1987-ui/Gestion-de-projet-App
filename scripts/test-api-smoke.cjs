const cp = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = 3287;
const child = cp.spawn(process.execPath, [path.join(root, 'node_modules/next/dist/bin/next'), 'start', '-p', String(port)], { cwd: root, stdio: ['ignore','pipe','pipe'], env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
let log = '';child.stdout.on('data', d => log += d);child.stderr.on('data', d => log += d);
async function main() {
  const base='http://localhost:'+port;
  let ready=false;
  for(let i=0;i<80;i++){try { const r=await fetch(base,{signal:AbortSignal.timeout(1000)}); if(r.ok){ready=true;break;} }catch{} await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'Production server must start: '+log);
  const checks=[['GET','/api/snapshot'],['GET','/api/sync'],['GET','/api/crm/modules'],['GET','/api/members'],['PATCH','/api/members'],['POST','/api/board/patch'],['POST','/api/boards'],['PATCH','/api/boards'],['DELETE','/api/boards'],['PATCH','/api/boards/metadata'],['PATCH','/api/workspace-settings'],['GET','/api/ai/analyze-audio'],['POST','/api/ai/analyze-audio']];
  for(const [method,url] of checks){
    const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json'},body:['GET','HEAD'].includes(method)?undefined:'null',signal:AbortSignal.timeout(5000)});
    assert.equal(r.status,401,method+' '+url+' must reject anonymous access');
    assert.equal((await r.json()).code,'UNAUTHORIZED');
  }
  const malformed=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'});assert.equal(malformed.status,400);
  const csrf=await fetch(base+'/api/boards',{method:'POST',headers:{Origin:'https://invalid.example','Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
  const logout=await fetch(base+'/api/auth/logout');assert.equal(logout.status,405);
  console.log('PASS production HTTP smoke: page, 13 anonymous denials, malformed login, cross-origin rejection and safe logout method');
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>child.kill('SIGTERM'));
