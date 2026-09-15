/** Select existing actions only; shortcuts never execute a command. */
export function contextualActions(actions,tab,mode,gm=false,selected=''){
 const groups=tab==='rulings'?[]:tab==='inventory'?['use','equip','buy','sell']:gm?['pause','checkpoint']:mode==='combat'?['move','attack','ability','end-turn']:['move','inspect','interact','talk'];
 const primary=groups.map(group=>actions.find(a=>a.group===group)).filter(Boolean).slice(0,4);
 const remaining=actions.filter(a=>!primary.includes(a));
 return {primary,remaining,menu:actions.filter(a=>!primary.includes(a)||a.id===selected)};
}

export function actionsForTab(actions,tab){
 const dieChoices=actions.filter(a=>a.type==='inspiration_choice');
 if(dieChoices.length&&!['journal','help'].includes(tab))return dieChoices;
 if(tab==='rulings')return actions.filter(a=>a.group==='rulings'&&a.id.startsWith('ruling:'));
 if(tab==='inventory')return actions.filter(a=>['use','equip','buy','sell'].includes(a.group));
 if(['journal','help'].includes(tab))return [];
 return actions;
}
