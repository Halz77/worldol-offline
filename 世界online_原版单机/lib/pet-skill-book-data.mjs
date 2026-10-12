import {Writer} from './codec.mjs';
import {exportSkill} from './character-import-codec.mjs';
import {petSkillLevels,petSkillMaxima} from './pet-catalog.mjs';
import {mentorTaughtSkillIds} from './pet-mentors.mjs';

// Local item ID, not an invented official drop. The skill itself is the exact
// recorded Magic Girl level-one skill; type 31 / power 186 is the native seal book.
export const BLOOD_MIST_BOOK_ID=9106079;
export const BLOOD_MIST_SKILL_ID=6079;
const book={id:BLOOD_MIST_BOOK_ID,type:31,handBookItem:false,name:'血雾的结界（封印书）',bagIcon:29,
 info:'在宠物界面使用可习得1级血雾的结界。魔法少女的自动技能，使宠物和主人进入物理攻击无效状态。学习后可在自动技能栏勾选。天生掌握此技能的宠物不能重复学习。',
 grade:0,autoBinding:0,stackNum:99,decomCHest:false,reqLv:0,ownTime:0,durMax:0,price:10,round:0,area:0,
 power1:186,powerValue1:BLOOD_MIST_SKILL_ID,power2:0,powerValue2:1,vipLevelReq:0,needShowRate:false,
 sources:[{origin:'local-requested-pet-skill-book',skillId:BLOOD_MIST_SKILL_ID,skillLevel:1}]};
function definition(book){return new Writer().byte(book.type).bool(false).int(book.id).string(book.name).int(book.bagIcon).string(book.info)
 .byte(book.grade).byte(book.autoBinding).byte(book.stackNum).bool(false).byte(book.reqLv).short(0).int(0).int(book.price)
 .byte(0).byte(0).short(book.power1).short(book.powerValue1).short(0).short(book.powerValue2).byte(0).bool(false).done().toString('base64');}
book.definitionBase64=definition(book);
export const MAGIC_EXHAUSTION_BOOK_ID=9105017;
export const MAGIC_EXHAUSTION_SKILL_ID=5017;
const magicExhaustionSource=petSkillLevels.get(`${MAGIC_EXHAUSTION_SKILL_ID}:9`);
if(!magicExhaustionSource)throw Error('Missing recorded level-nine Magic Exhaustion skill.');
const magicExhaustionLevelDelta=50-6;
const magicExhaustionSkill=exportSkill({...magicExhaustionSource,
 level:50,
 powerValue1:-12-magicExhaustionLevelDelta,
 powerValue2:-30-Math.round(magicExhaustionLevelDelta*7/3),
 round:2,
 useMP:200+Math.round(magicExhaustionLevelDelta*46/3),
 info:'单机推算50级：效果按已恢复的6至9级相邻档位增量外推，范围与状态沿用已采集资料。',
 isLearnByBook:true,
});
const magicExhaustionBook={...book,id:MAGIC_EXHAUSTION_BOOK_ID,name:'魔力衰竭（50级宠物技能书）',
 info:'宠物技能书。使用后使目标宠物学会50级魔力衰竭；技能效果按已恢复的6至9级相邻档位本地推算。',
 powerValue1:MAGIC_EXHAUSTION_SKILL_ID,powerValue2:magicExhaustionSkill.level,
 learnSkill:magicExhaustionSkill,
 sources:[{origin:'local-requested-pet-skill-book',skillId:MAGIC_EXHAUSTION_SKILL_ID,skillLevel:50}],
};
magicExhaustionBook.definitionBase64=definition(magicExhaustionBook);
export const KNIGHTS_DEVOTION_BOOK_ID=9106032;
export const KNIGHTS_DEVOTION_SKILL_ID=6032;
const knightsDevotionSource=petSkillLevels.get(`${KNIGHTS_DEVOTION_SKILL_ID}:8`);
if(!knightsDevotionSource)throw Error('Missing recorded level-eight Knight\'s Devotion skill.');
const knightsDevotionSkill=exportSkill({...knightsDevotionSource,isLearnByBook:true});
const knightsDevotionBook={...book,id:KNIGHTS_DEVOTION_BOOK_ID,name:'骑士的奉献（8级宠物技能书）',
 info:'宠物技能书。使用后使目标宠物学会8级骑士的奉献；技能效果采用已采集的8级技能定义。',
 powerValue1:KNIGHTS_DEVOTION_SKILL_ID,powerValue2:knightsDevotionSkill.level,
 learnSkill:knightsDevotionSkill,
 sources:[{origin:'local-requested-pet-skill-book',skillId:KNIGHTS_DEVOTION_SKILL_ID,skillLevel:8}],
};
knightsDevotionBook.definitionBase64=definition(knightsDevotionBook);
export const localPetSkillBooks=[book,magicExhaustionBook,knightsDevotionBook];

// ── 「装备与补给商人 → 技能书」：训练师教不到的那些宠物技能，各一本满级书 ──
//
// 上游目录里那批人物技能书（power1 176/177/182、type 31、61001 等）已在
// lib/supply-shops.mjs 里整体下架，这个分类从此只卖宠物技能书。
//
// **只留训练师教不到的**：宠物训练师（商店 2001/2002/2003，走 14001/14002）能免费
// 逐级教到满级的技能不在商店里卖 —— 同一门技能两个来源没有意义，也把列表撑得很长。
// 剔除名单取自 lib/pet-mentors.mjs 的 mentorTaughtSkillIds()（和 petMentorSkills 同源），
// 不在这里自己重判一遍。剩下的是目录里的天生（innate）技能：宠物自己升级学不到、
// 训练师也不教，只有书能给别的宠物补上。
//
// 「满级」= lib/pet-catalog.mjs 的 petSkillMaxima()，和宠物导师商店
// （14001/14002 的 offer.levels.at(-1)）能教到的上限是同一个口径。
//
// 编号：930000000 + 技能编号 * 128 + 等级（等级 ≤ 127，所以这一段不会撞车）。
// 和封印产物（createSealedPetSkillBook 的 920000000 段）刻意分开：封出来的书带着
// 当时宠物的品质（grade），商店书是目录价，两者不该堆到同一个 itemId 上。
export const PET_SKILL_SHOP_BOOK_ID_BASE=930000000;
export function petSkillShopBookId(skill){return PET_SKILL_SHOP_BOOK_ID_BASE+skill.id*128+skill.level;}
let registry=null,shopBooks=null;
/**
 * 全部宠物满级技能书的**定义登记表**（目录里每个技能各一本，含训练师那批）。
 *
 * 它是 `petSkillShopBooks()` 的超集，唯一的用途是**让老存档还认得出来**：
 * 第 44 版（2026-10-12）曾经把 345 本全摆上商店，玩家可能已经买过训练师那批。
 * `lib/restoration-packets.mjs` 的 itemPacket 遇到未知道具是**直接抛错**的，而它在
 * 「进入世界」的整包里（enterWorld → worldData → bagPacket）—— 定义一撤，
 * 那个角色就永远黑屏（第 43 版踩过的正是这一类）。所以下架只是不进商店，
 * **定义一律留着**，多出来的这 71 条对玩家不可见。
 */
export function petSkillBookRegistry(){
 if(!registry)registry=petSkillMaxima().map(skill=>{
  const item={...book,id:petSkillShopBookId(skill),
   name:`${skill.name}（满级技能书·${skill.level}级）`,
   info:`宠物技能书。在宠物的道具界面使用，可学习${skill.level}级${skill.name}（该技能已采集到的最高等级；宠物训练师不教这个技能，只能靠书学）。天生掌握此技能的宠物不能重复学习。`,
   power1:186,powerValue1:skill.id,power2:0,powerValue2:skill.level,
   learnSkill:exportSkill({...skill,isLearnByBook:true}),
   sources:[{origin:'local-requested-pet-skill-book',skillId:skill.id,skillLevel:skill.level}]};
  if(item.learnSkill.id!==skill.id||item.learnSkill.level!==skill.level)throw Error('满级宠物技能书导出的技能与目录不一致：'+skill.id);
  item.definitionBase64=definition(item);
  return item;
 });
 return registry;
}
/** 真正在「技能书」分类里卖的（登记表剔除训练师能教到的那些），按技能编号升序。 */
export function petSkillShopBooks(){
 if(shopBooks)return shopBooks;
 const taught=mentorTaughtSkillIds();
 shopBooks=petSkillBookRegistry().filter(b=>!taught.has(b.powerValue1));
 return shopBooks;
}
/** 技能书分类的上架名单（Set，供 supply-shops 的 supplyCategory 逐件判定；缓存在这里避免反复重建）。 */
let shopBookIds=null;
export function petSkillShopBookIds(){
 if(!shopBookIds)shopBookIds=new Set(petSkillShopBooks().map(b=>b.id));
 return shopBookIds;
}

// A sealed book carries the exact skill definition in the save. This also
// supports captured pet skills that have no ordinary shop-book template.
export function createSealedPetSkillBook(source,grade){
 const skill=exportSkill({...source,isLearnByBook:true});
 if(skill.id>32767)throw Error('这个技能编号超出宠物封印协议范围。');
 const item={...book,id:920000000+skill.id*128+skill.level,
  name:`${skill.name}（封印书·${skill.level}级）`,
  info:`从宠物封印获得。在其他宠物的道具界面使用，可学习${skill.level}级${skill.name}。保留封印时的技能效果。`,
  grade:Math.max(0,Math.min(4,Number(grade)||0)),powerValue1:skill.id,powerValue2:skill.level,
  sources:[{origin:'local-pet-seal',skillId:skill.id,skillLevel:skill.level}],native:true,imported:true,localPrice:0,level:0,durability:0};
 item.definitionBase64=definition(item);
 return {itemId:item.id,quantity:1,recordedDefinition:item,sealedPetSkill:skill};
}
