import {Writer} from './codec.mjs';
import {localPetSkillBooks} from './pet-skill-book-data.mjs';
import {recordedPetSkills} from './recorded-content.mjs';
import {skillBytes} from './character-import-codec.mjs';
import {equipment} from './restoration.mjs';

const books=new Map(localPetSkillBooks.map(b=>[b.id,b]));
function selection(p,bookSlot,petSlot){
 const item=p.inventory.find(i=>i.slot===bookSlot),book=books.get(item?.itemId)||item?.recordedDefinition||equipment.get(item?.itemId);
 if(bookSlot<30||!book||book.id!==item.itemId||book.type!==31||book.power1!==186||!Number.isInteger(item.quantity)||item.quantity<1)throw Error('请选择背包中的宠物技能封印书。');
 const pet=p.inventory.find(i=>i.slot===petSlot&&(petSlot===1||petSlot>=30))?.pet;
 if(!pet)throw Error('请从目标宠物的详情界面使用封印书。');
 if(pet.expiresAt<=Date.now())throw Error('宠物寿命已到期，请先续命。');
 const known=pet.skills.find(s=>s.id===book.powerValue1);
 if(known)throw Error(known.isLearnByBook?`宠物已经学会${known.name}，不能重复学习。`:'宠物天生掌握此技能，不能重复学习。');
 const recorded=item.sealedPetSkill||book.learnSkill||recordedPetSkills.get(`${book.powerValue1}:${book.powerValue2}`);
 if(!recorded||recorded.id!==book.powerValue1||recorded.level!==book.powerValue2||![1,2,3].includes(recorded.type))throw Error('技能的完整效果尚未恢复，封印书未消耗。');
 const skill={...structuredClone(recorded),isLearnByBook:true,addLevel:0};
 delete skill.sources;delete skill.variants;
 skill.wireBase64=skillBytes(skill).toString('base64');
 return {item,book,pet,skill};
}

export function handlePetSkillBooks(type,r,context,{store,send,log}){
 if(![14016,14017].includes(type)||!context.role)return false;
 const p=context.role;
 try{
  if(context.battle)throw Error('请先结束战斗，再学习宠物技能。');
  if(type===14016){
   context.petBookPreview=null;
   const bookSlot=r.short(),petSlot=r.short(),{item,pet,skill}=selection(p,bookSlot,petSlot);
   context.petBookPreview={roleId:p.id,itemId:item.itemId,bookSlot,petSlot,petUid:pet.uid,skillId:skill.id,level:skill.level,skillWire:skill.wireBase64};
   // Original v305 doUsePetSealItemLearnSkillCb: item, count, cost, skill, level, definition.
   send(type,new Writer().byte(0).int(item.itemId).byte(1).int(0).short(skill.id).byte(skill.level).byte(1).raw(Buffer.from(skill.wireBase64,'base64')));
  }else{
   const id=r.int(),level=r.byte(),confirmed=r.bool(),bookSlot=r.short(),petSlot=r.short(),preview=context.petBookPreview;
   context.petBookPreview=null;
   if(!confirmed)throw Error('已取消学习，封印书未消耗。');
   const {item,pet,skill}=selection(p,bookSlot,petSlot);
   if(!preview||preview.roleId!==p.id||preview.itemId!==item.itemId||preview.bookSlot!==bookSlot||preview.petSlot!==petSlot||preview.petUid!==pet.uid||preview.skillId!==id||preview.level!==level||preview.skillWire!==skill.wireBase64||id!==skill.id||level!==skill.level)throw Error('宠物或封印书已变化，请重新选择。');
   const before=structuredClone(p);
   try{
    pet.skills.push(skill);item.quantity--;
    if(!item.quantity)p.inventory=p.inventory.filter(i=>i!==item);
    store.save();
   }catch(error){for(const key of Object.keys(p))if(!(key in before))delete p[key];Object.assign(p,before);throw error;}
   // learnPetSkillAskCb updates this pet, marks the learned skill, and removes one book.
   send(type,new Writer().byte(0).int(pet.sp||0).raw(Buffer.from(skill.wireBase64,'base64')).bool(false).byte(1).short(bookSlot));
   log('pet-book-learned',{role:p.id,pet:pet.uid,skill:id,level,book:item.itemId});
  }
 }catch(error){send(type,new Writer().byte(-1).string(error.message));log('pet-book-rejected',{role:p.id,type,error:error.message});}
 return true;
}
