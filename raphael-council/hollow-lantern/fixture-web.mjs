import {readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createEngineClient} from './engine-client.mjs';
import {createGameService} from './service.mjs';
import {createWebTable} from './web-server.mjs';
const root='C:/Users/Hermes/LocalFiles/HollowLanternUI-20260909';
export function fixtureAuthorize(scope){
 const owners={'ai-fighter':'lantern-fighter','ai-rogue':'lantern-rogue','ai-cleric':'lantern-cleric'};
 return scope.campaignId==='fixture-hollow-ui'&&((scope.userId==='fixture-dm'&&(scope.audience==='gm'||(scope.audience==='player'&&['lantern-fighter','lantern-rogue','lantern-cleric','lantern-sentinel'].includes(scope.actorId))))||(Boolean(owners[scope.userId])&&owners[scope.userId]===scope.actorId&&scope.audience==='player'));
}
export async function startFixture(){
const client=createEngineClient({campaignId:'fixture-hollow-ui',channelId:'fixture-ui',baseUrl:'http://127.0.0.1:18794',secret:(await readFile(join(root,'bridge-secret'),'utf8')).trim()});
const authorize=async scope=>fixtureAuthorize(scope);
const service=createGameService({client,authorize}),host={service,authorize};
const art=resolve('../campaign-art/hollow-lantern');
const renderAssets={portraits:{'lantern-fighter':join(art,'mara.png'),'lantern-rogue':join(art,'kestrel.png'),'lantern-cleric':join(art,'ash.png'),'lantern-sentinel':join(art,'sentinel-sd.png')},terrainTextures:{floor:join(art,'stone-floor-sd.png')}};
const table=createWebTable({getHost:()=>host,port:18795,renderAssets});await table.start();
async function mintLinks(){
 const dmLink=await table.webLink({campaignId:client.campaignId,userId:'fixture-dm',audience:'gm'});
 const playerLink=await table.webLink({campaignId:client.campaignId,userId:'ai-fighter',actorId:'lantern-fighter',audience:'player'});
 const rogueLink=await table.webLink({campaignId:client.campaignId,userId:'ai-rogue',actorId:'lantern-rogue',audience:'player'});
 const clericLink=await table.webLink({campaignId:client.campaignId,userId:'ai-cleric',actorId:'lantern-cleric',audience:'player'});
 await writeFile(join(root,'web-fixture-links.json'),JSON.stringify({dmLink,playerLink,rogueLink,clericLink}));
}
await mintLinks();
process.stdin.on('data',chunk=>{if(chunk.toString().trim()==='links')void mintLinks().then(()=>console.log('Fresh fixture links written.'));});
console.log(JSON.stringify({origin:table.origin,links:join(root,'web-fixture-links.json'),evidence:'Unity-backed fixture; not live Discord'}));
process.once('SIGINT',async()=>{await table.close();process.exit(0);});
return table;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await startFixture();
