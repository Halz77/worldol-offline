/**
 * BOSS 挑战赛（任务 1305，新月古镇广场 map 14 / NPC 103）—— 本地重建。
 *
 * ## 背景
 * 抓包里这条线**任务定义齐、入口齐，就是打不了**：
 *   · 1305「挑战BOSS」：60 级 + 用一张 BOSS 挑战券接取，接完走棋盘（14508 那套协议）；
 *   · 2451 / 2452 / 2453 三个奖励委托：分别要击杀 3314 古龙-多拉斯 / 3315 巨石神兵 /
 *     3239 千年魔牛，交货 1480 / 1481 / 1482 奖励盒；
 *   · NPC 103「BOSS挑战赛」：status 66（**只有「可交互」没有「可见」**，见下方「入口」）。
 * 而 3314 / 3315 这两只怪在我们这份 official-v305 里**完全不存在**，
 * 于是 2451 / 2452 挂着「任务目标怪物资料尚未采集」，1305 的棋盘协议也没有服务端实现。
 *
 * ## 怎么补（与 lib/dungeon-challenge-data.mjs 同一套原则）
 * 不凭空造数值：3315 巨石神兵 ← **克隆同名怪 3209**（lv90，抓包里就有）；
 * 3314 古龙-多拉斯 ← 克隆 **3317 邪恶蛟龙**（lv90，龙类、600 万血，与本副本第二场
 * 千年魔牛同档）。⚠️ 抓包里唯一叫「古龙-多拉斯」的是太阳神殿 2606 那条龙（2320，
 * **1.4 亿血**）—— 那是团队副本的终场 BOSS，拿来当 60 级委托目标不现实，
 * 所以只借「同档位的龙」当模板，名字仍用任务要求的「古龙-多拉斯」。
 * 千年魔牛 3239 抓包里本来就有，直接复用已补的 30022 编队。
 *
 * ## 三个格子 = 三场单挑
 * 棋盘（map 14）五格：起点 0 → 1 巨石神兵 → 2 千年魔牛 → 3 古龙-多拉斯 → 100 交付点。
 * 格子里的怪**就是三个委托要杀的怪本身**（不是另克隆一份信用怪），所以打棋盘
 * 同时就把 2451 / 2452 / 2453 的击杀计数攒齐了 —— 服务端零改动（12502 的击杀计数
 * 直接由 battle.monsters 推，不需要 questCreditMonsterId 那套）。
 *
 * ## 入口（真 BUG）
 * NPC 103 录到的 status=66 —— 按主包 ModelConst 的位表（STATUS_VISIBLE=1、
 * STATUS_ENABLE=2、STATUS_HIDE_PLAYER=64），这是「可交互但**看不见**」，
 * 本工程 `npcEnabled()` 的 `(status&3)===3` 也会直接判它不可用 →
 * 玩家既看不到这个 NPC、也交不了 2453（那一条原本就是能打的，只是入口点不到）。
 * 补上可见位 → 66|1 = 67，与地图上正常营业的商店 NPC（67 / 75）一致。
 * 同一次重建里还**摘掉券店菜单项**「购买挑战凭证」（商店 2061）：这一版不做券，
 * 留着它点下去只会报「这个商店尚未接入」，按本工程「下架只改名单」的惯例去掉。
 *
 * ## 这一版**不做**的
 *   · **入场券 119**：用户明确说「不需要入场券」。119 在整个 data 目录里没有定义，
 *     1305 接取条件里那条 CONDITION_HAVE_ITEM 119 会被 `missionConditions()` 过滤掉
 *     （见 official-rules），所以接任务**不需要**任何券，棋盘的「两格验证关卡」机制
 *     也一并不做（原版靠它扣券）；NPC 菜单里的券店（2061）一并摘掉。
 *   · **奖励盒 1480 / 1481 / 1482**：用户明确说「奖励可以不做」。它们同样没有任何定义，
 *     而抓包里也**没有可开箱的宝箱表**（petContent.chests 只有 40067 / 1324），
 *     做成会开箱的道具只会报「开出内容尚未采集」；`missionRewards()` 会自动跳过
 *     没有定义的道具，所以三个委托做完就是「击杀完成、领不到实物奖励」，不会报错。
 *   · **每日 2 次 / 2454 每日赠券**：依赖上面的券经济，一并留待。
 * 三条都在 docs/memory/2026-10-18.md 记为待补。
 *
 * ## 注入点顺序
 * `official-data.ensure()` 里 `applyDungeonChallengeRepairs` 之后、建索引之前调用：
 * 编队要能被 `battleSupported()` 查到，NPC wire 要给客户端下发。
 */
import {Reader} from './codec.mjs';
import {cloneMonster,addGroup} from './dungeon-challenge-data.mjs';

/** 棋盘任务（报名 + 交付都在 NPC 103）。 */
export const BOSS_TOURNAMENT_MISSION=1305;
/** 棋盘所在场景：新月古镇广场。 */
export const BOSS_TOURNAMENT_MAP_ID=14;
/** 棋盘入口 NPC「BOSS挑战赛」。 */
export const BOSS_TOURNAMENT_NPC_ID=103;

/** 棋盘格子（起点 / 三个挑战格 / 交付格）。 */
export const BOSS_BOARD_POINTS=[0,1,2,3,100];
/** 格子坐标：照抄社区版同一处（对方也是从抓包坐标复现的）。 */
export const BOSS_BOARD_XY={0:[280,400],1:[230,310],2:[165,210],3:[100,110],100:[65,390]};
/** 连线：一条直线 0-1-2-3-100（社区版同）。 */
const BOSS_BOARD_CONNECTIONS={0:[1],1:[0,2],2:[1,3],3:[2,100],100:[3]};

/**
 * 三个挑战格：`cell`/`event` 就是格子号（14514 回包的对手号），`group` 是编队，
 * `mission` 是那一场能攒进度的委托（同一条怪 id 两边共用）。
 * `reference` = 克隆重参考怪（0 表示抓包里本来就有）。
 */
export const BOSS_TOURNAMENT_STAGES=[
 {cell:1,group:30150,monster:3315,name:'巨石神兵',reference:3209,mission:2452},
 {cell:2,group:30022,monster:3239,name:'千年魔牛',reference:0,mission:2453},
 {cell:3,group:30152,monster:3314,name:'古龙-多拉斯',reference:3317,mission:2451},
];

export const bossBoardConnections=cell=>BOSS_BOARD_CONNECTIONS[Number(cell)]||[];
/** 这个格子有没有挑战（没有就是「走过即通过」的格）。 */
export const bossTournamentEventOfCell=cell=>BOSS_TOURNAMENT_STAGES.some(s=>s.cell===Number(cell))?Number(cell):0;
/** 格子 → 编队号（0 = 这一格没有对手）。 */
export function bossTournamentEventGroup(event){
 const stage=BOSS_TOURNAMENT_STAGES.find(s=>s.cell===Number(event));
 return stage?stage.group:0;
}
/** 这个编队属于 BOSS 挑战赛（12501 跳过「站在 NPC 旁边」校验用）。 */
export function bossTournamentMissionOfGroup(groupId){
 const id=Number(groupId);
 return BOSS_TOURNAMENT_STAGES.some(s=>s.group===id)?BOSS_TOURNAMENT_MISSION:0;
}
export const isBossTournamentMission=id=>Number(id)===BOSS_TOURNAMENT_MISSION;
/** 格子里的对手名字（给 14510 的挑战文案用）。 */
export function bossTournamentBossName(event){
 const stage=BOSS_TOURNAMENT_STAGES.find(s=>s.cell===Number(event));
 return stage?stage.name:'';
}

/** 客户端 ModelConst.STATUS_VISIBLE。 */
const STATUS_VISIBLE=1;
/** 客户端 ModelConst.STATUS_ENABLE。 */
const STATUS_ENABLE=2;
/** 客户端 ModelConst.STATUS_MISSION_DATA_USE：状态位带它时记录里多 6 字节 missionData。 */
const STATUS_MISSION_DATA_USE=8;
/** 录到的券店菜单项（这一版不做券，见文件头「这一版不做的」）。 */
const VOUCHER_MENU='购买挑战凭证';
/** 券店编号：`shopItems()` 里没有这一家，点下去只会报「这个商店尚未接入」。 */
const VOUCHER_SHOP=2061;
/** 四段菜单：传送 / 战斗 / 商店 / 导师；只有商店段有这一项。 */
const SHOP_SECTION=2;

/**
 * 入口 NPC 的两处小修（一次解析、一次重建，二次调用幂等）：
 *  ① 补可见位（status 66 → 67，见文件头「入口」）；
 *  ② 摘掉券店菜单项 —— 这一版不做入场券，留着「购买挑战凭证」点下去只会报
 *    「这个商店尚未接入」，按本工程「下架只改名单」的惯例把这一项从菜单里去掉。
 * 先按记录布局把四段菜单解析一遍并校对（哪一段、几项、菜单名与商店号都要对得上），
 * 位置算错就会把别的字节改坏 —— 宁可抛错。
 */
function prepareEntryNpc(npc){
 if(npc.localBossTournamentNpc)return npc; // 幂等
 if(!npc.wireBase64)return npc;            // 本地自编 NPC 自带状态位，不动
 const body=Buffer.from(npc.wireBase64,'base64'),r=new Reader(body);
 r.take(14);
 r.utf();
 r.utf();
 const talk=r.utf(),statusOffset=r.pos,status=r.byte()&255;
 if(talk!==npc.talkDetail||status!==npc.status)throw Error(`BOSS挑战赛入口记录与字段不符：${npc.mapId}:${npc.id}`);
 r.take(5); // 朝向 / x / y / 范围x / 范围y
 if(status&STATUS_MISSION_DATA_USE)r.take(6);
 let voucherStart=-1,voucherEnd=-1;
 for(let section=0;section<4;section++){
  const countOffset=r.pos,count=r.byte()&255,items=[];
  for(let i=0;i<count;i++)items.push({menu:r.utf(),shop:r.short(),first:r.short(),second:r.byte()});
  if(!items.length)continue;
  if(section!==SHOP_SECTION||items.length!==1||items[0].menu!==VOUCHER_MENU||items[0].shop!==VOUCHER_SHOP)
   throw Error(`BOSS挑战赛入口的记录里出现了预期外的菜单项：${npc.mapId}:${npc.id}`);
  voucherStart=countOffset;
  voucherEnd=r.pos;
 }
 if(r.pos!==body.length)throw Error(`BOSS挑战赛入口记录尾部有多余字节：${npc.mapId}:${npc.id}`);
 const changes=[];
 let wire=body;
 if(voucherStart>=0){ // 计数位写 0、整段菜单项（菜单名 + 三个字段）删掉
  wire=Buffer.concat([wire.subarray(0,voucherStart),Buffer.from([0]),wire.subarray(voucherEnd)]);
  changes.push('drop-voucher-menu');
 }
 const wanted=status|STATUS_VISIBLE;
 if(wanted!==status){
  if(wire===body)wire=Buffer.from(body);
  wire[statusOffset]=wanted;
  changes.push('show-visible');
 }
 if(!changes.length)return npc;
 return {...npc,status:wanted,wireBase64:wire.toString('base64'),localBossTournamentNpc:`${changes.join('+')}-from-${status}`};
}

/**
 * 把 BOSS 挑战赛补进官方数据（在 official-data.ensure() 建索引之前调用一次）。
 * @returns {{monsters:number[],groups:number[],missions:number[],entry:string|null}}
 */
export function applyBossTournament(data){
 const source=extra=>[{origin:'local-boss-tournament',mapId:BOSS_TOURNAMENT_MAP_ID,npcId:BOSS_TOURNAMENT_NPC_ID,...extra}];
 const createdMonsters=[],createdGroups=[],linkedMissions=[];
 for(const stage of BOSS_TOURNAMENT_STAGES){
  if(stage.reference&&!data.monsters.some(m=>m.id===stage.monster)){
   cloneMonster(data,stage.reference,stage.monster,stage.name,source({missionId:stage.mission,referenceMonsterId:stage.reference}));
   createdMonsters.push(stage.monster);
  }
  if(!data.groups.some(g=>g.groupId===stage.group)){
   // 单挑阵型：10 槽、中间一只（与 2453 已补的 30022 同一套排布）。
   addGroup(data,source({missionId:stage.mission,referenceMonsterId:stage.reference||stage.monster}),
    {groupId:stage.group,monsters:[0,0,stage.monster,0,0,0,0,0,0,0]});
   createdGroups.push(stage.group);
  }
 }
 // 2451 / 2452 原本没有 acceptBattleID → 把入口指到棋盘上同一场编队：
 // 接了委托就能直接在 NPC 处开打，打赢同样记进度（两边同一批怪 id）。
 for(const [missionId,groupId] of [[2452,30150],[2451,30152]]){
  const q=data.missions.find(m=>m.id===missionId);
  if(!q)continue;
  if(!(Number(q.acceptBattleID)>0)){q.acceptBattleID=groupId;linkedMissions.push(missionId);}
 }
 // 入口 NPC：补可见位 + 摘掉券店菜单（地图上没有这张图、或没有这个 NPC 时只告警 ——
 // 这段在 ensure() 里跑，抛错等于服务起不来；真正的问题由 tests/boss-tournament.test.mjs 兜住）。
 let entry=null;
 const map=data.maps.find(m=>m.id===BOSS_TOURNAMENT_MAP_ID);
 const npc=map?.npcs?.find(n=>n.id===BOSS_TOURNAMENT_NPC_ID);
 if(npc){
  const fixed=prepareEntryNpc(npc);
  if(fixed!==npc){
   map.npcs[map.npcs.indexOf(npc)]=fixed;
   entry=fixed.localBossTournamentNpc;
  }
 }else console.warn(`[boss-tournament] 地图 ${BOSS_TOURNAMENT_MAP_ID} 上找不到入口 NPC ${BOSS_TOURNAMENT_NPC_ID}，棋盘入口可能点不到。`);
 return {monsters:createdMonsters,groups:createdGroups,missions:linkedMissions,entry};
}
