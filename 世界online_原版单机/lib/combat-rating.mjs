import {nativeCharacterStats} from './native-character-stats.mjs';
import {Writer} from './codec.mjs';

export const combatRatingRevision='local-rating-v2';
export const COMBAT_RATING_MULTIPLIER=100;
export const MAX_COMBAT_RATING=2147483647;
// Local progression score, not the unpublished official formula or damage.
export function scoreCombatStats(stats,skillLevels=0){
 const v=key=>{const value=Number(stats[key]??0);if(!Number.isFinite(value))throw Error('Invalid combat rating input: '+key);return Math.max(0,value);};
 const sum=keys=>keys.reduce((n,key)=>n+v(key),0);
 const physical=Math.max(v('ATK_STR_NEARBY'),v('ATK_STR_RANGE'),v('ATK_AGI_NEARBY'),v('ATK_AGI_RANGE'));
 const weapon=(v('ATK_MIN')+v('ATK_MAX'))/2,attacks=Math.min(99,v('ATK_TIME'));
 const rows=[
  ['offense','输出',Math.max(physical+weapon*attacks,v('ATK_MAGIC'))/100,'max（最高物理攻击＋武器平均伤害×攻击次数，魔法攻击）÷100'],
  ['survival','生存',v('HPMAX')/20+v('MPMAX')/40+(sum(['DEF_STR_NEARBY','DEF_STR_RANGE','DEF_AGI_NEARBY','DEF_AGI_RANGE'])/2+v('DEF_MAGIC'))/100+v('DEF_FIELD')/20,'生命上限÷20＋法力上限÷40＋（平均劈砍防御＋平均穿刺防御＋魔防）÷100＋法力护盾÷20'],
  ['technique','战斗属性',sum(['HIT_RATE','HIT_MAGIC','DODGE','CRITICAL','BLOCK','INSIGHT','WIL'])/5+v('SPEED')/20+sum(['BRK_ARMOR','MAGIC_PENETRATION'])/50+sum(['TOUGH','IGNORE_BACK','IGNORE_MAGIC_BACK','IGNORE_BLOCK','IGNORE_INSIGHT','IGNORE_WIL','IGNORE_TOUCH'])/5+Math.min(100,v('FORCE_HIT'))*10+sum(['LIFE_ABSORPTION','MANA_ABSORPTION','HEAL_RECOVERY','MANA_RECOVERY'])/10,'（命中＋魔命＋闪避＋致命＋格挡＋洞察＋状态抵抗）÷5＋出手÷20＋（破甲＋魔穿）÷50＋（伤免＋六类无视）÷5＋强制命中×10＋（吸血＋吸蓝＋回血＋回蓝）÷10'],
  ['skills','主动／自动技能',Math.max(0,Number.isFinite(skillLevels)?skillLevels:0)*10,'当前有效的主动与自动技能等级合计×10；被动技能通过面板计分']
 ];
 const parts=rows.map(([id,name,value,formula])=>({id,name,score:Math.min(MAX_COMBAT_RATING,Math.floor(value)*COMBAT_RATING_MULTIPLIER),formula}));
 const raw=parts.reduce((n,p)=>n+p.score,0);
 return {revision:combatRatingRevision,multiplier:COMBAT_RATING_MULTIPLIER,total:Math.min(MAX_COMBAT_RATING,raw),capped:raw>MAX_COMBAT_RATING||rows.some(row=>Math.floor(row[2])*COMBAT_RATING_MULTIPLIER>MAX_COMBAT_RATING),parts};
}
const cache=new WeakMap();
export function combatRating(role){
 const key=JSON.stringify([role.level,role.level2,role.baseStats,role.skills,role.vipLevel2,role.characterFeatures,role.titleId,role.importedTitle,role.importedSkillDefinitions,role.importedRolePowers,role.importedCombatModifiers,(role.inventory||[]).filter(i=>i.slot<30&&!i.pet)]);
 const previous=cache.get(role);if(previous?.key===key)return previous.value;
 const {stats,skillLevels}=nativeCharacterStats(role),value={...scoreCombatStats(stats,skillLevels),role:role.id,name:role.name,stats,skillLevels};
 cache.set(role,{key,value});return value;
}
// Native actor combat-power push also carries six flat modifier fields. Local
// equipment modifiers are already in item powers, so leave those base fields 0.
export function combatRatingPacket(role){const w=new Writer().int(combatRating(role).total);for(let i=0;i<6;i++)w.int(0);return w;}
export function syncCombatRating(context,send){
 if(!context.role){delete context.lastCombatRating;return;}
 const rating=combatRating(context.role),key=rating.role+':'+rating.total;
 if(context.lastCombatRating===key)return;
 send(12049,combatRatingPacket(context.role));context.lastCombatRating=key;
}
