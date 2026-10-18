import {official} from './official-data.mjs';
import {powers,firstFree,planItemRewards,bagCapacity} from './restoration.mjs';
import {petSources,petFromRecord} from './recorded-content.mjs';
import {equipmentPowers} from './item-affixes.mjs';
import {officialItems} from './official-data.mjs';
import {petSnapshotVitals} from './pet-snapshot-vitals.mjs';
import {nativeCharacterPowers} from './native-character-stats.mjs';
import {LEGENDARY_EGG_ID,drawLegendaryPet,growthProfile,growLocalPet,selectablePetEggsById} from './pet-catalog.mjs';
import {normalizePetExperience} from './pet-experience.mjs';
import {petEquipmentSkills} from './pet-equipment-skills.mjs';
import {spiritBoxes,isSpiritBox,drawSpiritRune,rollSpiritPowers} from './spirit-seal-data.mjs';
export const petTemplates=new Map((official.petContent?.pets||[]).map(p=>[p.eggId,p]));
export const chestTemplates=new Map((official.petContent?.chests||[]).map(p=>[p.inputId,p]));
export const activePet=p=>p.inventory.find(i=>i.slot===1&&i.pet)?.pet||null;
export function claimRecordedPet(p,id){
 const template=petSources.get(id);if(!template)throw Error('这只宠物的完整详情尚未录到。');
 if(template.level>p.level)throw Error('宠物等级不能高于人物等级。');
 const slot=firstFree(p);if(slot===undefined)throw Error('背包空间不足，请先整理。');
 let index=(p.nextPetIndex||0)+1;
 const used=new Set(p.inventory.filter(i=>i.pet).map(i=>String(i.pet.uid)));
 while(used.has(String(p.id*10000+index)))index++;
 const pet=normalizePetExperience(petFromRecord(template));
 pet.uid=String(p.id*10000+index);const max=petAttributes(p,pet);pet.hp=Math.min(pet.hp,max.hp);pet.mp=Math.min(pet.mp,max.mp);
 const instance={itemId:24,slot,quantity:1,pet};p.inventory.push(instance);p.nextPetIndex=index;return instance;
}
export function petAttributes(owner,pet){
 const native=owner.importedCharacter?nativeCharacterPowers(owner):null;
 const ownEquip=native?.equipment||powers(owner,'equipment'),ownSkill=native?.skill||powers(owner,'skill'),values=new Map();
 for(const s of petEquipmentSkills(pet))if(s.type===1)for(const n of [1,2,3])if(s['power'+n])values.set(s['power'+n],(values.get(s['power'+n])||0)+s['powerValue'+n]);
 for(const item of pet.equipment||[]){const e=officialItems.get(item.itemId);if(e)for(const [id,value] of equipmentPowers({...e,native:true},item))values.set(id,(values.get(id)||0)+value);}
 const skill=id=>values.get(id)||0;
 const base=[1,3,5,7,9].map((id,i)=>{const raw=pet.baseStats[i]+skill(id),percent=skill(id+1)+ownEquip(92+i)+ownSkill(92+i);return Math.max(0,raw+(percent>0?Math.trunc(raw*percent/100):0));});
 const calc=(value,id,parent)=>{const flat=value+skill(id),percent=skill(id+1)+ownEquip(parent)+ownSkill(parent);return Math.max(1,flat+(percent>0?Math.trunc(flat*percent/100):0));};
 const snapshot=petSnapshotVitals(pet);
 return {base,hp:snapshot?.hpMax??calc(Math.trunc(6.5*base[1])+3*base[0]+100+20*(pet.level-1),11,90),mp:snapshot?.mpMax??calc(5*base[3]+2*base[4]+40+5*(pet.level-1),13,91)};
}
export function openContainer(p,slot,quantity,random){
 const source=p.inventory.find(i=>i.slot===slot),chest=chestTemplates.get(source?.itemId),template=petTemplates.get(source?.itemId);
 const selectableEgg=selectablePetEggsById.get(source?.itemId),legendary=source?.itemId===LEGENDARY_EGG_ID,spirit=isSpiritBox(source?.itemId);
 if(slot<30||!source||!Number.isInteger(quantity)||quantity<1||quantity>source.quantity||(!chest&&!template&&!legendary&&!selectableEgg&&!spirit))throw Error('这件宝箱或宠物蛋的开出内容尚未采集。');
 // 连开 quantity 个：全过程只改副本，任何一次因为背包放不下而中断就整批回滚
 // （p 一字未动），并把「最多能开几个」告诉玩家，而不是默默少开几个。
 const wait=chest||spirit?4:1,added=[];
 const copy={...p,inventory:structuredClone(p.inventory)};
 const used=new Set(p.inventory.filter(i=>i.pet).map(i=>String(i.pet.uid)));
 let index=p.nextPetIndex||0;
 for(let n=0;n<quantity;n++){
  try{
   // planItemRewards() 内部还会再克隆一次背包，所以每轮都要按槽位重新取，
   // 不能把上一轮的引用留到下一轮。
   const stack=copy.inventory.find(i=>i.slot===slot);
   if(!stack)throw Error('道具或数量已变化，请整理背包后重试。');
   stack.quantity--;if(!stack.quantity)copy.inventory=copy.inventory.filter(i=>i!==stack);
   if(chest||spirit){
    const result=planItemRewards(copy,spirit?[{id:drawSpiritRune(random,spiritBoxes.find(b=>b.id===source.itemId)?.family),quantity:1}]:chest.rewards);
    if(spirit){
     const reward=result.added[0],instance=result.inventory.find(i=>i.slot===reward.instance.slot);
     instance.spiritRune={powers:rollSpiritPowers(instance.itemId,random)};
     reward.instance=structuredClone(instance);
    }
    copy.inventory=result.inventory;added.push(...result.added);
   }else{
    const free=firstFree(copy);if(free===undefined)throw Error('背包空间不足，请整理后再开启。');
    index++;while(used.has(String(p.id*10000+index)))index++;
    const pet=selectableEgg?{...structuredClone(selectableEgg.profile.baseline),name:selectableEgg.profile.name,eggId:selectableEgg.id,catalogKey:selectableEgg.profile.key,expiresAt:Date.now()+100*86400000}:legendary?drawLegendaryPet(random):{...structuredClone(template.baseline),name:template.name,eggId:template.eggId,expiresAt:Date.now()+template.item.lifeMs};pet.uid=String(p.id*10000+index);delete pet.seq;delete pet.lifeMs;
    levelPetTo(p,pet,90);
    used.add(pet.uid);
    const instance={itemId:24,slot:free,quantity:1,pet};copy.inventory.push(instance);added.push({mode:1,quantity:1,instance});
   }
  }catch(error){
   if(!/背包空间不足/.test(error?.message||''))throw error;
   if(n===0)throw error;
   throw Error(`背包剩余空间不足，一次最多只能开启 ${n} 个（当前选择了 ${quantity} 个）。`);
  }
 }
 p.inventory=copy.inventory;p.nextPetIndex=index;return {wait,added};
}
export function equipPet(p,slot,destination){
 const item=p.inventory.find(i=>i.slot===slot);if(slot<30||!item?.pet||![1,-1].includes(destination))throw Error('请选择背包中的宠物。');
 if(item.pet.level>p.level)throw Error('宠物等级不能高于人物等级。');
 const old=p.inventory.find(i=>i.slot===1);if(old)old.slot=slot;item.slot=1;return item.pet;
}
export function unequipPet(p){
 const item=p.inventory.find(i=>i.slot===1&&i.pet);if(!item)throw Error('没有出战宠物。');
 const free=firstFree(p);if(free===undefined)throw Error('背包空间不足，请先整理。');item.slot=free;return item.pet;
}
// 可选传入 targetPet：让「休息中」的宠物也能直接吃经验卷（经验卷不要求宠物出战）。
export function gainPet(owner,exp,targetPet){
 const pet=targetPet||activePet(owner);if(!pet)return null;
 const template=petTemplates.get(pet.eggId),profile=growthProfile(pet),old=structuredClone(pet);normalizePetExperience(pet);pet.exp=Math.min(2147483647,pet.exp+exp);
 const cap=Math.min(owner.level,profile?97:template?.maxRecordedLevel??pet.level);
 while(pet.level<cap&&pet.exp>=pet.expMax){
  if(pet.expMax<=0)break;
  pet.exp-=pet.expMax;pet.level++;normalizePetExperience(pet);
  const milestone=template?.milestones[pet.level];
  if(milestone){
   const learned=pet.skills.filter(s=>s.isLearnByBook||s.learnedFromMentor||s.kind==='mentor');
   for(const key of ['sp','cp','baseStats','growLevel'])pet[key]=structuredClone(milestone[key]);
   pet.skills=[...structuredClone(milestone.skills).filter(s=>!learned.some(b=>b.id===s.id)),...learned];
  }
  else if(profile&&(!template||pet.level>template.maxRecordedLevel))growLocalPet(pet,profile);
  else pet.sp+=(pet.level-1)*10; // Intermediate SP follows the recorded summed reward.
 }
 if(pet.level>=97){pet.exp=0;pet.expMax=0;}
 if(pet.level>old.level){const max=petAttributes(owner,pet);pet.hp=max.hp;pet.mp=max.mp;}
 return {exp,levels:pet.level-old.level,sp:pet.sp-old.sp,growLevels:pet.growLevel-old.growLevel,stats:pet.baseStats.map((v,i)=>v-old.baseStats[i]),currentExp:pet.exp,expMax:pet.expMax,cp:pet.cp,skills:pet.skills.filter(s=>!old.skills.some(o=>o.id===s.id&&o.level===s.level))};
}
export function observedPetExperience(key,id,fallback){
 const rows=(official.petContent?.rewardEvents||[]).filter(e=>e[key]===id);return rows.length&&rows.every(r=>r.exp===rows[0].exp)?rows[0].exp:fallback;
}

export function levelPetTo(owner,pet,targetLevel=90){
  const template=petTemplates.get(pet.eggId);
  const profile=growthProfile(pet);
  const target=Math.min(targetLevel,owner.level);

  pet.exp=0;
  normalizePetExperience(pet);

  while(pet.level<target){
    pet.level++;
    normalizePetExperience(pet);

    const milestone=template?.milestones?.[pet.level];

    if(milestone){
      const learned=pet.skills.filter(s=>
        s.isLearnByBook||s.learnedFromMentor||s.kind==='mentor'
      );

      for(const key of ['sp','cp','baseStats','growLevel']){
        pet[key]=structuredClone(milestone[key]);
      }

      pet.skills=[
        ...structuredClone(milestone.skills)
          .filter(s=>!learned.some(old=>old.id===s.id)),
        ...learned
      ];
    }else if(profile&&(!template||pet.level>template.maxRecordedLevel)){
      growLocalPet(pet,profile);
    }else{
      pet.sp+=(pet.level-1)*10;
    }
  }

  normalizePetExperience(pet);

  const max=petAttributes(owner,pet);
  pet.hp=Math.min(pet.hp,max.hp);
  pet.mp=Math.min(pet.mp,max.mp);
}

// 第 73 版：宠物返老还童石（40005）。
//   · 客户端把它归到 BAG_PET_AGE(14)：请求是 action 3 + wait 14，包体在 quantity 之后多一个
//     short(petSlot)（createPlayerBagMessage 对 isPetCanUseItem() 的道具会 putShort(o)）；
//   · 回包是 byte(14) + long(剩余毫秒)，客户端 BAG_PET_AGE 分支把它换算成 ageTime 并提示
//     STR_PET_RESET_AGE_INFO —— 所以这里必须回**剩余**时间，而不是绝对时间戳。
// 寿命重置规则按玩家要求与自选传说蛋一致：重置为 100 天，**已过期的宠物也能用**
// （所以这里不检查 expiresAt 是否已过），等级/品质/成长/技能/装备一律保留。
export const PET_REJUVENATION_STONE_ID=40005;
export const PET_REJUVENATION_DAYS=100;
export const PET_REJUVENATION_MS=PET_REJUVENATION_DAYS*86400000;
export function rejuvenatePet(p,stoneSlot,petSlot=1,now=Date.now()){
 const stone=p.inventory.find(i=>i.slot===stoneSlot);
 if(!Number.isInteger(stoneSlot)||stoneSlot<30||stoneSlot>=30+bagCapacity(p)||stone?.itemId!==PET_REJUVENATION_STONE_ID||!Number.isInteger(stone.quantity)||stone.quantity<1)throw Error('请选择背包中的宠物返老还童石。');
 const petItem=p.inventory.find(i=>i.slot===petSlot);
 // petSlot 1 是出战位；30..30+容量-1 是背包位（客户端两个来源都可能传）。
 if(!Number.isInteger(petSlot)||(petSlot!==1&&(petSlot<30||petSlot>=30+bagCapacity(p)))||!petItem?.pet)throw Error('请选择需要返老还童的宠物。');
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(now+PET_REJUVENATION_MS))throw Error('宠物寿命时间无效。');
 petItem.pet.expiresAt=now+PET_REJUVENATION_MS;
 stone.quantity-=1;
 if(!stone.quantity)p.inventory=p.inventory.filter(i=>i!==stone);
 return petItem.pet;
}