import {Writer} from './codec.mjs';
import {enchantments} from './enchantment-data.mjs';
import {equipment,clampVitals} from './restoration.mjs';
import {itemWithAffixes} from './item-affixes.mjs';
import {itemPacket} from './restoration-packets.mjs';
import {healthUpdate} from './game-packets.mjs';
export const enchantable=i=>!i.pet&&((i.recordedDefinition||equipment.get(i.itemId))?.type>=0)&&((i.recordedDefinition||equipment.get(i.itemId)).type<=24||[34,35,36,37,38,39].includes((i.recordedDefinition||equipment.get(i.itemId)).type));
export function applyEnchantment(p,slot,id,cardSlot,cardId){
 const target=p.inventory.find(i=>i.slot===slot&&i.itemId===id),card=p.inventory.find(i=>i.slot===cardSlot&&i.itemId===cardId&&!i.pet);
 if(!target||!enchantable(target))throw Error('请选择身上或背包中的装备。');
 if(!card||cardSlot<30||card.quantity<1||!enchantments.has(cardId))throw Error('附魔道具已变化，请重新打开背包。');
 const next={...target,enchantment:{itemId:cardId}};
 // Validate and serialize before consuming the card. Replacing an enchantment
 // preserves bindings, sockets, stars, skills and captured item definitions.
 itemWithAffixes(equipment.get(id),next);
 p.inventory=p.inventory.flatMap(i=>i===target?[next]:i===card?(i.quantity>1?[{...i,quantity:i.quantity-1}]:[]):[i]);
 return next;
}
export function handleEnchantment(type,r,context,{store,send,log}){
 if(![11520,11521].includes(type)||!context.role)return false;
 const p=context.role,before=structuredClone(p);let committed=false;
 try{
  if(context.battle)throw Error('请先结束战斗再附魔。');
  if(type===11521){
   const id=r.int();if(!enchantments.has(id)||!p.inventory.some(i=>i.itemId===id&&i.slot>=30&&i.quantity>0&&!i.pet))throw Error('背包中没有这件附魔道具。');
   const list=p.inventory.filter(enchantable),reply=new Writer().byte(0).short(list.length);for(const item of list)reply.short(item.slot).int(item.itemId);send(type,reply);return true;
  }
  const target=applyEnchantment(p,r.short(),r.int(),r.short(),r.int());clampVitals(p);
  const reply=itemPacket(new Writer().byte(0),target).int(p.enchantValue||0),update=healthUpdate(p);
  // The native reply updates the target and consumes one card locally. Sending
  // a full bag snapshot in the same turn races that callback and consumes twice.
  store.save();committed=true;send(type,reply);send(17601,update);log('equipment-enchanted',{role:p.id,slot:target.slot,itemId:target.itemId,enchantment:target.enchantment.itemId});
 }catch(error){
  if(!committed){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);}
  send(type,new Writer().byte(-1).string(error.message));log('enchantment-rejected',{role:p.id,type,error:error.message,committed});
 }
 return true;
}
