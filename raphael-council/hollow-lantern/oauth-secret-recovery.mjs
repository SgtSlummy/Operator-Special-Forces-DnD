import {readFile,writeFile,lstat,realpath,mkdir,open,rename,unlink,chmod} from 'node:fs/promises';
import {resolve,dirname,join,isAbsolute,parse,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {parseEnv,promisify} from 'node:util';
import {execFile} from 'node:child_process';

export const DAVY_CLIENT_ID='1540006061099188274';
const nativePath='C:/Users/Hermes/Projects/Davy Jones/deployment/.env.native-gateway';
const backupsPath='C:/Users/Hermes/LocalFiles/hollow-lantern/oauth-recovery';
const run=promisify(execFile);
const fail=()=>{throw new Error('OAuth recovery refused. Configuration was not safely verified; no credentials were logged.');};
async function directory(path,create=false){
 if(!isAbsolute(path)||/(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(path))fail();
 const absolute=resolve(path);let cursor=parse(absolute).root;
 for(const part of relative(cursor,absolute).split(/[\\/]/).filter(Boolean)){
  cursor=join(cursor,part);let s;try{s=await lstat(cursor);}catch(e){if(e.code!=='ENOENT'||!create)throw e;await mkdir(cursor,{mode:0o700});s=await lstat(cursor);}
  if(s.isSymbolicLink()||!s.isDirectory())fail();
 }
 if((await realpath(absolute)).toLowerCase()!==absolute.toLowerCase())fail();return absolute;
}
async function file(path,max=65536){await directory(dirname(path));const s=await lstat(path);if(s.isSymbolicLink()||!s.isFile()||s.nlink!==1||s.size>max)fail();return readFile(path);}
async function protect(path,directory=false){
 if(process.platform!=='win32'){await chmod(path,directory?0o700:0o600);return;}
 const script=`$ErrorActionPreference='Stop'; $p=$env:HOLLOW_RECOVERY_ACL_PATH; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=${directory?'[System.Security.AccessControl.DirectorySecurity]':'[System.Security.AccessControl.FileSecurity]'}::new(); $acl.SetAccessRuleProtection($true,$false); $inherit=${directory?"[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'":"[System.Security.AccessControl.InheritanceFlags]::None"}; $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($sid,[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule); $acl.SetOwner($sid); [System.IO.FileSystemAclExtensions]::SetAccessControl(${directory?'[System.IO.DirectoryInfo]':'[System.IO.FileInfo]'}::new($p),$acl)`;
 await run('pwsh.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,HOLLOW_RECOVERY_ACL_PATH:path}});
}
function replaceOnlySecret(before,secret){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(before),parsed=parseEnv(text);
 if(parsed.DISCORD_CLIENT_ID&&parsed.DISCORD_CLIENT_ID!==DAVY_CLIENT_ID)fail();
 const matches=[...text.matchAll(/^[ \t]*(?:export[ \t]+)?DISCORD_CLIENT_SECRET[ \t]*=[^\r\n]*/gm)];
 if(matches.length>1)fail();
 let updated;
 if(matches.length){const match=matches[0],old=parseEnv(match[0]).DISCORD_CLIENT_SECRET;if(old!==parsed.DISCORD_CLIENT_SECRET)fail();updated=text.slice(0,match.index)+`DISCORD_CLIENT_SECRET=${secret}`+text.slice(match.index+match[0].length);}
 else {const newline=text.includes('\r\n')?'\r\n':'\n';updated=text+(text.endsWith('\n')||!text?'':newline)+`DISCORD_CLIENT_SECRET=${secret}`+newline;}
 const after=Buffer.from(updated);
 const expected={...parsed,DISCORD_CLIENT_SECRET:secret};if(JSON.stringify(Object.entries(parseEnv(after.toString())).sort())!==JSON.stringify(Object.entries(expected).sort()))fail();
 return after;
}
/** Fixed production bindings; injected paths/provider exist only for isolated tests. */
export function createOAuthRecovery({target=nativePath,backupRoot=backupsPath,fetchImpl=fetch,protectImpl=protect}={}){
 async function exclusive(work){
  await directory(dirname(target));await directory(backupRoot,true);await protectImpl(backupRoot,true);
  const lock=join(backupRoot,'replacement.lock');let handle;
  try{handle=await open(lock,'wx',0o600);await protectImpl(lock);return await work();}
  finally{if(handle){await handle.close();await unlink(lock);}}
 }
 async function privateWrite(path,bytes){await writeFile(path,bytes,{flag:'wx',mode:0o600});await protectImpl(path);}
 async function atomicReplace(before,after){
  const staging=join(dirname(target),`.oauth-override-${randomUUID()}.tmp`);
  try{await privateWrite(staging,after);if(!(await file(target)).equals(before))fail();await rename(staging,target);}
  finally{await unlink(staging).catch(()=>{});}
 }
 return {
  async replace({secretFile}={}){
   try{return await exclusive(async()=>{
    const before=await file(target);const input=await file(secretFile,512);
    const secret=input.toString('utf8').replace(/\r?\n$/,'');if(!/^[A-Za-z0-9_-]{16,256}$/.test(secret))fail();
    const after=replaceOnlySecret(before,secret);
    const response=await fetchImpl('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${DAVY_CLIENT_ID}:${secret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',scope:'applications.commands.update'}),redirect:'error',signal:AbortSignal.timeout(10000)});
    // The grant's 2xx response verifies client authentication. Never log or persist its bearer token.
    await response.body?.cancel();if(!response.ok)fail();
    if(!(await file(target)).equals(before))fail();
    const id=randomUUID(),folder=join(backupRoot,id);await mkdir(folder,{mode:0o700});await protectImpl(folder,true);
    await privateWrite(join(folder,'before.env'),before);await privateWrite(join(folder,'after.env'),after);
    await privateWrite(join(folder,'receipt.json'),JSON.stringify({version:1,id,clientId:DAVY_CLIENT_ID,verifiedAt:new Date().toISOString(),status:'prepared'}));
    await atomicReplace(before,after);
    return {id,status:'replaced',restartPerformed:false};
   });}catch{fail();}
  },
  async rollback({id}={}){
   try{return await exclusive(async()=>{
    if(!/^[a-f0-9-]{36}$/.test(id??''))fail();const folder=join(backupRoot,id);await directory(folder);
    const before=await file(join(folder,'before.env')),after=await file(join(folder,'after.env')),current=await file(target);
    if(current.equals(before))return {id,status:'already-restored',restartPerformed:false};
    if(!current.equals(after))fail();await atomicReplace(after,before);return {id,status:'restored',restartPerformed:false};
   });}catch{fail();}
  }
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3||!['--replace','--rollback'].includes(process.argv[2]))fail();
  const recovery=createOAuthRecovery();const result=process.argv[2]==='--replace'?await recovery.replace({secretFile:process.env.HOLLOW_OAUTH_SECRET_FILE}):await recovery.rollback({id:process.env.HOLLOW_OAUTH_RECOVERY_ID});
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch{process.stderr.write('OAuth recovery refused. No credential details were logged. Check protected inputs and verification before retrying.\n');process.exitCode=1;}
}
