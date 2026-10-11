import {Writer} from './codec.mjs';
import {itemPacket} from './restoration-packets.mjs';
import {petDetail} from './pet-packets.mjs';
import {healthUpdate} from './game-packets.mjs';
import {petEquipmentFields,petEquipmentValue} from './pet-equipment-data.mjs';
import {decodePetEquipment,petEquipmentExperiencePacket} from './pet-equipment-protobuf.mjs';
import {planPetEquip,planPetOffEquip,planPetEquipmentUpgrade,previewPetEquipment} from './pet-equipment-actions.mjs';

export function pushPetEquipmentChanges(before,role,send){
 const previous=new Map(before.inventory.filter(i=>i.slot>=30).map(i=>[i.slot,i])),current=new Map(role.inventory.filter(i=>i.slot>=30).map(i=>[i.slot,i]));
 for(const slot of new Set([...previous.keys(),...current.keys()])){
  const old=previous.get(slot),item=current.get(slot);if(JSON.stringify(old)===JSON.stringify(item))continue;
  send(17603,itemPacket(new Writer().short(slot),item||{...old,slot:-1}));
 }
 for(const item of role.inventory.filter(i=>i.pet)){
  const old=before.inventory.find(i=>i.pet?.uid===item.pet.uid);if(JSON.stringify(old?.pet)===JSON.stringify(item.pet))continue;
  send(17602,petDetail(new Writer().short(item.slot),item.pet));
 }
 send(17601,healthUpdate(role));
}
export function commitPetEquipment(role,next,store){
 const old={...role};for(const key of Object.keys(role))delete role[key];Object.assign(role,next);
 try{store.save();}catch(error){for(const key of Object.keys(role))delete role[key];Object.assign(role,old);throw error;}
}
export function handlePetEquipment(type,r,context,{store,send,log}){
 if(!context.role||![31101,31103,31105,12061].includes(type))return false;
 const role=context.role;
 try{
  if(type===12061){
   const uid=r.long().toString(),level=r.short();if(r.pos!==r.b.length)throw Error('升级预览请求长度无效。');
   const e=previewPetEquipment(role,uid,level),w=new Writer().byte(0).string('');
   for(const field of petEquipmentFields)w.short(e[field]||0).short(e[petEquipmentValue(field)]||0);
   w.byte(e.petEquipSkillLevel);for(const key of ['def_str','def_agi','def_mag'])w.short(e[key]||0);send(type,w);return true;
  }
  if(context.battle)throw Error('请先结束战斗再操作宠物装备。');
  const request=decodePetEquipment(({31101:'c2s_petEquip',31103:'c2s_offPetEquip',31105:'c2s_petEquip_Up'})[type],r.b.subarray(r.pos));
  const result=type===31101?planPetEquip(role,request.equipId,request.petPos,request.pos??0):type===31103?planPetOffEquip(role,request.equipId,request.petPos,request.type??0):planPetEquipmentUpgrade(role,request.equipId,request.cost);
  const before=structuredClone(role);commitPetEquipment(role,result.next,store);pushPetEquipmentChanges(before,role,send);send(type+1,Buffer.alloc(0));
  log('pet-equipment-changed',{role:role.id,type,uid:request.equipId,petPos:request.petPos,consumed:result.consumed});
 }catch(error){if(type===12061)send(type,new Writer().byte(-1).string(error.message));else send(10509,new Writer().byte(2).string(error.message));log('pet-equipment-rejected',{role:role.id,type,error:error.message});}
 return true;
}
export const pushPetEquipmentExperience=send=>send(31108,petEquipmentExperiencePacket());
