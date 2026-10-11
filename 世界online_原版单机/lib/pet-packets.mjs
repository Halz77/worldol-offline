import {official} from './official-data.mjs';
import {petBagAppearance,petFromRecord} from './recorded-content.mjs';
import {itemPacket} from './restoration-packets.mjs';
import {requiredPetExperience} from './pet-experience.mjs';
import {ensurePetEquipment} from './pet-equipment-data.mjs';
import {petEquipmentSkills} from './pet-equipment-skills.mjs';
import {petAppearance} from './pet-illusion-service.mjs';
// 宠物幻化（见 lib/pet-illusion-service.mjs）：外观三项在「下发时」替换，
// 存档里永远保留宠物自己的 icon/headIcon/model，pet.illusion 只是外观快照。
const lookIcon=p=>Number(petAppearance(p,'icon',0))||0;
const lookHeadIcon=p=>petAppearance(p,'headIcon',0);
const lookModel=p=>petAppearance(p,'model',-1);
export function petItemPacket(w,i){
 w.short(1).int(0).int(0).byte(0).short(0).short(0).short(i.slot).byte(i.bound?2:0);
 return petItemDefinition(w,i.pet);
}
function petItemDefinition(w,p,info=p.catalogKey?'传说宠物蛋孵化。资料含录制、社区及单机推算值。':'本地宠物；属性、品质和技能来自正式服录制。'){
 const t=official.petContent.pets.find(t=>t.eggId===p.eggId)?.item||petBagAppearance(p);
 return w.byte(32).bool(false).string(p.name).int(t.bagIcon).string(info).byte(p.grade).byte(t.autoBinding).short(lookIcon(p)).byte(p.level).byte(0).long(p.uid).short(lookHeadIcon(p)).long(Math.max(0,p.expiresAt-Date.now()));
}
export function petShopItem(w,template,index){
 const pet=petFromRecord(template);
 // Negative IDs identify immutable shop samples, never owned pet instances.
 pet.uid=String(template.id);petItemDefinition(w,pet,template.description);
 // Native ShopItemType.pet is 3; the visible category index is 2.
 return w.byte(Math.min(index,127)).int(0).int(0).int(0).byte(100).int(0).int(0).int(0).byte(0).short(-1).short(-1).byte(0).byte(3).bool(false);
}
export function petDetail(w,p){
 if(!p)return w.byte(-1);
 const skills=petEquipmentSkills(p);
 w.byte(0).string(p.name).byte(p.level).long(lookIcon(p)).int(p.hp).int(p.mp).int(p.exp).int(requiredPetExperience(p)).int(p.sp);
 for(const v of p.baseStats)w.short(v);
 w.byte(p.grow).byte(p.comprehension).byte(p.cp).byte(p.growLevel).long(Math.max(0,p.expiresAt-Date.now())).short(p.hit).byte(p.attackType).short(p.attackMin).short(p.attackMax).byte(p.attackTimes).byte(p.job).byte(p.grade);
 w.byte(p.autoSkills.length);for(const id of p.autoSkills)w.short(id);w.short(p.initiativeSkill).short(skills.length);
 for(const s of skills)w.raw(Buffer.from(s.wireBase64,'base64'));
 w.byte(p.vipLevel||0).long(p.bornStatus||0).short(lookHeadIcon(p)).int(lookModel(p)).byte(p.equipment?.length||0);
 for(const item of p.equipment||[]){ensurePetEquipment(item);itemPacket(w.byte(item.slot),{...item,slot:-item.slot-1});}
 w.short(skills.length);
 for(const s of skills)w.int(s.id).byte(s.addLevel||0);return w;
}
export function petReward(w,r){
 w.int(r.exp).byte(r.levels);if(r.levels){w.short(r.sp).byte(r.growLevels);if(r.growLevels)for(const v of r.stats)w.short(v);w.int(r.currentExp).int(r.expMax).byte(r.cp).byte(r.skills.length);for(const s of r.skills)w.raw(Buffer.from(s.wireBase64,'base64'));}return w;
}
