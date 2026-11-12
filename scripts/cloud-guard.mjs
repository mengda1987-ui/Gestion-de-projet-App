#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { rpc, stamp, writeSnapshot } from './lib/snapshot.mjs';
async function main(){
 const file=process.env.GUARD_STATE_FILE||'.guard-state.json';
 const fingerprint=await rpc('workspace_fingerprint_v3');
 let previous; try{previous=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
 if(previous?.fingerprint===fingerprint){console.log('No changes across board, CRM, members and settings');return;}
 if(!process.argv.includes('--mode=backup')){console.log('Changes detected');return;}
 const data=await rpc('export_workspace_v3');
 const dir=path.join(process.env.BACKUP_DIR||'backups',stamp());writeSnapshot(dir,data);
 fs.writeFileSync(file,JSON.stringify({fingerprint,lastBackupAt:new Date().toISOString()}),{mode:0o600});
 console.log('Complete snapshot saved:',dir);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
