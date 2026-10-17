import test from 'node:test';
import assert from 'node:assert/strict';
import {officialMissions,officialGroups,officialMonsters,officialMaps} from '../lib/official-data.mjs';
import {battleSupported,missionBattleId} from '../lib/official-rules.mjs';
import {MID_AUTUMN_SHADOW_BOSS,MID_AUTUMN_TRUE_BOSS,MID_AUTUMN_FINAL_GROUP,MID_AUTUMN_QUEST} from '../lib/mid-autumn-final-boss.mjs';

/**
 * 中秋月宫最终 BOSS（凋羽台之争）。
 *
 * 原录制把「连续战斗」的两段录成了互不相连的两个编队：11733 只有分身、11734 才是真身，
 * 而任务 1940 的完成条件要真身击杀 —— 玩家打赢分身却交不了任务。
 * 修法是让 11733 同场带上真身（见 lib/dungeon-challenge-data.mjs ⑤）。
 *
 * 这组用例只钉结果：**打赢这一场，就能满足任务条件**。
 */

test('中秋：1940 的击杀条件全部在它触发的战斗编队里',()=>{
 const q=officialMissions.get(MID_AUTUMN_QUEST);
 assert.ok(q,'任务 1940 没有注册');
 const need=q.submitCondition.filter(c=>c.type===2).map(c=>c.monsterId);
 assert.deepEqual(need,[MID_AUTUMN_TRUE_BOSS],'1940 的击杀条件变了');
 // 关键保证：条件要的怪必须真的在这场战斗里，否则赢了也交不了
 const group=officialGroups.get(missionBattleId(q));
 assert.ok(group,'1940 触发的战斗编队不存在');
 for(const id of need)assert.ok(group.monsters.includes(id),'战斗编队里没有条件要求的怪 '+id);
});

test('中秋：最终战可战斗，且分身与真身同场',()=>{
 const group=officialGroups.get(MID_AUTUMN_FINAL_GROUP);
 assert.ok(group,'编队 11733 没有注册');
 assert.equal(battleSupported(MID_AUTUMN_FINAL_GROUP),true);
 assert.equal(missionBattleId(officialMissions.get(MID_AUTUMN_QUEST)),MID_AUTUMN_FINAL_GROUP);
 assert.ok(group.monsters.includes(MID_AUTUMN_SHADOW_BOSS),'分身不在场，任务提示「小心分身」就不成立');
 assert.ok(group.monsters.includes(MID_AUTUMN_TRUE_BOSS),'真身不在场');
});

test('中秋：编队 wire 里的槽位与字段一致（客户端只看字节）',()=>{
 const group=officialGroups.get(MID_AUTUMN_FINAL_GROUP);
 const bytes=Buffer.from(group.wireBase64,'base64');
 let pos=0;
 assert.equal(bytes.readInt16BE(pos),group.groupId,'wire 组号不一致');pos+=2;
 pos++; // type 跳过
 pos+=2; // next 跳过
 const flag=bytes[pos++];
 assert.equal(flag,group.flag,'wire flag 不一致');
 pos+=4; // coefficient 跳过
 const slotCount=(flag&1)?20:10;
 const slots=[];
 for(let i=0;i<slotCount;i++){slots.push(bytes.readInt16BE(pos));pos+=2;}
 // wire 与字段的槽位必须逐个对得上
 assert.deepEqual(slots,group.monsters,
  'wire 槽位与 monsters 字段不一致 —— 客户端会看到另一种阵容');
});

test('中秋：真身比分身强 —— 面对的确实是最终 BOSS',()=>{
 const real=officialMonsters.get(MID_AUTUMN_TRUE_BOSS);
 const shadow=officialMonsters.get(MID_AUTUMN_SHADOW_BOSS);
 assert.ok(real.hpMax>shadow.hpMax,'真身血量应高于分身：'+real.hpMax+' vs '+shadow.hpMax);
 assert.ok(real.level>=shadow.level,'真身等级不应低于分身');
 assert.ok(real.atkMax>shadow.atkMax,'真身攻击应高于分身');
});

test('中秋：1936 要刷 25 只魔炎兽，有可用编队（否则卡在最终战之前）',()=>{
 const q=officialMissions.get(1936);
 const need=q.submitCondition.filter(c=>c.type===2);
 assert.equal(need.length,1);
 assert.equal(need[0].monsterId,3295);
 assert.equal(need[0].required,25);
 const groups=[...officialGroups.values()].filter(g=>g.monsters.includes(3295));
 assert.ok(groups.length>0,'没有任何编队含魔炎兽 3295');
 for(const g of groups)assert.equal(battleSupported(g.groupId),true,'编队 '+g.groupId+' 不可战斗');
});

test('中秋：月宫 987 三个魔炎兽刷怪点都在',()=>{
 const map=officialMaps.get(987);
 assert.ok(map,'地图 987 没有注册');
 for(const id of [44,45,72]){
  const npc=map.npcs.find(n=>n.id===id);
  assert.ok(npc,'987 缺少魔炎兽 NPC '+id);
  assert.ok((npc.battleID||[]).length,'魔炎兽 NPC '+id+' 没有战斗组');
 }
});

test('中秋：修复是幂等的 —— 重复注入不会往编队里塞第二只真身',()=>{
 const group=officialGroups.get(MID_AUTUMN_FINAL_GROUP);
 const count=group.monsters.filter(id=>id===MID_AUTUMN_TRUE_BOSS).length;
 assert.equal(count,1,'编队里真身应恰好一只，实际 '+count+' 只');
});