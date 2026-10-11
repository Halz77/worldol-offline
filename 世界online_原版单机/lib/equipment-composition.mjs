import {equipment,clampVitals,reconcileSkillSettings} from './restoration.mjs';
import {compositionRanges,compositionSkills,itemWithAffixes} from './item-affixes.mjs';
import {upgradeTarget,fingerprint} from './equipment-upgrades.mjs';
import {localVipLevel,setState,equipmentSets,VIP_MAX,setAttributeData} from './equipment-sets.mjs';

export const COMPOSITION_LIST=90001,COMPOSITION_APPLY=90002,VIP_APPLY=90003;
export function workshopState(p){
 return {role:p.id,mode:'free',vipLevel:localVipLevel(p),vipMax:VIP_MAX,knownSets:equipmentSets.size,sets:setState(p),setAttributes:setAttributeData(p),items:(p.inventory||[]).filter(i=>!i.pet).flatMap(i=>{
   const e=equipment.get(i.itemId);if(!e?.native)return [];
   const ranges=compositionRanges(e),skills=compositionSkills(e);if(!ranges.length&&!skills.length)return [];
   const actual=itemWithAffixes(e,i);
   return [{slot:i.slot,itemId:i.itemId,name:e.name,bound:!!(i.bound||e.autoBinding),star:i.star||0,fingerprint:fingerprint(i),ranges,skills:skills.map(s=>({id:s.id,level:s.level,name:s.name,type:s.type})),affixes:i.affixes||{},currentSkill:actual.skill?{id:actual.skill.id,name:actual.skill.name,level:actual.skill.level}:null}];
 })};
}
export function planComposition(p,request){
 if(!request||typeof request!=='object'||!Number.isInteger(request.slot)||!Number.isInteger(request.itemId))throw Error('请选择有效装备。');
 const {instance,template}=upgradeTarget(p,request.slot,request.itemId);
 if(request.fingerprint!==fingerprint(instance))throw Error('装备已变化，请重新选择后合成。');
 const next=structuredClone(p),target=next.inventory.find(i=>i.slot===request.slot);
 if(request.mode==='attribute'){
   const range=compositionRanges(template).find(r=>r.field===request.field),option=range?.options.find(o=>o.power===request.power);
   if(!option||!Number.isInteger(request.value)||request.value<option.min||request.value>option.max)throw Error('请选择这件装备已有的合成属性，并填写范围内的整数。');
   target.affixes??={};target.affixes[range.field]={power:option.power,value:request.value};
 }else if(request.mode==='skill'){
   const skill=compositionSkills(template).find(s=>s.id===request.skillId&&s.level===request.level);
   if(!skill)throw Error('这件装备不支持所选技能等级。');
   target.combinedSkill={id:skill.id,level:skill.level};
 }else throw Error('无效合成操作。');
 itemWithAffixes(template,target);
 if(next.pendingIdentification?.slot===target.slot)delete next.pendingIdentification;
 reconcileSkillSettings(next);clampVitals(next);
 return {next,item:target};
}
export function planVip(p,level){
 if(!Number.isInteger(level)||level<0||level>VIP_MAX)throw Error(`VIP等级范围为0–${VIP_MAX}。`);
 const next=structuredClone(p);next.vipLevel2=level;clampVitals(next);return {next};
}
