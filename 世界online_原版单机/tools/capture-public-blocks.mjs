// Read only enough account fields to reach public definitions. Private fields
// are discarded and are never returned to the configuration exports.
import {readPetDetail} from '../../正式服录制工具/lib/pets.cjs';
export function skipPlayerDetail(r,d){
 r.getInt();r.getString();r.getString();r.getString();
 const base={sex:r.getByte(),race:r.getByte(),job:r.getByte(),level:r.getByte(),level2:r.getByte()};r.take(8+24+8+1);
 if(r.getInt()>=0){r.getString();r.getByte();}
 base.exp=r.getInt();base.expMax=r.getInt();base.hp=r.getInt();base.mp=r.getInt();base.attributePoints=r.getShort();base.skillPoints=r.getInt();
 base.attributes=Array.from({length:5},()=>r.getShort());r.take(12);base.bagSlots=r.getByte();base.storageSlots=r.getByte();r.take(20+1);
 if(r.getInt()>=0)r.getString();r.getString();r.getString();r.take(80+3);
 base.autoSkillIds=Array.from({length:r.getByte()&255},()=>r.getShort());base.initiativeSkillId=r.getShort();r.take((r.getByte()&255)*2);r.take(12+1+4);r.take((r.getByte()&255)*12);
 if(d)base.pet=readPetDetail(r,d,{itemInstance});
 else if(r.getByte()>=0)throw Error('Player pet detail not supported');
 if(r.getByte()!==0)throw Error('Player mercenary detail not supported');
 for(let n=r.getByte()&255;n>0;n--){r.take(1+4+24);if(r.getByte()>=0){r.getString();r.take(8+2+8);}}
 r.getBoolean();base.bagLimit=r.getInt();r.getByte();r.getString();r.getString();return base;
}
export function itemInstance(r,d){
 const quantity=r.getShort();r.take(4+4+1+2+2);const slot=r.getShort(),status=r.getByte();if(status&1)r.getInt();
 const start=r.pos,item=new d.Item();d.Item.fromBytesAtts2(item,r);
 // Pet instances carry individual IDs/names and are not public item templates.
 if(item.getItemClass()===d.Item.ITEM_CLASS_PET)return {quantity,slot,privatePet:true};
 item.wireBase64=r.b.subarray(start,r.pos).toString('base64');return {quantity,slot,item};
}
export function readLevelReward(r){
 const out={exp:r.getInt(),levels:r.getByte()};
 if(out.levels>0){out.currentExp=r.getInt();out.expMax=r.getInt();out.skillPoints=r.getShort();out.attributePoints=r.getByte();}
 out.exp2=r.getInt();out.levels2=r.getByte();if(out.levels2>0){r.getInt();r.getInt();}return out;
}
export function readAddedItems(r,d,onItem){
 const out=[];
 for(let n=r.getByte();n>0;n--){const mode=r.getByte(),quantity=r.getByte();
  if(mode===1){r.getInt();const row=itemInstance(r,d);if(row.item){onItem(row.item);out.push({itemId:row.item.id,quantity});}}
  else if(mode===2){const itemId=r.getInt();r.getInt();out.push({itemId,quantity});}
  else throw Error('Unknown added-item mode '+mode);
 }return out;
}
export function skipNpcSigns(r){r.take((r.getByte()&255)*2);}
export function skipPetReward(r,d){
 r.getInt();if(r.getByte()>0){r.getShort();if(r.getByte()>0)r.take(10);r.take(8+1);for(let n=r.getByte();n>0;n--)d.Skill.fromBytes(r);}
}
export function readQuestReward(r,d,onItem){
 skipNpcSigns(r);const completed=r.getBoolean(),cost={gold:r.getShort(),silver:r.getInt(),coins:r.getInt()},silver=r.getInt(),coins=r.getInt(),level=readLevelReward(r);
 if(r.getBoolean())skipPetReward(r,d);
 r.take((r.getByte()&255)*9);const items=readAddedItems(r,d,onItem),cityChanged=r.getBoolean();
 let country;
 if(r.getBoolean()){
  country={honor:r.getInt()};
  for(const key of ['cityProsperity','cityArmy','countryLand','countryProsperity','promoteProsperity','countryPeople','countryWood','countryStone','countryIron','countryArmy'])country[key]=r.getShort();
 }
 return {completed,cost,silver,coins,...level,items,cityChanged,...(country?{country}:{})};
}
export function readBattleReward(r,d,onItem){
 const result=r.getByte(),out={result};if(result<0){out.error=r.getString();return out;}
 if(result===2){out.coins=r.getInt();Object.assign(out,readLevelReward(r));r.getBoolean();if(r.getBoolean())skipPetReward(r,d);
  out.kills=[];for(let n=r.getByte();n>0;n--)out.kills.push({monsterId:r.getShort(),count:r.getByte()});
  if(r.getBoolean())throw Error('Escort battle reward not supported');out.items=readAddedItems(r,d,onItem);skipNpcSigns(r);
 }
 r.getBoolean();if(r.getByte()!==0)throw Error('Mercenary check not supported');out.changedMap=r.getBoolean();r.getBoolean();return out;
}
