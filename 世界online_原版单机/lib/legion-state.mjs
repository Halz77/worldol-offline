import fs from 'node:fs';
export const legionData=JSON.parse(fs.readFileSync(new URL('../data/legion-v1.json',import.meta.url),'utf8'));
export const legionRevision=legionData.revision;
const rosters=new WeakMap();
// Associate canonical roles without adding other characters to a saved role.
export function bindLegionRoster(characters){for(const role of characters)rosters.set(role,characters);}
export function legionRoster(p){return (rosters.get(p)||[]).filter(r=>r.accountId===p.accountId&&r.id!==p.id);}
export function legionState(p){
 const source=p.legion||{},valid=new Set(legionRoster(p).map(r=>r.id)),formations={};
 for(const template of legionData.formations){
  const used=new Set();
  formations[template.id]=template.slots.map((slot,i)=>{const id=source.formations?.[template.id]?.[i];if(!valid.has(id)||used.has(id))return 0;used.add(id);return id;});
 }
 return {activeId:legionData.formations.some(f=>f.id===source.activeId)?source.activeId:1,formations};
}
export function activeLegionMembers(p){
 const state=legionState(p),template=legionData.formations.find(f=>f.id===state.activeId),roster=legionRoster(p);
 return template.slots.flatMap((slot,i)=>{const role=roster.find(r=>r.id===state.formations[state.activeId][i]);return role&&p.level>=slot.unlockLevel?[{role,index:slot.index,legionId:state.activeId}]:[];});
}
const head=p=>({id:p.id,sex:p.sex||0,vocation:p.job||0,camp:p.race||0,level:p.level});
export function legionInfo(p){
 const state=legionState(p),roster=legionRoster(p);
 return {
  legionInfos:legionData.formations.map(f=>({legionId:f.id,battle:f.id===state.activeId,infos:f.slots.map((slot,i)=>{const role=roster.find(r=>r.id===state.formations[f.id][i]);return {...slot,...(role?{headInfo:head(role)}:{})};})})),
  actorInfos:roster.map(r=>({actorId:r.id,name:r.name,job:r.job||0,level:r.level,icon1:r.icon1||'0',icon2:r.icon2||'0',icon3:r.icon3||'0',legionIds:legionData.formations.filter(f=>state.formations[f.id].includes(r.id)).map(f=>f.id)}))
 };
}
export function changeLegionFormation(p,{type,legionId,index,actorId=0}){
 const template=legionData.formations.find(f=>f.id===legionId),slot=template?.slots.find(s=>s.index===index);
 if(!slot||![1,2].includes(type))throw Error('军团或栏位不存在。');
 if(p.level<slot.unlockLevel)throw Error(`该栏位需要主角色达到 ${slot.unlockLevel} 级。`);
 const state=legionState(p),position=template.slots.indexOf(slot),current=state.formations[legionId][position];
 if(type===1){
  const role=legionRoster(p).find(r=>r.id===actorId);
  if(!role)throw Error('只能编入同一存档中的其他角色。');
  if(current||state.formations[legionId].includes(actorId))throw Error('该栏位已有角色，或角色已经编入此军团。');
  state.formations[legionId][position]=actorId;p.legion=state;
  return {type,legionId,index,actorId,headInfo:head(role)};
 }
 if(!current)throw Error('该栏位已经空闲。');
 state.formations[legionId][position]=0;p.legion=state;
 return {type,legionId,index,actorId:current};
}
export function selectLegion(p,id){
 if(!legionData.formations.some(f=>f.id===id))throw Error('军团不存在。');
 const state=legionState(p);state.activeId=id;p.legion=state;return {legionId:id};
}
