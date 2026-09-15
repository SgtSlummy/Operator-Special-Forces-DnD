import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the existing screen renderer without opening or serving the HTML.
const html=await readFile(new URL('./player-walkthrough.html',import.meta.url),'utf8');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]);
for(const script of scripts)new vm.Script(script);
const script=scripts.find(value=>value.includes('function render(){'));
assert.ok(script,'walkthrough renderer must exist');
const start=script.indexOf('function render(){');
const end=script.indexOf('\npicker.onchange=',start);
assert.ok(end>start,'renderer boundary must exist');
const renderer=script.slice(start,end);

function fixture(focusLocation){
 const document={body:{name:'body'}};
 const oldControl={name:'old action'};
 const outsideControl={name:'stage picker'};
 const nextControl={name:'next screen action',focus(){document.activeElement=this;}};
 document.activeElement=focusLocation==='content'?oldControl:focusLocation==='outside'?outsideControl:document.body;
 const content={
  contains:node=>node===oldControl,
  set innerHTML(value){this.markup=value;if(document.activeElement===oldControl)document.activeElement=document.body;},
  querySelectorAll:()=>[],
  querySelector:selector=>selector==='input, textarea, select, button:not([disabled])'?nextControl:null
 };
 const nodes=new Map();
 const root={style:{setProperty(){}},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{});return nodes.get(selector);},querySelectorAll:()=>[]};
 const context=vm.createContext({document,content,root,picker:outsideControl,state:{index:0,accent:'#5865f2'},stages:[{id:'opening',channel:'session',scope:'party',phase:'Arrival',note:'Known details',title:'Arrival',body:'Rain over the road',kicker:'Scene',actions:[['Inspect','inspect']]}],esc:String,fill:String,map:()=>'',act:()=>{}});
 vm.runInContext(renderer+'\nrender();',context);
 return {document,content,nextControl,outsideControl};
}

test('replacing the focused screen carries keyboard focus to its next available control',()=>{
 const result=fixture('content');
 assert.equal(result.document.activeElement,result.nextControl);
 assert.match(result.content.markup,/Arrival/);
});
test('changing the stage from persistent navigation retains focus on that navigation',()=>{
 const result=fixture('outside');
 assert.equal(result.document.activeElement,result.outsideControl);
});
test('initial rendering does not steal page focus',()=>{
 const result=fixture('body');
 assert.equal(result.document.activeElement,result.document.body);
});
