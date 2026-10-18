/**
 * 日常副本整合（移植自社区版 `dungeon-repairs.mjs` 的导航 / 重玩部分）。
 *
 * ## 解决什么
 * 「每日活动」看板里有 8 个挑战 / 剧情副本（刺杀行动、玛雅副本、晴菜与精灵、幻兽副本、
 * 火焰副本、机械城副本、晴菜与精灵后续、精灵之森后续），录制只给了它们的**名字与入口**：
 * `pending` 写着「完整任务链或完成规则待定」、`linkage` 是空的、`progressSum` 只有个数字。
 * 于是看板表现得像坏了 —— 进度永远是 0，点「前往」也只会站在入口 NPC 面前（进行中时
 * 客户端会去 `findMapId/findMisId`，而这两个字段没人填）。
 *
 * 这里做三件事：
 * 1. **位表**：把每个副本的节点集合写进 `linkage.{terminal,missionIds}` —— 节点集合来自
 *    `data/replayable-chains.json`（`daily-*` 链），下面 `applyRepairedDaily` 只做搬运，
 *    保证「看板进度」与「重玩复位」用的是同一份名单。链里标了 `optional` 的可选高难度支线
 *    （晴菜 1822 / 后续 1395）**不进位表**（录制的 `progressSum` 也不含它们），但仍算在
 *    链的节点集合里 —— 于是「主线交付后高难入口还在」（录制流程如此），
 *    等高难也打完才整条复位、同一天重玩。
 * 2. **导航**：`dailyNavigation()` 给出「现在该去找谁」——taskSnapshot 会把它填进
 *    `findMisId/findMisSta/findMapId/findPx/findPy`，客户端「前往」按钮就能一路带到
 *    当前这一环的任务 NPC（进行中的任务走 `findMis*`，未开始的走 `mapId/npcID`）。
 * 3. **重玩**：副本链一旦通关就整条复位（`lib/replayable-chains.mjs` 的既有机制），
 *    同一天也能从第一环重接。
 *
 * 另外顺手补上「紫禁城·平民」菜单里指向却缺失的编队 1838，把「葬送佣兵团」行接到本工程
 * 补出的三个队长战上，并把半途而废的「跨服副本」行接到本工程真正实现的单机合作副本
 * （9176，紫禁城 824:112）。
 */
import {officialMissions,officialMaps,origins} from './official-data.mjs';
import {replayableChains} from './replayable-chains.mjs';
import {isCityMission,cityTarget} from './city-state.mjs';
import {cloneMonster,addGroup} from './dungeon-challenge-data.mjs';
import {burialCommanders,COOP_DUNGEON_MISSION,COOP_DUNGEON_MAP,COOP_DUNGEON_NPC} from './boss-challenges.mjs';

export const dungeonRepairRevision='complete-local-dungeons-20261018-v1';

/**
 * 8 个日常副本行 → 重玩链。
 * - 行 31「玛雅副本」直接用已登记的 `maya-sun-god` 链（同一个副本，节点集合一致，避免重复登记）。
 * - 行 36「机械城副本」的收尾是本工程续写的 9140「机械城·重获自由」（录制里只有前 39 步）。
 */
export const DUNGEON_DAILY_SPECS=[
 {id:30,name:'刺杀行动',chain:'daily-30',terminal:2720},
 {id:31,name:'玛雅副本',chain:'maya-sun-god',terminal:1846},
 {id:33,name:'晴菜与精灵',chain:'daily-33',terminal:1820},
 {id:34,name:'幻兽副本',chain:'daily-34',terminal:1780},
 {id:35,name:'火焰副本',chain:'daily-35',terminal:3472},
 {id:36,name:'机械城副本',chain:'daily-36',terminal:9140},
 {id:37,name:'晴菜与精灵后续',chain:'daily-37',terminal:1394},
 {id:38,name:'精灵之森后续',chain:'daily-38',terminal:2738},
];

/**
 * 失魂沙漠（日常行 45）在录制里只到 41 号「完成失魂沙漠高级阶段任务」；本工程又把黑鬼线
 * 续写成了 28 → 33 → 34 → 35 → 36（`lib/dungeon-story-repairs.mjs`），这五环要一起算进度，
 * 否则玩家打完本地续篇看板却不涨。
 */
export const DESERT_DAILY_BRANCH=[28,33,34,35,36];

/** 葬送佣兵团（日常行 27）：三个队长战 + 收尾的汇总任务。 */
export const BURIAL_DAILY={rowIds:[27],terminal:2803,missionIds:[2800,2801,2802,2803]};

/** 「跨服副本」这一行（57）在本工程的实现。 */
export const COOP_DAILY_ROW=57;

/** 紫禁城·平民（263:99）菜单里指向、但录制里没有的编队。 */
export const LEGACY_DUEL={mapId:263,npcId:99,groupId:1838,referenceMonsterId:1833,name:'姬无丹'};

/**
 * 把 8 个副本的位表写进每日活动表，并修正葬送佣兵团 / 失魂沙漠 / 跨服副本三行。
 * 在 `lib/daily-activity.mjs` 的 `ensure()` 里调用（这时 official 的索引已经建好）。
 * @returns {Array<{id:number,name:string,nodes:number,chain:string}>}
 */
export function applyRepairedDaily(data){
 const chains=new Map(replayableChains().map(chain=>[chain.id,chain]));
 const applied=[];
 for(const spec of DUNGEON_DAILY_SPECS){
  const chain=chains.get(spec.chain);
  if(!chain)throw Error(`日常副本 ${spec.id}「${spec.name}」的重玩链 ${spec.chain} 不在 data/replayable-chains.json 里。`);
  if(!chain.nodes.includes(spec.terminal))throw Error(`日常副本 ${spec.id} 的收尾任务 ${spec.terminal} 不在链 ${spec.chain} 的节点集合里。`);
  const rows=data.tasks.filter(row=>row.canonicalId===spec.id);
  if(!rows.length)throw Error(`每日活动表里没有 ${spec.id} 号副本行。`);
  // 「可选高难度支线」不占看板进度（录制的 progressSum 也不含它）：
  // 位表只放主线节点，但复位范围（链的节点集合）仍包含它 —— 见 replayable-chains.mjs 的说明。
  const optional=new Set(chain.optional||[]);
  const bits=chain.nodes.filter(id=>!optional.has(id));
  if(!bits.length||!bits.includes(spec.terminal))throw Error(`日常副本 ${spec.id} 的收尾任务 ${spec.terminal} 不在看板位表里。`);
  for(const row of rows){
   row.linkage={terminal:spec.terminal,missionIds:bits,evidence:'complete-local-dungeon'};
   row.frequency=1;
   row.progressSum=bits.length;
   delete row.pending;
   delete row.unavailable;
  }
  applied.push({id:spec.id,name:rows[0].name,nodes:bits.length,chain:chain.id});
 }
 // 葬送佣兵团：进度 = 三个队长战，收尾 = 汇总任务 2803（社区版只登记了 2803 本身）。
 {
  const ids=BURIAL_DAILY.missionIds.filter(id=>officialMissions.has(id));
  if(ids.length!==BURIAL_DAILY.missionIds.length)throw Error('葬送佣兵团的 2800—2803 没齐，日常行 27 无法接。');
  if(!officialMissions.get(2803)||!burialCommanders.every(entry=>officialMissions.has(entry.missionId)))throw Error('葬送佣兵团队长任务缺失。');
  for(const row of data.tasks.filter(row=>BURIAL_DAILY.rowIds.includes(row.id))){
   row.linkage={terminal:BURIAL_DAILY.terminal,missionIds:[...ids],monsterIds:burialCommanders.map(entry=>entry.id),evidence:'local-burial-commanders-xingtian'};
   row.frequency=1;
   // 录制的 3 步 = 三个队长；汇总任务 2803 只作为「今天打完了」的收尾，不占进度。
   row.progressSum=burialCommanders.length;
   delete row.pending;
   delete row.unavailable;
   applied.push({id:row.id,name:row.name,nodes:burialCommanders.length,chain:'local-burial-commanders-xingtian'});
  }
 }
 for(const row of data.tasks.filter(row=>row.canonicalId===45)){
  if(!row.linkage){applied.push({id:45,name:row.name,nodes:0,chain:'（缺位表）'});continue;}
  const extra=DESERT_DAILY_BRANCH.filter(id=>officialMissions.has(id)&&!row.linkage.missionIds.includes(id));
  row.linkage.missionIds=[...row.linkage.missionIds,...extra];
  row.progressSum=row.linkage.missionIds.length;
  applied.push({id:45,name:row.name,nodes:row.linkage.missionIds.length,chain:'recorded+'+extra.length});
 }
 const coopNpc=officialMaps.get(COOP_DUNGEON_MAP)?.npcs.find(n=>n.id===COOP_DUNGEON_NPC);
 for(const row of data.tasks.filter(row=>row.id===COOP_DAILY_ROW)){
  Object.assign(row,{
   name:'跨服副本·单机合作',
   mapId:COOP_DUNGEON_MAP,npcID:COOP_DUNGEON_NPC,px:coopNpc?.x||16,py:coopNpc?.y||13,
   type:3,typeName:'挑战副本',frequency:-1,value:0,missionId:-1,progressSum:1,
   // 录制的这一行挂着「券店 11315」，客户端会把按钮做成「进商店」（`r_shopId>0` 走
   // ON_MISSION_DAILY_GOTO_SHOPID，否则才走导航）。这一版不做券店、行又指向本地副本，
   // 所以把商店号清掉 —— 按钮与整行点击都变成「导航到紫禁城 824:112」。
   shopid:0,
   linkage:{terminal:COOP_DUNGEON_MISSION,missionIds:[COOP_DUNGEON_MISSION],evidence:'local-cooperative-dungeon'},
  });
  delete row.pending;
  delete row.unavailable;
  applied.push({id:COOP_DAILY_ROW,name:row.name,nodes:1,chain:'local-cooperative-dungeon'});
 }
 return applied;
}

/** 一行任务「现在该去找谁」：优先取进行中的那一环，否则取第一环没做的。 */
function currentDungeonStep(p,ids){
 for(const id of ids)if(p.quests?.active?.[id])return id;
 for(const id of ids)if(!(p.quests?.completed||[]).includes(id))return id;
 return ids[0]||0;
}

/** 任务的落点：城市任务按个人城市映射，其余优先取玩家当前地图上的来源，再退到录制的第一个来源。 */
function missionTarget(p,q){
 if(isCityMission(q))return cityTarget(q,p);
 const list=origins(q);
 return list.find(x=>x.mapId===p.mapId)||list.find(x=>officialMaps.has(x.mapId))||{mapId:q.acceptMapId||q.mapId,npcId:q.acceptNpcId||q.npcId};
}

/**
 * 日常看板的「前往」字段：副本行指向当前那一环的任务 NPC。
 * 客户端只在「进行中」（`status===1`）时才用 `findMis*`，所以调用方只在这种情况下需要它。
 * @returns {null | {findMisId:number,findMisSta:number,findMapId:number,findPx:number,findPy:number}}
 */
export function dailyNavigation(p,row){
 const ids=row?.linkage?.missionIds;
 if(!ids?.length)return null;
 const step=currentDungeonStep(p,ids);
 const q=officialMissions.get(step);
 if(!q)return null;
 const target=missionTarget(p,q);
 const npc=officialMaps.get(target.mapId)?.npcs.find(n=>n.id===target.npcId);
 return {findMisId:step,findMisSta:1,findMapId:target.mapId,findPx:npc?.x||0,findPy:npc?.y||0};
}

/**
 * 紫禁城·平民（263:99）菜单写着「击败姬无丹」，编队 1838 却从来没采到 —— 按录制的
 * 西域杀手（1833）克隆一只并改名，菜单就能真的开战。
 * 在 `official-data.ensure()` 建索引之前调用。
 */
export function applyDungeonRepairs(official){
 const applied=[];
 if(!official.groups.some(row=>row.groupId===LEGACY_DUEL.groupId)){
  const sources=[{origin:'local-legacy-duel-repair',mapId:LEGACY_DUEL.mapId,npcId:LEGACY_DUEL.npcId,referenceMonsterId:LEGACY_DUEL.referenceMonsterId}];
  cloneMonster(official,LEGACY_DUEL.referenceMonsterId,LEGACY_DUEL.groupId,LEGACY_DUEL.name,sources);
  addGroup(official,sources,{groupId:LEGACY_DUEL.groupId,monsters:[0,0,LEGACY_DUEL.groupId,0,0,0,0,0,0,0]});
  applied.push({kind:'group',id:LEGACY_DUEL.groupId});
 }
 return applied;
}
