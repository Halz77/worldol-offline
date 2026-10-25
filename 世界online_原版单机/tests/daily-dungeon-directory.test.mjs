import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {officialMaps,officialMissions,origins} from '../lib/official-data.mjs';
import {missionBlockers,missionFollowupId} from '../lib/official-rules.mjs';
import {dailyData,taskSnapshot,dailyRevision,recordMissionCompletion} from '../lib/daily-activity.mjs';
import {encodeDaily,decodeDaily} from '../lib/daily-service.mjs';
import {npcPacket} from '../lib/game-packets.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
import {
 DAILY_DUNGEON_DIRECTORY,DIRECTORY_REVISION,DIRECTORY_TERMINALS,directoryEntry,applyDailyDungeonDirectory,
} from '../lib/daily-dungeon-directory.mjs';
import {TERMINAL_BY_DIRECTORY,STORY_ROW_CREATE_IDS,DUNGEON_DAILY_SPECS} from '../lib/dungeon-repairs.mjs';
import {repairedStoryDungeons} from '../lib/dungeon-story-repairs.mjs';

/**
 * 每日活动「挑战副本」目录（第 84 版，移植自 4.0AI 版的
 * `data/daily-dungeon-expansion.json`）：38 条目录行 + 进度 / 导航绑定 + 季节入口可见位。
 *
 * 断言的是四件事：
 * 1. 38 行都进看板了，行形状与客户端要的一致（type 3 / canonicalId / linkage null）；
 * 2. 目录里的地图与 NPC 在本工程全部存在（4.0 的 `unavailable` 备注大多已过时）；
 * 3. 19 行绑了进度与导航（15 个故事副本 + 70/79/80/94），其余 22 行只做目录式导航；
 * 4. 91/92 两行的季节入口 NPC 可见位补回来了（4.0 的 `applyDailyDungeonEntrances`）。
 */

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);

function player(overrides={}){
 const p=normalizeRole({id:2001,name:'目录验收',level:97,job:1,race:0,sex:1,mapId:1000});
 p.inventory=[];p.quests={active:{},completed:[]};p.coins=500000;
 return Object.assign(p,overrides);
}
const rowOf=id=>dailyData.tasks.find(row=>row.id===id);

test('挑战副本目录：38 行全部进看板，行形状与客户端契约一致',()=>{
 assert.equal(DAILY_DUNGEON_DIRECTORY.length,38);
 assert.deepEqual(DAILY_DUNGEON_DIRECTORY.map(r=>r.id),[...Array(38)].map((_,i)=>i+59));
 for(const entry of DAILY_DUNGEON_DIRECTORY){
  const row=rowOf(entry.id);
  assert.ok(row,`行 ${entry.id} 存在`);
  assert.equal(row.canonicalId,entry.id);
  assert.equal(row.type,3,'并入「挑战副本」页签');
  assert.equal(row.typeName,'挑战副本');
  assert.equal(row.missionId,-1,'missionId=-1 客户端才显示这一行');
  assert.equal(row.shopid,0,'没有商店入口（r_shopId>0 会把按钮变成「进商店」）');
  assert.ok(typeof entry.icon==='string'&&entry.icon.length>0,`行 ${entry.id} 有图标名`);
  assert.ok(officialMaps.has(entry.mapId),`行 ${entry.id} 的地图 ${entry.mapId} 存在`);
  const npc=officialMaps.get(entry.mapId).npcs.find(n=>n.id===entry.npcID);
  assert.ok(npc,`行 ${entry.id} 的入口 NPC ${entry.mapId}:${entry.npcID} 存在`);
  assert.equal(npc.x,entry.px,`行 ${entry.id} 的导航落点 x 与 NPC 一致`);
  assert.equal(npc.y,entry.py,`行 ${entry.id} 的导航落点 y 与 NPC 一致`);
 }
 // 看板 = 录制的 58 行 + 38 条目录 + 现场建出的 97/98/99。
 assert.equal(dailyData.tasks.length,99);
 assert.deepEqual([...new Set(dailyData.tasks.map(t=>t.id))].sort((a,b)=>a-b),[...Array(99)].map((_,i)=>i+1));
 assert.ok(dailyRevision().includes(DIRECTORY_REVISION),dailyRevision());
 assert.equal(directoryEntry(59)?.name,'问剑十一峰（初级）');
 assert.equal(directoryEntry(999),null);
});

test('挑战副本目录：77/78/86 的过期 unavailable 备注已清除，全链复验通过',()=>{
 // 第 84 版移植时保留了三行备注（77 缺地图 943 / 78 缺任务 941 / 86 缺地图 973），
 // 那原是 4.0 自己数据里缺的号。2026-10-25 全量复验：三行的任务/地图/NPC/链全部完整
 // ——水底秘洞在 980/982、鹊桥在 985/986、彩蛋森林在 834/835，且 77 的续链
 // 1211、9159—9162 由 lib/dungeon-story-repairs.mjs 本地补写（收尾 9162 回九歌镇 954）。
 // 943/941/973 没有任何引用方：补定义只会造幻影数据，正确动作是清备注。
 assert.deepEqual(DAILY_DUNGEON_DIRECTORY.filter(r=>r.unavailable),[],'不应再有过期缺口备注');
 // 幻影号防护：谁都不该给这三个号补定义——没有引用方，补了就是幻影数据。
 assert.equal(officialMaps.has(943),false);
 assert.equal(officialMaps.has(973),false);
 assert.equal(officialMissions.has(941),false);
 // 三行的完整依赖图（目录导航任务 + 故事位表节点）逐项可解析。
 for(const id of [77,78,86]){
  const row=rowOf(id);
  assert.ok(row.linkage,`行 ${id} 应已绑定进度`);
  const nodes=new Set([...(directoryEntry(id).navigationMissionIds||[]),...(row.linkage.missionIds||[])]);
  assert.ok(nodes.size>0,`行 ${id} 的节点集非空`);
  for(const n of nodes){
   const q=officialMissions.get(n);
   assert.ok(q,`行 ${id} 的节点 ${n} 有任务定义`);
   assert.ok(officialMaps.has(q.mapId),`行 ${id} 节点 ${n} 的地图 ${q.mapId} 存在`);
   if(q.npcId>0)assert.ok(officialMaps.get(q.mapId).npcs.some(npc=>npc.id===q.npcId),`行 ${id} 节点 ${n} 的 NPC ${q.mapId}:${q.npcId} 存在`);
   assert.deepEqual(missionBlockers(q),[],`行 ${id} 节点 ${n} 不应有未采集的依赖`);
   const next=missionFollowupId(q);
   if(next>0)assert.ok(officialMissions.has(next),`行 ${id} 节点 ${n} 的下一环 ${next} 存在`);
  }
 }
 // 77 的水底秘洞续链（本地补写）逐环对上：1210→1211→9159→…→9162。
 for(const [from,to] of [[1210,1211],[1211,9159],[9160,9161],[9161,9162]])
  assert.equal(officialMissions.get(from).submitNextMissionID,to,`${from} 的下一环应是 ${to}`);
 assert.equal(rowOf(77).linkage.terminal,9162);
 assert.ok(rowOf(77).linkage.missionIds.includes(9162),'收尾 9162 必须进位表');
});

test('挑战副本目录：16 行目录行 + 97/98/99 三行绑了进度与导航，其余 22 行只做目录式导航',()=>{
 const bound=DAILY_DUNGEON_DIRECTORY.filter(r=>rowOf(r.id).linkage).map(r=>r.id);
 assert.deepEqual(bound,[63,64,70,73,76,77,78,79,80,86,87,88,90,94,95,96],'12 个故事副本（36 归日常行）+ 70/79/80/94');
 assert.deepEqual(Object.keys(TERMINAL_BY_DIRECTORY).map(Number),[70,79,80,94]);
 assert.equal(TERMINAL_BY_DIRECTORY,DIRECTORY_TERMINALS);
 // 现场建出的三行同样绑好。
 for(const id of STORY_ROW_CREATE_IDS)assert.ok(rowOf(id).linkage,`行 ${id} 有进度位表`);
 // 目录里与故事副本重合的 15 行（去掉 36）都绑上了：12 行在目录里 + 3 行现场建出。
 const stories=repairedStoryDungeons.filter(s=>s.id!==36).map(s=>s.id).sort((a,b)=>a-b);
 const terminals=new Set(Object.keys(TERMINAL_BY_DIRECTORY).map(Number));
 const storyCovered=[...bound,...STORY_ROW_CREATE_IDS].filter(id=>!terminals.has(id)).sort((a,b)=>a-b);
 assert.deepEqual(storyCovered,stories,'15 个故事副本全部绑定（另加 70/79/80/94 四个收尾任务型行）');
 for(const entry of DAILY_DUNGEON_DIRECTORY){
  const row=rowOf(entry.id);
  if(!row.linkage)continue;
  assert.equal(row.pending,undefined,`行 ${entry.id} 不再「待定」`);
  assert.equal(row.unavailable,undefined,`行 ${entry.id} 不标缺口`);
  assert.ok(row.linkage.missionIds.length>0,`行 ${entry.id} 位表非空`);
  assert.ok(row.linkage.missionIds.includes(row.linkage.terminal),`行 ${entry.id} 收尾任务在位表里`);
  assert.equal(row.progressSum,row.linkage.missionIds.length,`行 ${entry.id} 进度上限 = 位表节点数`);
  assert.equal(row.frequency,entry.id===94?2:1,`行 ${entry.id} 每天 ${entry.id===94?2:1} 次`);
  assert.deepEqual(row.navigationMissionIds,row.linkage.missionIds);
  for(const id of row.linkage.missionIds)assert.ok(officialMissions.has(id),`行 ${entry.id} 的节点 ${id} 有定义`);
 }
 // 只导航的行：linkage 仍是 null（不进任务次数统计，也不显示进度），frequency 保持 -1。
 const onlyNav=[59,60,61,62,65,66,67,68,69,71,72,74,75,81,82,83,84,85,89,91,92,93];
 assert.equal(onlyNav.length,22);
 assert.deepEqual([...new Set([...bound,...onlyNav])].sort((a,b)=>a-b),DAILY_DUNGEON_DIRECTORY.map(r=>r.id),'38 行 = 16 绑定 + 22 只导航');
 for(const id of onlyNav){
  assert.equal(rowOf(id).linkage,null,`行 ${id} 只做导航`);
  assert.equal(rowOf(id).frequency,-1);
 }
});

test('挑战副本目录：97/98/99 按故事链根入口现场建行',()=>{
 assert.deepEqual(STORY_ROW_CREATE_IDS,[97,98,99]);
 for(const id of STORY_ROW_CREATE_IDS){
  const story=repairedStoryDungeons.find(s=>s.id===id);
  const row=rowOf(id);
  assert.ok(story&&row,`故事 ${id} 与看板行都在`);
  assert.equal(row.name,story.name);
  assert.equal(row.type,3);assert.equal(row.typeName,'挑战副本');
  const origin=origins(officialMissions.get(story.root))[0];
  assert.equal(row.mapId,origin.mapId,`行 ${id} 的入口地图 = 链根任务的登记地图`);
  assert.equal(row.npcID,origin.npcId,`行 ${id} 的入口 NPC = 链根任务的登记 NPC`);
  const npc=officialMaps.get(origin.mapId).npcs.find(n=>n.id===origin.npcId);
  assert.equal(row.px,npc.x);assert.equal(row.py,npc.y);
  assert.equal(row.linkage.terminal,story.terminal);
 }
});

test('挑战副本目录：进度按位表统计，交付收尾任务后才算完成',()=>{
 const p=player(),story=repairedStoryDungeons.find(s=>s.id===63),row=rowOf(63);
 assert.equal(row.linkage.terminal,story.terminal);
 for(const id of row.linkage.missionIds)p.quests.completed.push(id);
 let snap=taskSnapshot(p).info.find(r=>r.id===63);
 assert.equal(snap.progress,row.progressSum,'位表节点全部完成 → 进度满');
 assert.equal(snap.status,1,'还没交付收尾任务 → 仍是进行中（可导航）');
 // 交付收尾任务：任务次数 +1 → 状态变「今日已完成」，不再填导航字段。
 recordMissionCompletion(p,officialMissions.get(story.terminal));
 snap=taskSnapshot(p).info.find(r=>r.id===63);
 assert.equal(snap.finishTImes,1);
 assert.equal(snap.status,2,'交付收尾任务后 = 今日已完成');
 assert.ok(!snap.findMisId);
 // 只导航的行：永远停在「未开始」，导航靠行自带的 mapId/npcID。
 const plain=taskSnapshot(p).info.find(r=>r.id===59);
 assert.equal(plain.status,0);assert.equal(plain.progress,0);assert.equal(plain.mapId,37);assert.equal(plain.npcID,11);
 assert.ok(!plain.findMisId);
});

test('挑战副本目录：进行中的行「前往」指向当前那一环',()=>{
 const p=player();
 for(const id of [1930])p.quests.active[id]={};
 const snap=taskSnapshot(p).info.find(r=>r.id===79);
 assert.equal(snap.status,1,'月宫有进行中的一环');
 assert.equal(snap.findMisId,1930);
 assert.equal(snap.findMapId,officialMissions.get(1930).mapId);
 assert.ok(snap.findPx>0&&snap.findPy>0);
 // 97 行（现场建的行）同样能导航。
 p.quests.active={[repairedStoryDungeons.find(s=>s.id===97).missionIds[0]]:{}};
 assert.equal(taskSnapshot(p).info.find(r=>r.id===97).status,1);
});

test('挑战副本目录：99 行能过真协议（s2c_TaskInfo 往返）',()=>{
 const p=player();
 const info=decodeDaily('s2c_TaskInfo',encodeDaily('s2c_TaskInfo',taskSnapshot(p)));
 assert.equal(info.info.length,99);
 const row=info.info.find(r=>r.id===79);
 assert.equal(row.progressSum,rowOf(79).progressSum);
 assert.equal(row.mapId,987);assert.equal(row.npcID,0);
 assert.equal(info.info.find(r=>r.id===70).progressSum,rowOf(70).progressSum);
});

test('挑战副本目录：91/92 的季节入口 NPC 补回可见位（wire 能解回来）',()=>{
 assert.deepEqual(DAILY_DUNGEON_DIRECTORY.filter(r=>r.restoreNpcVisibility).map(r=>r.id),[91,92]);
 const before=officialMaps.get(14).npcs.find(n=>n.id===10),after=officialMaps.get(19).npcs.find(n=>n.id===13);
 assert.equal(before.status,67,'财神爷 66（可交互但看不见）→ 67（可见）');
 assert.equal(after.status,3,'祈福小子 2 → 3（可见 + 可交互）');
 for(const [mapId,npcId,status] of [[14,10,67],[19,13,3]]){
  const p={mapId,quests:{active:{},completed:[]}},r=new NativeReader(npcPacket(new Writer(),p).done());r.take(3);
  const npcs=[];for(let count=r.getByte();count>0;count--)npcs.push(d.Npc.fromBytes(r));r.finish();
  const npc=npcs.find(n=>n.id===npcId);
  assert.ok(npc,`${mapId}:${npcId} 在 NPC 包里`);
  assert.equal(npc.status,status,`${mapId}:${npcId} 的可见位`);
 }
});

test('挑战副本目录：重复推进目录会当场报错（编号是唯一键）',()=>{
 assert.throws(()=>applyDailyDungeonDirectory(dailyData),/编号重复/);
});
