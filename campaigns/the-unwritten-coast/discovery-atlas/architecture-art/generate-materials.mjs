import {mkdir,writeFile,access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const output=resolve(dirname(fileURLToPath(import.meta.url)),'../art/architecture');
const materials=[
 {id:'harbor-limestone',seed:419031,prompt:'Seamless tileable physically believable material texture for an exquisitely detailed miniature coastal fantasy dungeon, orthographic flat scan of ancient pale gray and warm ivory limestone, weathered cut stone surface, subtle tiny fossil inclusions, salt crystallization at the edges of faint hairline cracks, scattered minute slate-colored pores, delicate mineral veining, very restrained olive patina, finely granular tactile surface, natural irregular variations in stone color, aged but carefully maintained harbor engineering architecture, evenly distributed neutral diffuse illumination without directional shadows, consistent scale throughout, flat continuous stone material filling the entire square edge to edge, no perspective, no objects, no inscriptions, no gridded floor, texture atlas quality, detailed architectural conservation photograph, low contrast, natural material realism'},
 {id:'tidal-brass',seed:419032,prompt:'Seamless tileable physically believable material texture for exceptionally detailed coastal fantasy machinery, orthographic flat scan of antique hammered brass plate, rich desaturated golden bronze metal, very fine irregular hammer marks, tiny shallow scratches and burnished wear, restrained blue green verdigris deposits inside minute surface pits, warm muted copper undertones, delicate centuries-old mottling, well maintained maritime instrument material, completely flat continuous metal surface filling the entire square edge to edge, homogeneous small scale detail, neutral diffuse studio illumination, no directional reflections, no directional shadows, no edges or border, no rivets, no screws, no symbols or letters, no objects, no perspective, sophisticated miniature architecture material atlas, high material detail, low contrast physically plausible surface'}
];
if(!process.argv.includes('--generate'))throw Error('Pass --generate to request local material artwork.');
await mkdir(output,{recursive:true});
for(const m of materials){
 const path=resolve(output,m.id+'.png');try{await access(path);console.log(JSON.stringify({id:m.id,status:'existing-preserved'}));continue;}catch(e){if(e.code!=='ENOENT')throw e;}
 const payload={prompt:m.prompt,negative_prompt:'text, letters, watermark, logo, objects, furniture, characters, figures, room, walls, landscape, perspective, harsh shadow, frame, border, blurry, low resolution, oversaturated, plastic, cartoon',seed:m.seed,width:512,height:512,steps:32,cfg_scale:7,sampler_name:'DPM++ 2M',batch_size:1,n_iter:1,tiling:true,save_images:false};
 const response=await fetch('http://127.0.0.1:7860/sdapi/v1/txt2img',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(300000),redirect:'error'});
 if(!response.ok)throw Error(`Local image request failed: ${response.status}`);
 const result=await response.json();if(result.images?.length!==1)throw Error('Expected one material image.');
 const bytes=Buffer.from(result.images[0],'base64');if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Expected PNG output.');
 await writeFile(path,bytes,{flag:'wx'});
 await writeFile(resolve(output,m.id+'.provenance.json'),JSON.stringify({createdAt:new Date().toISOString(),generator:'Local AUTOMATIC1111 Stable Diffusion WebUI',endpoint:'http://127.0.0.1:7860',request:payload,responseInfo:JSON.parse(result.info),sha256:createHash('sha256').update(bytes).digest('hex'),purpose:'Surface artwork only; measured geometry, doors, markers and discoveries remain deterministic.'},null,2),{flag:'wx'});
 console.log(JSON.stringify({id:m.id,path,bytes:bytes.length}));
}
