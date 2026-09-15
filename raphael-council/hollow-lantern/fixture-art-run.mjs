// Actual local SD through the signed Obus boundary; fixed disposable campaign only.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createEngineClient} from './engine-client.mjs';
import {createCampaignAI} from './ai-runtime.mjs';
const fixture='C:/Users/Hermes/LocalFiles/hollow-lantern/unity-supervised-20260909';
const data='C:/Users/Hermes/Projects/Operator Special Forces Dungeon and Dragons/raphael-council/.runtime/hollow-lantern/ai-live';
const output='C:/Users/Hermes/LocalFiles/hollow-lantern/local-sd/scene-fixture';
const engine=createEngineClient({baseUrl:'http://127.0.0.1:18793',campaignId:'fixture-hollow-supervised',channelId:'fixture-channel',secret:(await readFile(join(fixture,'bridge-secret'),'utf8')).trim()});
const host={engine,authorize:async scope=>scope.campaignId==='fixture-hollow-supervised'&&scope.userId==='fixture-dm',onCommitted:()=>()=>{},refreshPublic:async()=>{}};
const renderAssets={};let runtime;
try{
 runtime=await createCampaignAI({host,campaignId:engine.campaignId,gmUserId:'fixture-dm',baseUrl:'http://127.0.0.1:38178',serviceToken:(await readFile(join(data,'service-token'),'utf8')).trim(),hostControlToken:(await readFile(join(data,'host-control-token'),'utf8')).trim(),artDirectory:output,renderAssets});
 const result=await runtime.requestSceneArt();await mkdir(output,{recursive:true});
 const report={result,art:renderAssets.publicSceneArts,scope:'Actual local Stable Diffusion via signed private Obus image route against a disposable Unity campaign. No engine command, AI action, or Discord delivery.'};await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await runtime?.close();}
