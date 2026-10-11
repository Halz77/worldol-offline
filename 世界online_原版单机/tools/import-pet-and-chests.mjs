import fs from 'node:fs';
const file=new URL('../data/official-v305.json',import.meta.url),data=JSON.parse(fs.readFileSync(file,'utf8')),capture=JSON.parse(fs.readFileSync(new URL('../analysis/pet-chest-capture.json',import.meta.url),'utf8'));
for(const item of capture.items){const index=data.items.findIndex(x=>x.id===item.id);if(index<0)data.items.push(item);else if(data.items[index].sources?.some(s=>s.origin==='chest-reward'))data.items[index]=item;}
const base=capture.petSnapshots[0],expTable={[base.level]:base.expMax},milestones={[base.level]:structuredClone(base)};
let state=structuredClone(base);
for(const event of capture.petRewards){
 if(event.eggId!==base.eggId)throw Error('Multiple species require independent progression tables');
 if(event.levels){
  const target=state.level+event.levels,total=state.exp+event.exp-event.currentExp;
  const unknown=Array.from({length:event.levels},(_,i)=>state.level+i).filter(level=>!expTable[level]);
  const known=Array.from({length:event.levels},(_,i)=>state.level+i).reduce((sum,level)=>sum+(expTable[level]||0),0);
  if(unknown.length>1)throw Error('Intermediate pet XP cannot be inferred');
  if(unknown.length===1)expTable[unknown[0]]=total-known;else if(total!==known)throw Error('Pet XP accounting mismatch');
  state.level=target;state.sp+=event.sp;state.growLevel+=event.growLevels;state.baseStats=state.baseStats.map((v,i)=>v+event.stats[i]);state.cp=event.cp;
  for(const skill of event.skills){state.skills=state.skills.filter(s=>s.id!==skill.id);state.skills.push(skill);}
  state.exp=event.currentExp;state.expMax=event.expMax;expTable[target]=event.expMax;milestones[target]=structuredClone(state);
 }else state.exp+=event.exp;
}
data.petContent={sourceCapture:capture.capture,openingRule:'Replay the observed result; no official random distribution inferred.',chests:capture.chests.filter(x=>x.wait===4),pets:[{eggId:30100,name:'苍鹰',item:capture.petItems[0],baseline:base,expTable,milestones,maxRecordedLevel:state.level}],rewardEvents:capture.petRewards};
const tmp=new URL('../data/official-v305.json.tmp',import.meta.url);fs.writeFileSync(tmp,JSON.stringify(data,null,2)+'\n');fs.renameSync(tmp,file);
console.log(JSON.stringify({itemDefinitions:data.items.length,chests:data.petContent.chests.map(x=>x.inputId),pet:30100,maxPetLevel:state.level,expTable,milestoneLevels:Object.keys(milestones)},null,2));
