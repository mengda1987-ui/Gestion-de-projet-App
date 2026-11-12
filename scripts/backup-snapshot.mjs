#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { rpc, stamp, digest, writeSnapshot } from './lib/snapshot.mjs';
async function main() {
  const root = path.join(os.homedir(),'Backups','trello-app');
  fs.mkdirSync(root,{recursive:true,mode:0o700});
  const data = await rpc('export_workspace_v3');
  const dirs = fs.readdirSync(root).filter(n => /^\d{4}-\d{2}-\d{2}T/.test(n)).sort().reverse();
  let previous;
  try { previous=JSON.parse(fs.readFileSync(path.join(root,dirs[0],'_meta.json'),'utf8')); } catch {}
  if (previous?.fingerprint === digest(data)) { console.log('No content changes; snapshot unchanged'); return; }
  const dir=path.join(root,stamp()); writeSnapshot(dir,data);
  console.log('Complete transactional snapshot saved:',dir);
  const index=process.argv.indexOf('--days'); const days=index<0?2:Number(process.argv[index+1]);
  if(!Number.isFinite(days)||days<1)throw new Error('Invalid retention days');
  for(const old of dirs) { let meta; try { meta=JSON.parse(fs.readFileSync(path.join(root,old,'_meta.json'),'utf8')); } catch {continue;}
    if(Date.now()-Date.parse(meta.createdAt)>days*86400000)fs.rmSync(path.join(root,old),{recursive:true,force:true});
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
