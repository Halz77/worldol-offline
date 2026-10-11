import fs from 'node:fs';
import {randomInt} from 'node:crypto';
import {Writer} from './codec.mjs';
export const petCatalog=JSON.parse(fs.readFileSync(new URL('../data/pet-catalog.json',import.meta.url),'utf8'));
export const LEGENDARY_EGG_ID=30013,LEGENDARY_EGG_PRICE=500000;
export const petProfiles=new Map(petCatalog.profiles.map(p=>[p.key,p]));
export const legendaryPetPool=petCatalog.legendaryPool.map(key=>petProfiles.get(key));
export const SELECTABLE_PET_EGG_ID_START=30000000;
function encodePetEgg(item){
 return new Writer().byte(item.type).bool(false).int(item.id).string(item.name).int(item.bagIcon).string(item.info)
    .byte(item.grade).byte(item.autoBinding).byte(item.stackNum).bool(false).byte(item.reqLv).short(0).int(0).int(item.price)
    .byte(0).byte(-1).short(item.power1).short(item.powerValue1).short(0).short(0).byte(0).bool(false).done().toString('base64');
}
export const selectablePetEggs=legendaryPetPool.map((profile,index)=>{
 const id=SELECTABLE_PET_EGG_ID_START+index,item={id,type:28,name:`${profile.name}（${profile.grade}阶）宠物蛋`,bagIcon:29,
    info:`免费宠物蛋；开启后固定获得${profile.name}（${profile.grade}阶）。`,grade:profile.grade,autoBinding:0,stackNum:1,
    decomCHest:false,reqLv:0,ownTime:0,durMax:0,price:0,round:0,area:-1,power1:109,powerValue1:1,power2:0,powerValue2:0,
    vipLevelReq:0,needShowRate:false};
 item.definitionBase64=encodePetEgg(item);
 return {id,profile,item};
});
export const selectablePetEggsById=new Map(selectablePetEggs.map(egg=>[egg.id,egg]));
if(selectablePetEggsById.size!==legendaryPetPool.length)throw Error('宠物蛋编号重复。');
export const petSkillLevels=new Map(petCatalog.skills.map(s=>[`${s.id}:${s.level}`,s]));
export const petEggItem=e=>e?.power1===109||(e?.type===28&&e.name.includes('宠物蛋'));
export const soldPetItem=e=>!petEggItem(e);
// Exactly one uniform draw over identities, not a two-stage quality/form draw.
export function drawLegendaryPet(random){
 const n=legendaryPetPool.length,value=random?.();
 if(random&&(!Number.isFinite(value)||value<0||value>=1))throw Error('无效随机数。');
 const profile=legendaryPetPool[random?Math.floor(value*n):randomInt(n)];
 const p=structuredClone(profile.baseline);p.eggId=LEGENDARY_EGG_ID;p.expiresAt=Date.now()+100*86400000;
 delete p.lifeMs;return p;
}
export function legendaryEggDefinition(item){
 const e={...item,info:`随机孵化1级传说宠物，包含进化形态。共${legendaryPetPool.length}种，每种概率相同。商城售价50万铜币。缺失资料采用单机推算规则。`};
 e.definitionBase64=new Writer().byte(e.type).bool(false).int(e.id).string(e.name).int(e.bagIcon).string(e.info)
  .byte(e.grade).byte(e.autoBinding).byte(e.stackNum).bool(false).byte(e.reqLv).short(0).int(0).int(e.price)
  .byte(e.round||0).byte(e.area??-1).short(e.power1).short(e.powerValue1).short(e.power2||0).short(e.powerValue2||0).byte(0).bool(false).done().toString('base64');
 return e;
}
const normal=s=>String(s||'').normalize('NFKC').replace(/[\s\-－—·]/g,'').replace(/啊宝/g,'阿宝').replace('小白机器熊(变异)','小白机器熊');
export function growthProfile(pet){
 return petProfiles.get(pet.catalogKey)||petProfiles.get(normal(pet.name)+':'+pet.grade)||petCatalog.profiles.find(p=>p.grade===pet.grade&&p.provenance.origin==='captured'&&p.baseline.templateId===pet.templateId);
}
export function growLocalPet(pet,profile){
 const rate=pet.grow>=100?3:Math.min(3,1+0.4*Math.max(0.5,pet.grow/20));
 // Persist fractional carry so a multi-level scroll and individual battles
 // produce the same result, including after saving and loading.
 pet.localGrowthCarry=(pet.localGrowthCarry||0)+rate;
 const points=Math.floor(pet.localGrowthCarry+1e-8);pet.localGrowthCarry-=points;
 pet.cp+=points;const extra=Math.floor(pet.cp/10);pet.cp%=10;pet.growLevel+=extra;
 if(extra)pet.baseStats=pet.baseStats.map((n,i)=>Math.min(32767,n+profile.baseline.baseStats[i]*extra));
 pet.sp+=10;
 for(let i=0;i<pet.skills.length;i++){
  const old=pet.skills[i];if(old.isLearnByBook||old.id<5000||!profile.baseline.skills.some(s=>s.id===old.id))continue;
  const cap=old.id<6000?(profile.evolved?6:5):9;
  const progress=Math.min(1,(pet.level-1)/96*(1+Math.max(0,pet.comprehension)/200));
  const level=Math.max(old.level,1+Math.floor((cap-1)*progress));
  const next=petSkillLevels.get(`${old.id}:${level}`);if(next&&level>old.level)pet.skills[i]=structuredClone(next);
 }
}
export const petCatalogSummary={revision:petCatalog.revision,profiles:petProfiles.size,legendary:legendaryPetPool.length,evolved:legendaryPetPool.filter(p=>p.evolved).length,eggId:LEGENDARY_EGG_ID,price:LEGENDARY_EGG_PRICE,skillRows:petCatalog.skills.length,mentorMaxLevel:petCatalog.rules.skillLevels.mentor,experienceDivisor:petCatalog.rules.experienceDivisor};
