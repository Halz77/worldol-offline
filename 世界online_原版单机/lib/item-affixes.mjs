import fs from 'node:fs';
import {petEquipmentDefinition} from './pet-equipment-data.mjs';
import crypto from 'node:crypto';
import {official} from './official-data.mjs';
import {Writer} from './codec.mjs';
import {starRules,gemRules,starLimit,advancedRules,advancedStarLimit} from './equipment-policy.mjs';
import {finishEquipment} from './character-import-codec.mjs';
import {enchantmentFields} from './enchantment-data.mjs';
import {spiritRuneDefinition,applySpiritSeals} from './spirit-seal-data.mjs';

const layouts=JSON.parse(fs.readFileSync(new URL('../data/item-affix-layouts.json',import.meta.url),'utf8'));
const manualGrants=JSON.parse(fs.readFileSync(new URL('../data/manual-item-grants.json',import.meta.url),'utf8'));
const ranges=new Map((official.identification||[]).map(row=>[row.itemId,row.slots]));
const allowed=new Set(['power1','power2','power3','bindPower1','bindPower2']);
const valueField=field=>field.replace('Power','PowerValue').replace(/^power/,'powerValue');
export const upgradeRules={...JSON.parse(fs.readFileSync(new URL('../data/equipment-upgrade-rules.json',import.meta.url),'utf8')),version:'equipment-upgrades-v3',star:starRules,gem:gemRules,advanced:advancedRules};
const starExcluded=new Set(upgradeRules.starExcludedPowers);
export const isStarPower=power=>!starExcluded.has(power);
export const identifySlots=template=>(ranges.get(template?.id)||[]).filter(slot=>upgradeRules.identify.fields.includes(slot.field)&&template[slot.field]===121&&slot.options?.length);
export const canIdentify=template=>(template?.type===41||!!layouts.items[String(template?.id)])&&identifySlots(template).length>0;
export const upgradeIdentifySlots=template=>(ranges.get(template?.id)||[]).filter(slot=>/^power[4-7]$/.test(slot.field)&&slot.options?.length);
export const canUpgradeIdentify=template=>!!layouts.items[String(template?.id)]&&upgradeIdentifySlots(template).length>0;
export const upgradeIdentifyItemIds=[...ranges.keys()].filter(id=>canUpgradeIdentify({id}));
export const compositionRanges=template=>(ranges.get(template?.id)||[]).filter(slot=>allowed.has(slot.field)&&template[slot.field]===131&&slot.options?.length);
export const compositionSkills=template=>template?.combinUpSkillList?.filter(s=>layouts.items[template.id]?.combinationSkill?.options.some(o=>o.id===s.id&&o.level===s.level))||[];
export function nativeEquipmentSkill(template){if(template?.imported&&template.skill?.wireBase64)return template.skill;const wire=layouts.items[template?.id]?.nativeSkillWireBase64;return template?.skill&&wire?{...template.skill,wireBase64:Buffer.concat([Buffer.from(wire,'base64'),Buffer.from([0])]).toString('base64')}:null;}
export function starValue(value,ascension,star,bound,power){
  if(!bound||!ascension||!star||(power!==undefined&&!isStarPower(power)))return value||0;
  return Math.min(32767,(value||0)+Math.trunc((Math.abs(value||0)*ascension*star+500)/1000));
}
const gemDefinitions=new Map(official.items.filter(i=>i.type===30).map(i=>[i.id,i]));
export function gemCapacity(template,instance){
 const count=instance?.socketCapacity;
 if(count===undefined)return template?.attachCount||0;
 if(count!==30||template?.attachCount===undefined)throw Error('无效的单机宝石孔数。');
 return Math.max(count,template.attachCount);
}
export function gemAttachment(template,instance){
  let count=0,power=0,value=0;
  for(const row of instance?.gems||[]){
    const gem=row.grant?manualGrants.gems[row.grant]:gemDefinitions.get(row.itemId);
    if(!gem||!Number.isInteger(row.quantity)||row.quantity<1||!gem.power1||gem.powerValue1<=0||gem.power2||gem.power3)throw Error('无效的宝石存档。');
    if(power&&power!==gem.power1)throw Error('同一装备只能镶嵌相同属性的宝石。');
    count+=row.quantity;power=gem.power1;value+=gem.powerValue1*row.quantity;
  }
  if(count>gemCapacity(template,instance)||value>32767)throw Error('宝石数量超出装备上限。');
  return {count,power,value};
}
export function equipmentPowers(template,instance){
  const e=itemWithAffixes(template,instance),bound=!!(e.autoBinding||instance.bound),rows=[];
  for(const field of ['power1','power2','power3',...(bound?['bindPower1','bindPower2']:[])])if(e[field])rows.push([e[field],starValue(e[valueField(field)],e.ascensionStar,e.star,bound,e[field])]);
  if(bound&&e.isUpgradeItem)for(const n of [4,5,6,7])if(e['power'+n])rows.push([e['power'+n],starValue(e['powerValue'+n],e.upgradeAscensionStar,e.upgradeStar,bound,e['power'+n])]);
  for(const n of [1,2])if(e['enchantPower'+n])rows.push([e['enchantPower'+n],e['enchantPowerValue'+n]]);
  for(const side of ['Left','Right'])if(e['css'+side+'HasItem'])for(const [id,value] of Object.entries(e['css'+side+'ItemPower']||{}))if(Number(id)>0&&value)rows.push([Number(id),value]);
  const gem=gemAttachment(e,instance);if(gem.count)rows.push([gem.power,gem.value]);
  return rows;
}

// Apply public, range-checked affixes to one saved item instance. The original
// item catalogue and every ordinary copy retain their captured definitions.
function applyUpgradeFields(template,result,instance){
  if(instance.upgradeAffixes!==undefined){
    const affixes=instance.upgradeAffixes,slots=upgradeIdentifySlots(template);
    if(!canUpgradeIdentify(template)||!affixes||typeof affixes!=='object'||Array.isArray(affixes)||Object.keys(affixes).length!==slots.length)throw Error('无效进阶鉴定属性。');
    for(const slot of slots){
      const affix=affixes[slot.field],option=slot.options.find(o=>o.power===affix?.power);
      if(!option||!Number.isInteger(affix.value)||affix.value<option.min||affix.value>option.max)throw Error('进阶鉴定属性超出已录原版范围。');
      result[slot.field]=affix.power;result[valueField(slot.field)]=affix.value;
    }
    result.isUpgradeItem=true;
  }
  if(instance.upgradeStar!==undefined){
    if(!Number.isInteger(instance.upgradeStar)||instance.upgradeStar<0||!advancedStarLimit(result)||instance.upgradeStar>advancedStarLimit(result))throw Error('无效的装备进阶星级。');
    result.upgradeStar=instance.upgradeStar;
  }
}
export function itemWithAffixes(template,instance){
  if(template?.type===43)return spiritRuneDefinition(template,instance);
  if(template?.type===41||instance?.recordedDefinition?.type===41)return petEquipmentDefinition(template,instance);
  if(instance?.recordedDefinition){
    const captured=instance.recordedDefinition;if(captured.id!==instance.itemId||!captured.imported)throw Error('导入装备定义与物品不符。');
    const changes={...instance};delete changes.recordedDefinition;
    if(changes.star===captured.star)delete changes.star;
    if(changes.upgradeStar===captured.upgradeStar)delete changes.upgradeStar;
    if(!changes.affixes&&!changes.combinedSkill&&changes.star===undefined&&!changes.enchantment&&changes.socketCapacity===undefined&&!changes.upgradeAffixes&&changes.upgradeStar===undefined&&!changes.spiritSeals)return captured;
    // Validate subsequent workshop edits against the public catalogue, then
    // replace only edited fields. All other captured properties stay intact.
    const enchantment=changes.enchantment;delete changes.enchantment;
    const advanced={upgradeAffixes:changes.upgradeAffixes,upgradeStar:changes.upgradeStar};delete changes.upgradeAffixes;delete changes.upgradeStar;
    const spiritSeals=changes.spiritSeals;delete changes.spiritSeals;
    const updated=itemWithAffixes(template,changes),result={...captured};
    for(const field of Object.keys(changes.affixes||{})){result[field]=updated[field];result[valueField(field)]=updated[valueField(field)];}
    if(enchantment)Object.assign(result,enchantmentFields(enchantment.itemId));
    if(changes.socketCapacity!==undefined)result.attachCount=updated.attachCount;
    if(changes.combinedSkill){result.skill=updated.skill;result.skillDesc=updated.skillDesc;}
    if(changes.star!==undefined){
      result.star=updated.star;const spiritFactor=(100+(captured.cssLeftPowerPer||0)+(captured.cssRightPowerPer||0))/100;
      for(const key of ['def_str','def_agi','def_mag','atkMin','atkMax'])if(captured[key]!==undefined){
        const at=star=>Math.trunc(starValue(template[key],template.ascensionStar,star,!!(template.autoBinding||instance.bound))*spiritFactor);
        result[key]=Math.min(32767,captured[key]+at(changes.star)-at(captured.star));
      }
    }
    applyUpgradeFields(template,result,advanced);
    applySpiritSeals(result,{spiritSeals});
    return finishEquipment(result);
  }
  if(!instance?.affixes&&!instance?.combinedSkill&&!instance?.star&&!instance?.enchantment&&instance?.socketCapacity===undefined&&!instance?.upgradeAffixes&&instance?.upgradeStar===undefined&&!instance?.spiritSeals)return template;
  const layout=layouts.items[String(instance.itemId)];
  if(!template?.native||template.id!==instance.itemId||!layout)throw Error('此物品尚未核验独立鉴定属性。');
  let bytes=Buffer.from(template.definitionBase64,'base64');
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==layout.definitionSHA256)throw Error('物品定义已变化，请重新核验鉴定字段。');
  if(instance.affixes&&(typeof instance.affixes!=='object'||Array.isArray(instance.affixes)))throw Error('无效鉴定属性。');
  const result={...template};
  if(instance.socketCapacity!==undefined){
    const value=gemCapacity(template,instance),offset=layout.offsets.attachCount;
    if(!Number.isInteger(offset)||offset<0||offset>=bytes.length||bytes.readInt8(offset)!==template.attachCount)throw Error('宝石孔数字段位置不匹配。');
    bytes.writeInt8(value,offset);result.attachCount=value;
  }
  if(instance.enchantment){
    const fields=enchantmentFields(instance.enchantment.itemId);
    for(const [key,value] of Object.entries(fields)){
      const offset=layout.offsets[key];
      if(!Number.isInteger(value)||value<0||value>32767||!Number.isInteger(offset)||offset<0||offset+2>bytes.length||bytes.readInt16BE(offset)!==template[key])throw Error('装备附魔字段位置不匹配。');
      bytes.writeInt16BE(value,offset);result[key]=value;
    }
  }
  for(const [field,affix] of Object.entries(instance.affixes||{})){
    if(!allowed.has(field)||![121,131].includes(template[field]))throw Error('这项属性不能鉴定。');
    const option=ranges.get(template.id)?.find(slot=>slot.field===field)?.options.find(p=>p.power===affix?.power);
    if(!option||!Number.isInteger(affix.value)||affix.value<option.min||affix.value>option.max)throw Error('鉴定属性超出已录原版范围。');
    const values={[field]:affix.power,[valueField(field)]:affix.value};
    for(const [key,value] of Object.entries(values)){
      const offset=layout.offsets[key];
      if(!Number.isInteger(offset)||offset<0||offset+2>bytes.length||bytes.readInt16BE(offset)!==template[key])throw Error('鉴定字段位置不匹配。');
      bytes.writeInt16BE(value,offset);result[key]=value;
    }
  }
  if(instance.star!==undefined){
    if(!Number.isInteger(instance.star)||instance.star<0||instance.star>starLimit(template)||!template.ascensionStar)throw Error('无效的装备星级。');
    const offset=layout.offsets.star;
    if(!Number.isInteger(offset)||bytes[offset]!==template.star)throw Error('装备星级字段位置不匹配。');
    bytes[offset]=instance.star;result.star=instance.star;
    for(const key of ['def_str','def_agi','def_mag','atkMin','atkMax'])if(Number.isInteger(layout.offsets[key])){
      const value=starValue(template[key],template.ascensionStar,instance.star,!!(template.autoBinding||instance.bound));
      bytes.writeInt16BE(value,layout.offsets[key]);result[key]=value;
    }
  }
  if(instance.combinedSkill){
    const {id,level}=instance.combinedSkill,section=layout.combinationSkill;
    const option=section?.options.find(s=>s.id===id&&s.level===level);
    const skill=template.combinUpSkillList?.find(s=>s.id===id&&s.level===level);
    if(!option||!skill||bytes[section.flagOffset]!== (template.skill?1:0))throw Error('该合成技能等级没有已录原版定义。');
    const wire=Buffer.from(option.wireBase64,'base64');
    result.skill={...skill,wireBase64:Buffer.concat([wire,Buffer.from([0])]).toString('base64')};
    result.skillDesc=`${skill.name}+${skill.level}级`;
    // Patch later offsets first, then insert the actual item skill where the
    // original template carried only an absent-skill flag and a possible list.
    bytes=Buffer.concat([bytes.subarray(0,section.descOffset),new Writer().string(result.skillDesc).done(),bytes.subarray(section.descEnd)]);
    bytes=Buffer.concat([bytes.subarray(0,section.flagOffset),Buffer.from([1]),wire,bytes.subarray(section.skillEnd??section.flagOffset+1)]);
  }
  if(instance.upgradeAffixes!==undefined||instance.upgradeStar!==undefined){
    applyUpgradeFields(template,result,instance);
    // The v305 equipment definition ends with this optional four-power block.
    // Replacing the trailer also preserves variable-length skills/CSS above it.
    const tailSize=template.isUpgradeItem?19:3,offset=bytes.length-tailSize;
    if(offset<0||bytes[offset]!==Number(!!template.isUpgradeItem)||bytes.at(-2)!==(template.upgradeAscensionStar||0)||bytes.at(-1)!==(template.upgradeStar||0))throw Error('进阶属性字段位置不匹配。');
    const tail=new Writer().bool(result.isUpgradeItem);
    if(result.isUpgradeItem)for(const n of [4,5,6,7])tail.short(result['power'+n]||0).short(result['powerValue'+n]||0);
    bytes=Buffer.concat([bytes.subarray(0,offset),tail.byte(result.upgradeAscensionStar||0).byte(result.upgradeStar||0).done()]);
  }
  result.definitionBase64=bytes.toString('base64');
  result.powers=[1,2,3].filter(n=>result['power'+n]).map(n=>[result['power'+n],result['powerValue'+n]]);
  if(instance.spiritSeals)return finishEquipment(applySpiritSeals(result,instance));
  return result;
}
