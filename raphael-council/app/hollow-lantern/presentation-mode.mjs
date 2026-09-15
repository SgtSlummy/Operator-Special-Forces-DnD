const contextOf=view=>JSON.stringify([view.campaignId,view.selectedActor,view.sceneId??view.title]);
const recommended=view=>view.mode==='combat'||!view.illustrations?.scene?'tactical':'scene';
export function reconcilePresentation(previous,view){
 if(!view)return previous;
 const context=contextOf(view),mode=view.mode;
 if(!previous||previous.context!==context)return {context,mode,value:recommended(view)};
 if(mode==='combat'&&previous.mode!=='combat')return {context,mode,value:'tactical'};
 if(previous.value==='scene'&&!view.illustrations?.scene)return {context,mode,value:'tactical'};
 return previous.mode===mode?previous:{...previous,mode};
}
export function choosePresentation(view,value){
 if(!view||!['scene','tactical','dungeon','details'].includes(value))return null;
 return {context:contextOf(view),mode:view.mode,value:value==='scene'&&!view.illustrations?.scene?'tactical':value};
}
