import {Writer} from './codec.mjs';
import {exportSkill} from './character-import-codec.mjs';
import {petSkillLevels} from './pet-catalog.mjs';

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
