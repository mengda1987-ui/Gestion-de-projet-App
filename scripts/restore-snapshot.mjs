#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { tables,rpc,stamp,writeSnapshot,cardCount } from './lib/snapshot.mjs';
const root=path.join(os.homedir(),'Backups','trello-app');
async function main(){
 const args=process.argv.slice(2);
 const index=args.indexOf('--from'); const from=index<0?null:args[index+1];
 if(args.includes('--list')||!args.length){console.log(fs.existsSync(root)?fs.readdirSync(root).filter(n=>/^\d{4}-\d{2}-\d{2}T/.test(n)).sort().reverse().join('\n'):'No snapshots');return;}
 if(!from||path.basename(from)!==from)throw new Error('Use --from <snapshot-folder>');
 const dir=path.join(root,from),data={};
 for(const table of tables){data[table]=JSON.parse(fs.readFileSync(path.join(dir,table+'.json'),'utf8'));if(!Array.isArray(data[table]))throw new Error('Invalid table '+table);}
 console.log('Snapshot preview:',data.boards.length,'boards;',cardCount(data),'live cards');
 if(!args.includes('--yes')){console.log('Preview only. Add --yes to restore atomically.');return;}
 const only=args.indexOf('--only'); const selected=only<0?tables:args[only+1].split(',');
 if(selected.some(t=>!tables.includes(t)))throw new Error('Invalid --only table');
 const current=await rpc('export_workspace_v3');
 const safety=path.join(root,stamp()+'-BEFORE-RESTORE');writeSnapshot(safety,current);
 const result=await rpc('restore_workspace_v3',{p_snapshot:data,p_tables:selected});
 if(!result.ok)throw new Error(result.code||'Restore failed');
 console.log('Atomic restore complete. Safety snapshot:',safety,'All sessions invalidated; sign in again.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
