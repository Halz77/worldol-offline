import {petCatalog} from './pet-catalog.mjs';
const groups=new Map();
for(const s of petCatalog.skills.filter(s=>s.kind==='mentor'&&s.shops.length)){
 if(!groups.has(s.id))groups.set(s.id,{id:s.id,name:s.name,type:s.type,native:true,shops:s.shops,levels:[]});
 // Keep the captured profession as a label, while every pet can learn it.
 // Normalize every offer level, including the next-level reply used by the
 // native dialog, so a second click cannot restore an old level/price gate.
 groups.get(s.id).levels.push({...s,reqLevel:1,sp:0,money1:0,money2:0,money3:0});
}
/**
 * 宠物训练师（商店 2001/2002/2003，走 14001/14002）能教到的技能编号全集 —— 唯一口径。
 *
 * 「装备与补给商人 → 技能书」要按它剔除：训练师那儿已经能免费逐级学到满级的技能，
 * 再在商店摆一本书等于同一门技能两个来源。判定只认这份 groups（和 petMentorSkills
 * 同源），不要另外重判一遍 kind/shops，否则两边迟早对不上。
 */
let taughtIds=null;
export function mentorTaughtSkillIds(){
 if(!taughtIds)taughtIds=new Set(groups.keys());
 return taughtIds;
}
export function petMentorSkills(pet,shop){
 if(!pet)throw Error('请先让需要学习的宠物出战。');
 return [...groups.values()].filter(s=>s.shops.includes(shop)).map(s=>{
  const wanted=(pet.skills.find(x=>x.id===s.id)?.level||0)+1;
  return {...s,...(s.levels.find(x=>x.level===wanted)||s.levels.at(-1))};
 });
}
// 人物那边的学习请求一次就能学到指定等级（服务端逐级过一遍），宠物这边照同一套：
// level 是目标等级，玩家点一次就直接升到那个等级，中途任何一级不合法就整体回滚。
export function learnPetMentorSkill(pet,shop,id,level){
 const offer=petMentorSkills(pet,shop).find(s=>s.id===id),old=pet.skills.find(s=>s.id===id);
 if(!offer)throw Error('技能不在这个宠物导师的列表中。');
 const from=(old?.level||0)+1,top=offer.levels.at(-1).level;
 if(!Number.isInteger(level)||level<from||level>top)throw Error('该等级已学会或已达到上限。');
 let learned;
 for(let next=from;next<=level;next++){
  const data=offer.levels.find(s=>s.level===next);
  if(!data)throw Error('该等级已学会或已达到上限。');
  learned={...structuredClone(data),learnedFromMentor:true};
  const current=pet.skills.find(s=>s.id===id);
  if(current)pet.skills[pet.skills.indexOf(current)]=learned;else pet.skills.push(learned);
 }
 return {...offer,...learned};
}
