import {randomInt,createHash} from 'node:crypto';
import {equipment,clampVitals} from './restoration.mjs';
import {itemSlots} from './official-data.mjs';
import {canIdentify,identifySlots,canUpgradeIdentify,upgradeIdentifySlots,itemWithAffixes,gemAttachment,gemCapacity,upgradeRules} from './item-affixes.mjs';
import {starLimit,advancedStarLimit} from './equipment-policy.mjs';
import {findPetEquipment,refreshPetEquipmentVitals} from './pet-equipment-actions.mjs';
import {ensurePetEquipment} from './pet-equipment-data.mjs';

export const fingerprint=i=>createHash('sha256').update(JSON.stringify(i)).digest('hex');
export function upgradeTarget(p,slot,id){
  const instance=p.inventory.find(i=>i.slot===slot),template=equipment.get(instance?.itemId)||instance?.recordedDefinition;
  if(!instance||instance.pet||!template?.native||!itemSlots(template.type).length||(instance.quantity||1)!==1||(id!==undefined&&id!==instance.itemId))throw Error('请选择一件有效的人物装备。');
  gemAttachment(itemWithAffixes(template,instance),instance);
  return {instance,template};
}
function consume(p,ids,slot){
  const item=p.inventory.find(i=>i.slot>=30&&ids.includes(i.itemId)&&(slot===undefined||slot===i.slot)&&(i.quantity||1)>0);
  if(!item)throw Error('背包中没有对应材料，请到新月繁华之都（20,18）的装备与补给商人处领取。');
  const used={itemId:item.itemId,slot:item.slot,quantity:1};item.quantity=(item.quantity||1)-1;
  p.inventory=p.inventory.filter(i=>i.quantity!==0);return used;
}
export function identificationList(p,scroll,upgrade=false){
  const star=upgrade&&upgradeRules.advanced.starScrolls.includes(scroll),ids=upgrade?(star?upgradeRules.advanced.starScrolls:upgradeRules.advanced.identifyScrolls):upgradeRules.identify.scrolls;
  if(!ids.includes(scroll))throw Error('请使用对应的普通鉴定卷轴或进阶卷轴。');
  if(!p.inventory.some(i=>i.slot>=30&&i.itemId===scroll&&i.quantity>0))throw Error('鉴定卷轴不足。');
  return p.inventory.filter(i=>{if(i.slot<30||i.pet)return false;const template=equipment.get(i.itemId);if(!upgrade)return canIdentify(template);if(!star)return canUpgradeIdentify(template);const e=itemWithAffixes(template,i);return advancedStarLimit(e)>0&&(e.upgradeStar||0)<advancedStarLimit(e);}).map(i=>i.slot);
}
// Plans are detached from the live role. No failed validation can spend items.
export function identificationTarget(p,slot,id,uid){
 if(uid!==undefined){
  const target=findPetEquipment(p,uid),wireSlot=target.petItem?-target.instance.slot-1:target.instance.slot;
  if(wireSlot!==slot||(id!==undefined&&id!==target.instance.itemId))throw Error('宠物装备已移动，请重新打开详情。');
  return target;
 }
 const item=p.inventory.find(i=>i.slot===slot);
 if(equipment.get(item?.itemId)?.type===41){ensurePetEquipment(item);return identificationTarget(p,slot,id,item.petEquipment.uid);}
 return upgradeTarget(p,slot,id);
}
export function planIdentification(p,slot,scroll,draw=randomInt,uid,upgrade=false){
  const {instance,template,petItem}=identificationTarget(p,slot,undefined,uid);
  if(slot<30&&template.type!==41)throw Error('请先卸下装备再鉴定。');
  if(!(upgrade?canUpgradeIdentify(template):canIdentify(template)))throw Error(`此装备没有已采集的${upgrade?'进阶':'普通'}鉴定范围。`);
  const next=structuredClone(p),candidate=structuredClone(instance),field=upgrade?'upgradeAffixes':'affixes';candidate[field]??={};
  for(const range of (upgrade?upgradeIdentifySlots(template):identifySlots(template))){
    const options=range.options.filter(o=>Number.isInteger(o.min)&&Number.isInteger(o.max)&&o.min<=o.max&&o.min>=-32768&&o.max<=32767);
    if(!options.length)throw Error('该装备鉴定范围不完整。');
    const option=options[draw(options.length)];
    // candidate[field][range.field]={power:option.power,value:option.min+draw(option.max-option.min+1)};
    // FIX：进阶鉴定要写 upgradeAffixes，普通鉴定写 affixes。
    // 原实现写死 candidate.affixes，进阶时该字段不存在，会抛
    // "Cannot set properties of undefined (setting 'power4')"。
    candidate[field][range.field]={power: option.power,value: option.max};
  }
  itemWithAffixes(template,candidate);
  const allowed=upgrade?upgradeRules.advanced.identifyScrolls:upgradeRules.identify.scrolls,ids=scroll===undefined?allowed:[scroll];
  if(ids.some(id=>!allowed.includes(id)))throw Error('无效鉴定卷轴。');
  const consumed=consume(next,ids);
  next.pendingIdentification={slot,itemId:instance.itemId,fingerprint:fingerprint(instance),candidate,upgrade,...(template.type===41?{uid:instance.petEquipment.uid,petUid:petItem?.pet.uid}: {})};
  return {next,candidate,consumed};
}
export function planAcceptIdentification(p,mode,slot,id,accept,upgrade){
  const pending=p.pendingIdentification,{instance,template,petItem}=identificationTarget(p,slot,id,pending?.uid);
  if(mode!==1||!pending||!!upgrade!==!!pending.upgrade||pending.slot!==slot||pending.itemId!==id||pending.fingerprint!==fingerprint(instance)||(pending.uid&&pending.petUid!==petItem?.pet.uid))throw Error('鉴定结果已失效，请重新选择装备。');
  const next=structuredClone(p);
  if(accept){itemWithAffixes(template,pending.candidate);if(pending.uid)Object.assign(findPetEquipment(next,pending.uid).instance,structuredClone(pending.candidate));else next.inventory[next.inventory.findIndex(i=>i.slot===slot)]=structuredClone(pending.candidate);}
  delete next.pendingIdentification;clampVitals(next);refreshPetEquipmentVitals(p,next);return {next};
}
export function planStar(p,slot,id,draw=randomInt){
  const {instance,template}=upgradeTarget(p,slot,id),star=itemWithAffixes(template,instance).star||0;
  if(!template.ascensionStar)throw Error('这件装备不能强化升星。');
  if(!(instance.bound||template.autoBinding))throw Error('请先装备绑定再强化，星级属性需要绑定才生效。');
  const limit=starLimit(template);if(star>=limit)throw Error(`已达到这件装备的强化上限${limit}星。`);
  const next=structuredClone(p),target=next.inventory.find(i=>i.slot===slot),success=draw(100)<upgradeRules.star.successRate;target.star=star+(success?1:0);
  itemWithAffixes(template,target);
  const consumed=consume(next,[upgradeRules.star.scroll]);clampVitals(next);
  return {next,item:target,consumed,success};
}
export function starPreview(p,slot,id,mode=1){
  const {instance,template}=upgradeTarget(p,slot,id),star=itemWithAffixes(template,instance).star||0;
  if(!template.ascensionStar)throw Error('这件装备不能强化升星。');
  if(!(instance.bound||template.autoBinding))throw Error('请先装备绑定再强化，星级属性需要绑定才生效。');
  const limit=starLimit(template);if(mode!==3&&star>=limit)throw Error(`已达到这件装备的强化上限${limit}星。`);
  const candidate={...instance,star:mode===3?star:star+1},available=p.inventory.filter(i=>i.slot>=30&&i.itemId===upgradeRules.star.scroll).reduce((n,i)=>n+(i.quantity||1),0);
  return {item:itemWithAffixes(template,candidate),candidate,available,limit,successRate:upgradeRules.star.successRate,fingerprint:fingerprint(instance)};
}
export function advancedStarPreview(p,slot,id,mode=1){
  const {instance,template}=upgradeTarget(p,slot,id),current=itemWithAffixes(template,instance),star=current.upgradeStar||0,limit=advancedStarLimit(current);
  if(!limit)throw Error('请先使用进阶鉴定卷轴鉴定这件装备。');
  if(!(instance.bound||current.autoBinding))throw Error('请先装备绑定再进阶强化，星级属性需要绑定才生效。');
  if(mode!==3&&star>=limit)throw Error(`已达到这件装备的进阶强化上限${limit}星。`);
  const candidate={...instance,upgradeStar:mode===3?star:star+1},available=p.inventory.filter(i=>i.slot>=30&&upgradeRules.advanced.starScrolls.includes(i.itemId)).reduce((n,i)=>n+(i.quantity||1),0);
  return {item:itemWithAffixes(template,candidate),candidate,available,limit,currentStar:star,upgrade:true,successRate:upgradeRules.advanced.successRate,fingerprint:fingerprint(instance)};
}
export function planAdvancedStar(p,slot,id,draw=randomInt){
  const preview=advancedStarPreview(p,slot,id),next=structuredClone(p),target=next.inventory.find(i=>i.slot===slot),success=draw(100)<preview.successRate;
  target.upgradeStar=preview.currentStar+(success?1:0);
  itemWithAffixes(equipment.get(target.itemId)||target.recordedDefinition,target);
  const consumed=consume(next,upgradeRules.advanced.starScrolls);clampVitals(next);
  return {next,item:target,consumed,success};
}
export function planGem(p,slot,gemSlot,draw=randomInt){
  const {instance,template}=upgradeTarget(p,slot),gem=p.inventory.find(i=>i.slot===gemSlot),definition=equipment.get(gem?.itemId);
  if(gemSlot<30||!gem||definition?.type!==30||!definition.power1||definition.powerValue1<=0||definition.power2||definition.power3)throw Error('请选择背包中的有效宝石。');
  const attachment=instance.gemBroken?{count:0,power:0,value:0}:gemAttachment(template,instance);
  if(attachment.count>=gemCapacity(template,instance))throw Error('这件装备的宝石孔已满，或不能镶嵌宝石。');
  if(attachment.power&&attachment.power!==definition.power1)throw Error('同一装备只能镶嵌相同属性的宝石。');
  const next=structuredClone(p),target=next.inventory.find(i=>i.slot===slot),restarted=!!instance.gemBroken;
  if(restarted)target.gems=[];else target.gems??=[];
  const success=attachment.count<upgradeRules.gem.guaranteed||draw(100)<upgradeRules.gem.successRate;
  if(success){const same=target.gems.find(g=>g.itemId===gem.itemId);if(same)same.quantity++;else target.gems.push({itemId:gem.itemId,quantity:1});}
  target.gemBroken=!success;
  const result=gemAttachment(template,target),consumed=consume(next,[gem.itemId],gemSlot);clampVitals(next);
  return {next,item:target,attachment:result,consumed,success,restarted};
}

// ---- 宝石替换 ---------------------------------------------------------------
// 原版客户端（BagItemAttachMdr / BagItemAttachChangeMdr）本来就有「宝石替换」：
//   点装备 → 镶嵌 → 面板上多一条「宝石替换」（条件是下面 replaceGemMinValue &&
//   isReplaceInlayGem），进去选一颗新宝石，确认后把整件装备的宝石换成新属性。
// 规则（客户端 isReplaceInlayGem / getCanChangeAttachGemItemList / STR_ATTACH_CAN_REPLACE_INFO）：
//   · 装备宝石的基础属性总和 ≥ 20 时才允许替换（文案：当装备宝石基础属性超过 20 时，可用其他宝石替换）；
//   · 只有提升五维（力量/体质/敏捷/智力/感知）的宝石可以替换，生命、魔法宝石不在其中；
//   · 新宝石同样是五维宝石，且不能用 +1 档（+1 太便宜，原版专门排除了它）；
//   · 替换消耗 2×已镶颗数 颗新宝石；替换后颗数不变，属性按新宝石重算。
// 服务端原来完全没有接 11507/11508，所以按钮点下去没有任何反应。
export const replaceGemMinValue=20;
export const replaceGemPowers=new Set([1,3,5,7,9]);
function replaceGemTarget(p,slot,id,gemSlot){
  const {instance,template}=upgradeTarget(p,slot,id);
  const attachment=gemAttachment(template,instance);
  if(!attachment.count)throw Error('这件装备还没有镶嵌宝石，不能替换。');
  if(!replaceGemPowers.has(attachment.power))throw Error('只有提升力量、体质、敏捷、智力、感知的宝石可以替换。');
  if(attachment.value<replaceGemMinValue)throw Error(`装备宝石的基础属性超过 ${replaceGemMinValue} 才能替换。`);
  const gem=p.inventory.find(i=>i.slot===gemSlot),definition=gem&&equipment.get(gem.itemId);
  if(gemSlot<30||!gem||definition?.type!==30||!definition.power1||definition.power2||definition.power3)throw Error('请选择背包中的有效宝石。');
  if(!replaceGemPowers.has(definition.power1))throw Error('只有提升力量、体质、敏捷、智力、感知的宝石可以用于替换。');
  if(definition.powerValue1===1)throw Error('+1 宝石不能用于替换，请选择 +2 以上的宝石。');
  return {instance,template,gem,definition,attachment};
}
// 固定按背包槽位从小到大取，报价和确认两次算出来的清单必然一致。
function gemReplaceRows(p,itemId,need){
  const rows=[];
  for(const item of p.inventory.filter(i=>i.slot>=30&&i.itemId===itemId&&(i.quantity||1)>0).sort((a,b)=>a.slot-b.slot)){
    if(need<=0)break;
    const take=Math.min(need,item.quantity||1,255);
    rows.push({slot:item.slot,quantity:take});need-=take;
  }
  return {rows,missing:need};
}
export function gemReplaceQuote(p,slot,id,gemSlot){
  const target=replaceGemTarget(p,slot,id,gemSlot),need=target.attachment.count*2;
  const {rows,missing}=gemReplaceRows(p,target.gem.itemId,need);
  return {...target,need,rows,missing};
}
export function planGemReplace(p,slot,id,gemSlot,rows){
  const quote=gemReplaceQuote(p,slot,id,gemSlot);
  if(quote.missing>0)throw Error(`替换需要 ${quote.need} 颗「${quote.definition.name}」，背包里只有 ${quote.need-quote.missing} 颗。`);
  if(!Array.isArray(rows)||rows.length!==quote.rows.length||rows.some((row,n)=>row.slot!==quote.rows[n].slot||row.quantity!==quote.rows[n].quantity))throw Error('替换材料已变化，请重新打开宝石替换。');
  const next=structuredClone(p),target=next.inventory.find(i=>i.slot===slot);
  target.gems=[{itemId:quote.gem.itemId,quantity:quote.attachment.count}];
  target.gemBroken=false;
  let consumed=0;
  for(const row of quote.rows){
    const entry=next.inventory.find(i=>i.slot===row.slot);
    if(!entry||entry.itemId!==quote.gem.itemId||(entry.quantity||1)<row.quantity)throw Error('替换材料已变化，请重新打开宝石替换。');
    entry.quantity-=row.quantity;consumed+=row.quantity;
  }
  // 用完的槽位必须整条删掉。这里**不能**写成 (i.quantity||1)!==0：
  // quantity 是 0 时 (0||1) 得 1，表达式恒为真，等于没过滤 —— 于是背包里会留下
  // 一条数量为 0 的宝石，客户端按 1 颗显示，但镶嵌时服务端要求 (quantity||1)>0、
  // 出售时数量也对不上，表现就是「剩下一颗既不能镶嵌也不能出售」的幽灵宝石。
  next.inventory=next.inventory.filter(i=>i.quantity!==0);
  clampVitals(next);
  const attachment=gemAttachment(equipment.get(target.itemId)||target.recordedDefinition,target);
  return {next,item:target,gem:quote.gem,attachment,consumed,replaced:quote.attachment};
}
