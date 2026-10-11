import {officialItems} from './official-data.mjs';
import {firstFree} from './restoration.mjs';
import {petAttributes} from './pet-state.mjs';
import {petEquipmentDefinition,PET_EQUIPMENT_MAX_LEVEL,PET_EQUIPMENT_LEVEL_XP,PET_EQUIPMENT_SLOTS} from './pet-equipment-data.mjs';

export function findPetEquipment(owner,uid){
 const matches=[];
 for(const item of owner.inventory||[]){
  if(item.petEquipment?.uid===String(uid))matches.push({instance:item,petItem:null});
  for(const gear of item.pet?.equipment||[])if(gear.petEquipment?.uid===String(uid))matches.push({instance:gear,petItem:item});
 }
 if(matches.length!==1)throw Error('未找到这件宠物装备，请重新打开背包。');
 const result=matches[0],template=officialItems.get(result.instance.itemId)||result.instance.recordedDefinition;
 if(template?.type!==41||(result.instance.quantity||1)!==1)throw Error('无效的宠物装备。');
 return {...result,template};
}
function selectedPet(owner,pos){
 const item=owner.inventory.find(i=>i.slot===pos&&i.pet);
 if(!item||!(pos===1||pos>=30))throw Error('请选择自己的宠物。');
 item.pet.equipment??=[];return item;
}
export function refreshPetEquipmentVitals(before,next){
 for(const item of next.inventory.filter(i=>i.pet)){
  const old=before.inventory.find(i=>i.pet?.uid===item.pet.uid)?.pet;if(!old)continue;
  if(JSON.stringify(old.equipment||[])===JSON.stringify(item.pet.equipment||[]))continue;
  if(item.pet.recordedSnapshotVitals){
   const previous=petAttributes(before,{...old,recordedSnapshotVitals:undefined}),current=petAttributes(next,{...item.pet,recordedSnapshotVitals:undefined});
   item.pet.recordedSnapshotVitals.hpMax=Math.max(1,item.pet.recordedSnapshotVitals.hpMax+current.hp-previous.hp);
   item.pet.recordedSnapshotVitals.mpMax=Math.max(1,item.pet.recordedSnapshotVitals.mpMax+current.mp-previous.mp);
  }
  const max=petAttributes(next,item.pet);item.pet.hp=Math.min(item.pet.hp,max.hp);item.pet.mp=Math.min(item.pet.mp,max.mp);
 }
}
export function planPetEquip(owner,uid,petPos,pos){
 if(!Number.isInteger(pos)||pos<0||pos>=PET_EQUIPMENT_SLOTS)throw Error('宠物装备位置无效。');
 const next=structuredClone(owner),{instance,petItem,template}=findPetEquipment(next,uid),target=selectedPet(next,petPos);
 if(petItem||instance.slot<30)throw Error('请选择背包中未穿戴的宠物装备。');
 if(target.pet.level<(template.reqLv||1))throw Error('宠物等级未达到装备要求。');
 const old=target.pet.equipment.find(i=>i.slot===pos),bagSlot=instance.slot;
 next.inventory=next.inventory.filter(i=>i!==instance);
 if(old){target.pet.equipment=target.pet.equipment.filter(i=>i!==old);old.slot=bagSlot;next.inventory.push(old);}
 instance.slot=pos;instance.bound=!!(instance.bound||template.autoBinding);target.pet.equipment.push(instance);
 refreshPetEquipmentVitals(owner,next);return {next};
}
export function planPetOffEquip(owner,uid,petPos,type){
 if(![0,1].includes(type))throw Error('无效卸下请求。');
 const next=structuredClone(owner),target=selectedPet(next,petPos);
 const items=type===1?[...target.pet.equipment]:target.pet.equipment.filter(i=>i.petEquipment?.uid===String(uid));
 if(!items.length)throw Error('这只宠物没有所选装备。');
 for(const item of items){const slot=firstFree(next);if(slot===undefined)throw Error('背包空间不足，请整理后再卸下。');target.pet.equipment=target.pet.equipment.filter(i=>i!==item);item.slot=slot;next.inventory.push(item);}
 refreshPetEquipmentVitals(owner,next);return {next};
}
export function planPetEquipmentUpgrade(owner,uid,cost){
 if(!Array.isArray(cost)||!cost.length||cost.length>99)throw Error('请选择宠物装备经验素材。');
 const next=structuredClone(owner),{instance}=findPetEquipment(next,uid),state=instance.petEquipment;
 if(state.level>=PET_EQUIPMENT_MAX_LEVEL)throw Error('宠物装备已达到100级。');
 let gained=0,count=0;const positions=new Set();
 for(const row of cost){
  if(!Number.isInteger(row.pos)||row.pos<30||positions.has(row.pos)||!Number.isInteger(row.num)||row.num<1)throw Error('升级素材数量或位置无效。');
  positions.add(row.pos);count+=row.num;
  const material=next.inventory.find(i=>i.slot===row.pos),definition=officialItems.get(material?.itemId);
  if(!material||definition?.type!==42||!(definition.petProvideExp>0)||material.quantity<row.num||count>99)throw Error('宠物装备经验素材不足或数量无效。');
  gained+=definition.petProvideExp*row.num;
 }
 const needed=(PET_EQUIPMENT_MAX_LEVEL-state.level)*PET_EQUIPMENT_LEVEL_XP-state.exp;
 // Use only the material units needed at the cap; never discard a selected stack.
 let remaining=Math.max(0,needed),consumed=[];
 for(const row of cost){
  const material=next.inventory.find(i=>i.slot===row.pos),xp=officialItems.get(material.itemId).petProvideExp;
  const used=Math.min(row.num,Math.ceil(remaining/xp));if(!used)continue;
  material.quantity-=used;state.exp+=used*xp;remaining=Math.max(0,remaining-used*xp);consumed.push({slot:row.pos,quantity:used});
 }
 next.inventory=next.inventory.filter(i=>i.quantity!==0);
 while(state.level<PET_EQUIPMENT_MAX_LEVEL&&state.exp>=PET_EQUIPMENT_LEVEL_XP){state.exp-=PET_EQUIPMENT_LEVEL_XP;state.level++;}
 if(state.level===PET_EQUIPMENT_MAX_LEVEL)state.exp=0;
 refreshPetEquipmentVitals(owner,next);return {next,consumed};
}
export function previewPetEquipment(owner,uid,level){
 if(!Number.isInteger(level)||level<1||level>PET_EQUIPMENT_MAX_LEVEL)throw Error('宠物装备等级应为1至100级。');
 const {instance,template}=findPetEquipment(owner,uid);
 return petEquipmentDefinition(template,{...instance,petEquipment:{...instance.petEquipment,level,exp:0}});
}
