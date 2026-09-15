import {createHash} from 'node:crypto';

export const PRESETS = Object.freeze({
  character: {label:'Character', width:512, height:768, direction:'A detailed fantasy character portrait, expressive face, coherent anatomy, dramatic natural light, painterly realism, plain atmospheric background', example:'A weathered coastal ranger in a salt-stained cloak, carrying a brass lantern. Quiet resolve, wind-tangled hair, sea-green and amber light.'},
  location: {label:'Location', width:768, height:512, direction:'A richly illustrated coastal fantasy environment, cinematic composition, believable architecture, atmospheric depth, painterly realism', example:'A welcoming harbor tavern on a rain-dark quay. Amber windows, heavy timber beams, bowls of chowder, the sea visible through open doors.'},
  item: {label:'Item', width:512, height:512, direction:'A single fantasy inventory object, clearly readable silhouette, carefully rendered materials, isolated on a quiet dark background, studio lighting, painterly realism', example:'An old brass compass with sea-green enamel, salt-worn edges and an intricate hinged cover. A treasured sailor’s tool.'},
  map: {label:'Map illustration', width:768, height:768, direction:'Orthographic top-down fantasy environment illustration, overhead view, clear pathways and room silhouettes, no perspective, no grid, no labels, no text', example:'A small coastal inn seen directly from above: a common room, hearth, kitchen, storage and wooden stairs. Warm stone and timber, readable open floor space.'}
});
export const NEGATIVE = 'text, watermark, logo, lettering, blurry, low quality, distorted anatomy, extra limbs, duplicate object, oversaturated';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateRequest(value){
  if(!value || typeof value!=='object' || Array.isArray(value))throw Error('Choose an artwork type and describe your image.');
  const keys=['requestId','kind','title','prompt','negative','checkpoint','seed','steps','shape','contextId'];
  if(Object.keys(value).some(k=>!keys.includes(k)))throw Error('This request contains unsupported settings.');
  if(!UUID.test(value.requestId??'') || !PRESETS[value.kind])throw Error('Choose a supported artwork type and try again.');
  if(typeof value.prompt!=='string'||!value.prompt.trim()||value.prompt.length>5000)throw Error('Describe your image in 1–5,000 characters.');
  if(typeof value.title!=='string'||!value.title.trim()||value.title.length>100)throw Error('Give your image a title of at most 100 characters.');
  if(typeof value.checkpoint!=='string'||!value.checkpoint||value.checkpoint.length>250)throw Error('Choose an installed model.');
  const seed=value.seed===''||value.seed==null?Math.floor(Math.random()*2147483647):Number(value.seed);
  const steps=Number(value.steps??22);
  if(!Number.isSafeInteger(seed)||seed<0||seed>2147483647)throw Error('Seed must be a whole number from 0 to 2147483647.');
  if(!Number.isInteger(steps)||steps<8||steps>40)throw Error('Choose 8–40 sampling steps.');
  if(value.negative!=null&&(typeof value.negative!=='string'||value.negative.length>2000))throw Error('Keep exclusions below 2,000 characters.');
  if(value.shape!=null&&!['auto','square','landscape','portrait'].includes(value.shape))throw Error('Choose a supported canvas shape.');
  if(value.contextId!=null&&(typeof value.contextId!=='string'||!/^[\w-]{1,100}$/.test(value.contextId)))throw Error('The table context is invalid. Reopen the studio from the table.');
  return {...value,title:value.title.trim(),prompt:value.prompt.trim(),seed,steps,negative:value.negative??NEGATIVE,shape:value.shape??'auto',contextId:value.contextId??null};
}
export function buildWorkflow(spec){
  const preset=PRESETS[spec.kind];
  const [width,height]=({square:[512,512],landscape:[768,512],portrait:[512,768]})[spec.shape]??[preset.width,preset.height];
  return {
    '1':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:spec.checkpoint},_meta:{title:'Campaign model'}},
    '2':{class_type:'CLIPTextEncode',inputs:{text:`${spec.prompt}. ${preset.direction}.`,clip:['1',1]},_meta:{title:'Your artwork brief'}},
    '3':{class_type:'CLIPTextEncode',inputs:{text:spec.negative,clip:['1',1]},_meta:{title:'Things to avoid'}},
    '4':{class_type:'EmptyLatentImage',inputs:{width,height,batch_size:1}},
    '5':{class_type:'KSampler',inputs:{model:['1',0],positive:['2',0],negative:['3',0],latent_image:['4',0],seed:spec.seed,steps:spec.steps,cfg:7,sampler_name:'euler',scheduler:'normal',denoise:1}},
    '6':{class_type:'VAEDecode',inputs:{samples:['5',0],vae:['1',2]}},
    '7':{class_type:'SaveImage',inputs:{images:['6',0],filename_prefix:`UnwrittenCoast/${spec.kind}-${spec.requestId}`},_meta:{title:spec.title}}
  };
}
export function requestFingerprint(value){const {requestId,...spec}=value;return createHash('sha256').update(JSON.stringify(spec)).digest('hex');}
export function imageFromHistory(history,id){
  const record=history[id];
  if(!record)return {status:'running'};
  if(['error','failed'].includes(record.status?.status_str)||record.status?.messages?.some(([kind])=>['execution_error','execution_interrupted'].includes(kind)))return {status:'failed'};
  if(record.status?.completed!==true||record.status?.status_str!=='success')return {status:'running'};
  const image=record.outputs?.['7']?.images?.find(image=>image.type==='output');
  if(!image||typeof image.filename!=='string'||typeof image.subfolder!=='string')return {status:'failed'};
  return {status:'ready',image};
}
