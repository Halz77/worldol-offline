import {ensurePetEquipment} from './pet-equipment-data.mjs';
import {titlePowers} from './recorded-content.mjs';
import {characterFeaturePowers} from './character-features.mjs';
import fs from 'node:fs';
import {lazyBox} from './lazy-data.mjs';
import {official,officialItems,officialSkills,itemSlots} from './official-data.mjs';
import {itemWithAffixes,equipmentPowers,nativeEquipmentSkill} from './item-affixes.mjs';
import {setPowers} from './equipment-sets.mjs';
import {reconcileAttributePoints} from './progression.mjs';
import {careerSkills,migrateCareerSkills,careers} from './career-skills.mjs';
import {nativeCharacterStats} from './native-character-stats.mjs';
import {INITIAL_BAG_CAPACITY} from './bag-capacity.mjs';
import {automaticSkillSlots} from './automatic-skills.mjs';
import {equipmentSkillLevels,MAX_EQUIPMENT_SKILL_LEVEL} from './equipment-skill-levels.mjs';
import {LEGENDARY_EGG_ID,LEGENDARY_EGG_PRICE} from './pet-catalog.mjs';
import {spiritRules} from './spirit-seal-data.mjs';
import {skillBytes} from './character-import-codec.mjs';
import {IGNORE_REQUIREMENT_ITEM_ID} from './local-items.mjs';
import {localCareerSkills,localCareerSkillIds} from './local-career-skills.mjs';

/**
 * 运行时物品表与技能表 —— 服务端每次算属性、每次开背包都要用，但**只有登录之后**才用。
 *
 * 以前这两张表连同它们的输入（official 34.8 MB、career-skills 7.8 MB、restored 646 KB）
 * 全在模块顶层建好，于是「起一个 HTTP 服务」= 把整张数据图拉进堆（架构评审 P1-1）。
 * 现在整套合并逻辑挂在 ensure() 上，第一次真正查物品/技能时执行一次。
 *
 * `equipment` 与 `skills` 是热表，包了代理会多一层属性查找 —— 实测 2.25x，
 * 单次 0.03 µs，相对一个数据包的开销可以忽略；换来的是启动不再建这 30 MB 多的副本。
 */
let built=null;
function ensure(){
 if(built)return built;
 const restored=JSON.parse(fs.readFileSync(new URL('../data/restored-v03.json',import.meta.url),'utf8'));
 const equipment=new Map(restored.equipment.map(x=>[x.id,x]));
 const careerSkillMap=new Map(careerSkills);
 const skills=new Map(careerSkillMap);
 // MOD(country-skill-shop)：把国家专属技能（防御战术（劈砍）/（穿刺）等）并进运行时技能表。
 // 它们不在 data/career-skills.json 里（那份文件要保持上游原样），所以这里单独合并。
 for(const s of localCareerSkills)skills.set(s.id,s);
 for(const e of officialItems.values())equipment.set(e.id,{...e,native:true,level:e.reqLv,requirements:[e.reqStr,e.reqCon,e.reqAgi,e.reqIlt,e.reqWis],durability:e.durMax,localPrice:0,localIcon:e.bagIcon,attackTimes:(e.atk_time||0)+1,hit:e.hitrate||0,powers:[1,2,3].filter(n=>e['power'+n]).map(n=>[e['power'+n],e['powerValue'+n]])});
 equipment.get(LEGENDARY_EGG_ID).localPrice=LEGENDARY_EGG_PRICE;
 for(const id of [spiritRules.boxId,...spiritRules.boxIds])equipment.get(id).localPrice=spiritRules.boxPrice;
 for(const row of officialSkills()){
  if(careerSkillMap.has(row.id)||localCareerSkillIds.has(row.id))continue;
  let s=skills.get(row.id);if(s&&!s.native)throw Error('Official skill ID conflicts with local data: '+row.id);
  if(!s){s={id:row.id,name:row.name,native:true,type:row.type,levels:[],shops:[]};skills.set(row.id,s);}
  s.levels.push({...row,native:true,powers:[1,2,3].filter(n=>row['power'+n]).map(n=>[row['power'+n],row['powerValue'+n]])});
  for(const source of row.sources)if(source.origin==='shop'&&!s.shops.includes(source.shopId))s.shops.push(source.shopId);
  s.levels.sort((a,b)=>a.level-b.level);s.shop=s.shops[0];
 }
 built={restored,equipment,skills};
 return built;
}
export const restored=lazyBox(()=>ensure().restored,'restored');
export const equipment=lazyBox(()=>ensure().equipment,'equipment');
export const skills=lazyBox(()=>ensure().skills,'skills');
export const ITEM_SHOP=901,SKILL_SHOP=1100;
export const bagCapacity=p=>Math.min(INITIAL_BAG_CAPACITY,Math.max(1,p.bagLimit||24));
export const firstFree=p=>Array.from({length:bagCapacity(p)},(_,i)=>30+i).find(slot=>!p.inventory.some(x=>x.slot===slot));
export function normalizeRestoration(p){
 p.inventory??=[];p.skills??={};p.restoration??={};p.baseStats??=[10,10,10,10,10];p.initialStats??=[...p.baseStats];p.attributePoints??=0;p.skillPoints??=0;p.autoSkillIds??=p.progression==='xia-v05'?[...official.newbie.archetype.autoSkillIds]:[];p.initiativeSkillId??=p.progression==='xia-v05'&&p.skills[452]?452:-1;
 reconcileAttributePoints(p);
 migrateCareerSkills(p);
 if(!p.restoration.starterIssued){
  const slot=firstFree(p);
  if(slot!==undefined){p.inventory.push({itemId:800000,slot,quantity:1});p.restoration.starterIssued=true;}
 }
 return p;
}
export function learned(p){return Object.entries(p.skills||{}).map(([id,level])=>{const skill=skills.get(Number(id)),data=p.importedSkillDefinitions?.[`${id}:${level}`]||skill?.levels.find(x=>x.level===level);if(!data)throw Error('存档中的技能版本无法识别: '+id);return {...skill,...data};});}
export function activeSkills(p){
 const result=new Map(learned(p).map(s=>[s.id,{...s,addLevel:0}])),bonuses=new Map();
 for(const instance of (p.inventory||[]).filter(i=>i.slot>=0&&i.slot<30&&!i.pet)){
  const item=itemWithAffixes(equipment.get(instance.itemId),instance);
  // Equipment skills are granted by wearing the item, regardless of binding.
  if(!item.skill)continue;
  const s=instance.combinedSkill?item.skill:nativeEquipmentSkill(item);if(!s)continue;
  const bonus=bonuses.get(s.id)||{level:0,definitions:new Map(),slots:new Map()};
  bonus.level+=s.level;
  if(!bonus.definitions.has(s.level)||instance.slot<bonus.slots.get(s.level)){bonus.definitions.set(s.level,{...s,native:true});bonus.slots.set(s.level,instance.slot);}
  bonuses.set(s.id,bonus);
 }
 for(const [id,bonus] of bonuses){
  const learnedLevel=p.skills?.[id]||0,wanted=Math.min(MAX_EQUIPMENT_SKILL_LEVEL,learnedLevel+bonus.level),skill=skills.get(id);
  const definitions=new Map([...(equipmentSkillLevels.get(id)||[]),...(skill?.levels||[])].map(s=>[s.level,s]));
  // Keep captured equipment definitions for exact single-item levels, and use
  // all captured equipment levels and verified reference levels for the sum.
  for(const [level,s] of bonus.definitions)definitions.set(level,s);
  for(const s of Object.values(p.importedSkillDefinitions||{}))if(s.id===id)definitions.set(s.level,s);
  const current=result.get(id);if(current&&!definitions.has(current.level))definitions.set(current.level,current);
  // Never fabricate effects above the highest available restored skill level.
  let data=[...definitions.values()].filter(s=>s.level<=wanted).sort((a,b)=>b.level-a.level)[0];
  // MOD(equip-skill-stack)：两件相同装备的技能等级是相加的（两枚「天魔惊神の指」＝11+11＝22）。
  // 原来的取法只在「已知等级定义」里挑不超过 wanted 的最大那条，缺 22 级定义时就永远停在 11。
  // 现在把等级对齐到 wanted：有该等级的定义就用它的效果（例：天魔无视 22 级＝无视洞察+400、
  // 无视状态抵抗+300、无视魔法反馈+200，见 data/equipment-skill-levels-extra.json）；
  // 真没有定义时才沿用最高可得定义的效果、只把等级与 wire 改到 wanted，不臆造数值。
  if(data&&data.level<wanted){
   data={...data,level:wanted};
   if(data.native&&data.wireBase64)data.wireBase64=skillBytes(data).toString('base64');
  }
  if(data)result.set(id,{...skill,...data,addLevel:Math.max(0,data.level-learnedLevel),powers:data.native?[1,2,3].filter(n=>data['power'+n]).map(n=>[data['power'+n],data['powerValue'+n]]):data.powers});
 }
 return [...result.values()];
}
export function reconcileSkillSettings(p){const list=activeSkills(p),ids=new Set(list.map(s=>s.id));if(p.initiativeSkillId>0&&!ids.has(p.initiativeSkillId))p.initiativeSkillId=-1;p.autoSkillIds=automaticSkillSlots(p.autoSkillIds,list);}
// 商店列表给出的是「下一级」（不是最高级）：客户端 web/career-skills.js 的
// ShopSkillAndMaxList 是按 {nextLevel:row.skill.level, maxLevel:row.maxLevel} 读的，
// 14001 回包在每条后面额外带一个 byte 的 maxLevel。这里必须保持「下一级」，
// 否则人物技能店的列表会整列显示成满级（上游验收用例也按 (p.skills[id]||0)+1 断言）。
export function availableSkills(p,shop){return [...skills.values()].filter(s=>s.native?s.shops.includes(shop)&&s.levels.some(x=>x.level===1):(shop===SKILL_SHOP||s.shop===shop)).map(s=>{const wanted=(p.skills[s.id]||0)+1;const data=s.levels.find(x=>x.level===wanted)||s.levels.at(-1);return {...s,...data};});}
export function powers(p,kind){const rows=kind==='skill'?activeSkills(p):p.inventory.filter(x=>x.slot<30&&!x.pet).map(x=>{const e=equipment.get(x.itemId)||x.recordedDefinition;if(!e)throw Error('未知装备: '+x.itemId);return e.native?{...e,powers:equipmentPowers(e,x)}:e;});if(kind!=='skill')rows.push({powers:[...setPowers(p),...titlePowers(p)]});if(kind==='skill')rows.push({powers:characterFeaturePowers(p)});const result=new Map();for(const r of rows){if(kind==='skill'&&r.native&&r.type!==1)continue;for(const [id,n] of r.powers)result.set(id,(result.get(id)||0)+n);}return id=>result.get(id)||0;}
const clamp=(x,min,max)=>Math.min(max,Math.max(min,x));
export function attributes(p){
 if(p.importedCharacter){const {stats,base}=nativeCharacterStats(p);return {base,hp:stats.HPMAX,mp:stats.MPMAX};}
 const s=powers(p,'skill'),e=powers(p,'equipment');
 const base=[1,3,5,7,9].map((id,i)=>{const raw=(p.baseStats?.[i]??10)+s(id);return clamp(raw+Math.trunc(raw*(s(id+1)+e(id+1))/100)+e(id),0,32767);});
 const value=(b,id)=>{const flat=Math.trunc(b)+s(id)+e(id);return clamp(flat+Math.trunc(flat*(s(id+1)+e(id+1))/100),1,9999999);};
 const totalLevel=p.level+(p.level2||0);
 const hp=value(Math.trunc(6.5*base[1])+3*base[0]+100+40*(totalLevel-1),11);
 const mp=value(Math.trunc(7.5*base[3])+Math.trunc(3.5*base[4])+50+10*(totalLevel-1),13);
 return {base,hp,mp};
}
export function clampVitals(p){const a=attributes(p);p.hp=Math.min(p.hp,a.hp);p.mp=Math.min(p.mp,a.mp);}
export function buyItem(p,id,quantity){
 const e=equipment.get(id),limit=Math.max(1,e?.stackNum||1);
 if(!e||!Number.isInteger(quantity)||quantity<1||quantity>99||(limit>1&&quantity>limit))throw Error('无效商品或数量。');
 if(p.coins<e.localPrice*quantity)throw Error('铜币不足。');
 const next={...p,inventory:structuredClone(p.inventory)};
 // v305 Bag.addItem_3 adds the entire purchase to a single stack that fits,
 // otherwise to a new slot. It does not fill partial stacks across slots.
 const stack=limit>1?next.inventory.filter(i=>i.slot>=30&&i.slot<30+bagCapacity(p)&&i.itemId===id&&(i.quantity||1)+quantity<=limit).sort((a,b)=>a.slot-b.slot)[0]:null;
 if(stack)stack.quantity=(stack.quantity||1)+quantity;
 else for(let n=0;n<(limit>1?1:quantity);n++){
   const slot=firstFree(next);if(slot===undefined)throw Error('背包空间不足，请整理后再领取。');
   next.inventory.push(ensurePetEquipment({itemId:id,slot,quantity:limit>1?quantity:1},e));
 }
 p.inventory=next.inventory;p.coins-=e.localPrice*quantity;
 return e;
}
export function planItemRemoval(p,requirements){
 const copy={...p,inventory:structuredClone(p.inventory)},removed=[];
 for(const required of requirements){let left=required.quantity;if(!Number.isInteger(left)||left<1)throw Error('无效扣除数量');
  for(const i of copy.inventory.filter(x=>x.slot>=30&&x.itemId===required.id)){if(!left)break;const quantity=Math.min(left,i.quantity||1);left-=quantity;i.quantity=(i.quantity||1)-quantity;removed.push({itemId:i.itemId,slot:i.slot,quantity});}
  if(left)throw Error('背包中的任务道具数量不足。');
 }
 copy.inventory=copy.inventory.filter(x=>x.quantity!==0);return {inventory:copy.inventory,removed};
}
export function planItemRewards(p,rewards){
 const copy={...p,inventory:structuredClone(p.inventory)},added=[];
 for(const reward of rewards){const e=equipment.get(reward.id);if(!e)throw Error('奖励道具详情尚未采集：'+reward.id);
  let left=reward.quantity;const limit=Math.max(1,e.stackNum||1);
  if(!Number.isInteger(left)||left<1)throw Error('无效奖励数量');
  for(const i of copy.inventory.filter(x=>x.slot>=30&&x.itemId===e.id))if(left&&i.quantity<limit){const count=Math.min(left,limit-i.quantity);i.quantity+=count;left-=count;added.push({mode:2,quantity:count,instance:{...i}});}
  while(left){const slot=firstFree(copy);if(slot===undefined)throw Error('背包空间不足，请整理后再领取奖励。');const quantity=Math.min(left,limit),instance=ensurePetEquipment({itemId:e.id,slot,quantity},e);copy.inventory.push(instance);added.push({mode:1,quantity,instance:{...instance}});left-=quantity;}
 }
 return {inventory:copy.inventory,added};
}
// ==== MOD: 无视装备穿戴要求（装备 800100）====
// 只要身上穿着该单手剑，穿戴其它装备时跳过等级与五维需求校验。
// 判定依据是「当前已穿戴状态」(slot < 30 即装备栏)，脱下剑即刻恢复要求。
export {IGNORE_REQUIREMENT_ITEM_ID};
export function ignoresEquipRequirements(p){
 return Array.isArray(p.inventory)&&p.inventory.some(x=>x&&x.slot<30&&!x.pet&&x.itemId===IGNORE_REQUIREMENT_ITEM_ID);
}
// ==== FIX: 武器槽位（单手/双手/副手）规则 ====
// 与客户端 module 0033 的 equipItem/equipWeapon/isSameWeaponType 保持一致。
// 原实现只是「找空槽」，和客户端的判定不一致，会出现穿戴后位置对不上。
const WEAPON_LEFT_POS=8,WEAPON_RIGHT_POS=10,ITEM_TYPE_ONEHAND_HAND=24;
const ONE_HAND_WEAPON_TYPES=new Set([13,15,21,35]);
const TWO_HAND_WEAPON_TYPES=new Set([14,16,18,19,20,22,23,34,36,38,39]);
function isWeaponSlots(slots){return Array.isArray(slots)&&slots.length===2&&slots[0]===WEAPON_LEFT_POS&&slots[1]===WEAPON_RIGHT_POS;}
function isOneHandWeaponType(t){return ONE_HAND_WEAPON_TYPES.has(t);}
function isTwoHandWeaponType(t){return TWO_HAND_WEAPON_TYPES.has(t);}
function weaponAt(p,s){return p.inventory.find(x=>x.slot===s)||null;}
function weaponTypeAt(p,s){const i=weaponAt(p,s);if(!i)return -1;const e=equipment.get(i.itemId)||i.recordedDefinition;return e?e.type:-1;}
function usedWeaponSlots(p){return (weaponAt(p,WEAPON_LEFT_POS)?1:0)+(weaponAt(p,WEAPON_RIGHT_POS)?1:0);}
function hasEquipOneHandHand(p){if(weaponTypeAt(p,WEAPON_LEFT_POS)===ITEM_TYPE_ONEHAND_HAND)return WEAPON_LEFT_POS;if(weaponTypeAt(p,WEAPON_RIGHT_POS)===ITEM_TYPE_ONEHAND_HAND)return WEAPON_RIGHT_POS;return -1;}
// 「无视装备穿戴要求」可与任意类型的单手武器并存
const ANY_ONEHAND_PAIR_ITEM_ID=IGNORE_REQUIREMENT_ITEM_ID;
function weaponItemIdAt(p,s){const i=weaponAt(p,s);return i?i.itemId:0;}
function canPairWeapon(selfId,selfType,otherId,otherType){
 if(otherType===-1)return true;
 if(otherType===selfType)return true;
 return isOneHandWeaponType(selfType)&&isOneHandWeaponType(otherType)&&(selfId===ANY_ONEHAND_PAIR_ITEM_ID||otherId===ANY_ONEHAND_PAIR_ITEM_ID);
}
// 对应客户端 isSameWeaponType：<0 表示会冲突
function sameWeaponTypeStatus(p,t,selfId){
 const l=weaponTypeAt(p,WEAPON_LEFT_POS),r=weaponTypeAt(p,WEAPON_RIGHT_POS);
 if(t===ITEM_TYPE_ONEHAND_HAND){
  return (!isOneHandWeaponType(l)||(r!==-1&&r!==ITEM_TYPE_ONEHAND_HAND))&&(!isOneHandWeaponType(r)||(l!==-1&&l!==ITEM_TYPE_ONEHAND_HAND))?-5:3;
 }
 if(!canPairWeapon(selfId,t,weaponItemIdAt(p,WEAPON_LEFT_POS),l))return -3;
 if(!canPairWeapon(selfId,t,weaponItemIdAt(p,WEAPON_RIGHT_POS),r))return -4;
 if(l===-1&&r===-1)return 2;
 return 1;
}
function slotSwap(p,a,b){const ia=weaponAt(p,a),ib=weaponAt(p,b);if(ia)ia.slot=b;if(ib)ib.slot=a;}
// 对应客户端 equipWeapon：把两个武器槽整体重排，新武器落到左手
function equipWeaponSlots(p,bagSlot){
 const used=usedWeaponSlots(p);
 if(used===2){
  const free=firstFree(p);if(free===undefined)throw Error('背包空间不足，请整理后再穿戴。');
  slotSwap(p,WEAPON_LEFT_POS,bagSlot);slotSwap(p,WEAPON_RIGHT_POS,free);
 }else if(used===1){
  if(weaponAt(p,WEAPON_RIGHT_POS))slotSwap(p,WEAPON_LEFT_POS,WEAPON_RIGHT_POS);
  slotSwap(p,WEAPON_LEFT_POS,bagSlot);
 }else slotSwap(p,WEAPON_LEFT_POS,bagSlot);
}
// 对应客户端 equipItem(bagSlot, posList)
function equipWeaponItem(p,instance,item,dest){
 const slots=item.native?itemSlots(item.type):[WEAPON_LEFT_POS,WEAPON_RIGHT_POS];
 const posList=dest===-1?slots:[dest];
 const off=hasEquipOneHandHand(p)>0&&isOneHandWeaponType(item.type);
 // MOD(weapon-slots-any)：原来这里有个「双手武器 / 与已装备武器类型不同就把两个武器槽
 // 整个腾空」的分支（走 equipWeaponSlots），导致双手武器只能装一把、不同类型武器也要
 // 互相顶替。现在一律走下面的循环：先找空的武器槽，两个都满才与左手整体交换。
 // 客户端 lib/client-weapon-slot-patch.mjs 同步堵掉了 module 0033 里同样的分支。
 for(const pos of posList){
  if(!weaponAt(p,pos)){slotSwap(p,pos,instance.slot);return;}
  if(item.type===ITEM_TYPE_ONEHAND_HAND){
   if(weaponTypeAt(p,pos)===ITEM_TYPE_ONEHAND_HAND){slotSwap(p,pos,instance.slot);return;}
  }else if(off&&isOneHandWeaponType(weaponTypeAt(p,pos))){slotSwap(p,pos,instance.slot);return;}
 }
 if(item.type===ITEM_TYPE_ONEHAND_HAND)throw Error('副手需要搭配单手剑或单手刀。');
 if(off)throw Error('副手只能搭配一件单手武器。');
 slotSwap(p,posList[0],instance.slot);
}
export function equip(p,slot,dest=-1){
 const instance=p.inventory.find(x=>x.slot===slot),item=instance?itemWithAffixes(equipment.get(instance.itemId),instance):null;
 if(slot<30||!item)throw Error('请在背包中选择装备。');
 const slots=item.native?itemSlots(item.type):[8,10];
 if((!item.native&&item.type!==13)||!slots.length||(dest!==-1&&!slots.includes(dest)))throw Error('装备位置不正确。');
 const stats=attributes(p).base;
 // 穿着 800100 时跳过等级/五维校验
 if(!ignoresEquipRequirements(p)&&(p.level<item.level||item.requirements.some((n,i)=>n>stats[i])))throw Error('角色等级或属性未达到穿戴要求。');
 if(isWeaponSlots(slots)){
  // FIX: 武器走单手/双手/副手规则（原实现只是找空槽，会和客户端不一致）
  equipWeaponItem(p,instance,item,dest);
 }else{
  const candidates=dest===-1?slots:[dest];dest=candidates.find(s=>!p.inventory.some(x=>x.slot===s))??candidates[0];
  const old=p.inventory.find(x=>x.slot===dest);if(old)old.slot=slot;instance.slot=dest;
 }
 reconcileSkillSettings(p);clampVitals(p);
}
export function unequip(p,slot){
 const item=p.inventory.find(x=>x.slot===slot);if(!item||slot>=30)throw Error('这个位置没有已穿戴装备。');
 const free=firstFree(p);if(free===undefined)throw Error('背包空间不足。');item.slot=free;reconcileSkillSettings(p);clampVitals(p);
}
export function learn(p,shop,id,level){
 if(shop>=2000&&shop<4000)throw Error('宠物导师的技能资料已录入；宠物学习规则尚未恢复，不能给人物学习。');
 const s=skills.get(id);if(!s||(s.native?!s.shops.includes(shop):(shop!==SKILL_SHOP&&s.shop!==shop)))throw Error('技能不在这个导师的列表中。');
 const data=s.levels.find(x=>x.level===level);
 if(level!==(p.skills[id]||0)+1||!data)throw Error('该等级已学会或尚无可靠资料。');
 if(s.native){if(p.level<(data.reqLevel||1))throw Error('角色等级未达到原版学习要求。');}
 else if(level>p.level)throw Error('本地体验规则：技能等级不能高于角色等级。');
 if(!p.skills[id]&&Object.keys(p.skills).length>=careers.maxLearned)throw Error('已学满 '+careers.maxLearned+' 个技能，请先遗忘一个再学习新技能；已学技能仍可升级。');
 p.skills[id]=level;clampVitals(p);return {...s,...data};
}
// 转职书。客户端用 ITEM_ID_JOB_START(41100)..ITEM_ID_JOB_END(41110) 判定「转职道具」，
// 目标职业号取自 data/career-skill-directory.json 的导师表（侠客1/修真2/战士3/法师4/贤者5/武圣6/枪王10/锤师11/岚舞12）。
// 道具名与 ID 的对应来自 data/official-v305.json 的道具定义。
export const jobBooks=new Map([
 [41100,1],  // 转职为《侠客》
 [41101,2],  // 转职为《修真者》
 [41102,3],  // 转职为《战士》
 [41103,4],  // 转职为《法师》
 [41104,5],  // 转职为《贤者》
 [41105,6],  // 转职为《武圣》
 [41106,10], // 转职为《枪王》
 [41107,11], // 转职为《锤师》
 [41108,12], // 转职为《岚舞》
]);
// 客户端的职业有两份：job 字段，以及 icon1 里的职业位域。Player.prototype.getJob 的实现是
//   getJob(){return isGetSexRaceJobByIcon() ? (icon1.toNumber()>>OFFSET_JOB)&LEN_JOB : this.job}
// isGetSexRaceJobByIcon() 对「自己」以外的玩家为真——选角界面的角色列表、军团/队伍成员都属于这一类，
// 它们显示的职业完全来自 icon1。ModelConst 里 OFFSET_SEX=0/LEN_SEX=1、OFFSET_RACE=1/LEN_RACE=3、
// OFFSET_JOB=3/LEN_JOB=15，即 icon1 低 32 位的 bit0=性别、bit1-2=阵营、bit3-6=职业。
// 原版客户端 setJob() 会同时改写这段位域，所以服务端任何改职业的地方都必须一起改，
// 否则存档里 job 已经是新职业，选角界面却还在显示转职前的职业。
const ICON_UNIT=4294967296,JOB_MASK=15,JOB_SHIFT=3;
export function syncJobIcon(p){
 const value=Number(p.icon1);
 // icon1 为 0 时客户端本来就走 job 字段，此时不要凭空造一个位域，免得性别/阵营跟着变。
 if(!Number.isFinite(value)||value===0)return p;
 const low=Math.floor(value%ICON_UNIT);
 p.icon1=Math.floor(value/ICON_UNIT)*ICON_UNIT+(((low&~(JOB_MASK<<JOB_SHIFT))|((p.job&JOB_MASK)<<JOB_SHIFT))>>>0);
 return p;
}
// 原版转职规则：自动洗点（不消耗任何货币）、删除所有角色技能并返还技能点、背包与装备不变。
// 本地技能一直是免费学习（skillPoints 从未被扣），所以技能点无需返还；属性点则按「基础属性+剩余点」的总量守恒退回。
export function changeJob(p,target){
 if(p.job===target)throw Error('角色已经是这个职业了。');
 const initial=[...(p.initialStats||p.baseStats)];
 const pool=p.baseStats.reduce((sum,n)=>sum+n,0)+(p.attributePoints||0);
 const floor=initial.reduce((sum,n)=>sum+n,0);
 p.job=target;
 syncJobIcon(p);
 p.baseStats=[...initial];
 p.attributePoints=Math.max(0,pool-floor);
 p.skills={};
 reconcileSkillSettings(p);clampVitals(p);
 return p;
}
