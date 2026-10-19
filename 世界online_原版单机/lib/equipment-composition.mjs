import {equipment,clampVitals,reconcileSkillSettings} from './restoration.mjs';
import {compositionRanges,compositionSkills,identifyRanges,upgradeIdentifyRanges,itemWithAffixes} from './item-affixes.mjs';
import {upgradeTarget,fingerprint} from './equipment-upgrades.mjs';
import {localVipLevel,setState,equipmentSets,VIP_MAX,setAttributeData} from './equipment-sets.mjs';

export const COMPOSITION_LIST=90001,COMPOSITION_APPLY=90002,VIP_APPLY=90003;
export function workshopState(p){
 return {role:p.id,mode:'free',vipLevel:localVipLevel(p),vipMax:VIP_MAX,knownSets:equipmentSets.size,sets:setState(p),setAttributes:setAttributeData(p),items:(p.inventory||[]).filter(i=>!i.pet).flatMap(i=>{
   const e=equipment.get(i.itemId);if(!e?.native)return [];
   const ranges=compositionRanges(e),skills=compositionSkills(e),identify=identifyRanges(e),upgradeIdentify=upgradeIdentifyRanges(e);
   if(!ranges.length&&!skills.length&&!identify.length&&!upgradeIdentify.length)return [];
   const actual=itemWithAffixes(e,i);
   return [{slot:i.slot,itemId:i.itemId,name:e.name,bound:!!(i.bound||e.autoBinding),star:i.star||0,fingerprint:fingerprint(i),ranges,skills:skills.map(s=>({id:s.id,level:s.level,name:s.name,type:s.type})),identify,upgradeIdentify,affixes:i.affixes||{},upgradeAffixes:i.upgradeAffixes||{},currentSkill:actual.skill?{id:actual.skill.id,name:actual.skill.name,level:actual.skill.level}:null}];
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
 }else if(request.mode==='identify'){
   // 自选鉴定属性：每个鉴定格一个选项，普通与进阶各自整组写入（进阶要求四格齐全）。
   const slots=identifyRanges(template),advanced=upgradeIdentifyRanges(template);
   if(!Array.isArray(request.picks)||request.picks.length!==slots.length)throw Error('请为这件装备的每个鉴定格选择属性。');
   const collect=(rows,list,label)=>{const out={};for(const row of rows){
     const chosen=list.find(entry=>entry?.field===row.field),option=row.options.find(o=>o.power===chosen?.power);
     if(!option||!Number.isInteger(chosen.value)||chosen.value<option.min||chosen.value>option.max)throw Error(`${label}超出已录原版范围。`);
     out[row.field]={power:option.power,value:chosen.value};
   }return out;};
   if(slots.length)target.affixes={...target.affixes,...collect(slots,request.picks,'鉴定属性')};
   if(request.upgradePicks!==undefined){
     if(!advanced.length||!Array.isArray(request.upgradePicks)||request.upgradePicks.length!==advanced.length)throw Error('请为这件装备的每个进阶鉴定格选择属性。');
     target.upgradeAffixes=collect(advanced,request.upgradePicks,'进阶鉴定属性');
   }
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
