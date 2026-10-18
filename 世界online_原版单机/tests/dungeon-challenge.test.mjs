import test from 'node:test';
import assert from 'node:assert/strict';
import {official,officialGroups,officialMonsters,officialMissions} from '../lib/official-data.mjs';
import {battleSupported,missionBattleId,missionBlockers} from '../lib/official-rules.mjs';
import {
 DUNGEON_CHALLENGE_SPECS,DUNGEON_CHALLENGE_SKIPPED,applyDungeonChallengeRepairs,
} from '../lib/dungeon-challenge-data.mjs';

/**
 * 日常副本扩展（编队补齐）。
 *
 * 这 9 个副本的**任务定义是齐的**，缺的是编队号（11918 / 11921 / 30210 / 30170…）。
 * `missionBlockers()` 判定「剧情战斗数据尚未采集」的条件就是
 * `missionBattleId(q)` 的组必须存在且组里每只怪都在官方怪物表里。
 * 所以这里钉两件事：
 *   ① 补完之后 9 个副本都能进战斗（blockers 为空）；
 *   ② 克隆出来的怪物/编队 wire **逐字节可解析**（id 与名字正确、槽位数与 flag 一致）——
 *      否则客户端收到怪物包会整包解析失败。
 */

test('9 个副本补完后都不再挂「战斗数据尚未采集」',()=>{
 for(const spec of DUNGEON_CHALLENGE_SPECS){
  const q=officialMissions.get(spec.mission);
  assert.ok(q,`任务 ${spec.mission} 必须存在`);
  assert.deepEqual(missionBlockers(q),[],`${spec.name}（${spec.mission}）不该再有阻塞项`);
  const accept=missionBattleId(q,'accept'),submit=missionBattleId(q,'submit');
  assert.ok(accept>0||submit>0,`${spec.name} 至少要有一个战斗入口`);
  for(const id of [accept,submit])if(id>0)assert.ok(battleSupported(id),`${spec.name} 的编队 ${id} 必须可打`);
 }
});

test('9100 跨服合作仍写明跳过原因，且没有引用我们没造的编队',()=>{
 assert.ok(DUNGEON_CHALLENGE_SKIPPED.length>=1);
 // 1305 BOSS 挑战赛已经单独补出来了（lib/boss-tournament-data.mjs），不该再挂在跳过名单里
 assert.equal(DUNGEON_CHALLENGE_SKIPPED.some(row=>row.mission===1305),false,'1305 已由 boss-tournament-data 补出来');
 const skippedGroups=new Set([3315,3314,2320,30160,30161,30162,30163,30164]);
 for(const row of DUNGEON_CHALLENGE_SKIPPED){
  assert.ok(row.reason,`${row.name} 要写明跳过原因`);
  const q=officialMissions.get(row.mission);
  assert.ok(q,`${row.name} 的任务仍应在表里`);
  for(const id of [missionBattleId(q,'accept'),missionBattleId(q,'submit')]){
   if(id>0)assert.ok(!skippedGroups.has(id),`${row.name} 不该引用我们没造的编队 ${id}`);
  }
 }
});

test('补出来的编队：组号、槽位、flag 与 wire 完全一致',()=>{
 for(const groupId of [11918,11921,30210,11706,30001,30002,30003,30004,30005,30006,30007,30008,30009,11733,30020,30021,30022,30023]){
  const group=officialGroups.get(groupId);
  assert.ok(group,`编队 ${groupId} 必须存在`);
  assert.equal(group.localReconstruction,true,'本地推算的编队要打标记');
  assert.ok(Array.isArray(group.sources)&&group.sources.length,`编队 ${groupId} 要写来源`);
  const bytes=Buffer.from(group.wireBase64,'base64');
  let pos=0;
  const wireId=bytes.readInt16BE(pos);pos+=2;
  const type=bytes[pos++];
  const next=bytes.readInt16BE(pos);pos+=2;
  const flag=bytes[pos++];
  const coefficient=bytes.readInt32BE(pos);pos+=4;
  assert.equal(wireId,groupId,'wire 里的组号必须与字段一致');
  assert.equal(type,group.type);
  assert.equal(next,group.nextBattleGroupID);
  assert.equal(flag,group.flag);
  assert.equal(coefficient,group.coefficient);
  const slotCount=(flag&1)?20:10;
  const slots=[];
  for(let i=0;i<slotCount;i++){slots.push(bytes.readInt16BE(pos));pos+=2;}
  assert.deepEqual(slots,group.monsters,`编队 ${groupId} 的槽位要与 wire 一致`);
  if(flag&2)pos+=8;
  assert.equal(pos,bytes.length,`编队 ${groupId} 的 wire 不能有多余字节`);
  // 每一只非零怪都必须在官方怪物表里（12501 会校验）
  for(const id of slots.filter(id=>id>0))assert.ok(officialMonsters.has(id),`编队 ${groupId} 的怪物 ${id} 必须存在`);
 }
});

test('克隆怪：id 与名字都写进了 wire，属性与原怪一致',()=>{
 const pairs=[[2531,2530],[2534,2533],[3019,3018],[1821,486],[1859,514]];
 for(const [id,reference] of pairs){
  const monster=officialMonsters.get(id),source=officialMonsters.get(reference);
  assert.ok(monster,`克隆怪 ${id} 必须存在`);
  assert.ok(source);
  assert.equal(monster.localReconstruction,true);
  assert.equal(monster.referenceMonsterId,reference);
  // 数值属性原样继承（只有 id / 名字 / 来源不同）
  for(const key of ['hpMax','mpMax','level','atkMin','atkMax','def_str','def_agi','tough','speed']){
   assert.equal(monster[key],source[key],`${id}.${key} 应与参考怪 ${reference} 相同`);
  }
  // wire 头：int32 id + 3 字节长度 + UTF-16BE 名字
  const bytes=Buffer.from(monster.wireBase64,'base64');
  assert.equal(bytes.readInt32BE(0),id,'wire 里的 id');
  const length=bytes.readUIntBE(4,3);
  const name=Buffer.from(bytes.subarray(7,7+length*2)).swap16().toString('utf16le');
  assert.equal(name,monster.name,'wire 里的名字必须是 UTF-16BE（写成小端会变乱码）');
  // 名字之外的字节要原样保留（属性区完全没动）
  const tail=bytes.subarray(7+length*2);
  const sourceBytes=Buffer.from(source.wireBase64,'base64');
  const sourceLength=sourceBytes.readUIntBE(4,3);
  assert.deepEqual(tail,sourceBytes.subarray(7+sourceLength*2),'属性区必须与参考怪逐字节相同');
 }
});

test('没 battleID 的任务挂上了编队，已有 battleID 的不被覆盖',()=>{
 // 1605 原本没有 accept/submitBattleID；3972 原本 acceptBattleID=11706（要保留）
 assert.equal(missionBattleId(officialMissions.get(1605),'submit'),30210);
 assert.equal(missionBattleId(officialMissions.get(3972),'accept'),11706);
 assert.equal(missionBattleId(officialMissions.get(2769),'submit'),11611);
 // 光/暗试炼原本就是 submit 战斗
 assert.equal(missionBattleId(officialMissions.get(1051),'submit'),11918);
 assert.equal(missionBattleId(officialMissions.get(1053),'submit'),11921);
});

test('幂等：重复 apply 不会重复 push 怪物或编队，也不会改写已有 wire',()=>{
 // ⚠️ 不能对 official 做 structuredClone（里面是惰性代理 + Map），只比较关键指纹。
 const monsters=official.monsters.length,groups=official.groups.length;
 const fingerprints=new Map(official.groups.map(g=>[g.groupId,g.wireBase64]));
 const monsterIds=new Set(official.monsters.map(m=>m.id));
 applyDungeonChallengeRepairs(official);
 assert.equal(official.monsters.length,monsters,'怪物数量不该变');
 assert.equal(official.groups.length,groups,'编队数量不该变');
 assert.deepEqual([...new Set(official.monsters.map(m=>m.id))].length,monsterIds.size,'怪物 id 不该重复');
 for(const [id,wire] of fingerprints)assert.equal(official.groups.find(g=>g.groupId===id).wireBase64,wire,`编队 ${id} 的 wire 不该被改写`);
});
