import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createCanonicalDatabaseExporters,createOfflineProductionBackup,validateProductionBackup,createBackupSchedule,selectBackupRetention} from './production-backup.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'ops-backup-'));t.after(()=>rm(root,{recursive:true,force:true}));const source=join(root,'source');await mkdir(source);
 const storeFile=join(source,'campaign.json'),sqlite=join(source,'state.sqlite'),config=join(source,'protected.json');await writeFile(storeFile,'{"test":"synthetic"}');await writeFile(config,'{"test":true}');const db=new DatabaseSync(sqlite);db.exec('CREATE TABLE saved(value TEXT); INSERT INTO saved VALUES (\'committed\')');db.close();
 let proof={kind:'ops-dnd-offline-writers-proof',allWritersStopped:true,writersDrained:true,campaignId:'camp',revision:1,authorityEpoch:0};
 const backup=createOfflineProductionBackup({descriptor:{campaignId:'camp',storeFile},backupRoot:join(root,'backups'),verifyStopped:async()=>({...proof}),sqliteFiles:[sqlite],protectedFiles:[config],capturePostgres:async path=>{await writeFile(path,'PGDMP-synthetic-fixture');return{container:'davy-postgres',verified:true};},captureRedis:async path=>{await writeFile(path,'REDIS-synthetic-fixture');return{container:'davy-redis',verified:true};}});
 return {backup,root,setProof:value=>{proof={...proof,...value};}};
}
test('offline backup captures a complete verified file set with SQLite integrity, without claiming restore rehearsal',async t=>{
 const f=await fixture(t),result=await f.backup.run();assert.equal(result.status,'complete');assert.equal(result.manifest.consistency,'offline-all-writers-stopped');assert.equal((await validateProductionBackup({directory:result.destination,campaignId:'camp'})).restoreRehearsed,false);
 await writeFile(join(result.destination,'postgres.dump'),'corrupt');await assert.rejects(validateProductionBackup({directory:result.destination,campaignId:'camp'}),{code:'PRODUCTION_BACKUP_INVALID'});
});
test('missing writer proof fails before producing any accepted backup',async t=>{
 const f=await fixture(t);f.setProof({allWritersStopped:false});await assert.rejects(f.backup.run(),{code:'PRODUCTION_OFFLINE_WRITER_PROOF_REQUIRED'});
});
test('15-minute scheduler coalesces in-flight backups and exposes failures',async()=>{
 let callback,interval,resolve,count=0,failures=0;const schedule=createBackupSchedule({backup:{run:()=>{count++;return new Promise(r=>{resolve=r;});}},setIntervalImpl:(fn,ms)=>{callback=fn;interval=ms;return{};},clearIntervalImpl:()=>{},onFailure:()=>failures++});assert.equal(interval,900000);callback();callback();assert.equal(count,1);resolve();await schedule.close();assert.equal(failures,0);
});
test('retention ignores other campaigns and incomplete directories',()=>{
 const entries=[{manifest:{kind:'ops-dnd-consistent-backup',campaignId:'other',createdUtc:'2026-01-01'}},{manifest:{kind:'partial'}}];assert.deepEqual(selectBackupRetention(entries,{campaignId:'camp'}),{keep:[],remove:[]});
});


test('changed offline cut refuses the completed manifest',async t=>{
 const f=await fixture(t);const pending=f.backup.run();f.setProof({revision:2});await assert.rejects(pending,{code:'PRODUCTION_BACKUP_CUT_CHANGED'});
});


test('canonical exporters scope containers and keep passwords out of arguments',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ops-export-'));t.after(()=>rm(root,{recursive:true,force:true}));const calls=[];
 const exporters=createCanonicalDatabaseExporters({databaseUrl:'postgres://davy:synthetic-pg-password@127.0.0.1:15432/davy',redisUrl:'redis://:synthetic-redis-password@127.0.0.1:16379',dump:async(args,path,options)=>calls.push({args,path,options}),run:async(args,options)=>{calls.push({args,options});return'';}});
 await exporters.capturePostgres(join(root,'pg.dump'));await exporters.captureRedis(join(root,'redis.rdb'));
 assert(!JSON.stringify(calls.map(c=>c.args)).includes('synthetic-'));assert(calls[0].args.includes('davy-postgres'));assert(calls[1].args.includes('davy-redis'));assert.equal(calls[0].options.env.PGPASSWORD,'synthetic-pg-password');assert.equal(calls[1].options.env.REDISCLI_AUTH,'synthetic-redis-password');
});
