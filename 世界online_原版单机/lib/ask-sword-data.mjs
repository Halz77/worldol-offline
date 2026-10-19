/**
 * 问剑十一峰 —— 本地重建（风雪之城 map 37 / NPC 11「封印守卫者」）。
 *
 * ## 为什么是本地重建
 * 客户端主包里**没有任何「问剑」相关的界面文本**（`grep 问剑` 在 analysis/modules 与主包里都是 0 命中），
 * 也就是说它不是原版功能，而是「幻想世界OL」那边自己加的玩法。他们的两个模块
 * （`ask-sword-data.mjs` 194 行 / `ask-sword-service.mjs` 179 行）在对比报告里只留下了这几条事实：
 *   · 三档：2604 初级 / 2650 中级 / 2651 高级，怪缩放 1 / 1.7 / 2.6；
 *   · 地图 37（风雪之城）、NPC 11（封印守卫者）、终点格 100；
 *   · 棋盘 13 个点，进度持久化到任务；押金与奖励按档不同。
 * 解包产物早就删了（`%TEMP%\opencode\fxol3` 已不在），所以这里按本工程的规矩重建：
 * **不凭空造数值** —— 十一峰的对手全部取自已采集的怪物表，三档只改编队系数。
 *
 * ## 为什么能「不用改客户端」
 * 棋盘界面（14508 / 14509 / 14510 / 14511 / 14514）是客户端自带的，太阳神殿与 BOSS 挑战赛
 * 已经把它当通用界面用了一版（`lib/solar-challenge-service.mjs` 的 `BOARD_HOSTS`）。
 * 这里只是**第三份 host**：同一张图 37、同样的 13 个点，换成「0 → 十一峰 → 100」的线性山道。
 *
 * ## 怪缩放 = 编队系数（coefficient）
 * 客户端模块 0228 读编队时调 `monster.getClone(coefficient)`，模块 0091 的 `setMonsterData`
 * 里 `i = coefficient/100`，把 speed/atk/def/hpMax/mpMax 等**全部乘 i**（奖励 experience/money 不动）。
 * 所以三档只需要三套同内容、不同系数的编队：100 / 170 / 260 —— 就是对比报告里的 1 / 1.7 / 2.6。
 *
 * ## 等级门槛说明
 * 三档任务里照官方棋盘任务（2606 太阳神殿：CONDITION_LEVEL 50）的写法挂了等级条件，
 * 但 `official-rules.missionConditions()` 对非城市任务只保留 [9,10]（前置任务）两类条件 ——
 * 全工程的任务都不限制等级（任务面板里那句「接取不限制等级和职业」就是这么来的），
 * 所以三档实际都能接；档位差别体现在编队系数与押金/奖励上。
 */
import {Writer} from './codec.mjs';
import {addGroup} from './dungeon-challenge-data.mjs';

/** 入口地图：风雪之城。 */
export const ASK_SWORD_MAP_ID=37;
/** 入口 NPC：封印守卫者（抓包里就有，status 3 = 可见 + 可交互）。 */
export const ASK_SWORD_NPC_ID=11;
/** 终点格（与太阳神殿 / BOSS 挑战赛同一套约定：100 = 交付点）。 */
export const ASK_SWORD_DELIVERY_CELL=100;
/** 最后一峰（走完它才算完成赛程）。 */
export const ASK_SWORD_FINAL_CELL=11;

/** 棋盘 13 个点：起点 0 + 十一峰 1..11 + 交付点 100。 */
export const ASK_SWORD_POINTS=[0,1,2,3,4,5,6,7,8,9,10,11,ASK_SWORD_DELIVERY_CELL];

/**
 * 各格在棋盘上的像素坐标（客户端按这个摆位）。整条路从右下角起步，
 * 之字形往左上爬（1→11 峰），交付点回到左下角 —— 与太阳神殿「起点右下、终点左下」一致。
 */
export const ASK_SWORD_XY={
 0:[300,412],
 1:[248,368],
 2:[176,336],
 3:[104,304],
 4:[132,244],
 5:[206,212],
 6:[276,180],
 7:[206,132],
 8:[128,104],
 9:[64,68],
 10:[196,60],
 11:[288,72],
 100:[60,404],
};

/** 线性山道：0 → 1 → … → 11 → 100（只能往前走，没有岔路）。 */
const LINEAR=[];
for(let i=0;i<ASK_SWORD_POINTS.length-1;i++)LINEAR.push([ASK_SWORD_POINTS[i],ASK_SWORD_POINTS[i+1]]);
const CONNECTIONS=new Map();
for(const [from,to] of LINEAR){
 if(!CONNECTIONS.has(from))CONNECTIONS.set(from,[]);
 CONNECTIONS.get(from).push(to);
}
export const askSwordConnections=cell=>CONNECTIONS.get(Number(cell))||[];

/**
 * 十一峰（每峰一只怪，全部取自已采集的怪物表，按血量从 7 万爬到 358 万）。
 * `title` 只用于任务说明与文档，战斗里显示的是怪物自己的名字。
 */
export const ASK_SWORD_PEAKS=[
 {cell:1,monster:1730,title:'冰原狼'},
 {cell:2,monster:3244,title:'冰风鹰身人'},
 {cell:3,monster:3201,title:'骷髅监视者'},
 {cell:4,monster:1755,title:'无名英灵-剑侠'},
 {cell:5,monster:2259,title:'熊人'},
 {cell:6,monster:1710,title:'火龙'},
 {cell:7,monster:3243,title:'雪狼'},
 {cell:8,monster:3210,title:'大殿守卫'},
 {cell:9,monster:3457,title:'风雪幽灵刺客'},
 {cell:10,monster:1873,title:'广寒双刃-冰霜'},
 {cell:11,monster:2353,title:'寒冰之心-钢牙'},
];

/**
 * 三档。`groupBase` 起 11 个连号编队（每峰一个），`coefficient` 就是怪缩放 ×100。
 * 押金 `escortCost = [黄金, 白银, 铜币]`（照太阳神殿 2606 的 [0,5,50000] 那档往上加），
 * 接任务时**只收一次**（重开棋盘不重复扣，见 lib/official-service.mjs）。
 * 奖励道具必须都有定义（`planItemRewards` 碰到无定义道具会整包抛错）。
 */
export const ASK_SWORD_TIERS=[
 {mission:2604,key:'初级',coefficient:100,groupBase:30301,level:50,
  escortCost:[0,5,50000],exp:20000,money2:0,money3:5000,rewards:[[732,2],[40001,1]]},
 {mission:2650,key:'中级',coefficient:170,groupBase:30321,level:60,
  escortCost:[0,10,100000],exp:40000,money2:0,money3:10000,rewards:[[716,2],[40001,2]]},
 {mission:2651,key:'高级',coefficient:260,groupBase:30341,level:90,
  escortCost:[0,20,200000],exp:80000,money2:0,money3:20000,rewards:[[733,2],[40023,1]]},
];

export const isAskSwordMission=id=>ASK_SWORD_TIERS.some(t=>t.mission===Number(id));
const tierOfMission=mission=>ASK_SWORD_TIERS.find(t=>t.mission===Number(mission))||null;
const peakOfCell=cell=>ASK_SWORD_PEAKS.find(p=>p.cell===Number(cell))||null;

/** 某一峰有没有挑战（没有就是「走过即通过」的格）。 */
export const askSwordEventOfCell=cell=>peakOfCell(cell)?Number(cell):0;
/** 第几峰的编队号（0 = 这一格没有对手）。 */
export function askSwordEventGroup(mission,event){
 const tier=tierOfMission(mission),peak=peakOfCell(event);
 return tier&&peak?tier.groupBase+peak.cell-1:0;
}
/** 这个编队属于问剑十一峰（12501 跳过「站在 NPC 旁边」校验用）→ 返回任务号。 */
export function askSwordMissionOfGroup(groupId){
 const id=Number(groupId);
 for(const tier of ASK_SWORD_TIERS)
  for(const peak of ASK_SWORD_PEAKS)
   if(tier.groupBase+peak.cell-1===id)return tier.mission;
 return 0;
}
/** 这一峰的对手名字（给 14510 的挑战文案用）。 */
export const askSwordPeakTitle=event=>peakOfCell(event)?.title||'';

/** 三档任务的字段（照 custom-adventures 里那套已在跑的本地任务模板）。 */
function missionFor(data,tier){
 const rewardItems=tier.rewards.map(([id,quantity])=>{
  const item=data.items.find(x=>x.id===id);
  if(!item)throw Error(`问剑十一峰缺少奖励道具定义：${id}`);
  return {illusion:[],id,name:item.name,bagIcon:item.bagIcon,grade:item.grade,quantity};
 });
 return {
  id:tier.mission,name:`问剑十一峰·${tier.key}`,level:0,
  simpleDesc:`闯过风雪之城的十一峰（${tier.key}）`,
  desc:`【单机补写】封印守卫者在风雪之城外布下十一峰剑阵。沿山道逐峰而上，`+
   `十一峰的守关者全部战而胜之，走到终点再回来交付即可领取奖励。`+
   `本档对手强度 ${tier.coefficient}%（初级 100 / 中级 170 / 高级 260），`+
   `押金 ${tier.escortCost[1]} 白银 + ${tier.escortCost[2]} 铜币（接取时只收一次）。`,
  // 8 = 可重复挑战（unlimitedMission，交付后还能再接）；与 3042 那条重复挑战同一套标记。
  setting:8,
  mapId:ASK_SWORD_MAP_ID,npcId:ASK_SWORD_NPC_ID,radarMapID:ASK_SWORD_MAP_ID,radarGx:12,radarGy:10,
  dialogNotStartNotReady:'十一峰的剑阵还没走完，先回去把山道走到底。',
  dialogStartNotFinish:'',
  dialogStartFinish:'十一峰已经尽数闯过，这一份奖励归你。',
  exp:tier.exp,money2:tier.money2,money3:tier.money3,honor:0,
  countryLand:0,countryProsperity:0,countryPeople:0,countryWood:0,countryStone:0,countryIron:0,
  cityArmy:0,cityProsperity:0,promoteProsperity:0,
  escortCost:[...tier.escortCost],
  rewardItems,selectItems:[],
  // 与官方棋盘任务（2606 太阳神殿）同一写法：等级条件照挂，但任务系统不收等级门槛
  // （见文件头）。rawHex 就是 1 字节等级值。
  acceptCondition:[{type:1,typeName:'CONDITION_LEVEL',not:0,minimum:tier.level,rawHex:new Writer().byte(tier.level).done().toString('hex')}],
  submitCondition:[],
  // type 0 = 普通任务（官方棋盘 BOSS 挑战赛 1305 也是 0）；series 只作任务列表里的分组标题。
  type:0,series:'问剑十一峰',
  acceptMapId:ASK_SWORD_MAP_ID,acceptNpcId:ASK_SWORD_NPC_ID,
  canAccept:1,_isHelp:false,
  acceptJumpMapID:0,submitJumpMapID:0,acceptBattleID:0,submitBattleID:0,submitNextMissionID:0,
  localReconstruction:true,
  sources:[{origin:'local-ask-sword',mapId:ASK_SWORD_MAP_ID,npcId:ASK_SWORD_NPC_ID,missionId:tier.mission}],
 };
}

/**
 * 把问剑十一峰补进官方数据（在 official-data.ensure() 建索引之前调用一次）。
 * @returns {{missions:number[],groups:number[],missing:string[]}}
 */
export function applyAskSword(data){
 const missions=[],groups=[],missing=[];
 for(const tier of ASK_SWORD_TIERS){
  if(!data.missions.some(q=>q.id===tier.mission)){
   data.missions.push(missionFor(data,tier));
   missions.push(tier.mission);
  }
  for(const peak of ASK_SWORD_PEAKS){
   const groupId=tier.groupBase+peak.cell-1;
   if(data.groups.some(g=>g.groupId===groupId))continue;
   if(!data.monsters.some(m=>m.id===peak.monster)){
    // 这段在 ensure() 里跑，抛错等于服务起不来 —— 缺怪只记账，测试里会拦。
    missing.push(`${tier.mission}/${peak.cell}:${peak.monster}`);
    continue;
   }
   // 单挑阵型：10 槽、中间一只（与 BOSS 挑战赛 30150 那批同一套排布）。
   addGroup(data,[{origin:'local-ask-sword',mapId:ASK_SWORD_MAP_ID,npcId:ASK_SWORD_NPC_ID,
    missionId:tier.mission,peak:peak.cell,referenceMonsterId:peak.monster}],
    {groupId,monsters:[0,0,peak.monster,0,0,0,0,0,0,0],coefficient:tier.coefficient});
   groups.push(groupId);
  }
 }
 return {missions,groups,missing};
}
