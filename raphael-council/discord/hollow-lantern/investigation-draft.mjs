import { isDeepStrictEqual } from 'node:util';
import { FLAGS } from './components.mjs';
import { presentReceipt } from '../../hollow-lantern/service.mjs';

const privatePlayer = scope => scope.audience === 'player' && Boolean(scope.actorId) && !scope.gmController;
const storedScope = scope => ({campaignId:scope.campaignId,userId:scope.userId,actorId:scope.actorId,role:'player',visibility:'private'});
const safe = value => String(value ?? '').replace(/@/g,'@\u200b').replace(/[\\`*_{}\[\]()<>#+.!|~-]/g,'\\$&');
const eligible = action => ['interact','talk','describe'].includes(action?.type) && action.fields?.length > 0 && action.fields.length <= 5 && action.fields.every(field => (field.type === undefined || field.type === 'text') && (field.kind === undefined || field.kind === 'text') && typeof field.id === 'string' && typeof field.label === 'string');
const validInput = (action,input) => eligible(action) && isDeepStrictEqual(Object.keys(input).sort(),action.fields.map(f=>f.id).sort()) && action.fields.every(field => typeof input[field.id] === 'string' && (field.required === false || input[field.id].trim()) && input[field.id].length <= Math.min(field.maxLength ?? 500,4000));
const snapshot = action => structuredClone({id:action.id,type:action.type,payload:action.payload ?? {},fields:action.fields});
const queues = new WeakMap();

/** Durable drafts are optional; without an injected store existing action behavior is retained. */
export function createInvestigationDraftFlow({draftStore,engine,authorize,tokenStore}) {
  if (!draftStore) return null;
  if (!['get','save','prepare','complete'].every(key=>typeof draftStore[key] === 'function')) throw new Error('Invalid investigation draft store');
  if (!queues.has(draftStore)) queues.set(draftStore,new Map());
  const locks = queues.get(draftStore);
  const issue = (scope,view,draft,kind,extra={}) => tokenStore.issue({...scope,revision:view.revision,draftControl:kind,draftId:draft.draftId,draftVersion:draft.version,opensModal:kind==='edit',...extra});
  const button = (label,id) => ({type:2,style:2,label,custom_id:id});
  async function resume(payload,scope,view) {
    if (!privatePlayer(scope)) return;
    const draft=await draftStore.get(storedScope(scope));
    if (draft && draft.status !== 'completed') payload.components[0].components.push({type:1,components:[button('Resume saved intention',issue(scope,view,draft,'review'))]});
  }
  async function review(scope,view,draft,send,page=0) {
    if (!await authorize(scope)) throw new Error('Access changed');
    const title=draft.status==='completed'?'Intention completed':draft.status==='prepared'?'Recover saved intention':'Saved intention';
    const status=draft.status==='editing'?'Saved privately. Viewing maps and known details does not attempt this action. Try action submits it to the engine.':draft.status==='prepared'?'An attempt was prepared. Recover its original result before replacing this intention.':'The original action has a recorded result.';
    const texts=[{type:10,content:`## ${title}\n${status}`}];
    if(draft.status==='editing'&&draft.expectedRevision!==view.revision)texts.push({type:10,content:'The scene changed while you were writing. Your text is saved. Edit and save it against the current scene before trying the action.'});
    // Paginate escaped text so every saved character remains readable within Discord limits.
    const body=safe(Object.entries(draft.input).map(([key,value])=>`${key}: ${value}`).join('\n'));
    const pages=Math.max(1,Math.ceil(body.length/1800));
    page=Number.isInteger(page)?Math.max(0,Math.min(page,pages-1)):0;
    texts.push({type:10,content:`Page ${page+1} of ${pages}\n${body.slice(page*1800,(page+1)*1800)}`});
    if(pages>1)texts.push({type:1,components:[button('Previous text',issue(scope,view,draft,'review',{draftPage:Math.max(0,page-1)})),button('Next text',issue(scope,view,draft,'review',{draftPage:Math.min(pages-1,page+1)}))]});
    if(draft.status==='completed') texts.push({type:10,content:safe(draft.receipt.result ?? 'Result recorded.').slice(0,1500)});
    const controls=[button('Map',issue(scope,view,draft,'map')),button('Review known details',issue(scope,view,draft,'known'))];
    if(draft.status==='editing')controls.unshift(button('Edit intention',issue(scope,view,draft,'edit')),button('Try action',issue(scope,view,draft,'try')));
    if(draft.status==='prepared')controls.unshift(button('Recover original action',issue(scope,view,draft,'try')));
    await send({flags:FLAGS.componentsV2|FLAGS.ephemeral,allowedMentions:{parse:[]},attachments:[],components:[{type:17,components:[...texts,{type:1,components:controls}]}]});
  }
  async function handle(context) {
    const {token,scope,view,interaction,send,reject,render}=context;
    if (!privatePlayer(scope)) return false;
    const action=(view.actions??[]).find(item=>item.id===token.actionId);
    if (!token.draftControl && (!eligible(action) || token.intent)) return false;
    const key=JSON.stringify(storedScope(scope));
    const previous=locks.get(key)??Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      if (!await authorize(scope)) return reject('You no longer have access to this character.');
      let draft=await draftStore.get(storedScope(scope));
      if(token.draftControl && !(token.draftControl==='save' && !draft && token.draftVersion===null) && (!draft || draft.draftId!==token.draftId || draft.version!==token.draftVersion))return reject('That saved intention was replaced. Reopen the panel for its current version.');
      const fresh=await engine.project(scope);
      if (!await authorize(scope)) return reject('You no longer have access to this character.');
      if(token.draftControl==='review') {await review(scope,fresh,draft,send,token.draftPage);return true;}
      if(['map','known'].includes(token.draftControl)) {await send(await render({...fresh,audience:scope.audience},scope,{tab:token.draftControl==='known'?'journal':'map'}));return true;}
      if(token.draftControl==='try') {
        if(draft.status==='completed'){await review(scope,fresh,draft,send);return true;}
        if(draft.status==='editing'){
          const current=(fresh.actions??[]).find(item=>item.id===draft.actionId);
          if(!validInput(current,draft.input)||!isDeepStrictEqual(current.payload??{},draft.actionPayload))return reject('The available action changed. Edit your saved intention before trying it.');
          if(draft.expectedRevision!==fresh.revision)return reject('The scene changed. Edit and save your intention against the current scene before trying it.');
          draft=await draftStore.prepare(storedScope(scope),{draftId:draft.draftId,version:draft.version,currentRevision:fresh.revision,availableActionIds:[current.id]});
        }
        if(!await authorize(scope))return reject('You no longer have access to this character.');
        const intent=draft.intent;
        try {
          const receipt=await engine.command({...scope,mapLevel:'tactical',expectedRevision:intent.expectedRevision,commandId:intent.commandId,action:intent.actionId,payload:{...intent.actionPayload,...intent.input}});
          // Only a confirmed returned receipt closes an attempt; errors retain its identity.
          draft=await draftStore.complete(storedScope(scope),{draftId:draft.draftId,commandId:intent.commandId,receipt:{result:String(presentReceipt(receipt)??'').trim() || 'Result recorded.'}});
        } catch {
          await review(scope,fresh,draft,send);return true;
        }
        await review(scope,await engine.project(scope),draft,send);return true;
      }
      const current=(fresh.actions??[]).find(item=>item.id===(token.draftControl==='edit'?draft.actionId:token.draftAction?.id??token.actionId));
      if(token.draftControl==='save'){
        const original=token.draftAction;
        if(!eligible(original))return reject('That saved form is invalid. Reopen your intention.');
        const input=Object.fromEntries(original.fields.map(field=>[field.id,interaction.fields.getTextInputValue(field.id)]));
        if(!validInput(original,input))return reject('Check your intention fields and their character limits.');
        draft=await draftStore.save(storedScope(scope),{actionId:original.id,actionPayload:original.payload??{},input,expectedRevision:token.revision},token.draftVersion??null);
        await review(scope,fresh,draft,send);return true;
      }
      if(!eligible(current))return reject('That written action is no longer available.');
      if(token.revision!==fresh.revision && token.draftControl!=='edit')return reject('The scene changed. Reopen the game panel for current choices.');
      if(draft?.status==='prepared'){await review(scope,fresh,draft,send);return true;}
      await interaction.showModal({title:'Save intention — no action yet',custom_id:tokenStore.issue({...scope,revision:fresh.revision,draftControl:'save',draftId:draft?.draftId,draftVersion:draft?.version??null,draftAction:snapshot(current),opensModal:true}),components:current.fields.map(field=>({type:18,label:field.label.slice(0,45),component:{type:4,custom_id:field.id,style:field.multiline?2:1,required:field.required!==false,max_length:Math.min(field.maxLength??500,4000),...(draft?.actionId===current.id?{value:draft.input[field.id]??''}:{})}}))});
      return true;
    });
    locks.set(key,task);try{return await task;}finally{if(locks.get(key)===task)locks.delete(key);}
  }
  return {resume,handle};
}
