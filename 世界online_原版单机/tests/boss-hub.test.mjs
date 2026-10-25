import test from 'node:test';
import assert from 'node:assert/strict';
import {officialGroups,officialMissions,officialMaps} from '../lib/official-data.mjs';
import {missionBlockers,repeatableChallengeMissions} from '../lib/official-rules.mjs';

// 「boss直达」（地图 277，入口风雪之城 37:10 小白，lib/boss-hub.mjs）的守护用例。
// 2026-10-25：社区版对比时发现 9106「挑战太阳神-库库尔坎」的 acceptBattleID=20500
// 在数据里不存在（NPC 接不了任务），已在 lib/boss-hub.mjs 运行时改指 11781；
// 同时把社区版的「直达挑战可重复接取」MOD 移植进 lib/official-rules.mjs。

const HUB_MAP_ID=277;
const challenges=()=>[...officialMissions.values()].filter(q=>q.localChallenge&&q.mapId===HUB_MAP_ID);

test('boss直达：39 个挑战任务的战斗数据全部可采集',()=>{
 const list=challenges();
 assert.equal(list.length,39,'直达挑战应保持 39 个（9100—9138）');
 for(const q of list){
  assert.ok(q.acceptBattleID>0,`${q.id} ${q.name} 应有接取战斗`);
  assert.deepEqual(missionBlockers(q),[],`${q.id} ${q.name} 不应有未采集的依赖`);
 }
});

test('boss直达：9106 太阳神-库库尔坎已改指包含 3352 的编队 11781',()=>{
 const kukulkan=officialMissions.get(9106);
 assert.ok(kukulkan,'9106 挑战太阳神-库库尔坎应存在');
 assert.equal(kukulkan.acceptBattleID,11781,'20500 编队不存在，应已改指 11781');
 const group=officialGroups.get(11781);
 assert.ok(group,'替补编队 11781 应存在');
 assert.ok((group.monsters||[]).includes(3352),'11781 必须含怪物 3352 太阳神-库库尔坎');
});

test('boss直达：39 个挑战 + 3042 全部可重复接取',()=>{
 const repeatable=repeatableChallengeMissions();
 assert.ok(repeatable.has(3042),'3042 恶梦爆破原本就可重复');
 for(const q of challenges())assert.ok(repeatable.has(q.id),`${q.id} ${q.name} 应可重复接取`);
});

test('boss直达：入口小白（37:10）已挂上 277 传送菜单',()=>{
 const xiaobai=officialMaps.get(37)?.npcs.find(n=>n.id===10);
 assert.ok(xiaobai,'风雪之城 37:10 小白应存在');
 assert.ok((xiaobai.menuJumpMap||[]).some(label=>label.includes('boss直达')),'小白菜单应有 boss直达入口');
 assert.ok((xiaobai.jumpMapID||[]).includes(HUB_MAP_ID),'且目标应是地图 277');
});
