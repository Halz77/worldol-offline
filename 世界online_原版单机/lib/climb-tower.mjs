/**
 * 永泽塔（爬塔）挑战 —— 让 30001/30003/30005 从「待补」变成真能打。
 *
 * ## 数据从来都不缺
 * `data/home-features-v1.json`（抓包自 13101 / 30002）里已经有全部内容：
 *   · 132 层（普通塔 mode=1 共 120 层，困难塔 mode=2 共 12 层）
 *   · 160 只塔层怪物（id 2700–3000），每只都是完整定义 + wireBase64
 *   · 每层的 13101 回包原文 bodyBase64
 * 缺的只是**接线**：塔怪不在官方怪物表里、塔层编队不存在、30003/30005 直接抛错。
 *
 * ## 塔怪没有技能与 AI
 * preview 里带 `skillsPending` / `aiPending` 标记 —— 抓包时就没录到。所以塔怪
 * 只会普攻，靠属性压制（hpMax 2 万起步、后期上百万），这是既定的简化。
 *
 * ## 编队怎么来
 * 官方没有塔层编队，所以按「每层一个确定性 groupId」现场生成：
 *   groupId = TOWER_GROUP_BASE(23000) + 层号
 * 怪物**居中排布**（`floor((10-n)/2)` 起连续铺开）—— 从槽 0 开始填会让怪全挤在
 * 客户端阵型最上面几格，和征战广场的编排对不上。
 *
 * ## 解锁（openFloor）
 * 抓包里所有层的 openFloor 都是 1（原版没给正确的值），所以按「上一层通关即开放」重算：
 *   第 1 层 = 0（直接开），第 N 层 = 上一层的 rank。
 * ⚠️ 不要写 `Number(x) || 1` —— 0 会被兜成 1，第 1 层永远开不了。
 */
import {Writer} from './codec.mjs';
import {encodeWithSchema} from './feature-protobuf.mjs';
import {official,officialGroups,officialItems,officialMonsters} from './official-data.mjs';
import {homeFeatureData,towerFloors,towerPreviews} from './home-feature-data.mjs';
import {dailyKey} from './daily-activity.mjs';
import {planItemRewards} from './restoration.mjs';
import {gainItemsPacket} from './daily-service.mjs';

export const TOWER_GROUP_BASE=23000;
/** 每天免费挑战次数。 */
export const TOWER_DAILY_CHALLENGE=10;
/** 每天最多能买几次（每次 10 挑战）。 */
export const TOWER_DAILY_BUY=10;
/** 每次购买要多少黄金。 */
export const TOWER_BUY_GOLD=30;
/** 一次购买给多少挑战次数。 */
export const TOWER_BUY_COUNT=10;
/** 单层怪物槽位（客户端阵型 10 格）。 */
const GROUP_SLOTS=10;

/** 负数 itemId 是货币（沿用塔层奖励的既有约定）。 */
const CURRENCY_BY_ITEM={[-1]:'gold',[-2]:'silver',[-3]:'coins',[-6]:'towerPoint'};

/** 楼层修正后的 openFloor（不改抓包数据本身）。 */
let openFloorCache=null;
function floorsWithOpenFloor(){
 if(openFloorCache)return openFloorCache;
 const rows=new Map();
 for(const tower of homeFeatureData.tower){
  const levels=tower.levels||[];
  levels.forEach((floor,index)=>{
   const prev=index>0?Number(levels[index-1].rank):0;
   const need=index===0?0:(prev>0?prev:Math.max(0,Number(floor.rank)-1));
   rows.set(Number(floor.id),{...floor,mode:tower.mode,openFloor:need});
  });
 }
 openFloorCache=rows;
 return rows;
}

/** 某层（修正过 openFloor 的那份）。 */
export function towerFloor(floorId){
 return floorsWithOpenFloor().get(Number(floorId))||null;
}

/** 某个模式下的全部层（按抓包顺序，即低层在前）。 */
export function towerLevels(mode){
 const tower=homeFeatureData.tower.find(t=>t.mode===Number(mode));
 return (tower?.levels||[]).map(f=>floorsWithOpenFloor().get(Number(f.id))).filter(Boolean);
}

let registered=false;
const groupByFloor=new Map();
const floorByGroup=new Map();

/**
 * 把塔层怪物与编队注册进官方数据（幂等）。
 * 不注册的话 12501 会报「这组怪物的数据尚未恢复」：塔怪 2700–3000 本来不在官方表里。
 */
export function registerClimbTower(){
 if(registered)return {groups:groupByFloor.size,monsters:officialMonsters.size};
 registered=true;
 const used=new Set((official.groups||[]).map(g=>g.groupId));
 for(const floor of floorsWithOpenFloor().values()){
  const preview=towerPreviews.get(floor.id);
  const ids=[];
  for(const monster of preview?.monsters||[]){
   if(!Number.isSafeInteger(monster.id)||monster.id<=0)continue;
   if(!officialMonsters.has(monster.id)){
    const copy={...monster,sources:[{origin:'climb-tower',floor:floor.id,mode:floor.mode}]};
    official.monsters.push(copy);
    officialMonsters.set(monster.id,copy);
   }
   ids.push(monster.id);
  }
  if(!ids.length)continue;
  const groupId=TOWER_GROUP_BASE+Number(floor.id);
  if(used.has(groupId))continue;      // 极少数情况下层号与官方编队编号撞了，跳过不影响其它层
  const slots=new Array(GROUP_SLOTS).fill(0);
  const picked=ids.slice(0,GROUP_SLOTS);
  const start=Math.max(0,Math.floor((GROUP_SLOTS-picked.length)/2));
  for(let i=0;i<picked.length&&start+i<GROUP_SLOTS;i++)slots[start+i]=picked[i];
  const group={
   groupId,type:0,nextBattleGroupID:0,flag:0,coefficient:0,monsters:slots,npcs:[],
   wireBase64:new Writer().short(groupId).byte(0).short(0).byte(0).int(0)
    .raw(Buffer.concat(slots.map(id=>{const b=Buffer.alloc(2);b.writeInt16BE(id);return b;}))).done().toString('base64'),
   sources:[{origin:'climb-tower',floor:floor.id,mode:floor.mode}],
  };
  official.groups.push(group);
  groupByFloor.set(Number(floor.id),groupId);
  floorByGroup.set(groupId,Number(floor.id));
  used.add(groupId);
 }
 // officialGroups 是启动时按 official.groups 建的 Map，push 之后必须重建，
 // 否则 12501 里的 officialGroups.get(group) 取不到新增的塔组。
 officialGroups.clear();
 for(const group of official.groups)officialGroups.set(group.groupId,group);
 return {groups:groupByFloor.size,monsters:officialMonsters.size};
}

/** 层号 → 编队号（0 表示没有）。 */
export function towerGroupOf(floorId){
 if(!registered)registerClimbTower();
 return groupByFloor.get(Number(floorId))||0;
}

/** 编队号 → 层号（0 表示不是塔组）。 */
export function towerFloorOfGroup(groupId){
 if(!registered)registerClimbTower();
 return floorByGroup.get(Number(groupId))||0;
}

/** 当前要随世界数据下发的塔组（挑战期间只有一个）。 */
export function towerExtraGroups(p){
 const groupId=Number(p&&p.towerPendingGroup)||0;
 return groupId&&floorByGroup.has(groupId)?[groupId]:[];
}

/** 每日挑战状态（跨天重置）。 */
export function towerState(p,now=Date.now()){
 const day=dailyKey(now);
 if(!p.tower||typeof p.tower!=='object'||p.tower.day!==day)p.tower={day,used:0,bought:0};
 return p.tower;
}

/** 通关记录：{ 层号: 1=首通已领待扫荡 / 2=扫荡也领了 }。 */
export function towerProgress(p){
 if(!p.towerProgress||typeof p.towerProgress!=='object')p.towerProgress={};
 return p.towerProgress;
}

/** 今日次数。 */
export function towerCounts(p,now=Date.now()){
 const state=towerState(p,now);
 const total=TOWER_DAILY_CHALLENGE+(state.bought||0)*TOWER_BUY_COUNT;
 const used=state.used||0;
 return {left:Math.max(0,total-used),total,used,bought:state.bought||0,
  buyLeft:Math.max(0,TOWER_DAILY_BUY-(state.bought||0)),buyPrice:TOWER_BUY_GOLD,buyCount:TOWER_BUY_COUNT};
}

/**
 * 只读版的今日次数：**不往角色上写任何字段**。
 * 30001 只是「查一下面板」，不该顺手改存档（那样纯查询也会让存档多出 tower/towerProgress）。
 */
export function towerCountsReadonly(p,now=Date.now()){
 const state=p&&p.tower;
 const sameDay=!!state&&state.day===dailyKey(now);
 const used=sameDay?(Number(state.used)||0):0,bought=sameDay?(Number(state.bought)||0):0;
 const total=TOWER_DAILY_CHALLENGE+bought*TOWER_BUY_COUNT;
 return {left:Math.max(0,total-used),total,used,bought,
  buyLeft:Math.max(0,TOWER_DAILY_BUY-bought),buyPrice:TOWER_BUY_GOLD,buyCount:TOWER_BUY_COUNT};
}

/** 只读版的通关记录。 */
export function towerProgressReadonly(p){
 const progress=p&&p.towerProgress;
 return progress&&typeof progress==='object'?progress:{};
}

/** 只读版的某层开放状态（不改存档）。 */
export function towerFloorStateReadonly(p,floorId){
 const floor=towerFloor(floorId);
 if(!floor)return 0;
 if(towerProgressReadonly(p)[String(floor.id)])return 2;
 const need=Math.max(0,Number(floor.openFloor)||0);
 if(!need)return 1;
 const progress=towerProgressReadonly(p),mode=Number(floor.mode)||1;
 let top=0;
 for(const key of Object.keys(progress)){
  const row=towerFloor(Number(key));
  if(!row||Number(row.mode)!==mode)continue;
  if(Number(row.rank)>top)top=Number(row.rank);
 }
 return top>=need?1:0;
}

/**
 * 某层的开放状态：2=已通关、1=可挑战、0=未开放。
 * ⚠️ 与「是否已通关」是两件事：扫荡要查 towerProgress，不能用这个返回值判断。
 */
export function towerFloorState(p,floorId,now=Date.now()){
 const floor=towerFloor(floorId);
 if(!floor)return 0;
 if(towerProgress(p)[String(floor.id)])return 2;
 const mode=Number(floor.mode)||1;
 const need=Math.max(0,Number(floor.openFloor)||0);
 if(!need)return 1;
 return towerMaxClearedRank(p,mode)>=need?1:0;
}

/** 某模式已通关到的最高 rank（两个模式互不影响）。 */
export function towerMaxClearedRank(p,mode){
 const progress=towerProgress(p);
 let top=0;
 for(const key of Object.keys(progress)){
  const floor=towerFloor(Number(key));
  if(!floor)continue;
  if(mode!==undefined&&Number(floor.mode)!==Number(mode))continue;
  if(Number(floor.rank)>top)top=Number(floor.rank);
 }
 return top;
}

/**
 * 30002 的塔信息。`mode` 1=普通塔 2=困难塔。
 * infos 按**降序**下发：客户端 TowerProxy.onClimbTowerInfo 会再 reverse 一次，
 * 我们要让它在界面上变成「第 1 层在最上面」。
 */
export function towerInfo(mode,p){
 const tower=homeFeatureData.tower.find(t=>t.mode===Number(mode));
 if(!tower)throw Error('没有这个爬塔模式。');
 const levels=tower.levels||[];
 const counts=p?towerCountsReadonly(p):{left:TOWER_DAILY_CHALLENGE,total:TOWER_DAILY_CHALLENGE};
 const progress=p?towerProgressReadonly(p):{};
 return {
  id:levels.length?levels[levels.length-1].id:0,
  leftCount:counts.left,
  totalCount:counts.total,
  score:p?(Number(p.towerPoint)||0):0,
  modeType:Number(mode),
  isMock:false,
  isChallenge:false,
  sweepItem:tower.sweepItem,
  infos:[...levels].reverse().map(raw=>{
   const floor=towerFloor(raw.id)||raw;
   const state=p?towerFloorStateReadonly(p,floor.id):0;
   const cleared=!!progress[String(floor.id)];
   // openFloor 用修正后的值（抓包里全是 1），否则客户端本地判断会认为每层都开着。
   return {...raw,openFloor:floor.openFloor,state,receivedFirst:cleared,
    receivedNormal:cleared&&Number(progress[String(floor.id)])>=2,info:floor.info};
  }),
 };
}

/**
 * 发某一层的奖励。
 * @param {boolean} useFirst true=首通奖励（打赢那次），false=扫荡奖励
 * @returns {{added:object[],currencies:{gold:number,silver:number,coins:number},towerScore:number,skipped:number[]}}
 */
export function grantTowerFloorReward(p,floorId,useFirst){
 const floor=towerFloor(floorId);
 if(!floor)throw Error('没有这一层。');
 const rows=(useFirst?floor.first:floor.normal)||[];
 const items=[],currencies={gold:0,silver:0,coins:0},skipped=[];
 let towerScore=0;
 for(const row of rows){
  const itemId=Number(row.itemId),count=Math.max(1,Math.round(Number(row.itemCount)||1));
  if(itemId>0){
   // 1759/1760/1770（初级/中级/高级宝箱）在抓包里没有道具定义 —— 跳过并记账，
   // 不能让一个缺定义的奖励把整层结算搞崩。
   if(!officialItems.has(itemId)){skipped.push(itemId);continue;}
   items.push({id:itemId,quantity:count});
   continue;
  }
  const key=CURRENCY_BY_ITEM[itemId];
  if(!key){skipped.push(itemId);continue;}
  if(key==='towerPoint')towerScore+=count;
  else currencies[key]+=count;
 }
 const plan=items.length?planItemRewards(p,items):{inventory:p.inventory,added:[]};
 p.inventory=plan.inventory;
 for(const key of ['gold','silver','coins']){
  const value=(Number(p[key])||0)+currencies[key];
  if(!Number.isSafeInteger(value)||value<0||value>2147483647)throw Error('货币已达当前存档上限。');
  p[key]=value;
 }
 if(towerScore){
  const before=Number(p.towerPoint)||0;
  p.towerPoint=Math.min(2147483647,before+towerScore);
  towerScore=p.towerPoint-before;
 }
 return {added:plan.added,currencies,towerScore,skipped};
}

/**
 * 战斗胜利后的塔层结算：记通关 + 发首通奖励（同一层只发一次）。
 * 返回 null 表示「这场不是塔战 / 不是胜利 / 该层已经通关过」。
 */
export function settleTowerBattle(p,groupId,result){
 if(Number(result)!==2)return null;
 const floorId=towerFloorOfGroup(groupId);
 if(!floorId)return null;
 const progress=towerProgress(p);
 if(Number(progress[String(floorId)])>0)return null;   // 首通奖励只发一次
 const plan=grantTowerFloorReward(p,floorId,true);
 progress[String(floorId)]=1;                            // 1 = 首通已领、扫荡待领
 return {floorId,floor:towerFloor(floorId),...plan};
}

/** 30007 的包体（塔积分变化）。 */
export function towerScorePacket(delta){
 const w=new Writer().int(Math.trunc(Number(delta)||0));
 return w.done();
}

/** 30002 的完整回包（层列表 + 真实进度），战斗胜利后要立刻推一次让客户端解锁下一层。 */
export function encodeTowerInfo(mode,p){
 return encodeWithSchema('s2c_ClimbTowerInfo',towerInfo(mode,p),homeFeatureData.schemas);
}

/**
 * 12502 胜利结算里的塔层收尾：记通关 + 发首通奖励 + 推新塔信息。
 * @returns {null | {floorId:number,added:object[],currencies:object,towerScore:number,skipped:number[]}}
 */
export function settleTowerBattleAndNotify(p,groupId,result,send,log){
 if(Number(result)!==2)return null;
 const floorId=towerFloorOfGroup(groupId);
 if(!floorId)return null;
 const plan=settleTowerBattle(p,groupId,result);
 if(!plan)return null;
 const hasMoney=plan.currencies.gold||plan.currencies.silver||plan.currencies.coins;
 if(plan.added.length||hasMoney)send(12100,gainItemsPacket(p,plan.added,plan.currencies));
 if(plan.towerScore)send(30007,towerScorePacket(plan.towerScore));
 // 立刻推一次塔信息：客户端据此把「下一层」点亮，不用等玩家重开面板。
 send(30002,encodeTowerInfo(plan.floor?.mode||1,p));
 if(log)log('climb-tower-cleared',{role:p.id,floor:floorId,mode:plan.floor?.mode,
  added:plan.added.length,towerScore:plan.towerScore,skipped:plan.skipped});
 return plan;
}

/** 买挑战次数（30 黄金 → 10 次，每天最多 10 次）。 */
export function buyTowerChallenges(p,now=Date.now()){
 const counts=towerCounts(p,now);
 if(counts.buyLeft<=0)throw Error(`今天已经买过 ${TOWER_DAILY_BUY} 次了，明天再来。`);
 if((Number(p.gold)||0)<TOWER_BUY_GOLD)throw Error(`黄金不足，需要 ${TOWER_BUY_GOLD}。`);
 p.gold=(Number(p.gold)||0)-TOWER_BUY_GOLD;
 const state=towerState(p,now);
 state.bought=(state.bought||0)+1;
 return towerCounts(p,now);
}
