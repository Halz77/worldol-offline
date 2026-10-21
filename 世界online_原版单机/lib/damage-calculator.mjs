/**
 * 伤害计算器：把「存档里的角色 → 真实面板属性 + 已学技能 → 木桩模拟」串起来。
 *
 * 设计原则（别改成手写近似）：
 *   · 面板属性走 `nativeCharacterBattleStats()`（客户端 0056 的真 `get()`，含装备、
 *     附魔、宝石、套装、被动、称号、城市特征、本地装备覆盖）；
 *   · 技能走 `activeSkills()`（与服务端战斗包同一份定义，含技能编辑器覆盖）；
 *   · 伤害公式照抄主包模块 0251 的 `calcDirectDamage` / `calc` / `calTouchDmg`，
 *     并默认打开 `isPreviewBeta`（当前客户端就是 true）；
 *   · 左右手攻次照第 76 版客户端补丁 `buildAttackPlan()`：总攻次不变，逐手分配武伤。
 *
 * 这里只做只读计算：不写存档、不改全局索引、不启动战斗。
 */
import crypto from 'node:crypto';
import {normalizeRole} from './content.mjs';
import {activeSkills} from './restoration.mjs';
import {nativeCharacterBattleStats} from './native-character-stats.mjs';
import {POWER_LABELS} from './damage-calculator-labels.mjs';

export const damageCalculatorRevision='damage-calculator-20261020-v1';

const MIN_HIT_TIME=1,MAX_HIT_TIME=99;
const BATTLE_DMG_MIN=95,BATTLE_DMG_MAX=105;
const BATTLE_RD_MAX=75;
const MAX_FORCE_RATE=70,MAX_BLOCK_TOUCH=70,BLOCK_HIT_REDUCE=10,MAX_RATE_TOUCH=700;
const MAGIC_WEAPON_TYPES=new Set([19,34,37,38,39]); // 法杖/法器/单手锤/双手锤/双手扇
const PHYSICAL_ATK_TYPES=new Set([0,1,2,3]);
const ATK_TYPE_NAMES=['近身劈砍','远程劈砍','近身穿刺','远程穿刺','魔法攻击','诅咒攻击','祝福'];
const SKILL_TYPE_NAMES={1:'被动',2:'自动',3:'主动'};

const intNum=value=>Math.trunc(Number(value)||0);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const nonNegative=value=>Math.max(0,intNum(value));

function powerValue(skill,code){
 if(!skill)return 0;
 if(Array.isArray(skill.powers))return skill.powers.reduce((sum,item)=>sum+(Number(item?.[0])===code?Number(item?.[1])||0:0),0);
 let total=0;
 for(let i=1;i<=3;i++)if(Number(skill['power'+i])===code)total+=Number(skill['powerValue'+i])||0;
 return total;
}

function powerList(skill){
 const list=Array.isArray(skill?.powers)?skill.powers:[];
 if(list.length&&list[0]&&typeof list[0]==='object'&&!Array.isArray(list[0])){
  return list
   .map(item=>({code:Number(item.code)||0,value:Number(item.value)||0}))
   .filter(item=>item.code)
   .map(item=>({...item,name:POWER_LABELS[item.code]?.name||('效果 '+item.code),percent:!!POWER_LABELS[item.code]?.percent}));
 }
 const source=list.length?list:[[skill?.power1,skill?.powerValue1],[skill?.power2,skill?.powerValue2],[skill?.power3,skill?.powerValue3]];
 return source
   .map(([code,value])=>({code:Number(code)||0,value:Number(value)||0}))
   .filter(item=>item.code)
   .map(item=>({...item,name:POWER_LABELS[item.code]?.name||('效果 '+item.code),percent:!!POWER_LABELS[item.code]?.percent}));
}

function lightweightSkill(skill){
 return {
  id:Number(skill.id)||0,
  name:skill.name||('技能 '+skill.id),
  type:Number(skill.type)||0,
  typeName:SKILL_TYPE_NAMES[Number(skill.type)]||'其他',
  level:Number(skill.level)||1,
  info:skill.info||'',
  skillAtkType:Number(skill.skillAtkType)||0,
  atkTypeName:ATK_TYPE_NAMES[Number(skill.skillAtkType)||0]||'未知',
  atk_time:Number(skill.atk_time)||0,
  area:Number(skill.area)||0,
  round:Number(skill.round)||0,
  useMP:Number(skill.useMP)||0,
  useHP:Number(skill.useHP)||0,
  skillWeapon:Number(skill.skillWeapon)||0,
  powers:powerList(skill)
 };
}

/** 一个角色给计算器用的轻量档案：面板 + 技能，不含 wire/levels/来源等大字段。 */
export function calculatorProfile(role){
 const {stats,base}=nativeCharacterBattleStats(role);
 const byId=new Map();
 for(const skill of activeSkills(role)){
  const current=byId.get(skill.id);
  if(!current||(Number(skill.level)||0)>(Number(current.level)||0))byId.set(skill.id,skill);
 }
 const skills=[...byId.values()]
   .map(lightweightSkill)
   .sort((a,b)=>a.type-b.type||a.id-b.id);
 const autoSkillIds=(role.autoSkillIds||role.autoSkillID||[])
   .map(id=>Number(id)||0)
   .filter(Boolean);
 const initiativeSkillId=Number(role.initiativeSkillId??role.initiativeSkillID??role.autoSkillID_Initiative??0)||0;
 return {
  id:String(role.id??''),
  name:role.name||('角色 '+(role.id??'')),
  level:Number(role.level)||1,
  level2:Number(role.level2)||0,
  job:Number(role.job)||0,
  sex:Number(role.sex)||0,
  base,
  stats,
  autoSkillIds,
  initiativeSkillId,
  skills,
  passiveCount:skills.filter(skill=>skill.type===1).length
 };
}

/** 从 world.json / 单角色导出 / 角色数组里取出可计算的角色，尽量宽松。 */
export function extractCalculatorRoles(document){
 if(Array.isArray(document))return document;
 if(Array.isArray(document?.characters))return document.characters;
 if(Array.isArray(document?.world?.characters))return document.world.characters;
 if(Array.isArray(document?.data?.characters))return document.data.characters;
 if(Array.isArray(document?.save?.characters))return document.save.characters;
 if(document?.character&&typeof document.character==='object')return [document.character];
 if(document?.role&&typeof document.role==='object')return [document.role];
 if(document?.data&&typeof document.data==='object'&&document.data.id!=null)return [document.data];
 if(document?.id!=null&&document?.inventory)return [document];
 throw Error('没有找到角色列表：请选择 world.json 或角色导出文件');
}

/**
 * 解析导入的存档，返回 profiles + warnings。每个角色独立 try/catch：
 * 一个残缺角色不该让整份存档都打不开。
 */
export function profilesFromSave(document){
 const roles=extractCalculatorRoles(document);
 if(!roles.length)throw Error('存档里没有角色');
 const profiles=[],warnings=[];
 const seen=new Set();
 for(let index=0;index<roles.length;index++){
  const raw=roles[index];
  if(!raw||typeof raw!=='object'){warnings.push(`第 ${index+1} 个角色不是对象，已跳过`);continue;}
  try{
   const role=normalizeRole(structuredClone(raw));
   const profile=calculatorProfile(role);
   if(!profile.id)profile.id='imported-'+(index+1);
   let id=profile.id,dup=2;
   while(seen.has(id))id=`${profile.id}#${dup++}`;
   seen.add(id);profile.id=id;
   profiles.push(profile);
  }catch(error){
   warnings.push(`角色 ${raw.name||raw.id||index+1} 无法计算：${error?.message||error}`);
  }
 }
 if(!profiles.length)throw Error('存档里没有可计算的角色：'+warnings.join('；'));
 return {profiles,warnings};
}

// ───────────────────────── 会话（导入存档的临时缓存） ─────────────────────────
const sessions=new Map();
const SESSION_LIMIT=8,SESSION_TTL=30*60*1000;

function cleanSessions(){
 const now=Date.now();
 for(const [token,session] of sessions)if(now-session.createdAt>SESSION_TTL)sessions.delete(token);
 while(sessions.size>SESSION_LIMIT)sessions.delete(sessions.keys().next().value);
}

export function createCalculatorSession(profiles,source='import'){
 cleanSessions();
 const token=crypto.randomUUID();
 const map=new Map(profiles.map(profile=>[profile.id,profile]));
 sessions.set(token,{token,source,createdAt:Date.now(),profiles:map});
 return {token,source,characters:[...map.values()]};
}

export function getCalculatorSession(token){
 cleanSessions();
 const session=sessions.get(String(token||''));
 if(!session)throw Error('计算会话已过期，请重新导入存档');
 return session;
}

export function calculatorSessionSummary(session){
 return {
  token:session.token,
  source:session.source,
  characters:[...session.profiles.values()]
 };
}

// ───────────────────────── 目标木桩 ─────────────────────────
function normalizeTarget(input={},profile){
 return {
  level:Math.max(1,intNum(input.level??profile.stats.LEVEL??1)),
  defStr:nonNegative(input.defStr),
  defStrNearby:nonNegative(input.defStrNearby??input.defStr),
  defStrRange:nonNegative(input.defStrRange??input.defStr),
  defAgi:nonNegative(input.defAgi),
  defAgiNearby:nonNegative(input.defAgiNearby??input.defAgi),
  defAgiRange:nonNegative(input.defAgiRange??input.defAgi),
  defMagic:nonNegative(input.defMagic),
  dodge:nonNegative(input.dodge),
  block:nonNegative(input.block),
  tough:nonNegative(input.tough),
  defField:nonNegative(input.defField),
  mp:nonNegative(input.mp),
  ignoreCritical:nonNegative(input.ignoreCritical),
  weak:!!input.weak,
  blood:!!input.blood
 };
}

function targetLevel(target){return Math.max(1,target.level||1);}

function targetTough(target){
 let tough=target.tough;
 if(target.blood)tough=intNum(tough/2);
 if(target.weak)tough=intNum(tough/2);
 return Math.max(0,tough);
}

// ───────────────────────── 临时修正（手动模拟自动技能增益） ─────────────────────────
function normalizeMods(input={}){
 return {
  atkStrPercent:Number(input.atkStrPercent)||0,
  atkAgiPercent:Number(input.atkAgiPercent)||0,
  atkMagicPercent:Number(input.atkMagicPercent)||0,
  atkStr:Number(input.atkStr)||0,
  atkAgi:Number(input.atkAgi)||0,
  atkMagic:Number(input.atkMagic)||0,
  atkTime:Number(input.atkTime)||0,
  hitRate:Number(input.hitRate)||0,
  hitMagic:Number(input.hitMagic)||0,
  critical:Number(input.critical)||0,
  brkArmor:Number(input.brkArmor)||0,
  magicPenetration:Number(input.magicPenetration)||0
 };
}

function addMods(base,extra){
 const out={...base};
 for(const key of Object.keys(out))out[key]=Number(out[key])+Number(extra[key]||0);
 return out;
}

// 自动技能里能确定是「自身攻击增益」的正向 power。只覆盖攻击/攻次/命中/致命/
// 破甲/法穿这几类；回复、护盾、控制、目标减益和没有目标标记的项一律不自动折算。
// 仍然保留手动「临时修正」，因为同一个 power 在不同技能里也可能是给目标的。
const AUTO_BUFF_CODES={
  28:'atkStrPercent',29:'atkAgiPercent',30:'atkMagicPercent',
  58:'atkStr',59:'atkAgi',60:'atkMagic',
  130:'atkTime',54:'hitRate',56:'hitMagic',57:'critical',69:'brkArmor',75:'magicPenetration'
};

export function collectAutoBuffs(skills=[]){
 const mods=normalizeMods({});
 const applied=[],skipped=[];
 for(const skill of skills){
  for(const power of powerList(skill)){
   if(power.value<=0)continue;
   const key=AUTO_BUFF_CODES[power.code];
   if(!key){skipped.push({skillId:skill.id,skill:skill.name,code:power.code,name:power.name,value:power.value,percent:!!power.percent});continue;}
   mods[key]+=power.value;
   applied.push({skillId:skill.id,skill:skill.name,code:power.code,name:power.name,value:power.value,percent:!!power.percent});
  }
 }
 return {mods,applied,skipped};
}

function applyMods(stats,mods){
 const out={...stats};
 const scale=(key,percent)=>out[key]=Math.max(0,intNum(out[key]*(1+(percent||0)/100)));
 scale('ATK_STR_NEARBY',mods.atkStrPercent);scale('ATK_STR_RANGE',mods.atkStrPercent);scale('ATK_STR',mods.atkStrPercent);
 scale('ATK_AGI_NEARBY',mods.atkAgiPercent);scale('ATK_AGI_RANGE',mods.atkAgiPercent);scale('ATK_AGI',mods.atkAgiPercent);
 scale('ATK_MAGIC',mods.atkMagicPercent);
 for(const key of ['ATK_STR_NEARBY','ATK_STR_RANGE','ATK_STR'])out[key]=Math.max(0,intNum(out[key]+mods.atkStr));
 for(const key of ['ATK_AGI_NEARBY','ATK_AGI_RANGE','ATK_AGI'])out[key]=Math.max(0,intNum(out[key]+mods.atkAgi));
 out.ATK_MAGIC=Math.max(0,intNum(out.ATK_MAGIC+mods.atkMagic));
 out.ATK_TIME=Math.max(MIN_HIT_TIME,Math.min(MAX_HIT_TIME,intNum(out.ATK_TIME+mods.atkTime)));
 out.HIT_RATE=Math.max(0,intNum(out.HIT_RATE+mods.hitRate));
 out.HIT_MAGIC=Math.max(0,intNum(out.HIT_MAGIC+mods.hitMagic));
 out.CRITICAL=Math.max(0,intNum(out.CRITICAL+mods.critical));
 out.BRK_ARMOR=Math.max(0,intNum(out.BRK_ARMOR+mods.brkArmor));
 out.MAGIC_PENETRATION=Math.max(0,intNum(out.MAGIC_PENETRATION+mods.magicPenetration));
 return out;
}

// ───────────────────────── 攻击计划（第 76 版补丁） ─────────────────────────
function isWeaponType(type){return Number(type)>0&&Number(type)!==-401;}

function hand(stats,left){
 const min=Math.max(0,intNum(stats[left?'LEFT_ATK_MIN':'RIGHT_ATK_MIN']));
 const max=Math.max(0,min,intNum(stats[left?'LEFT_ATK_MAX':'RIGHT_ATK_MAX']));
 return {left,min,max,type:intNum(stats[left?'LEFT_WEAPON_TYPE':'RIGHT_WEAPON_TYPE'])};
}

/** 与原版 + 第 76 版客户端补丁一致：总攻次不变，先按左右手攻次轮流，再交替补满。 */
export function buildAttackPlan(stats,skill){
 const total=Math.max(MIN_HIT_TIME,Math.min(MAX_HIT_TIME,intNum(stats.ATK_TIME)+(Number(skill?.atk_time)||0)));
 let left=isWeaponType(stats.LEFT_WEAPON_TYPE)?Math.max(0,intNum(stats.LEFT_ATK_TIME)):0;
 let right=isWeaponType(stats.RIGHT_WEAPON_TYPE)?Math.max(0,intNum(stats.RIGHT_ATK_TIME)):0;
 if(intNum(stats.EQUIP_WEAPON_TYPE)===-401)left=right=0;
 if(left<=0&&right<=0){
  const min=Math.max(0,intNum(stats.ATK_MIN)),max=Math.max(0,min,intNum(stats.ATK_MAX));
  const single={left:true,min,max,type:intNum(stats.EQUIP_WEAPON_TYPE)};
  return Array.from({length:total},()=>single);
 }
 const leftHand=left>0?hand(stats,true):null,rightHand=right>0?hand(stats,false):null;
 const plan=[];let remainLeft=left,remainRight=right;
 while(plan.length<total&&(remainLeft>0||remainRight>0)){
  if(remainLeft>0&&plan.length<total){plan.push(leftHand);remainLeft--;}
  if(remainRight>0&&plan.length<total){plan.push(rightHand);remainRight--;}
 }
 for(let extra=0;plan.length<total;extra++)plan.push(leftHand&&rightHand?(extra%2?rightHand:leftHand):(leftHand||rightHand));
 return plan;
}

// ───────────────────────── 命中 / 致命 / 格挡 / 伤害 ─────────────────────────
function hitRateFor(stats,skill,target){
 const attackType=Number(skill?.skillAtkType)||0;
 const skillHit=powerValue(skill,82);
 if(attackType===4||attackType===5)return intNum((10*(stats.HIT_MAGIC+skillHit))/targetLevel(target));
 if(attackType===6)return 100;
 let rate=stats.HIT_RATE+skillHit-target.dodge;
 let force=Math.min(MAX_FORCE_RATE,stats.FORCE_HIT)+powerValue(skill,85);
 if(force>rate)rate=force;
 return intNum(rate);
}

function critRateFor(stats,skill,target){
 const points=stats.CRITICAL+powerValue(skill,84)-target.ignoreCritical;
 return intNum((15*points)/targetLevel(target));
}

function blockRateFor(stats,skill,target){
 if(!PHYSICAL_ATK_TYPES.has(Number(skill?.skillAtkType)||0))return 0;
 const points=target.block-powerValue(skill,153)-stats.IGNORE_BLOCK;
 return Math.max(0,intNum((7*points)/Math.max(1,stats.LEVEL+stats.LEVEL2)));
}

function attackPointBase(stats,skill,item,totalHitTime,attackType){
 const powerDamage=powerValue(skill,81);
 let statPoints=0;
 if(attackType===0||attackType===1)statPoints=attackType===1?stats.ATK_STR_RANGE:stats.ATK_STR_NEARBY;
 else if(attackType===2||attackType===3)statPoints=attackType===3?stats.ATK_AGI_RANGE:stats.ATK_AGI_NEARBY;
 else if(attackType===4)statPoints=stats.ATK_MAGIC;
 return intNum(statPoints/totalHitTime)+intNum(powerDamage/totalHitTime);
}

function attackPoints(stats,skill,item,totalHitTime,attackType,rng){
 const base=attackPointBase(stats,skill,item,totalHitTime,attackType);
 let weapon=item.max<=item.min?item.min:item.min+Math.floor(rng()*(item.max-item.min+1));
 if(attackType===4&&!MAGIC_WEAPON_TYPES.has(item.type))weapon=0;
 if(!PHYSICAL_ATK_TYPES.has(attackType)&&attackType!==4)weapon=0;
 return base+weapon;
}

function reductionFor(stats,skill,target,attackType){
 if(attackType===0||attackType===1){
  const def=attackType===1?target.defStrRange:target.defStrNearby;
  let value=intNum((80*(def-stats.BRK_ARMOR-powerValue(skill,87)))/100);
  value=intNum(value/Math.max(1,stats.LEVEL+stats.LEVEL2+12));
  return clamp(value,0,BATTLE_RD_MAX);
 }
 if(attackType===2||attackType===3){
  const def=attackType===3?target.defAgiRange:target.defAgiNearby;
  let value=intNum((80*(def-stats.BRK_ARMOR-powerValue(skill,87)))/100);
  value=intNum(value/Math.max(1,stats.LEVEL+stats.LEVEL2+12));
  return clamp(value,0,BATTLE_RD_MAX);
 }
 if(attackType===4){
  let value=intNum((80*(target.defMagic-stats.MAGIC_PENETRATION-powerValue(skill,86)))/100);
  value=intNum(value/Math.max(1,stats.LEVEL+stats.LEVEL2+12));
  return clamp(value,0,BATTLE_RD_MAX);
 }
 return 0;
}

function rollDamage(stats,skill,item,target,attackType,totalHitTime,rng){
 // 诅咒/祝福在 0251 的 calcWithType(BATTLE_DAMAGE) 里直接返回 0，
 // 但仍然会走命中判定；不要给它补一个「最低 1 点」。
 if(!PHYSICAL_ATK_TYPES.has(attackType)&&attackType!==4)return {damage:0,points:0,reduction:0};
 const points=attackPoints(stats,skill,item,totalHitTime,attackType,rng);
 const reduction=reductionFor(stats,skill,target,attackType);
 const variance=BATTLE_DMG_MIN+Math.floor(rng()*(BATTLE_DMG_MAX-BATTLE_DMG_MIN+1));
 // 0251 是「先乘成整数，再除 1e4」，两步截断与一步除法偶尔差 1，照抄两步。
 let raw=intNum((100-reduction)*points*variance);
 if(points>0&&variance>0&&100-reduction>0&&raw<0)raw=2147483647;
 let damage=intNum(raw/10000);
 if(damage<=0)damage=1;
 return {damage,points,reduction};
}

function applyHitEffects(stats,skill,target,damage,blockValue,rng,state){
 let hit=true,crit=false,blocked=false;
 // 衰弱/流血：先加成，再算暴击（与 0251 的顺序一致）。
 let bonus=0;
 if(target.weak)bonus+=20;
 if(target.blood)bonus+=10;
 if(bonus>0)damage+=intNum(damage*bonus/100);
 const critRate=critRateFor(stats,skill,target);
 crit=critRate>Math.floor(rng()*100);
 if(crit)damage=intNum(damage*15/10);
 if(PHYSICAL_ATK_TYPES.has(Number(skill?.skillAtkType)||0)&&blockValue>0){
  const chance=Math.min(MAX_BLOCK_TOUCH,blockValue);
  if(chance>Math.floor(rng()*100))blocked=true;
 }
 if(blocked)hit=false;
 if(hit){
  let tough=targetTough(target)-powerValue(skill,156)-stats.IGNORE_TOUCH;
  tough=Math.min(MAX_RATE_TOUCH,tough);
  if(tough>0)damage=Math.max(0,damage-intNum(damage*tough/1000));
  if(damage>0&&state.defField>0&&state.mp>0){
   const shield=Math.min(damage,Math.min(state.defField,state.mp));
   state.defField-=shield;state.mp-=shield;damage-=shield;
  }
 }
 return {hit,crit,blocked,damage};
}

// ───────────────────────── 单技能 / 组合循环模拟 ─────────────────────────
function emptyStats(){return {hits:0,landed:0,crits:0,blocked:0,damage:0,minHit:Infinity,maxHit:0,apSum:0};}

function addCast(result,cast){
 result.hits+=cast.hits;result.landed+=cast.landed;result.crits+=cast.crits;result.blocked+=cast.blocked;
 result.damage+=cast.damage;result.minHit=Math.min(result.minHit,cast.minHit);result.maxHit=Math.max(result.maxHit,cast.maxHit);
 result.apSum+=cast.apSum;
}

function simulateCast(profile,skill,target,mods,{sample=false,rng=Math.random,round=0,log=null}={}){
 const stats=applyMods(profile.stats,mods);
 const attackType=Number(skill?.skillAtkType)||0;
 const plan=buildAttackPlan(stats,skill);
 const totalHitTime=plan.length;
 const hitRate=hitRateFor(stats,skill,target);
 const critRate=critRateFor(stats,skill,target);
 const blockRate=blockRateFor(stats,skill,target);
 const state={defField:target.defField,mp:target.mp};
 let blockValue=blockRate,hadHit=false;
 const result={hits:0,landed:0,crits:0,blocked:0,damage:0,minHit:Infinity,maxHit:0,apSum:0,hitRate,critRate,blockRate,totalHits:totalHitTime,reduction:reductionFor(stats,skill,target,attackType),attackType};
 for(let index=0;index<plan.length;index++){
  const item=plan[index];
  // 0251 的顺序：先掷命中，再算伤害（未命中也会消耗武器随机数）。
  const hit=hitRate>Math.floor(rng()*100);
  const rolled=rollDamage(stats,skill,item,target,attackType,totalHitTime,rng);
  let applied={hit:false,crit:false,blocked:false,damage:0};
  if(hit)applied=applyHitEffects(stats,skill,target,rolled.damage,blockValue,rng,state);
  result.hits++;result.apSum+=rolled.points;
  if(applied.hit)result.landed++;
  if(applied.crit)result.crits++;
  if(applied.blocked)result.blocked++;
  if(applied.hit)result.damage+=applied.damage;
  if(applied.hit)result.minHit=Math.min(result.minHit,applied.damage);
  if(applied.hit)result.maxHit=Math.max(result.maxHit,applied.damage);
  if(hadHit||applied.hit)blockValue=Math.max(0,blockValue-BLOCK_HIT_REDUCE);
  if(applied.hit)hadHit=true;
  if(sample&&log&&log.length<80)log.push({round,skillId:skill?.id||0,skill:skill?.name||'普通攻击',index:index+1,hand:item.left?'左':'右',hit:applied.hit,crit:applied.crit,blocked:applied.blocked,damage:applied.damage,attackPoints:rolled.points,reduction:rolled.reduction});
 }
 if(!Number.isFinite(result.minHit))result.minHit=0;
 return result;
}

function simulateSkill(profile,skill,target,mods,trials,rng){
 const total=emptyStats();
 let minCast=Infinity,maxCast=0,hitRate=0,critRate=0,blockRate=0,totalHits=0,reduction=0,attackType=0;
 for(let trial=0;trial<trials;trial++){
  const cast=simulateCast(profile,skill,target,mods,{rng});
  addCast(total,cast);minCast=Math.min(minCast,cast.damage);maxCast=Math.max(maxCast,cast.damage);
  hitRate+=cast.hitRate;critRate+=cast.critRate;blockRate+=cast.blockRate;totalHits+=cast.totalHits;reduction+=cast.reduction;attackType=cast.attackType;
 }
 const attempts=total.hits||1;
 return {
  id:skill?.id||0,
  name:skill?.name||'普通攻击',
  type:skill?.type??0,
  typeName:skill?.typeName||(skill?'':'普通'),
  level:skill?.level||1,
  attackType,
  attackTypeName:ATK_TYPE_NAMES[attackType]||'未知',
  totalHits:intNum(totalHits/trials),
  hitRate:intNum(hitRate/trials),
  critRate:intNum(critRate/trials),
  blockRate:intNum(blockRate/trials),
  damage:intNum(total.damage/trials),
  minCast:minCast===Infinity?0:minCast,
  maxCast,
  avgHit:total.landed?intNum(total.damage/total.landed):0,
  minHit:total.minHit,
  maxHit:total.maxHit,
  avgAttackPoints:total.hits?intNum(total.apSum/total.hits):0,
  reduction:intNum(reduction/trials),
  landed:intNum(total.landed/trials),
  crits:intNum(total.crits/trials),
  blocked:intNum(total.blocked/trials),
  attempts:intNum(attempts/trials)
 };
}

function normalSkill(profile){
 return {id:0,name:'普通攻击',type:0,typeName:'普通',level:1,skillAtkType:profile.stats.ATK_TYPE||0,atk_time:0,powers:[]};
}

function skillMap(profile){return new Map(profile.skills.map(skill=>[skill.id,skill]));}

/** 木桩模拟主入口：单技能成绩 + 自动/主动循环成绩 + 一段样例命中记录。 */
export function simulateCalculator(profile,config={}){
 if(!profile)throw Error('角色不存在');
 const target=normalizeTarget(config.target,profile);
 const trials=clamp(intNum(config.trials||1000),50,20000);
 const rounds=clamp(intNum(config.rounds||10),1,50);
 const seed=intNum(config.seed??1)||1;
 const map=skillMap(profile);
 const autoSource=Array.isArray(config.autoSkillIds)?config.autoSkillIds:[];
 const autoIds=[...new Set(autoSource.map(id=>intNum(id)).filter(Boolean))];
 const autoSkills=autoIds.map(id=>map.get(id)).filter(Boolean);
 const autoBuffs=config.applyAutoBuffs?collectAutoBuffs(autoSkills):{mods:normalizeMods({}),applied:[],skipped:[]};
 const mods=addMods(normalizeMods(config.mods),autoBuffs.mods);
 const requestedActive=config.activeSkillId==='normal'?0:intNum(config.activeSkillId);
 const activeId=requestedActive>0?requestedActive:0;
 const active=activeId?map.get(activeId):null;
 if(activeId&&!active)throw Error('主动技能不存在：'+activeId);
 const selected=[...new Set([...autoIds,...(activeId?[activeId]:[0])])]
   .map(id=>id?map.get(id):normalSkill(profile))
   .filter(Boolean);
 const rng=mulberry32(seed);
 const skills=selected.map(skill=>simulateSkill(profile,skill,target,mods,trials,rng));
 const byId=new Map(skills.map(item=>[item.id,item]));
 // 组合循环：每回合先放一个自动技能（按槽位轮换），再放主动技能/普通攻击。
 const rotationTrials=Math.min(trials,300);
 let totalDamage=0,minBattle=Infinity,maxBattle=0,perSkill=new Map();
 for(let trial=0;trial<rotationTrials;trial++){
  let battle=0;
  for(let round=0;round<rounds;round++){
   const auto=autoSkills.length?autoSkills[round%autoSkills.length]:null;
   const casts=[];
   if(auto)casts.push(auto);
   casts.push(active||normalSkill(profile));
   for(const skill of casts){
    const cast=simulateCast(profile,skill,target,mods,{rng});
    battle+=cast.damage;
    const key=skill.id||0;
    perSkill.set(key,(perSkill.get(key)||0)+cast.damage);
   }
  }
  totalDamage+=battle;minBattle=Math.min(minBattle,battle);maxBattle=Math.max(maxBattle,battle);
 }
 const sampleLog=[];
 const sampleSkill=active||normalSkill(profile);
 simulateCast(profile,sampleSkill,target,mods,{sample:true,rng:mulberry32(seed^0x9e3779b9),log:sampleLog,round:1});
 return {
  character:{id:profile.id,name:profile.name,level:profile.level,job:profile.job},
  target,
  mods,
  autoBuffs,
  applyAutoBuffs:!!config.applyAutoBuffs,
  trials,
  rounds,
  seed,
  skills,
  rotation:{
   rounds,
   trials:rotationTrials,
   damage:intNum(totalDamage/rotationTrials),
   minBattle:minBattle===Infinity?0:minBattle,
   maxBattle,
   avgPerRound:intNum((totalDamage/rotationTrials)/rounds),
   perSkill:[...perSkill.entries()].map(([id,damage])=>({id,name:byId.get(id)?.name||(id?'技能 '+id:'普通攻击'),damage:intNum(damage/rotationTrials)})).sort((a,b)=>b.damage-a.damage)
  },
  sample:sampleLog
 };
}

// 简单可复现随机数（mulberry32）；同一 seed 同一结果，方便对比两次改动。
function mulberry32(seed){
 let a=seed>>>0;
 return function(){
  a|=0;a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;
  return ((t^t>>>14)>>>0)/4294967296;
 };
}
