import {randomBytes} from 'node:crypto';
import {official,officialItems} from './official-data.mjs';
import {Writer} from './codec.mjs';
import {skillBytes} from './character-import-codec.mjs';

export const PET_EQUIPMENT_MAX_LEVEL=100,PET_EQUIPMENT_LEVEL_XP=10000,PET_EQUIPMENT_SLOTS=8;
export const petEquipmentFields=['power1','power2','power3','bindPower1','bindPower2','power4','power5','power6','power7'];
export const petEquipmentValue=field=>field.replace('Power','PowerValue').replace(/^power/,'powerValue');
const ranges=new Map(official.identification.map(r=>[r.itemId,r.slots]));
const validUid=id=>typeof id==='string'&&/^[1-9]\d{0,18}$/.test(id)&&BigInt(id)<=0x7fffffffffffffffn;
const newUid=()=>((randomBytes(8).readBigUInt64BE()&0x3fffffffffffffffn)+1n).toString();
export const petEquipmentScale=level=>Math.max(1,level/5);

// Preview IDs belong to shop samples. Every owned copy receives its own identity.
export function ensurePetEquipment(instance,template=officialItems.get(instance?.itemId)){
 if(template?.type!==41)return instance;
 const source=instance.recordedDefinition||template;
 if(!instance.petEquipment)instance.petEquipment={uid:newUid(),level:Math.max(1,Math.min(100,source.petLevel||1)),exp:Math.max(0,source.petEquipExp||0)};
 const state=instance.petEquipment;
 if(!validUid(state.uid))state.uid=newUid();
 if(!Number.isInteger(state.level)||state.level<1||state.level>100||!Number.isSafeInteger(state.exp)||state.exp<0)throw Error('宠物装备等级或经验存档无效。');
 // Existing experience is retained; it is settled using the new curve on upgrade.
 return instance;
}
export function normalizePetEquipment(owner){
 const seen=new Set();
 const visit=item=>{ensurePetEquipment(item);if(item.petEquipment){if(seen.has(item.petEquipment.uid))item.petEquipment.uid=newUid();seen.add(item.petEquipment.uid);}};
 for(const item of owner.inventory||[]){visit(item);for(const gear of item.pet?.equipment||[])visit(gear);}
 return owner;
}
export function petEquipmentDefinition(template,instance){
 ensurePetEquipment(instance,template);
 const state=instance.petEquipment,source=instance.recordedDefinition||template;
 if(source.id!==instance.itemId||source.type!==41)throw Error('宠物装备定义不匹配。');
 const e={...source,native:true},scale=petEquipmentScale(state.level),originalScale=petEquipmentScale(source.petLevel||1);
 for(const field of petEquipmentFields){
  const value=petEquipmentValue(field),affix=instance.affixes?.[field];
  if(affix){
   const option=ranges.get(e.id)?.find(r=>r.field===field)?.options.find(o=>o.power===affix.power);
   if(!option||!Number.isInteger(affix.value)||affix.value<option.min||affix.value>option.max)throw Error('宠物装备鉴定属性超出范围。');
   e[field]=affix.power;e[value]=Math.max(-32768,Math.min(32767,Math.ceil(affix.value*scale)));
  }else if(e[field]&&![121,131].includes(e[field]))e[value]=Math.max(-32768,Math.min(32767,Math.ceil((source[value]||0)*scale/originalScale)));
 }
 for(const key of ['def_str','def_agi','def_mag'])e[key]=Math.min(32767,Math.ceil((source[key]||0)*scale/originalScale));
 e.petLevel=state.level;e.petEquipExp=state.level===100?0:state.exp;e.petUid=state.uid;
 // The requested level-100 bonus is +4. Keep earlier levels/recorded bonuses
 // unchanged, so this update does not rewrite an existing lower-level build.
 e.petEquipSkillLevel=state.level===100?4:Math.min(4,Math.max(source.petEquipSkillLevel||0,Math.floor(state.level/50)));
 // The native description appends the bonus. Its old "+1级" is preview text.
 if(e.skill)e.skillDesc=e.skill.name;
 e.definitionBase64=petEquipmentBytes(e).toString('base64');
 e.powers=[1,2,3].filter(n=>e['power'+n]).map(n=>[e['power'+n],e['powerValue'+n]]);
 return e;
}
export function petEquipmentBytes(e){
 const w=new Writer().byte(41).bool(false).int(e.id).string(e.name).int(e.bagIcon).string(e.info)
 .byte(e.grade).byte(e.autoBinding).byte(e.stackNum||1).bool(e.decomCHest).short(e.icon).short(e.ownTime||0).int(e.durMax).int(e.price).byte(e.attachCount).byte(e.itemSet).byte(e.reqLv);
 for(const key of ['reqStr','reqCon','reqAgi','reqIlt','reqWis','def_str','def_agi','def_mag'])w.short(e[key]||0);
 for(const n of [1,2,3])w.short(e['power'+n]||0).short(e['powerValue'+n]||0);
 w.bool(!!e.skill);if(e.skill)w.raw(skillBytes(e.skill,true));
 w.byte(e.combinUpSkillList?.length||0);for(const s of e.combinUpSkillList||[])w.raw(skillBytes(s,true));
 w.string(e.skillDesc).short(e.bindPower1||0).short(e.bindPowerValue1||0).short(e.bindPower2||0).short(e.bindPowerValue2||0).byte(e.ascensionStar||0).byte(e.star||0).byte(e.hitrate||0).byte(e.vipLevelReq||0);
 for(const n of [1,2])w.short(e['enchantPower'+n]||0).short(e['enchantPowerValue'+n]||0);
 w.bool(e.isUpgradeItem);if(e.isUpgradeItem)for(const n of [4,5,6,7])w.short(e['power'+n]||0).short(e['powerValue'+n]||0);
 return w.byte(e.upgradeAscensionStar||0).byte(e.upgradeStar||0).short(e.petLevel).int(e.petEquipExp).short(e.petLowLevel||1).long(e.petUid).byte(e.petEquipSkillLevel||0).done();
}
