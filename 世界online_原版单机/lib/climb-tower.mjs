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
 * ## 困难塔复用普通塔的怪物 id（一个 id 要装两份属性 → 现场换号）
 * 普通塔 1—120 层与困难塔 121—132 层**共用同一批怪物 id（2700–3000）**，但困难塔那份
 * 气血/攻防整表 ×7（例：2701 万鸟王 普通 20000 血 / 困难 140000 血；2779 紫禁城卫兵
 * 1500000 → 10500000）。客户端按 id 认怪（模型包 id → 属性），一个 id 只能有一份属性，
 * 所以第二份（属性不同的那一份）现场换成 `LOCAL_TOWER_VARIANT_BASE`(21000) 起的本地号，
 * 编队槽位与模型包都用新号 —— 否则困难塔下发的是普通塔那份弱属性，而「查看怪物属性」
 * （13101 录制回包）显示的是 ×7 的真属性，两边对不上（第 79 版）。
 *
 * ## 编队怎么来
 * 官方没有塔层编队，所以按「每层一个确定性 groupId」现场生成：
 *   groupId = TOWER_GROUP_BASE(23000) + 层号
 * 怪物**居中排布**（`floor((10-n)/2)` 起连续铺开）—— 从槽 0 开始填会让怪全挤在
 * 客户端阵型最上面几格，和征战广场的编排对不上。
 *
 * ## 解锁（openFloor）——【单机修改】全层开放
 * 抓包里所有层的 openFloor 都是 1（原版没给正确的值）。原先是按「上一层通关即开放」重算
 * （第 1 层 = 0、第 N 层 = 上一层的 rank），第 79 版照参考实现「幻想世界OL 3.0 最终版」
 * 改成**全部层 openFloor = 0（132 层随手可挑战）** —— 循环里的 `need` 为 0 就返回「可挑战」。
 * ⚠️ 不要写 `Number(x) || 1` —— 0 会被兜成 1，第 1 层永远开不了。
 * ⚠️ openFloor 只是**开放条件**，与「是否已通关」是两件事（towerProgress 才是通关记录）。
 *
 * ## 每层奖励 ——【单机修改】统一一条
 * 抓包里的每层奖励（普通塔 1—39 给银币 + 1759 初级宝箱、40+ 给 1760/1770、困难塔另算）
 * 里那几个宝箱在 item 表里**根本没有定义**（1759/1760/1770 查不到），只能跳过；
 * 第 79 版照参考实现整表换成同一份 `TOWER_FLOOR_REWARD`：
 *   **50 黄金 + 傲雪凌霜礼盒(100781) ×1 + 30 勇气勋章**（首通 first 与扫荡 normal 一样）。
 * 数据文件一字不改（抓包那份仍在 `data/home-features-v1.json` 里，只是不再使用）；
 * 30002 下发的 first/normal 也跟着换成这一份，否则客户端奖励栏会显示旧表、与实际发放不符。
 * ⚠️ 傲雪凌霜礼盒是 type 28 宝箱，本工程**还没有开箱机制**（客户端没有开箱等待类型的分支），
 *    所以它目前只能当收藏 —— 与参考实现同样的情况。
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
/** 每天最多能买几次。 */
export const TOWER_DAILY_BUY=10;
/** 每次购买要多少黄金。 */
export const TOWER_BUY_GOLD=30;
/**
 * 一次购买给多少挑战次数。
 * 【单机修改】照参考实现改成 **1**（原来是我们自己定的 10）：那边 `total = 10 + bought`。
 * ⚠️ 客户端**没有**永泽塔购买入口（抓包里没有 C2S_CLIMB_TOWER_BUY，1496 塔界面只有
 *    「帮助 / 普通·困难切换」两个按钮，TOWER_DESC 也只讲每日刷新），所以这条路径
 *    目前只能由服务端自己调 buyTowerChallenges 触发 —— 语义对齐而已。
 */
export const TOWER_BUY_COUNT=1;
/**
 * 【单机修改，照参考实现】每一层的奖励：50 黄金 + 傲雪凌霜礼盒 ×1 + 30 勇气勋章。
 * 首通（first）与扫荡（normal）**同一份**；普通塔与困难塔也同一份。
 * 负数 itemId 是货币（沿用塔层奖励的既有约定）：-1 黄金 / -2 银 / -3 铜币 / -6 勇气勋章。
 */
export const TOWER_FLOOR_REWARD=[[-1,50],[100781,1],[-6,30]];
/** 货币行在客户端奖励栏里的 grade（照参考实现 TOWER_MONEY_GRADE）。 */
const TOWER_MONEY_GRADE={[-1]:3,[-2]:3,[-3]:1,[-6]:2};
/** 单层怪物槽位（客户端阵型 10 格）。 */
const GROUP_SLOTS=10;
/**
 * 同 id 第二份属性（困难塔 121—132 层复用它自己的普通塔怪，但属性 ×7）的本地编号起点。
 * 官方怪物 id 最大 4071（v305），20000–32767 这一段在本工程里没有占用；
 * 上限 32767 是因为编队 wire 的怪物槽位是 short。
 */
export const LOCAL_TOWER_VARIANT_BASE=21000;
/** 已经换过号的「同 id 另一份属性」的只计数（给 /api/status 与测试看）。 */
let towerVariantCount=0;

/** 负数 itemId 是货币（沿用塔层奖励的既有约定）。 */
const CURRENCY_BY_ITEM={[-1]:'gold',[-2]:'silver',[-3]:'coins',[-6]:'towerPoint'};

/**
 * 楼层修正后的 openFloor（不改抓包数据本身）。
 * 【单机修改】照参考实现：**全部层直接开放**（openFloor 全 0），不再「上一层通关才开下一层」。
 * 0 表示「无前置」——towerFloorState 看到 0 就返回 1（可挑战）。
 */
let openFloorCache=null;
function floorsWithOpenFloor(){
 if(openFloorCache)return openFloorCache;
 const rows=new Map();
 for(const tower of homeFeatureData.tower){
  for(const floor of tower.levels||[])rows.set(Number(floor.id),{...floor,mode:tower.mode,openFloor:0});
 }
 openFloorCache=rows;
 return rows;
}

/** 一层的奖励行（【单机修改】统一一条，见文件头）。每次返回新对象，调用方改了也污染不到常量。 */
function towerFloorRewardRows(){
 return TOWER_FLOOR_REWARD.map(([itemId,itemCount])=>({itemId,itemCount}));
}

/** 奖励行 → 客户端奖励栏要的 itemInfo（货币没有定义，按 TOWER_MONEY_GRADE 给 grade）。 */
function towerRewardRow(itemId,itemCount){
 const definition=itemId>0?officialItems.get(itemId):null;
 if(!definition)return {itemId,itemCount,icon:'',name:'',bagIcon:'',info:'',type:0,
  grade:TOWER_MONEY_GRADE[itemId]||0};
 return {itemId,itemCount,icon:'0',name:definition.name||'',bagIcon:String(definition.bagIcon??''),
  info:definition.info||'',type:definition.type||0,grade:definition.grade||0,
  fashIcons:{fashIcon1:'0',fashIcon2:'0',fashIcon3:'0'}};
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
 * 一只塔怪的「属性签名」：除 wire 与来源记录以外的全部字段（含 id）。
 * 同一只怪在同一层重复出现、或不同层共用同一份属性 → 签名相同 → 复用同一个 id；
 * 同一个 id 但属性不同（困难塔那份 ×7）→ 签名不同 → 换本地号（见 registerClimbTower）。
 */
function towerMonsterSignature(monster){
 const row={};
 for(const key of Object.keys(monster).sort()){
  if(key==='wireBase64'||key==='sources'||key==='localTowerVariantOf')continue;
  row[key]=monster[key];
 }
 return JSON.stringify(row);
}

/** 把录制 wire 的头 4 字节（int id）改成新号；其余字节一字节不动。 */
function reidMonsterWire(monster,id){
 const body=Buffer.from(String(monster.wireBase64||''),'base64');
 if(body.length<4)throw Error(`塔怪 ${monster.id} 的 wire 太短，不能改号。`);
 if(body.readInt32BE(0)!==Number(monster.id))throw Error(`塔怪 ${monster.id} 的 wire 头部不是它的 id，不能改号。`);
 const copy=Buffer.from(body);
 copy.writeInt32BE(id,0);
 return copy.toString('base64');
}

/**
 * 把塔层怪物与编队注册进官方数据（幂等）。
 * 不注册的话 12501 会报「这组怪物的数据尚未恢复」：塔怪 2700–3000 本来不在官方表里。
 */
export function registerClimbTower(){
 if(registered)return {groups:groupByFloor.size,monsters:officialMonsters.size,variants:towerVariantCount};
 registered=true;
 const used=new Set((official.groups||[]).map(g=>g.groupId));
 const claimed=new Map();      // 怪物 id → 占住它的属性签名
 const bySignature=new Map();  // 属性签名 → 怪物 id（同一份属性只注册一次）
 let nextVariant=LOCAL_TOWER_VARIANT_BASE;
 for(const floor of floorsWithOpenFloor().values()){
  const preview=towerPreviews.get(floor.id);
  const ids=[];
  for(const monster of preview?.monsters||[]){
   if(!Number.isSafeInteger(monster.id)||monster.id<=0)continue;
   const signature=towerMonsterSignature(monster);
   let id=bySignature.get(signature);
   if(id===undefined){
    id=monster.id;
    // 同一个 id 已经有另一份属性了（困难塔 121—132 层复用普通塔的怪、属性 ×7）：
    // 一个 id 装不下两份属性 → 换一个本地号，编队与模型包都用它。
    if(claimed.has(id)&&claimed.get(id)!==signature){
     while(claimed.has(nextVariant)||officialMonsters.has(nextVariant))nextVariant++;
     if(nextVariant>32767)throw Error(`塔层怪物本地编号超出 short 上限（${monster.id}）。`);
     id=nextVariant++;
     towerVariantCount++;
    }
    claimed.set(id,signature);
    bySignature.set(signature,id);
    if(!officialMonsters.has(id)){
     const sources=[{origin:'climb-tower',floor:floor.id,mode:floor.mode}];
     const copy=id===monster.id?{...monster,sources}
      :{...monster,id,wireBase64:reidMonsterWire(monster,id),localTowerVariantOf:monster.id,
        sources:[{...sources[0],variantOf:monster.id}]};
     official.monsters.push(copy);
     officialMonsters.set(id,copy);
    }
   }
   ids.push(id);
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
 return {groups:groupByFloor.size,monsters:officialMonsters.size,variants:towerVariantCount};
}

/** 某层编队里**真正用到的**怪物 id（槽位顺序；困难塔那份同 id 变体是本地号 21000+）。 */
export function towerFloorMonsterIds(floorId){
 if(!registered)registerClimbTower();
 const groupId=groupByFloor.get(Number(floorId));
 if(!groupId)return [];
 return (officialGroups.get(groupId)?.monsters||[]).filter(id=>id>0);
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

/** 只读版的某层开放状态（不改存档）。【单机修改】全层开放 → 新角色拿到的全是 1（可挑战）。 */
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
 * 【单机修改】全层开放 ⇒ 这里只会返回 1 或 2；0 只在层号不存在时返回。
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
   // openFloor 用修正后的值（抓包里全是 1，见 floorsWithOpenFloor），否则客户端本地判断会认为每层都锁着。
   // first/normal 也换成统一奖励：抓包那份里 1759/1760/1770 没有道具定义，
   // 直接下发会让奖励栏显示「空名宝箱」、与实际发放（50 黄金 + 礼盒 + 30 勋章）不符。
   const rewardRows=towerFloorRewardRows().map(row=>towerRewardRow(row.itemId,row.itemCount));
   return {...raw,openFloor:floor.openFloor,state,receivedFirst:cleared,
    receivedNormal:cleared&&Number(progress[String(floor.id)])>=2,info:floor.info,
    first:rewardRows,normal:rewardRows};
  }),
 };
}

/**
 * 发某一层的奖励。
 * 【单机修改】首通与扫荡现在**同一份**奖励（见 TOWER_FLOOR_REWARD），useFirst 只保留调用方语义。
 * @param {boolean} useFirst true=首通（打赢那次），false=扫荡
 * @returns {{added:object[],currencies:{gold:number,silver:number,coins:number},towerScore:number,skipped:number[]}}
 */
export function grantTowerFloorReward(p,floorId,useFirst){
 void useFirst;
 const floor=towerFloor(floorId);
 if(!floor)throw Error('没有这一层。');
 return planTowerRewardRows(p,towerFloorRewardRows());
}

/**
 * 把奖励行折成「物品 + 货币 + 勇气勋章」并落到角色上。
 * ⚠️ 缺定义的道具（如抓包里的 1759/1760/1770 宝箱）跳过并记账 —— 不能让一个缺定义的奖励
 *    把整层结算搞崩（首通那条路在 12502 的 try 里，抛错连通关记录都写不进去）。
 */
export function planTowerRewardRows(p,rows){
 const items=[],currencies={gold:0,silver:0,coins:0},skipped=[];
 let towerScore=0;
 for(const row of rows||[]){
  const itemId=Number(row.itemId),count=Math.max(1,Math.round(Number(row.itemCount)||1));
  if(itemId>0){
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

/** 买挑战次数（30 黄金 → 1 次，每天最多 10 次；照参考实现）。 */
export function buyTowerChallenges(p,now=Date.now()){
 const counts=towerCounts(p,now);
 if(counts.buyLeft<=0)throw Error(`今天已经买过 ${TOWER_DAILY_BUY} 次了，明天再来。`);
 if((Number(p.gold)||0)<TOWER_BUY_GOLD)throw Error(`黄金不足，需要 ${TOWER_BUY_GOLD}。`);
 p.gold=(Number(p.gold)||0)-TOWER_BUY_GOLD;
 const state=towerState(p,now);
 state.bought=(state.bought||0)+1;
 return towerCounts(p,now);
}
