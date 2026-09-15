import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
const source=await readFile(new URL('./table.js',import.meta.url),'utf8');
// Use only elements present in the actual page; missing markup must still fail.
const markup=await readFile(new URL('./table.html',import.meta.url),'utf8');
const pageIds=[...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
class Element{
 constructor(id){this.id=id;this.value='';this.hidden=false;this.disabled=false;this.children=[];this.listeners={};this.textContent='';}
 get textContent(){return this.text+this.children.map(c=>c.textContent).join('');}set textContent(value){this.text=value;this.children=[];}
 get firstChild(){return this.children[0];}
 replaceChildren(...c){this.text='';this.children=[];this.append(...c);if(this.id==='group'||this.id==='action')this.value=c[0]?.value??'';}
 append(...c){for(const node of c){node.parentElement=this;this.children.push(node);}}
 before(...c){for(const node of c)node.parentElement=this.parentElement;}
 after(...c){for(const node of c)node.parentElement=this.parentElement;}
 remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(c=>c!==this);}
 querySelector(selector){const value=/option\[value="([^"]+)"\]/.exec(selector)?.[1];return this.children.find(c=>c.value===value);}
 addEventListener(k,fn){this.listeners[k]=fn;}setAttribute(){}focus(){}async event(k,event={}){return this.listeners[k]?.({target:this,preventDefault(){},...event});}
}
const current=()=>({campaignId:'campaign',viewer:'player',selectedActor:'fighter',dmController:false,revision:3,title:'Briefing',summary:'Your private table',viewToken:'view',actions:[{id:'move:1:2',group:'move',label:'Move',description:'5 feet',fields:[]}],actor:{id:'fighter',name:'Mara',conditions:[],hp:31,maxHp:31,inventory:[]},controllableActors:[]});
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
async function browser({storage=new Map(),fetcher,view=current()}={}){const ids=pageIds,elements=Object.fromEntries(ids.map(id=>[id,new Element(id)]));elements.tab.value='map';elements.level.value='tactical';const calls=[],game=new Element('game'),nodes=Object.values(elements);for(const id of ['tab','action','level']){const label=new Element('label');label.append(new Element('text'),elements[id]);}const document={getElementById:id=>nodes.find(n=>n.id===id),createElement:id=>{const node=new Element(id);nodes.push(node);return node;},querySelector:selector=>selector==='.game'?game:new Element(selector)};const context={document,sessionStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async(path,options)=>{const input=options.body?JSON.parse(options.body):undefined;calls.push({path,input});return await fetcher?.(path,input)??response(view);},crypto:{randomUUID},FormData:class{*[Symbol.iterator](){}},location:{hash:'',pathname:'/'},history:{replaceState(){}},window:{addEventListener(){}},URLSearchParams,console};await vm.runInNewContext(`(async()=>{${source}})()`,context);return {elements,calls,storage,context,game};}
const key='hollow-lantern.pending.v1';
test('an explanation is an explicit required step and cannot submit empty or whitespace text',async()=>{
 const view=rulingView();view.actions.push({id:'ruling:r1:approve:note',group:'rulings',label:'Approve request with explanation',description:'Record approval.',fields:[{id:'text',label:'DM ruling',multiline:true,required:true}]});
 const b=await browser({view});b.elements.action.value='ruling:r1:approve:note';await b.elements.action.event('change');const label=b.elements.fields.children[0],input=label.children[0];
 assert.match(label.textContent,/2\. Write your explanation/);assert.equal(b.elements.action.parentElement.firstChild.textContent,'Response selected ');assert.equal(b.elements.submit.disabled,true);assert.equal(b.elements.submit.textContent,'Write an explanation above');
 await b.elements.intent.event('submit');input.value='   ';await input.event('input');await b.elements.intent.event('submit');assert.equal(b.elements.submit.disabled,true);assert.equal(b.calls.some(c=>c.path.startsWith('/api/action')),false);assert.equal(b.storage.has(key),false);
 input.value='I approve inspecting the visible records.';await input.event('input');assert.equal(b.elements.submit.disabled,false);assert.equal(b.elements.submit.textContent,'Confirm: Approve request with explanation');input.value='';await input.event('input');assert.equal(b.elements.submit.disabled,true);
});
test('uncertain action persists per tab; reload performs no mutation and recovery is receipt-only',async()=>{const storage=new Map();let b=await browser({storage,fetcher:async path=>{if(path.startsWith('/api/action'))throw new Error('Network lost');}});await b.elements.intent.event('submit');assert.ok(storage.has(key));assert.equal(b.elements.submit.disabled,true);const pending=JSON.parse(storage.get(key));assert.equal(pending.actorId,'fighter');b=await browser({storage,fetcher:async path=>path==='/api/receipt'?response({error:'not available'},404):undefined});assert.deepEqual(b.calls.map(c=>c.path),['/api/view?level=tactical']);await b.elements.recover.event('click');assert.equal(b.calls.at(-1).path,'/api/receipt');assert.deepEqual(b.calls.at(-1).input,{commandId:pending.request.commandId});assert.ok(storage.has(key));assert.match(b.elements.notice.textContent,/may still be in flight/);});
test('401 and403 recovery retain original identity; success clears it without submitting another action',async()=>{const storage=new Map();let status=401;let b=await browser({storage,fetcher:async path=>path.startsWith('/api/action')?response({error:'access changed'},403):undefined});await b.elements.intent.event('submit');const p=JSON.parse(storage.get(key));b=await browser({storage,fetcher:async path=>path==='/api/receipt'?(status===200?response({receipt:{success:true,campaignId:'campaign',commandId:p.request.commandId,revision:4,replayed:true,result:{message:'Moved'}}}):response({error:'restore access'},status)):undefined});for(const code of [401,403]){status=code;await b.elements.recover.event('click');assert.equal(JSON.parse(storage.get(key)).request.commandId,p.request.commandId);}status=200;await b.elements.recover.event('click');assert.equal(storage.has(key),false);assert.equal(b.calls.filter(c=>c.path.startsWith('/api/action')).length,0);assert.match(b.elements.receipt.textContent,/Original result recovered/);});
test('DM may select the rightful recovery actor; UI serializes actor changes and refresh',async()=>{const storage=new Map([[key,JSON.stringify({version:1,campaignId:'campaign',actorId:'fighter',audience:'player',actionLabel:'Move',request:{commandId:randomUUID(),action:'move'}})]]);let selected='rogue',release;const b=await browser({storage,fetcher:async(path,input)=>{if(path==='/api/actor'){await new Promise(r=>release=r);selected=input.actorId;return response({selected:true});}if(path.startsWith('/api/view'))return response({...current(),dmController:true,selectedActor:selected,actor:{...current().actor,id:selected},controllableActors:[{id:'fighter',name:'Mara'},{id:'rogue',name:'Kestrel'}]});}});assert.equal(b.elements.recover.disabled,true);assert.equal(b.elements['dm-actor'].disabled,false);b.elements['dm-actor'].value='fighter';const changing=b.elements['dm-actor'].event('change');await b.elements.refresh.event('click');assert.equal(b.elements.refresh.disabled,true);release();await changing;assert.equal(b.elements['dm-actor'].value,'fighter');assert.equal(b.elements.recover.disabled,false);assert.equal(b.calls.filter(c=>c.path.startsWith('/api/view')).length,2);assert.equal(b.elements.submit.disabled,true);});
test('storage failure prevents initial submit and dismissal is explicit rather than automatic',async()=>{const b=await browser();b.context.sessionStorage.setItem=()=>{throw new Error('storage unavailable');};await b.elements.intent.event('submit');assert.equal(b.calls.some(c=>c.path.startsWith('/api/action')),false);assert.match(b.elements.notice.textContent,/Nothing was sent/);const storage=new Map([[key,'broken']]),bad=await browser({storage});assert.equal(bad.elements.submit.disabled,true);assert.ok(storage.has(key));await bad.elements['dismiss-pending'].event('click');assert.equal(bad.elements['dismiss-confirm'].hidden,false);await bad.elements['confirm-dismiss'].event('click');assert.equal(storage.has(key),false);assert.match(bad.elements.notice.textContent,/did not cancel or undo/);});
const rulingView=()=>({...current(),viewer:'gm',dmStatus:{decisionOpen:false,pendingRulings:[{id:'r1',text:'Fixture request'}]},actions:[{id:'ruling:r1:approve',group:'rulings',label:'Approve request',description:'Allow the stated attempt.',fields:[]},{id:'ruling:r1:decline',group:'rulings',label:'Decline request',description:'Leave the situation unchanged.',fields:[]},...current().actions]});
test('pending rulings are neutral on both the DM map and Review; all offered responses are visible',async()=>{
 const b=await browser({view:rulingView()}),guide=b.context.document.getElementById('ruling-response-guide');
 assert.equal(b.elements.group.value,'rulings');assert.equal(b.elements.action.value,'');assert.equal(b.elements.submit.disabled,true);
 assert.equal(b.elements.submit.textContent,'Choose a response above');assert.match(b.elements.action.parentElement.firstChild.textContent,/1\. Choose a response/);
 assert.equal(guide.hidden,false);for(const text of ['Approve request','Allow the stated attempt.','Decline request','Leave the situation unchanged.'])assert.ok(guide.textContent.includes(text));
 assert.equal(guide.textContent.includes('5 feet'),false);
 b.elements.action.value='ruling:r1:decline';await b.elements.action.event('change');assert.equal(b.elements.submit.disabled,false);assert.equal(b.elements.cost.textContent,'Leave the situation unchanged.');
 assert.equal(b.elements.submit.textContent,'Confirm: Decline request');
 b.elements.tab.value='rulings';await b.elements.tab.event('change');assert.equal(b.elements.action.value,'');assert.equal(b.elements.submit.disabled,true);assert.equal(b.calls.some(c=>c.path.startsWith('/api/action')),false);
});
test('ruling guidance clears when the scope changes, while normal move controls remain available',async()=>{
 let next=rulingView();const b=await browser({fetcher:async()=>response(next)});next=current();await b.elements.refresh.event('click');
 const guide=b.context.document.getElementById('ruling-response-guide');assert.equal(guide.hidden,true);assert.equal(guide.textContent,'');assert.equal(b.elements.action.value,'move:1:2');assert.equal(b.elements.submit.disabled,false);
});
test('paired explanation variants stay in the dropdown without duplicate decision cards',async()=>{
 const view=rulingView();view.dmController=true;
 view.actions.push(...view.actions.filter(a=>a.group==='rulings').map(a=>({...a,id:a.id+':note',label:a.label+' with explanation',fields:[{id:'text',label:'DM ruling',multiline:true}]})));
 const b=await browser({view});b.elements.tab.value='rulings';await b.elements.tab.event('change');
 const guide=b.context.document.getElementById('ruling-response-guide');assert.equal(guide.children[2].children.length,2);assert.match(guide.textContent,/Approve request with explanation/);assert.match(guide.textContent,/Decline request with explanation/);assert.match(guide.textContent,/require your written ruling/);
 assert.equal(b.elements.action.children.length,5);assert.equal(b.elements.submit.disabled,true);assert.equal(b.elements.level.parentElement.hidden,true);assert.equal(b.elements['dm-actor-label'].hidden,true);
 b.elements.action.value='ruling:r1:approve';await b.elements.action.event('change');assert.equal(b.elements.submit.textContent,'Confirm: Approve request (no explanation)');assert.match(b.elements.cost.textContent,/No explanation will be recorded/);assert.equal(b.elements.fields.children.length,0);
 const add=b.context.document.getElementById('add-ruling-explanation');assert.equal(add.hidden,false);assert.equal(add.type,'button');
 const refreshing=b.elements.refresh.event('click');assert.equal(add.disabled,true);const busyClick=add.event('click');assert.equal(b.elements.action.value,'ruling:r1:approve');await busyClick;await refreshing;
 b.elements.action.value='ruling:r1:approve';await b.elements.action.event('change');await add.event('click');assert.equal(b.elements.action.value,'ruling:r1:approve:note');assert.equal(add.hidden,true);assert.equal(b.elements.fields.children[0].children[0].required,true);
 b.elements.action.value='ruling:r1:decline:note';await b.elements.action.event('change');assert.equal(b.elements.fields.children[0].children[0].name,'text');assert.equal(b.elements.fields.children[0].children[0].required,true);
 assert.equal(b.elements.cost.textContent.includes('No explanation will be recorded'),false);assert.equal(b.elements.submit.textContent.includes('(no explanation)'),false);assert.equal(b.calls.some(c=>c.path.startsWith('/api/action')),false);
 b.elements.tab.value='map';await b.elements.tab.event('change');assert.equal(b.elements.level.parentElement.hidden,false);assert.equal(b.elements['dm-actor-label'].hidden,false);
});
test('a separately offered explanation response is never hidden without its base choice',async()=>{
 const view=rulingView();view.actions=view.actions.filter(a=>a.id==='ruling:r1:approve').map(a=>({...a,id:a.id+':note',label:'Approve with explanation'}));
 const b=await browser({view}),guide=b.context.document.getElementById('ruling-response-guide');assert.equal(guide.children[2].children.length,1);assert.match(guide.textContent,/Approve with explanation/);
 assert.equal(b.context.document.getElementById('add-ruling-explanation').hidden,true);
});

