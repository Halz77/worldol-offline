import {Writer} from './codec.mjs';
import {bagCapacity,firstFree,planItemRewards} from './restoration.mjs';
import {addedItems} from './restoration-packets.mjs';
import {exportSkill} from './character-import-codec.mjs';
import {createSealedPetSkillBook} from './pet-skill-book-data.mjs';

// v305 capture 2026-09-21T01-33-38-380Z_0dc594, seq 4328/4359.
// Use the numeric rates shown by the native confirmation, not the stale
// option labels in that capture (30/60). All owned skills enter the draw.
export const petSealOptions=[
 {type:1,cost:80000,currency:13,key:'coins',rate:20,name:'20%成功率（80000铜币）'},
 {type:2,cost:50,currency:12,key:'silver',rate:50,name:'50%成功率（50白银）'},
 {type:3,cost:50,currency:11,key:'gold',rate:100,name:'100%成功率（50黄金）'},
];
function selection(p,slot){
 const item=p.inventory.find(i=>i.slot===slot);
 if(!item?.pet||slot<30||slot>=30+bagCapacity(p))throw Error('请先让宠物休息，再选择背包中的宠物封印。');
 const pet=item.pet;
 if(pet.equipment?.length)throw Error('请先卸下宠物装备再封印，避免装备丢失。');
 if(pet.expiresAt<=Date.now())throw Error('宠物寿命已到期，请先续命。');
 const skills=[...new Map(pet.skills.map(s=>{const skill=exportSkill(s);return [skill.id,skill];})).values()];
 if(!skills.length||skills.length>127)throw Error('这只宠物没有可封印的完整技能资料。');
 // Validate every possible result before accepting payment or consuming a pet.
 const books=skills.map(s=>createSealedPetSkillBook(s,pet.grade));
 const signature=JSON.stringify([String(pet.uid),pet.grade,skills.map(s=>s.wireBase64)]);
 return {item,pet,skills,books,signature};
}
function draw(random){const n=random();if(!Number.isFinite(n)||n<0||n>=1)throw Error('封印随机结果无效，请重新尝试。');return n;}

export function handlePetSealing(type,r,context,{store,send,log,random=Math.random}){
 if(![15516,15517].includes(type)||!context.role)return false;
 const p=context.role;
 try{
  if(type===15516)context.petSealPreview=null;
  const preview=context.petSealPreview;
  if(type===15517)context.petSealPreview=null;
  if(context.battle)throw Error('请先结束战斗，再封印宠物。');
  const slot=r.short(),optionType=type===15517?r.int():null,option=petSealOptions.find(o=>o.type===optionType);
  if(r.pos!==r.b.length)throw Error('无效宠物封印请求。');
  const {item,pet,skills,books,signature}=selection(p,slot);
  if(type===15516){
   context.petSealPreview={roleId:p.id,slot,signature};
   const w=new Writer().byte(0).byte(skills.length);
   for(const skill of skills)w.string(`${skill.name}（${skill.level}级）`);
   w.byte(petSealOptions.length);
   for(const o of petSealOptions)w.int(o.type).int(o.cost).byte(o.currency).int(o.rate).string(o.name);
   send(type,w);return true;
  }
  if(!option||!preview||preview.roleId!==p.id||preview.slot!==slot||preview.signature!==signature)throw Error('宠物或封印选项已变化，请重新打开封印界面。');
  const balance=p[option.key]||0;
  if(!Number.isSafeInteger(balance)||balance<option.cost)throw Error('封印所需货币不足，宠物未消耗。');
  const success=draw(random)<option.rate/100;
  const copy={...p,inventory:structuredClone(p.inventory.filter(i=>i!==item)),[option.key]:balance-option.cost};
    let added;
  if(success){
   // Native sealing removes the pet, then processAddItemMsg/addItem_2 merges
     // a matching stack or chooses the first empty bag slot. Plan every book
     // before committing so a full bag cannot consume the pet or payment.
     added=[];
     for(const book of books){
        const stack=copy.inventory.filter(i=>i.slot>=30&&i.slot<30+bagCapacity(p)&&i.itemId===book.itemId&&(i.quantity||1)<(i.recordedDefinition?.stackNum||99)).sort((a,b)=>a.slot-b.slot)[0];
        if(stack){stack.quantity=(stack.quantity||1)+1;added.push({mode:2,quantity:1,instance:stack});}
        else{
         book.slot=firstFree(copy);if(book.slot===undefined)throw Error('背包空间不足，请整理后再封印。');
         copy.inventory.push(book);added.push({mode:1,quantity:1,instance:book});
        }
   }
  }else{
   // The recorded failed seal returns one pet-supply box.
   const plan=planItemRewards(copy,[{id:1485,quantity:1}]);copy.inventory=plan.inventory;added=plan.added;
  }
  const response=addedItems(new Writer().byte(0).byte(success?1:2).bool(true),added)
   .int(copy.gold||0).int(copy.silver||0).int(copy.coins||0);
  const previousInventory=p.inventory,previousBalance=p[option.key];
  p.inventory=copy.inventory;p[option.key]=copy[option.key];
  try{store.save();}catch(error){p.inventory=previousInventory;p[option.key]=previousBalance;throw error;}
  send(type,response);
    log('pet-sealed',{role:p.id,pet:pet.uid,slot,option:option.type,cost:option.cost,currency:option.currency,success,skills:books.map(book=>({id:book.sealedPetSkill.id,level:book.sealedPetSkill.level}))});
 }catch(error){send(type,new Writer().byte(-1).string(error.message));log('pet-seal-rejected',{role:p.id,type,error:error.message});}
 return true;
}
