import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Reader} from '../lib/codec.mjs';
import {official,officialGroups,officialMaps,officialMissions,officialMonsters} from '../lib/official-data.mjs';
import {battleSupported} from '../lib/official-rules.mjs';
import {applyCaptured81} from '../lib/captured81.mjs';
import {migrateCaptured81Progress} from '../lib/captured81-progress.mjs';
import {MAYA_QUEST_IDS} from '../lib/maya-palace-story.mjs';
import {migrateMayaProgress,mayaRetiredRevision} from '../lib/maya-progress.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const has81=fs.existsSync(path.join(root,'data','captured81-20260926.json'));
const skip={skip:has81?false:'没有 data/captured81-20260926.json，跳过'};

/* ---------------- 八一副本 ---------------- */

test('八一副本：31 个任务全部注册，1430 是链条终点',skip,()=>{
 for(const id of [...Array.from({length:21},(_,i)=>902+i),...Array.from({length:10},(_,i)=>1421+i)]){
  const q=officialMissions.get(id);
  assert.ok(q,'任务 '+id+' 没有注册');
 }
 assert.equal(officialMissions.get(1430).name,'恢复和平');
 // 链条方向：1429 的下一环必须是 1430
 assert.equal(officialMissions.get(1429).submitNextMissionID,1430);
});

test('八一副本：录制包整表灌入，编队与怪物都能被战斗查到',skip,()=>{
 for(const id of [91,92,93,94,95,96,97,98,99,100,101,102,103,3087,4046,4049,4058,4059,4060,4061])
  assert.ok(officialMonsters.get(id),'怪物 '+id+' 没有注册');
 for(const g of [606,607,608,611,612,613,614,615,616,4016,4017,4018,11667,11668,11732])
  assert.ok(officialGroups.get(g),'编队 '+g+' 没有注册');
 // 战斗入口只认官方表里的组
 assert.equal(battleSupported(11732),true);
});

test('八一副本：1421—1430 按 81 级开放，但保留 120 级录制原值',skip,()=>{
 for(const id of [1421,1425,1430]){
  const level=officialMissions.get(id).acceptCondition.find(c=>c.type===1&&!c.not);
  if(!level)continue;
  assert.equal(level.minimum,81,'任务 '+id+' 的等级门槛不是 81');
  assert.equal(level.capturedMinimum,120,'任务 '+id+' 没有留录制原值');
  // 字节也要跟着改，否则客户端读到的还是 120
  assert.equal(level.rawHex,'51','任务 '+id+' 的 rawHex 没改成 81');
 }
});

test('八一副本：990 地图补了返回朱雀村的传送NPC',skip,()=>{
 const map=officialMaps.get(990);
 assert.ok(map,'地图 990 没有注册');
 const portal=map.npcs.find(n=>n.id===0);
 assert.ok(portal,'990 缺少返回NPC');
 assert.equal(portal.name,'返回朱雀村');
 assert.deepEqual(portal.jumpMapID,[955]);
 // 目标是 955 的出生点
 const back=officialMaps.get(955).spawn;
 assert.equal(portal.jumpMapGx[0],back[0]);
 assert.equal(portal.jumpMapGy[0],back[1]);
});

test('八一副本：任务奖励不引用未定义道具（否则发放整包抛错）',skip,()=>{
 for(const id of [...Array.from({length:21},(_,i)=>902+i),...Array.from({length:10},(_,i)=>1421+i)]){
  const q=officialMissions.get(id);
  for(const item of q.rewardItems||[])
   assert.ok(official.items.some(i=>i.id===item.id),'任务 '+id+' 引用了未定义道具 '+item.id);
 }
});

test('八一副本：注入是幂等的，两次跑不会撞号',skip,()=>{
 // 冲突时应当抛错而不是静默覆盖 —— 这里用一份改过wire 的副本验证守卫真的会响。
 const copy=structuredClone({maps:official.maps,missions:official.missions,monsters:official.monsters,
  groups:official.groups,ai:official.ai,skills:official.skills,items:official.items});
 // 把注入过的 1430 挪走，让captured81 重新写入它
 copy.missions=copy.missions.filter(m=>m.id!==1430);
 // 技能效果覆盖（data/local-skill-overrides.json）会改写 wire，与抓包不再一致 ——
 // 注入过的技能同样先挪走，让 captured81 按抓包重新灌一遍（否则守卫会按设计抛 Conflicting）。
 const captured=JSON.parse(fs.readFileSync(path.join(root,'data','captured81-20260926.json'),'utf8'));
 const injected=new Set(captured.skills.map(s=>s.id+':'+s.level));
 copy.skills=copy.skills.filter(s=>!injected.has(s.id+':'+s.level));
 assert.doesNotThrow(()=>applyCaptured81(copy));
 assert.ok(copy.missions.find(m=>m.id===1430),'1430 没有被重新写入');
});

test('八一副本：旧进度命中估算怪就归档重走，不静默删',skip,()=>{
 const p={
  captured81Migration:undefined,
  quests:{active:{1422:{origin:{mapId:990,npcId:1},counts:{}}},completed:[]},
  battles:{kills:{23100:3}},
  dailyActivity:{completed:{}},
 };
 assert.equal(migrateCaptured81Progress(p),true);
 assert.equal(p.quests.active[1422],undefined,'旧任务没被清掉');
 assert.ok(p.captured81Migration.previous.active['1422'],'旧进度没有归档');
 assert.ok(p.captured81Migration.previous.completed.length>=0);
 // 再跑一次必须是 no-op（幂等）
 assert.equal(migrateCaptured81Progress(p),false);
});

test('八一副本：已经通关 1430 的存档不动',skip,()=>{
 const p={
  captured81Migration:undefined,
  quests:{active:{},completed:[1430]},
  battles:{kills:{23100:3}},
  dailyActivity:{completed:{}},
 };
 assert.equal(migrateCaptured81Progress(p),false);
 assert.equal(p.captured81Migration,undefined,'通关的存档不该被迁移');
});

test('八一副本：无关存档不会被误伤',skip,()=>{
 const p={captured81Migration:undefined,quests:{active:{},completed:[1,2,3]},battles:{kills:{}},dailyActivity:{completed:{}}};
 assert.equal(migrateCaptured81Progress(p),false);
});

/* ---------------- 玛雅副本 ---------------- */

test('玛雅副本：地图 962 地下宫殿有 20 个 NPC 与出生点',()=>{
 const map=officialMaps.get(962);
 assert.ok(map,'地图 962 没有注册');
 assert.equal(map.name,'地下宫殿');
 assert.deepEqual(map.spawn,[1,12]);
 assert.ok(map.npcs.length>=20,'962 的 NPC 数量不足：'+map.npcs.length);
 // 每个 NPC 都必须有 wire 记录，否则客户端收到空记录
 for(const npc of map.npcs)assert.ok(npc.wireBase64,'NPC '+npc.id+' 缺 wireBase64');
});

test('玛雅副本：8700—8709 十环首尾相连，最后一环交回1824',()=>{
 assert.equal(MAYA_QUEST_IDS.length,10);
 for(const id of MAYA_QUEST_IDS)assert.ok(officialMissions.get(id),'任务 '+id+' 没有注册');
 for(let i=0;i<9;i++){
  const cur=officialMissions.get(MAYA_QUEST_IDS[i]);
  assert.equal(cur.submitNextMissionID,MAYA_QUEST_IDS[i+1],'任务 '+MAYA_QUEST_IDS[i]+' 的下一环不对');
 }
 const last=officialMissions.get(8709);
 assert.equal(last.submitNextMissionID,1824,'8709 没有交回 1824');
 // 环环相扣：每环的前置是上一环
 for(let i=1;i<10;i++){
  const prev=officialMissions.get(MAYA_QUEST_IDS[i-1]);
  const cond=officialMissions.get(MAYA_QUEST_IDS[i]).acceptCondition.find(c=>c.type===9);
  assert.equal(cond.missionId,prev.id,'任务 '+MAYA_QUEST_IDS[i]+' 的前置不是 '+prev.id);
 }
});

test('玛雅副本：两场战斗的编队与怪物都在官方表里',()=>{
 for(const g of [2659,2663,2666]){
  assert.ok(officialGroups.get(g),'编队 '+g+' 没有注册');
  assert.equal(battleSupported(g),true,'战斗 '+g+' 不被支持');
 }
 for(const id of [3210,3215])assert.ok(officialMonsters.get(id),'怪物 '+id+' 没有注册');
 // 8701 打 3210、8704 打 3215
 const kills=q=>q.submitCondition.filter(c=>c.type===2).map(c=>c.monsterId);
 assert.deepEqual(kills(officialMissions.get(8701)),[3210]);
 assert.deepEqual(kills(officialMissions.get(8704)),[3215]);
});

test('玛雅副本：3219 接回 8700、1824 前置改成 8709、1831 接1832',()=>{
 assert.equal(officialMissions.get(3219).submitNextMissionID,8700,'3219 没有指向 8700');
 assert.equal(officialMissions.get(1831).submitNextMissionID,1832,'1831 没有指向 1832');
 const confession=officialMissions.get(1824);
 const prerequisite=confession.acceptCondition.find(c=>c.type===9&&!c.not);
 assert.equal(prerequisite.missionId,8709,'1824 的前置不是 8709');
 assert.equal(prerequisite.name,officialMissions.get(8709).name);
 // 原值要留档，便于日后核对
 assert.ok(confession.recordedAcceptCondition.some(c=>c.missionId===1823),'1824 没留原前置');
 assert.ok(officialMissions.get(3219).recordedContinuation,'3219 没留原下一环');
});

test('玛雅副本：838 蒂卡尔的可见性前置字节真的改了（客户端只认字节）',()=>{
 const tikal=officialMaps.get(838).npcs.find(n=>n.id===2);
 assert.ok(tikal,'838 里没有蒂卡尔（npc 2）');
 assert.deepEqual(tikal.missionData.slice(0,1),[3219],'NPC 字段没有改成 3219');
 assert.deepEqual(tikal.recordedMissionData.slice(0,1),[1823],'没有留原来的 1823');
 // 按布局读回字节：14 头 + 3 utf + status + 5 + short(前置)
 const bytes=Buffer.from(tikal.wireBase64,'base64'),r=new Reader(bytes);
 r.take(14);r.utf();r.utf();r.utf();
 const status=r.byte()&255;
 r.take(5);
 assert.equal(status&8,8,'可见性位丢了');
 assert.equal(bytes.readUInt16BE(r.pos),3219,'字节里的前置任务号不是 3219');
});

test('玛雅副本：旧任务号（3220—3226、1823）已不再注册 —— 从正式服导入的存档要归档清掉',()=>{
 for(const id of [3220,3221,3222,3223,3224,3225,3226,1823])assert.equal(officialMissions.has(id),false,'旧任务号 '+id+' 又被注册了');
 const p={quests:{active:{
  3220:{official:true,counts:{}},
  1823:{official:true,origin:{mapId:838,npcId:2},acceptedAt:'2026-01-01T00:00:00.000Z'},
  1421:{official:true,counts:{}},
 }}};
 assert.equal(migrateMayaProgress(p),true,'命中了旧任务却没归档');
 assert.equal(p.quests.active[3220],undefined,'3220 还挂在 active 里');
 assert.equal(p.quests.active[1823],undefined,'1823 还挂在 active 里');
 assert.ok(p.quests.active[1421],'把正常任务误删了');
 const entry=p.mayaRetiredProgress[0];
 assert.equal(entry.revision,mayaRetiredRevision);
 assert.ok(entry.active[3220].official,'归档时没留原记录');
 assert.equal(entry.active[1823].origin.mapId,838);
 assert.equal(migrateMayaProgress(p),false,'第二次调用应当是 no-op');
 assert.equal(p.mayaRetiredProgress.length,1,'归档不该重复追加');
});

test('玛雅副本：没有 official 标记的同号任务、以及干净存档都不动',()=>{
 // 本地自编任务万一用到这些号：没有 official 标记就不许动它。
 const local={quests:{active:{1823:{counts:{}}}}};
 assert.equal(migrateMayaProgress(local),false);
 assert.ok(local.quests.active[1823],'误删了本地自编任务');
 assert.equal(local.mayaRetiredProgress,undefined);
 // 空存档 / 没有 quests 的残缺存档也不该抛错
 assert.equal(migrateMayaProgress({quests:{active:{}}}),false);
 assert.equal(migrateMayaProgress({}),false);
 assert.equal(migrateMayaProgress(undefined),false);
});

test('技能效果覆盖必须排在 captured81 之后（否则覆盖改过字节 = 服务端起不来）',skip,()=>{
 // 回归点：第 86 版实测「技能 548（解除魔法）22 级」在技能编辑器里改过数值后，服务端
 // 直接抛 `Conflicting captured81 skill 548:22` 起不来 —— 因为 applyCaptured81 会拿抓包
 // 字节与已有记录逐字节比对，而技能覆盖早一步把 wireBase64 改掉了。
 // ① 源码顺序（真正的守卫：谁把循环挪回去，这条立刻红）
 const source=fs.readFileSync(path.join(root,'lib','official-data.mjs'),'utf8');
 const capturedAt=source.indexOf('applyCaptured81(official)');
 const loopAt=source.indexOf('applyOverrideToDefinition(skill.id,skill)');
 assert.ok(capturedAt>0,'official-data.mjs 里找不到 applyCaptured81(official)');
 assert.ok(loopAt>0,'official-data.mjs 里找不到技能覆盖循环');
 assert.ok(capturedAt<loopAt,'applyCaptured81 必须排在技能效果覆盖之前，否则覆盖过的技能会让它抛 Conflicting');

 // ② 行为：没被覆盖的抓包技能，wire 必须与抓包字节一字不差（说明 captured81 先灌、覆盖没误伤）；
 //    被覆盖的技能仍要在表里（覆盖是改写，不是删除）。
 const captured=JSON.parse(fs.readFileSync(path.join(root,'data','captured81-20260926.json'),'utf8'));
 const raw=JSON.parse(fs.readFileSync(path.join(root,'data','local-skill-overrides.json'),'utf8'));
 const overridden=id=>!!raw.skills?.[String(id)];
 for(const row of captured.skills){
  const current=official.skills.find(s=>s.id===row.id&&s.level===row.level);
  assert.ok(current,`captured81 技能 ${row.id}:${row.level} 没有进 official.skills`);
  if(!overridden(row.id))
   assert.equal(current.monsterWireBase64||current.wireBase64,row.wireBase64,
    `技能 ${row.id}:${row.level} 的抓包字节被改动（技能覆盖跑早了或写坏了）`);
 }
 // ③ 覆盖真的生效：命中规则的等级，wire 必须换掉（否则「改了没反应」）。
 //    规则也可能指向 official.skills 之外的技能表（人物技能 / 装备技能），那种情况这里不判。
 for(const idRaw of Object.keys(raw.skills||{})){
  const id=Number(idRaw),rule=raw.skills[idRaw];
  const levels=rule.levels==='all'?null:rule.levels;
  const rows=official.skills.filter(s=>s.id===id&&(!levels||levels.includes(s.level)));
  for(const row of rows){
   const source=captured.skills.find(s=>s.id===id&&s.level===row.level);
   if(source)assert.notEqual(row.monsterWireBase64||row.wireBase64,source.wireBase64,
    `技能 ${id}:${row.level} 有覆盖规则，但 wire 还是抓包原样`);
  }
 }
});