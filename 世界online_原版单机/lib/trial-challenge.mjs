/**
 * 无限试炼（试炼面板）—— 打一只超肉 BOSS，按造成的伤害比例领三档奖励。
 *
 * ## 伤害从哪来
 * 原版战斗是**本地算的**，服务端只收到胜负结果，拿不到伤害数字。
 * 社区版的做法是让客户端上报 damage；本工程保留这个入口（request.damage），
 * 并给一个兜底：打赢（把 BOSS 打死，客户端传 victory=true）按满伤害算。
 * 所以不改造客户端也能玩 —— 打完回来结算，赢就吃满档。
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

/** 编队里的宠物 id 统一成「最多 3 个正整数」，脏数据（null/字符串/负数）直接丢。 */
const normalizePets=x=>Array.isArray(x)?x.filter(v=>Number.isSafeInteger(Number(v))&&Number(v)>0).slice(0,TRIAL_SLOT_COUNT):[];
/**
 * 只读归一化：**绝不往 p 上写任何东西**。
 * 快照（打开面板）走这条 —— 否则查一次面板就给角色凭空长出 trial 字段，
 * 存档被改脏、tests/home-features.test.mjs 的「查副本不能改角色」也会挂。
 */
function readTrialState(p,now=Date.now()){
 const day=dailyKey(now),raw=p&&typeof p.trial==='object'&&p.trial?p.trial:null;
 if(!raw||raw.day!==day)return {day,used:0,bought:0,bestDamage:0,pets:normalizePets(raw?.pets)};
 return {day,used:Number.isSafeInteger(raw.used)?raw.used:0,bought:Number.isSafeInteger(raw.bought)?raw.bought:0,
  bestDamage:Number.isSafeInteger(raw.bestDamage)?raw.bestDamage:0,pets:normalizePets(raw.pets)};
}
/** 写入路径：跨天/损坏时重建当日状态，返回的**就是** p.trial（改它等于改角色）。 */
export function trialState(p,now=Date.now()){
 p.trial=readTrialState(p,now);
 return p.trial;
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
  // ⚠️ 放在所有校验之后：被拒时绝不能留下「待下发」标记。
  p.trialPendingGroup=TRIAL_GROUP_ID;
  if(context)context.trialPendingGroup=TRIAL_GROUP_ID;
  result.trialChallenge=trialCounts(p,now);result.trialEnterBattle=TRIAL_GROUP_ID;
  return result;
 }
 if(request.action==='trial-settle'){
  const state=trialState(p,now),boss=officialMonsters.get(trialBossAt(now).id);
  const hpMax=Number(boss?.hpMax)||0;
  const reported=Math.max(0,Math.floor(Number(request.damage)||0));
  // 打赢（把 BOSS 打死）按满伤害算 —— 服务端拿不到战斗过程里的伤害数字。
  const damage=request.victory===true?Math.max(reported,hpMax):reported;
  const ratio=hpMax>0?damage/hpMax:0;
  const tier=TRIAL_REWARD_TIERS.find(t=>ratio>=t.minRatio)||TRIAL_REWARD_TIERS.at(-1);
  result.items=tier.items.map(x=>({id:x.id,quantity:x.quantity}));
  if(damage>(state.bestDamage||0))state.bestDamage=damage;
  if(p.trialPendingGroup===TRIAL_GROUP_ID)delete p.trialPendingGroup;
  clearTrialPending(context);
  result.trialDamage=damage;result.trialTier=tier.label;result.bestDamage=state.bestDamage||0;
  return result;
 }
 throw Error('未知的试炼操作：'+request.action);
}

/**
 * 战斗打完自动结算（12502 里调用）：打赢 = 把 BOSS 打死 → 满档；没打赢 → 参与档。
 * 服务端看不到战斗过程里的伤害数字，所以用胜负当档位依据 —— 玩家不必手动点结算。
 * 已经结算过（pending 标记没了）就只刷新最高伤害，绝不重复发奖。
 * @returns {null | {added:object[],currencies:object,tier:string,damage:number}}
 */
export function settleTrialBattleAndNotify(p,result,send,now=Date.now()){
 const pending=Number(p.trialPendingGroup)===TRIAL_GROUP_ID;
 const boss=officialMonsters.get(trialBossAt(now).id);
 const hpMax=Number(boss?.hpMax)||0;
 const victory=Number(result)===2;
 const damage=victory?hpMax:0;
 const state=trialState(p,now);
 if(!pending){
  // 没在挑战中（例如玩家手动结算过、或重进战斗）：只更新记录，不发奖。
  if(damage>(state.bestDamage||0))state.bestDamage=damage;
  return null;
 }
 const ratio=hpMax>0?damage/hpMax:0;
 const tier=TRIAL_REWARD_TIERS.find(t=>ratio>=t.minRatio)||TRIAL_REWARD_TIERS.at(-1);
 const plan=planItemRewards(p,tier.items.map(x=>({id:x.id,quantity:x.quantity})));
 p.inventory=plan.inventory;
 if(damage>(state.bestDamage||0))state.bestDamage=damage;
 delete p.trialPendingGroup;
 if(plan.added.length)send(12100,gainItemsPacket(p,plan.added,{gold:0,silver:0,coins:0}));
 return {added:plan.added,currencies:{gold:0,silver:0,coins:0},tier:tier.label,damage};
}
