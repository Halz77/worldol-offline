import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {patchCharacterAttackMethod} from './client-combat-limits.mjs';
import {decoders} from '../tools/capture-decoders.mjs';
import {Writer} from './codec.mjs';
import {itemPacket} from './restoration-packets.mjs';
import {activeSkills} from './restoration.mjs';
import {setAttributeData} from './equipment-sets.mjs';
import {selectedTitle} from './recorded-content.mjs';
import {characterFeaturePowers} from './character-features.mjs';
import {importedCombatFields} from './character-import-codec.mjs';

// Run only reviewed, pure v305 attribute methods. No client startup, UI, socket,
// battle state or save mutation is involved. This keeps scoring on native stats.
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
const M=d.module(12).constants,C=d.constants,Item=d.Item,Bag=d.module(33).constants;
const intNum=d.native(13,'intNum');
const Tool={MAX_VALUE_int:2147483647,MAX_VALUE_short:32767,sumValue:(v,add,min,max)=>Math.max(min,Math.min(max,v+add))};
const itemScope={e:Item,a:{default:C},E:{GUtil:{intNum}},d:{Tool}};
Item.isUpgradeItemOpen=true;
Item.getpowerValueAdd=d.native(32,'getpowerValueAdd',itemScope);
const readItem=d.native(32,'fromBytesAtts1',itemScope);
for(const name of ['get','getPowerValue','getPower1AndPower2','isAscension','isAutoBinding','isBinded','isTimeItem','isTimeItemTimeOut','isVipItem','isVipItemTimeOut','getItemHitRate','getItemSetID'])Item.prototype[name]=d.native(32,name,itemScope);
const bagMethods={};
for(const name of ['get','getForPos','getForArray','get_3','getItemAtkType','getEquipPowerValue','getEquipItemSetNum','isValidPos','getItem'])bagMethods[name]=d.native(33,name,{e:Bag,a:{default:Item},n:{default:C}});
const playerClass={getItemSetID:d.native(56,'getItemSetID'),getItemSetNum:d.native(56,'getItemSetNum')};
const scope={t:playerClass,n:{default:C},a:{Tool},r:{default:Item},s:{default:Bag},_:{ModelConst:M},g:{GUtil:{intNum}},y:{default:{isPreviewBeta:true}},P:{default:{getSpecialIconData:()=>null}},e:{prototype:{get(key){if(key===M.LEVEL)return this.level;if(key===M.LEVEL2)return this.level2||0;throw Error('Unmapped native score attribute: '+key);}}}};
const playerMethods={};
for(const name of ['get','getAttribute','getBaseValue','getPowerValue','getPowerValueCal','getPowerValueByBuffer','getBagEquipPowerValue','getEquipWeaponType','addWeaponSkillDamageOrDur','addWeaponSkillAtkTime'])playerMethods[name]=d.native(56,name,scope);
playerMethods.get=new vm.Script('('+patchCharacterAttackMethod(d.module(56).methods.get('get'))+')').runInNewContext(scope,{timeout:1000});
const zeroFields='speed atkMin atkMax atk_time atk_str atk_agi atk_magic def_str def_agi def_magic dodge hitrate hitMagic critical forceHit wil tough block brkArmor magic_penetration insight def_field back magic_back life_absorption mana_absorption heal_recovery mana_recovery recovery keepout_atk_time ignore_back ignore_magic_back ignore_block ignore_insight ignore_wil ignore_touch ignoreCritical criticalDmg atk_str_range atk_str_nearby atk_agi_range atk_agi_nearby def_str_range def_str_nearby def_agi_range def_agi_nearby _hpMax _mpMax'.split(' ');
export const ratingStatKeys=['HPMAX','MPMAX','ATK_STR_NEARBY','ATK_STR_RANGE','ATK_AGI_NEARBY','ATK_AGI_RANGE','ATK_MAGIC','ATK_MIN','ATK_MAX','ATK_TIME','DEF_STR_NEARBY','DEF_STR_RANGE','DEF_AGI_NEARBY','DEF_AGI_RANGE','DEF_MAGIC','DEF_FIELD','HIT_RATE','HIT_MAGIC','DODGE','CRITICAL','BLOCK','INSIGHT','WIL','SPEED','BRK_ARMOR','MAGIC_PENETRATION','TOUGH','IGNORE_BACK','IGNORE_MAGIC_BACK','IGNORE_BLOCK','IGNORE_INSIGHT','IGNORE_WIL','IGNORE_TOUCH','FORCE_HIT','LIFE_ABSORPTION','MANA_ABSORPTION','HEAL_RECOVERY','MANA_RECOVERY'];

// 伤害计算器用到的完整面板（不只是战力评分那 38 项）。这里的键都会走真实的
// 客户端 0056 `get()`，所以装备、附魔、宝石、套装、被动、称号、城市特征等加成
// 与服务端实际战斗时看到的是同一份数值。新增键之前先在 tests/damage-calculator.test.mjs
// 里确认 `get()` 有对应 case（否则会抛 Unmapped/Invalid）。
export const battleStatKeys=[
 'HPMAX','MPMAX','SPEED',
 'ATK_TYPE','ATK_MIN','ATK_MAX','ATK_TIME','ATK_STR','ATK_AGI','ATK_MAGIC',
 'LEFT_WEAPON_TYPE','RIGHT_WEAPON_TYPE','LEFT_ATK_MIN','LEFT_ATK_MAX','RIGHT_ATK_MIN','RIGHT_ATK_MAX','LEFT_ATK_TIME','RIGHT_ATK_TIME',
 'ATK_STR_NEARBY','ATK_STR_RANGE','ATK_AGI_NEARBY','ATK_AGI_RANGE',
 'DEF_STR','DEF_AGI','DEF_MAGIC','DEF_STR_NEARBY','DEF_STR_RANGE','DEF_AGI_NEARBY','DEF_AGI_RANGE',
 'DODGE','HIT_RATE','HIT_MAGIC','CRITICAL','CRITICAL_DAMAGE','FORCE_HIT','WIL','TOUGH','BLOCK','BRK_ARMOR','INSIGHT','DEF_FIELD',
 'BACK','MAGIC_BACK','LIFE_ABSORPTION','MANA_ABSORPTION','MAGIC_PENETRATION','HEAL_RECOVERY','MANA_RECOVERY','RECOVERY',
 'IGNORE_BACK','IGNORE_MAGIC_BACK','IGNORE_BLOCK','IGNORE_INSIGHT','IGNORE_WIL','IGNORE_TOUCH','IGNORE_CRITICAL',
 'KEEPOUT_ATK_TIME'
];

function nativePlayer(role){
 const bag=Object.assign({store:new Array(160).fill(null)},bagMethods);
 for(const instance of role.inventory||[]){
  if(instance.pet||instance.slot<0||instance.slot>=30)continue;
  const reader=new d.Reader(itemPacket(new Writer(),instance).done()),item=new Item();
  readItem(item,reader);Item.fromBytesAtts2(item,reader);reader.finish();bag.store[instance.slot]=item;
 }
 const skills=activeSkills(role),powers=new Map();
 for(const skill of skills){if((skill.type??1)!==1)continue;for(const [key,value] of skill.powers||[])powers.set(key,(powers.get(key)||0)+value);}
 const featurePowers=new Map(characterFeaturePowers(role));
 // 第 80 版：图鉴加成整块删除（第 77 版曾把 p.handbook.powers 折在这里 —— 原版落点是
 // 战斗单位的 getPower，我们折在 getSkillPowerValue 上，实测数值过强）。现在图鉴只是
 // 收集系统：属性计算不读 p.handbook，老存档里残留的 powers 由 handbook.refreshHandbook()
 // 在进世界时清空，客户端也会收到空的 32109（bookGroupPower 被清空）。
 const player={...Object.fromEntries(zeroFields.map(k=>[k,0])),...playerMethods,type:3,level:role.level||1,bag,itemSetData:setAttributeData(role),getSkillPowerValue:(type,key)=>key>0?((type===1?(powers.get(key)||0):0)+(featurePowers.get(key)||0)):0,getCountryBuffer:()=>0};
 player.level2=role.level2||0;for(const key of importedCombatFields)player[key]=role.importedCombatModifiers?.[key]||0;
 ['str','con','agi','ilt','wis'].forEach((key,i)=>player[key]=role.baseStats?.[i]??10);
 const title=selectedTitle(role);Object.assign(player,{titlePower1:title?.power1||0,titlePowerValue1:title?.value1||0,titlePower2:title?.power2||0,titlePowerValue2:title?.value2||0});
 const get=player.get;
 // Match the existing offline tutorial's unarmed 12–18 left-hand fallback.
 player.get=function(key){const value=get.call(this,key);return value<=0&&key===M.LEFT_ATK_MIN?12:value<=0&&key===M.LEFT_ATK_MAX?18:value;};
 return player;
}
export function nativeCharacterPowers(role){const p=nativePlayer(role);return {equipment:key=>p.getBagEquipPowerValue(key),skill:key=>p.getSkillPowerValue(C.SKILL_TYPE_PASSIVE,key)};}
export function nativeCharacterStats(role){
 const player=nativePlayer(role),skills=activeSkills(role);
 const stats=Object.fromEntries(ratingStatKeys.map(key=>{if(!Number.isInteger(M[key]))throw Error('Missing native score attribute '+key);const value=player.get(M[key]);if(!Number.isFinite(value))throw Error('Invalid native score attribute '+key);return [key,Math.max(0,value)];}));
 return {stats,base:['STR','CON','AGI','ILT','WIS'].map(key=>player.get(M[key])),skillLevels:skills.filter(s=>s.type===2||s.type===3).reduce((n,s)=>n+s.level,0)};
}

/**
 * 伤害计算器用的完整属性。与 `nativeCharacterStats` 共用同一个 nativePlayer，
 * 只是额外把攻击类型、左右手、命中/致命/减伤等也读出来。
 */
export function nativeCharacterBattleStats(role){
 const player=nativePlayer(role),stats={};
 for(const key of battleStatKeys){
  if(!Number.isInteger(M[key]))throw Error('Missing native battle attribute '+key);
  const value=player.get(M[key]);
  if(!Number.isFinite(value))throw Error('Invalid native battle attribute '+key);
  stats[key]=value;
 }
 stats.EQUIP_WEAPON_TYPE=player.getEquipWeaponType();
 stats.LEVEL=Number(role.level||1);
 stats.LEVEL2=Number(role.level2||0);
 return {stats,base:['STR','CON','AGI','ILT','WIS'].map(key=>player.get(M[key]))};
}
