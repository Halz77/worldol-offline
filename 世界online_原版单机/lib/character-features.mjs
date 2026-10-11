import {featureData} from './feature-protobuf.mjs';

export const featureRevision=featureData.revision;
const talentLevels=new Map(featureData.talents.map(t=>[`${t.rankId}:${t.rankLevel}`,t]));
const talentKinds=[...new Map(featureData.talents.map(t=>[t.rankId,t])).values()].sort((a,b)=>a.rankId-b.rankId);
const stages=new Map(featureData.artifact.stages.map(s=>[s.stage,s]));
const parts={skills:new Map(featureData.artifact.skills.map(s=>[`${s.type}:${s.lv}`,s])),decorations:new Map(featureData.artifact.decorations.map(s=>[`${s.type}:${s.lv}`,s]))};
export function characterFeatureState(p){const s=p.characterFeatures||{};return structuredClone({talents:s.talents||{},artifact:{stage:1,exp:0,...s.artifact,skills:s.artifact?.skills||{},decorations:s.artifact?.decorations||{}}});}
export function talentList(p){
 const state=characterFeatureState(p),talents=[],nextTalents=[];
 for(const t of talentKinds){
  const level=state.talents[t.rankId]||0,current=talentLevels.get(`${t.rankId}:${level}`),next=talentLevels.get(`${t.rankId}:${level+1}`);
  if(current)talents.push({...current,info:!next&&level<t.maxLv?'待定：下一等级数据尚未录到。':current.info});
  if(next)nextTalents.push(next);
  // A labelled empty preview preserves the native entry, without inventing a
  // missing level's bonuses or price. Both client and server reject learning it.
  else if(!level)nextTalents.push({...t,rankLevel:1,items:[],attrib:[],info:'待定：尚缺1级属性与消耗，暂不能学习。'});
 }
 return {talents,nextTalents};
}
export function artifactInfo(p){const s=characterFeatureState(p).artifact,t=stages.get(s.stage);if(!t)throw Error('神器阶数数据待定。');return {info:{...t,exp:s.exp,power:0,lvCost:t.lvCost||[]}};}
export function artifactParts(p,kind){
 const s=characterFeatureState(p).artifact,count=kind==='skills'?4:3;
 return {info:Array.from({length:count},(_,i)=>{const t=parts[kind].get(`${i+1}:${s[kind][i+1]||0}`);if(!t)throw Error('神器等级数据待定。');return t;})};
}
export function characterFeaturePowers(p){
 const state=characterFeatureState(p),totals=new Map(Object.entries(p.importedRolePowers||{}).map(([id,v])=>[Number(id),v]));
 const add=attrs=>{for(const {k,v} of attrs||[])totals.set(k,(totals.get(k)||0)+v);};
 for(const [id,level] of Object.entries(state.talents)){const t=talentLevels.get(`${id}:${level}`);if(!t)throw Error('存档中的天赋等级缺少数据。');add(t.attrib);}
 for(const kind of ['skills','decorations'])for(const [type,level] of Object.entries(state.artifact[kind])){const t=parts[kind].get(`${type}:${level}`);if(!t)throw Error('存档中的神器等级缺少数据。');add(t.attribute);}
 return [...totals].filter(([,v])=>v!==0);
}
export function consumeFeatureItems(p,items){
 const required=new Map();for(const i of items||[]){if(!Number.isSafeInteger(i.itemCount)||i.itemCount<1)throw Error('材料消耗数据待定。');required.set(i.itemId,(required.get(i.itemId)||0)+i.itemCount);}
 if(!required.size)throw Error('材料消耗数据待定。');
 for(const [id,n] of required){const have=(p.inventory||[]).filter(i=>i.slot>=30&&!i.pet&&i.itemId===id).reduce((sum,i)=>sum+i.quantity,0);if(have<n)throw Error(`${items.find(i=>i.itemId===id).name}不足，需要${n}个。`);}
 const inventory=structuredClone(p.inventory);
 for(const [id,n] of required){let left=n;for(const item of inventory.filter(i=>i.slot>=30&&!i.pet&&i.itemId===id)){const take=Math.min(left,item.quantity);item.quantity-=take;left-=take;if(!left)break;}}
 p.inventory=inventory.filter(i=>i.quantity>0);
}
export function learnTalent(p,id,level){
 const s=characterFeatureState(p),current=s.talents[id]||0;
 if(!Number.isInteger(id)||!Number.isInteger(level)||level!==current+1)throw Error('天赋等级已变化，请重新打开。');
 const next=talentLevels.get(`${id}:${level}`);if(!next)throw Error('待定：这个天赋等级的属性或消耗尚未录到，材料未消耗。');
 if(p.level<next.unlockLevel)throw Error(`人物达到${next.unlockLevel}级后开放。`);
 s.talents[id]=level;p.characterFeatures=s;return `${next.name}已免费升至${level}级。`;
}
export function upgradeArtifactPart(p,kind,type){
 if(!['skills','decorations'].includes(kind)||!Number.isInteger(type)||type<1||type>(kind==='skills'?4:3))throw Error('无效神器部位。');
 const s=characterFeatureState(p),level=s.artifact[kind][type]||0;
 if(kind==='skills'&&s.artifact.stage<type)throw Error(`需要神器${type}阶，可在神器界面免费进阶。`);
 const current=parts[kind].get(`${type}:${level}`),next=parts[kind].get(`${type}:${level+1}`);
 if(!current||!next)throw Error('此神器部位已达到最高等级。');
 s.artifact[kind][type]=level+1;p.characterFeatures=s;return `${current.name}已免费升至${level+1}级。`;
}
export function smeltArtifact(p){
 const s=characterFeatureState(p),next=stages.get(s.artifact.stage+1);
 if(!next)throw Error('神器已达到最高阶。');
 s.artifact.stage=next.stage;s.artifact.exp=0;p.characterFeatures=s;return `神器已免费提升至${next.stage}阶。`;
}
export function characterFeatureDirectory(p){
 const s=characterFeatureState(p);
 return {revision:featureRevision,role:p.id,state:s,powers:characterFeaturePowers(p),
  talents:talentKinds.map(t=>{const level=s.talents[t.rankId]||0,next=talentLevels.get(`${t.rankId}:${level+1}`);return {id:t.rankId,name:t.name,type:t.type,level,max:t.maxLv,unlockLevel:t.unlockLevel,pending:level<t.maxLv&&!next,next:next?{level:next.rankLevel,attributes:next.attrib,cost:next.items.map(i=>({id:i.itemId,name:i.name,count:i.itemCount}))}:null};}),
  artifact:{...artifactInfo(p).info,powerPending:true,skills:artifactParts(p,'skills').info,decorations:artifactParts(p,'decorations').info},
  pending:[...(p.importedRolePowers?['导入角色已保留神器、图鉴合计加成；未导出的独立等级待定。']:[]),'城市金库自动收入周期、速度和容量待定。','城市6级以后的升级条件待定。','神器独立战力公式待定；总战力沿用单机评分。']};
}
