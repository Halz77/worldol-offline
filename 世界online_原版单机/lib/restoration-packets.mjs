import {petItemPacket} from './pet-packets.mjs';
import {Writer} from './codec.mjs';
import {equipment,activeSkills} from './restoration.mjs';
import {itemWithAffixes,gemAttachment,canIdentify} from './item-affixes.mjs';
import {LEGENDARY_EGG_ID} from './pet-catalog.mjs';
import {isSpiritBox} from './spirit-seal-data.mjs';
import {exportEquipment} from './character-import-codec.mjs';
import {illusionBlockReason,noteIllusionFallback} from './illusion-policy.mjs';
function powerFields(w,list){for(let i=0;i<3;i++)w.short(list[i]?.[0]||0).short(list[i]?.[1]||0);return w;}
export function skillPacket(w,s,shop=false){
 if(s.native){w.raw(Buffer.from(s.wireBase64,'base64'));if(shop)w.short(0).short(0).short(0).int(0).byte(s.reqJob||0).byte(s.reqLevel||1);return w;}
 w.short(s.id).byte(s.level).string(s.name).byte(1).string('社区 H5 资料复原；本地免费学习，等级不高于角色等级。\n'+s.effects.join('\n')).byte(0);
 powerFields(w,s.powers).bool(false);
 if(shop)w.short(0).short(0).short(0).int(0).byte(s.job).byte(s.level);
 return w;
}
export function skillList(w,p){const list=activeSkills(p);w.short(list.length);for(const s of list)skillPacket(w,s).byte(s.addLevel||0);return w;}
export function skillUpdate(w,p){skillList(w,p);w.byte(p.autoSkillIds?.length||0);for(const id of p.autoSkillIds||[])w.short(id);return w.short(p.initiativeSkillId??-1);}
export function skillChanges(w,p={},before=[]){
 const old=new Map(before.map(s=>[s.id,s])),current=new Map(activeSkills(p).map(s=>[s.id,s])),changes=[];
 for(const [id] of old)if(!current.has(id))changes.push({type:3,id});
 for(const [id,s] of current){const previous=old.get(id);if(!previous||(previous.addLevel||0)!==(s.addLevel||0)||!skillPacket(new Writer(),previous).done().equals(skillPacket(new Writer(),s).done()))changes.push({type:previous?2:1,skill:s});}
 w.byte(changes.length);for(const c of changes){w.byte(c.type);if(c.type===3)w.int(c.id);else skillPacket(w,c.skill).byte(c.skill.addLevel||0);}
 w.byte(p.autoSkillIds?.length||0);for(const id of p.autoSkillIds||[])w.short(id);return w.short(p.initiativeSkillId??-1);
}
export function itemDefinition(w,e){
 if(e.native)return w.raw(Buffer.from(e.definitionBase64,'base64'));
 w.byte(e.type).bool(false).int(e.id).string(e.name).int(e.localIcon)
  .string('社区 H5 基础属性复原。\n无强化；通用图标。商店为本地测试价。')
  .byte(e.grade).byte(0).byte(1).bool(false)
  .short(0).short(0).int(e.durability).int(Math.floor(e.localPrice/2)).byte(0).byte(0).byte(e.level);
 for(const n of e.requirements)w.short(n);
 w.short(0).short(0).short(0);powerFields(w,e.powers);
 w.bool(false).byte(0).string('').short(0).short(0).short(0).short(0)
  .byte(2).byte(e.attackTimes-1).short(e.atkMin).short(e.atkMax).byte(0).byte(0)
  .byte(e.hit).byte(0);
 // MOD：附魔槽位改为从物品读取，用于承载第 4/5 项基础属性。
 // 原生装备走上面的 definitionBase64 提前返回，这里只影响本地恢复的道具；
 // 服务端算属性用的是 e.powers 数组，不会与这两格重复计算。
 w.short(e.enchantPower1||0).short(e.enchantPowerValue1||0)
  .short(e.enchantPower2||0).short(e.enchantPowerValue2||0)
  .short(e.enchantLevel||0);
 return w.bool(false).bool(false).bool(false).bool(false).short(0).short(0).bool(false).byte(0).byte(0);
}
export function itemPacket(w,i){if(i.pet)return petItemPacket(w,i);const template=equipment.get(i.itemId);let e=itemWithAffixes(template,i);if(!e)throw Error('未知道具: '+i.itemId);if(i.illusionItemId){
 // 幻化判定只有一处（lib/illusion-policy.mjs）：同槽位即可，不再要求 type 相等 ——
 // 这里以前写的是 appearance.type!==e.type，而幻化服务端按「同槽位」放行，
 // 于是跨类型幻化（剑→刃，都占武器槽 [8,10]）能存进存档、却在这一步抛错。
 // 而这一步在进入世界的整包里（enterWorld → worldData → bagPacket），
 // 一抛错整包就发不出去，玩家选这个角色永远卡在黑屏（第 43 版修的就是它）。
 // 现在：判定同源；万一还是用不了（例如早期存档缺独立定义），**降级为按本体下发**，
 // 宁可幻化外观不显示，也不能让人进不去游戏。
 const appearance=equipment.get(i.illusionItemId),blocked=illusionBlockReason(appearance,e.type);
 if(!blocked)e=exportEquipment({...e,handBookItem:true,isHandBookActivated:true,illusion:e.illusion?.length?e.illusion:[{currency:0,day:0,price:0}],illusionItemId:appearance.id,illusionEndTime:i.illusionEndTime??-1},appearance);
 else noteIllusionFallback({itemId:i.itemId,illusionItemId:i.illusionItemId,selfType:e.type,reason:blocked});
}const gem=gemAttachment(e,i);w.short(i.quantity||1).int(0).int(i.durability??e.durability??0).byte(gem.count).short(gem.power).short(gem.value).short(i.slot).byte((i.bound?2:0)|(canIdentify(template)?16:0)|(i.gemBroken?32:0));return itemDefinition(w,e);}
export function addedItems(w,added=[]){w.byte(added.length);for(const row of added){w.byte(row.mode).byte(row.quantity);if(row.mode===1)itemPacket(w.int(row.instance.slot),row.instance);else w.int(row.instance.itemId).int(row.instance.slot);}return w;}
export function bagPacket(w,p){w.short(p.inventory.length);for(const i of p.inventory)itemPacket(w,i);return w;}
// The native purchase callback copies the shop status into the new bag item.
export function shopItem(w,e,index){itemDefinition(w,e);return w.byte(Math.min(index,127)).int(0).int(0).int(e.localPrice).byte(100).int(0).int(0).int(e.localPrice).byte(canIdentify(e)?16:0).short(-1).short(-1).byte(0).byte(isSpiritBox(e.id)?2:e.id===LEGENDARY_EGG_ID?3:0).bool(false);}
