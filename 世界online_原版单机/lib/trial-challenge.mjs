/**
 * 无限试炼（试炼面板）—— 打一只超肉 BOSS，按造成的伤害比例领三档奖励。
 *
 * ## 伤害从哪来（第 78 版起）
 * 原版战斗是**本地算的**，服务端只收到胜负结果，拿不到伤害数字。
 * 客户端在战斗结束（ON_BATTLE_END）时把统计到的伤害用 trial-settle 上报
 * （见 web/home-features.js 的 damage 钩子），服务端据此定档 + 刷新「我的最高伤害」——
 * 与参考实现「幻想世界OL 3.0 最终版」一致。
 *
 * 两条路都可能先到（12502 的战斗结算 / 客户端上报），闸门是 state.awarded：
 *   ① 打赢 → 12502 直接按满伤害吃最高档（不依赖客户端上报，老客户端也不会漏奖）；
 *   ② 没打赢 → 服务端没有伤害数字，**不发奖**，等客户端上报后按真实伤害比例定档。
 * 同一场挑战只发一次奖 —— 先到的发，后到的只更新记录。
 *
 * ## 奖励只发「真有定义」的道具
 * planItemRewards 碰到缺定义的道具会**整包抛错**，所以这里每一件都选本工程
 * official.items 里有的：指令书 / 宠物经验卷 / 人物经验卷 / 十三周年特供礼盒。
 * 社区版那档「大额充值赠送(绑定)」(40048) 在我们这份抓包里没有定义，已去掉。
 *
 * ## 两个坑
 * ① 试炼组不在任何地图上 → 12501 要跳过「站到 NPC 旁边」的距离校验
 *    （同永泽塔塔层、太阳神殿棋盘，见 pendingTrialGroup）。
 * ② 下发世界数据时必须确认这一组真的存在（照塔的 towerExtraGroups 写法）：
 *    存档里可能残留 trialPendingGroup 而组已不在表 → 整包写歪 → 客户端 Error #1025。
 */
import {official,officialMonsters,officialGroups} from './official-data.mjs';
import {dailyKey} from './daily-activity.mjs';
import {planItemRewards} from './restoration.mjs';
import {gainItemsPacket} from './daily-service.mjs';
import {TRIAL_GROUP_ID,TRIAL_BOSSES,TRIAL_SLOT_COUNT,TRIAL_BUY_GOLD,TRIAL_DAILY_BUY,TRIAL_DAILY_CHALLENGE,trialBossAt,syncTrialGroup,isTrialGroup} from './trial-challenge-data.mjs';

export {TRIAL_GROUP_ID,TRIAL_BUY_GOLD,TRIAL_DAILY_BUY,TRIAL_DAILY_CHALLENGE,TRIAL_SLOT_COUNT,TRIAL_BOSSES,trialBossAt,isTrialGroup} from './trial-challenge-data.mjs';
export {TRIAL_TEMPLATE_ID,TRIAL_BOSS_HP} from './trial-challenge-data.mjs';

/** 奖励档位必须按 minRatio **降序**（结算用 find(ratio>=minRatio) 取第一个满足的）。 */
export const TRIAL_REWARD_TIERS=[
 {minRatio:0.5,label:'第三阶段（伤害 ≥ 50%）',items:[{id:100897,quantity:2}]},
 {minRatio:0.2,label:'第二阶段（伤害 ≥ 20%）',items:[{id:40006,quantity:3},{id:40007,quantity:3}]},
 {minRatio:0,label:'第一阶段（参与）',items:[{id:40002,quantity:1}]},
];
export const TRIAL_ACTIONS=['trial-buy','trial-config','trial-challenge','trial-settle'];
/** 「挑战记录」保留条数（面板里的记录页；参考实现是按次数列的，我们存最近 N 条）。 */
export const TRIAL_HISTORY_LIMIT=20;

/** 编队里的宠物 id 统一成「最多 3 个正整数」，脏数据（null/字符串/负数）直接丢。 */
const normalizePets=x=>Array.isArray(x)?x.filter(v=>Number.isSafeInteger(Number(v))&&Number(v)>0).slice(0,TRIAL_SLOT_COUNT):[];
/** 挑战记录：只留 {hurt,fightPower,time} 三条数字，最多 TRIAL_HISTORY_LIMIT 条。 */
const normalizeHistory=x=>Array.isArray(x)?x.filter(r=>r&&Number.isSafeInteger(Number(r.hurt))&&Number(r.hurt)>=0)
 .slice(0,TRIAL_HISTORY_LIMIT).map(r=>({hurt:Number(r.hurt),
  fightPower:Number.isSafeInteger(Number(r.fightPower))?Number(r.fightPower):0,
  time:Number.isFinite(Number(r.time))?Number(r.time):0})):[];
/** 档位 = 按「伤害 / BOSS 满血」比例取第一个满足 minRatio 的档（列表已按比例降序）。 */
export function trialTierFor(damage,hpMax){
 const ratio=hpMax>0?Math.min(1,Math.max(0,Number(damage)||0)/hpMax):0;
 return TRIAL_REWARD_TIERS.find(t=>ratio>=t.minRatio)||TRIAL_REWARD_TIERS.at(-1);
}
/**
 * 只读归一化：**绝不往 p 上写任何东西**。
 * 快照（打开面板）走这条 —— 否则查一次面板就给角色凭空长出 trial 字段，
 * 存档被改脏、tests/home-features.test.mjs 的「查副本不能改角色」也会挂。
 */
function readTrialState(p,now=Date.now()){
 const day=dailyKey(now),raw=p&&typeof p.trial==='object'&&p.trial?p.trial:null;
 // history 跨天保留（是「挑战记录」，不是当日进度）；awarded 是「这一场挑战发过奖没有」的闸门。
 const history=normalizeHistory(raw?.history);
 if(!raw||raw.day!==day)return {day,used:0,bought:0,bestDamage:0,pets:normalizePets(raw?.pets),awarded:false,history};
 return {day,used:Number.isSafeInteger(raw.used)?raw.used:0,bought:Number.isSafeInteger(raw.bought)?raw.bought:0,
  bestDamage:Number.isSafeInteger(raw.bestDamage)?raw.bestDamage:0,pets:normalizePets(raw.pets),
  awarded:raw.awarded===true,history};
}
/** 写入路径：跨天/损坏时重建当日状态，返回的**就是** p.trial（改它等于改角色）。 */
export function trialState(p,now=Date.now()){
 p.trial=readTrialState(p,now);
 return p.trial;
}
/**
 * 发奖闸门（同一场挑战只发一次）：state.awarded 就是那把锁。
 * 谁先到谁发 —— 12502 的战斗结算（打赢）或客户端的 trial-settle 上报（真实伤害）。
 * @returns {null | {tier:object,damage:number}} null = 这一场已经发过了
 */
function grantTrialReward(p,state,damage,now=Date.now()){
 if(state.awarded)return null;
 const safe=Math.max(0,Math.floor(Number(damage)||0));
 const tier=trialTierFor(safe,Number(officialMonsters.get(trialBossAt(now).id)?.hpMax)||0);
 state.awarded=true;
 if(safe>(state.bestDamage||0))state.bestDamage=safe;
 state.history=normalizeHistory([{hurt:safe,fightPower:Number(p.combatPoint)||0,time:now},...(state.history||[])]);
 return {tier,damage:safe};
}
/** 「我的最高伤害」总能刷新（奖励已经发过也刷）——上报值与 12502 的满伤害都可能更高。 */
function recordTrialDamage(state,damage){
 const safe=Math.max(0,Math.floor(Number(damage)||0));
 if(safe>(state.bestDamage||0))state.bestDamage=safe;
}
export function trialCounts(p,now=Date.now()){
 const state=readTrialState(p,now),total=TRIAL_DAILY_CHALLENGE+(state.bought||0);
 return {left:Math.max(0,total-(state.used||0)),total,used:state.used||0,bought:state.bought||0,
  buyLeft:Math.max(0,TRIAL_DAILY_BUY-(state.bought||0)),buyPrice:TRIAL_BUY_GOLD};
}
/** 世界数据里要额外带上的组（必须确认组真的存在）。 */
export const trialExtraGroups=p=>Number(p?.trialPendingGroup)===TRIAL_GROUP_ID&&officialGroups.has(TRIAL_GROUP_ID)?[TRIAL_GROUP_ID]:[];
/** 存档里可能残留「已不存在的组」标记，顺手清掉。 */
export function trialDropStalePending(p){
 if(p?.trialPendingGroup&&!officialGroups.has(Number(p.trialPendingGroup)))delete p.trialPendingGroup;
}
export const pendingTrialGroup=context=>Number(context?.trialPendingGroup)||0;
export function clearTrialPending(context){if(context)context.trialPendingGroup=0;}

export function trialSnapshot(p,now=Date.now()){
 trialDropStalePending(p);
 const state=readTrialState(p,now),counts=trialCounts(p,now),boss=officialMonsters.get(trialBossAt(now).id)||null;
 const detail=id=>{const m=officialMonsters.get(id);return {id,name:m?.name||'',icon1:String(m?.icon1||''),level:m?.level||1,hpMax:m?.hpMax||0,exists:!!m};};
 return {name:'无限试炼',available:!!boss,
  boss:boss?{id:boss.id,name:boss.name,icon1:String(boss.icon1||''),level:boss.level||1,hpMax:boss.hpMax||0,atkMin:boss.atkMin||0,atkMax:boss.atkMax||0}:null,
  bosses:TRIAL_BOSSES.map(b=>({...detail(b.id),fromHour:b.fromHour,toHour:b.toHour})),
  bossHour:new Date(now).getHours(),groupId:TRIAL_GROUP_ID,slots:TRIAL_SLOT_COUNT,
  pets:state.pets.slice(),bestDamage:state.bestDamage||0,challenge:counts,
  history:(state.history||[]).map(r=>({hurt:r.hurt,fightPower:r.fightPower,time:r.time})),
  rankInfo:(state.bestDamage||0)>0?[{rank:1,actorId:p.id,name:p.name||'我',power:p.combatPoint||0,hurt:state.bestDamage||0,icon1:p.icon1||''}]:[],
  rewards:TRIAL_REWARD_TIERS.map(t=>({minRatio:t.minRatio,label:t.label,items:t.items.map(x=>{
   const item=official.items.find(i=>i.id===x.id)||{};
   return {id:x.id,quantity:x.quantity,name:item.name||('物品'+x.id),bagIcon:item.bagIcon,type:item.type,grade:item.grade};})})),
 };
}

/**
 * 试炼的四个动作（在 planHomeAction 里调用；p 已经是 structuredClone 出来的 next）。
 * @returns 结果补丁 {items,currencies,...}
 */
export function planTrialAction(p,request,context,now=Date.now()){
 const result={items:[],currencies:{gold:0,silver:0,coins:0}};
 if(request.action==='trial-buy'){
  const state=trialState(p,now);
  if((state.bought||0)>=TRIAL_DAILY_BUY)throw Error(`今日已购买 ${TRIAL_DAILY_BUY} 次，达到上限。`);
  if((p.gold||0)<TRIAL_BUY_GOLD)throw Error(`黄金不足，购买 1 次需要 ${TRIAL_BUY_GOLD} 黄金。`);
  p.gold-=TRIAL_BUY_GOLD;state.bought=(state.bought||0)+1;
  result.currencies.gold=-TRIAL_BUY_GOLD;result.trialChallenge=trialCounts(p,now);
  return result;
 }
 if(request.action==='trial-config'){
  const state=trialState(p,now),pets=Array.isArray(request.pets)?request.pets:[];
  state.pets=pets.map(x=>String(x)).filter(x=>x&&x!=='null').slice(0,TRIAL_SLOT_COUNT);
  result.trialPets=state.pets.slice();
  return result;
 }
 if(request.action==='trial-challenge'){
  const boss=officialMonsters.get(trialBossAt(now).id);
  if(!boss)throw Error('试炼 BOSS 尚未就绪。');
  // 时段换了就把编队里的 BOSS 换成当前这只（改完必须重建索引，否则 12501 拿到的还是旧组）。
  if(syncTrialGroup(official,boss.id)){
   officialGroups.clear();
   for(const g of official.groups)officialGroups.set(g.groupId,g);
  }
  const counts=trialCounts(p,now);
  if(counts.left<=0)throw Error(`今日挑战次数已用完（每天 ${TRIAL_DAILY_CHALLENGE} 次），可用黄金购买。`);
  const state=trialState(p,now);
  state.used=(state.used||0)+1;
  state.awarded=false;   // 新的一场挑战：重新打开发奖闸门（见 grantTrialReward）
  // ⚠️ 放在所有校验之后：被拒时绝不能留下「待下发」标记。
  p.trialPendingGroup=TRIAL_GROUP_ID;
  if(context)context.trialPendingGroup=TRIAL_GROUP_ID;
  result.trialChallenge=trialCounts(p,now);result.trialEnterBattle=TRIAL_GROUP_ID;
  return result;
 }
 if(request.action==='trial-settle'){
  // 客户端上报的「这一场打了多少伤害」——赢/输都按真实比例定档（与参考实现一致）。
  const state=trialState(p,now),hpMax=Number(officialMonsters.get(trialBossAt(now).id)?.hpMax)||0;
  const reported=Math.max(0,Math.floor(Number(request.damage)||0));
  // 打赢但客户端没统计到伤害（比如刚进战斗就结束）时按满伤害算。
  const damage=request.victory===true?Math.max(reported,hpMax):reported;
  recordTrialDamage(state,damage);
  const granted=grantTrialReward(p,state,damage,now);
  if(granted)result.items=granted.tier.items.map(x=>({id:x.id,quantity:x.quantity}));
  if(p.trialPendingGroup===TRIAL_GROUP_ID)delete p.trialPendingGroup;
  clearTrialPending(context);
  result.trialDamage=damage;result.trialTier=trialTierFor(damage,hpMax).label;
  result.bestDamage=state.bestDamage||0;result.trialGrantedCount=result.items.length;
  return result;
 }
 throw Error('未知的试炼操作：'+request.action);
}

/**
 * 战斗打完自动结算（12502 里调用）——**只在打赢时**发奖。
 * 打赢 = 把 BOSS 打死 → 按满伤害吃最高档，不依赖客户端上报（老客户端也不会漏奖）；
 * 没打赢：服务端看不到伤害数字，这时**不发奖**，等客户端战斗结束时上报的 trial-settle
 * 按真实伤害比例定档（见 planTrialAction）。两边的闸门都是 state.awarded，先到的发，
 * 后到的只更新记录 —— 所以不会重复发奖，也不会出现「面板说第二阶段、实际发了参与档」。
 * 调用点只在「这一场确实是我们下发的试炼组」时（见 game-service 的 battle.trialGroup）。
 * @returns {null | {added:object[],currencies:object,tier:string,damage:number}}
 */
export function settleTrialBattleAndNotify(p,result,send,now=Date.now()){
 const victory=Number(result)===2;
 const state=trialState(p,now);
 // 这一战结束了：把「待下发」标记清掉（正常流程里 12501 已经清过，这里只是兜底）。
 if(Number(p.trialPendingGroup)===TRIAL_GROUP_ID)delete p.trialPendingGroup;
 if(!victory)return null;
 // 打赢：按满伤害发最高档。hpMax 取当前时段那只 BOSS 的血量。
 const hpMax=Number(officialMonsters.get(trialBossAt(now).id)?.hpMax)||0;
 recordTrialDamage(state,hpMax);
 const granted=grantTrialReward(p,state,hpMax,now);
 if(!granted)return null;
 const plan=planItemRewards(p,granted.tier.items.map(x=>({id:x.id,quantity:x.quantity})));
 p.inventory=plan.inventory;
 if(plan.added.length)send(12100,gainItemsPacket(p,plan.added,{gold:0,silver:0,coins:0}));
 return {added:plan.added,currencies:{gold:0,silver:0,coins:0},tier:granted.tier.label,damage:granted.damage};
}
