import fs from 'node:fs';
import {Writer} from './codec.mjs';
import {protobuf} from '../tools/capture-decoders.mjs';
import {encodeWithSchema} from './feature-protobuf.mjs';
import {spiritData,spiritRunes,spiritRules,validateSpiritPowers} from './spirit-seal-data.mjs';
import {equipment,firstFree,clampVitals} from './restoration.mjs';
import {itemWithAffixes} from './item-affixes.mjs';
import {upgradeTarget} from './equipment-upgrades.mjs';
import {commitPetEquipment,pushPetEquipmentChanges} from './pet-equipment-service.mjs';
import {itemPacket} from './restoration-packets.mjs';
import {moneyUpdate} from './game-packets.mjs';
const schemas=JSON.parse(fs.readFileSync(new URL('../data/spirit-seal-schemas.json',import.meta.url),'utf8'));
export const encodeSpirit=(type,value)=>encodeWithSchema(type,value,schemas);
export const decodeSpirit=(type,bytes)=>protobuf(bytes,type,schemas);
export const spiritEligible=e=>e?.type>=0&&e.type<=10&&e.native;
export function pushSpiritInfo(send){send(30100,encodeSpirit('s2c_SealInfo',{...spiritData.info,chisealCostGold:0,setUpCostGold:0,takeOffCostGold:0,absorbValue:0}));}
export function planSpiritSeal(p,action,request){
 const {equipSlotPos:slot,equipItemId:id,sealPos}=request,side=({1:'Left',2:'Right'})[sealPos];
 if(!Number.isInteger(slot)||slot<0||!Number.isInteger(id)||id<1)throw Error('装备位置或编号无效。');
 if(!side)throw Error('请选择有效的左右赋灵槽。');
 const {instance,template}=upgradeTarget(p,slot,id),effective=itemWithAffixes(template,instance);
 if(!spiritEligible(effective))throw Error('请选择人物防具或首饰进行赋灵。');
 const next=structuredClone(p),target=next.inventory.find(i=>i.slot===slot),existing=effective['css'+side+'HasItem'];
 let cost=0;
 target.spiritSeals??={};
 if(action==='open'){
  if(effective['css'+side+'Channel'])throw Error('这个赋灵槽已经开启。');
  target.spiritSeals[side]={open:true,basePercent:spiritData.basePercent[side],item:null};
 }else{
  if(!effective['css'+side+'Channel'])throw Error('请先免费开启这个赋灵槽。');
  const seal=target.spiritSeals[side]??={open:true,basePercent:effective['css'+side+'PowerPer'],item:existing?{itemId:effective['css'+side+'ItemId'],powers:structuredClone(effective['css'+side+'ItemPower'])}:null};
  if(action==='install'){
   if(existing)throw Error('请先取下此槽位的赋灵符。');
   const rune=next.inventory.find(i=>i.slot===request.costItemPos&&i.itemId===request.costItemId&&!i.pet),definition=spiritRunes.get(rune?.itemId);
   if(!rune||rune.slot<30||rune.quantity<1||!definition)throw Error('背包中的赋灵符已变化。');
   cost=spiritRules.installCoins;
   if(!Number.isSafeInteger(next.coins)||next.coins<cost)throw Error('铜币不足，装入一枚赋灵符需要100万铜币。');
   seal.item={itemId:rune.itemId,powers:validateSpiritPowers(rune.spiritRune?.powers||definition.powers),bound:!!rune.bound};
   rune.quantity--;next.inventory=next.inventory.filter(i=>i.quantity!==0);next.coins-=cost;
  }else if(action==='remove'){
   if(!existing||!seal.item)throw Error('这个槽位没有赋灵符。');
   const free=firstFree(next);if(!Number.isInteger(free)||free<30)throw Error('背包已满，请先腾出一格。');
   next.inventory.push({itemId:seal.item.itemId,slot:free,quantity:1,bound:!!seal.item.bound,spiritRune:{powers:structuredClone(seal.item.powers)}});seal.item=null;
  }else throw Error('无效赋灵操作。');
 }
 itemWithAffixes(template,target);clampVitals(next);return {next,item:target,side,cost};
}
export function handleSpiritSeals(type,r,context,{store,send,log}){
 if(!context.role||![30101,30103,30105].includes(type))return false;
 const role=context.role;
 try{
  if(context.battle)throw Error('请先结束战斗再进行装备赋灵。');
  const name=({30101:'ChiselSeal',30103:'SealSetUp',30105:'SealTakeOff'})[type],request=decodeSpirit('c2s_'+name,r.b.subarray(r.pos));
  const before=structuredClone(role),result=planSpiritSeal(role,({30101:'open',30103:'install',30105:'remove'})[type],request),e=itemWithAffixes(equipment.get(result.item.itemId),result.item),response={...request};
  if(type===30101)response.addBasePower=e['css'+result.side+'PowerPer'];
  if(type===30103)Object.assign(response,{costItemGrade:e['css'+result.side+'ItemGrade'],costItemIcon:e['css'+result.side+'ItemIcon'],attrs:Object.entries(e['css'+result.side+'ItemPower']).map(([k,v])=>({k:Number(k),v}))});
  const packet=encodeSpirit('s2c_'+name,response);commitPetEquipment(role,result.next,store);pushPetEquipmentChanges(before,role,send);
  if(result.item.slot<30)send(17603,itemPacket(new Writer().short(result.item.slot),result.item));
  if(result.cost)send(11004,moneyUpdate(role,-result.cost));
  send(type+1,packet);log('equipment-spirit',{role:role.id,type,slot:result.item.slot,itemId:result.item.itemId,side:result.side,coins:result.cost,free:result.cost===0});
 }catch(error){send(10509,new Writer().byte(2).string(error.message));log('equipment-spirit-rejected',{role:role.id,type,error:error.message});}
 return true;
}
