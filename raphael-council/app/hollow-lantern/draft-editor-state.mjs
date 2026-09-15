export async function guardedDraftRead(read,isCurrent){try{const value=await read();return isCurrent()?value:null;}catch(error){if(isCurrent())throw error;return null;}}
export const emptyDraftEditor=()=>({saved:null,buffer:null,pending:null,conflict:false,loaded:false});
export const isDraftEditorAction=a=>['interact','talk','describe'].includes(a?.type)&&a.fields?.length===1&&a.fields[0].id==='text'&&a.fields[0].kind===undefined&&a.fields[0].multiline===true&&Number.isSafeInteger(a.fields[0].maxLength)&&a.fields[0].maxLength>0&&a.fields[0].maxLength<=1500;
const context=(view,level)=>({campaignId:view.campaignId,selectedActor:view.selectedActor,viewToken:view.viewToken,revision:view.revision,level});
export const draftRequestQuery=c=>`?campaignId=${encodeURIComponent(c.campaignId)}&actorId=${encodeURIComponent(c.selectedActor)}&level=${encodeURIComponent(c.level)}`;
export const draftDirty=s=>Boolean(s.buffer&&(!s.saved||s.buffer.text!==s.saved.input.text||s.buffer.actionId!==s.saved.actionId||(s.buffer.context&&s.buffer.context.revision!==s.saved.expectedRevision)));
const savedBuffer=(draft,view)=>draft?{actionId:draft.actionId,label:view?.actions?.find(a=>a.id===draft.actionId)?.label??draft.actionId,text:draft.input.text,maxLength:1500,context:null}:null;
export function selectDraftAction(s,selection){
 if(!isDraftEditorAction(selection?.action))return s;
 if(s.buffer&&(s.buffer.actionId!==selection.action.id||selection.text!==undefined&&selection.text!==s.buffer.text))return {...s,pending:selection};
 if(s.buffer)return s;
 return {...s,buffer:{actionId:selection.action.id,label:selection.action.label,text:selection.text??'',maxLength:selection.action.fields[0].maxLength,context:context(selection.view,selection.level)},pending:null};
}
export function receiveDraft(s,draft,view){
 const changed=(s.saved?.draftId??null)!==(draft?.draftId??null)||(s.saved?.version??null)!==(draft?.version??null);
 if(s.buffer&&(draftDirty(s)||s.conflict))return {...s,saved:draft,loaded:true,conflict:s.conflict||changed};
 return {...s,saved:draft,buffer:savedBuffer(draft,view),loaded:true,conflict:false};
}
export const editDraftText=(s,text)=>({...s,buffer:{...s.buffer,text}});
export const useSavedDraft=(s,view)=>({...s,buffer:savedBuffer(s.saved,view),pending:null,conflict:false});
export function reviewDraft(s,view,level){
 const action=view?.actions?.find(a=>a.id===s.buffer?.actionId);if(!isDraftEditorAction(action)||s.saved?.status==='prepared')return s;
 return {...s,buffer:{...s.buffer,label:action.label,maxLength:action.fields[0].maxLength,context:context(view,level)},conflict:false};
}
export const acceptSavedDraft=(s,draft)=>({...s,saved:draft,loaded:true,conflict:false});
