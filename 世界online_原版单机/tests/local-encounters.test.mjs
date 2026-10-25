/**
 * 第 96 版：自定义怪物编队 —— 测试。
 *
 * 覆盖：
 *   · 配置归一化：默认空、summary、号段常量
 *   · 编队字节 battleGroupWire 的结构（组号/flag/系数/怪物槽）
 *   · applyLocalEncounters：注册进 official.groups + wireBase64 已生成
 *     + replaceMission 把任务的 acceptBattleID 改指过去
 *   · 号段冲突 / 任务不存在 → failed（不抛错）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
 applyLocalEncounters, localEncounters, localEncounterSummary,
 LOCAL_ENCOUNTER_REVISION, LOCAL_GROUP_MIN, LOCAL_GROUP_MAX
} from '../lib/local-encounters.mjs';
import {battleGroupWire} from '../lib/dungeon-challenge-data.mjs';

function fakeOfficial() {
 return {
  groups: [{ groupId: 409, monsters: [0, 0, 409, 0, 409, 0, 409, 0, 0, 0], npcs: [], type: 0, flag: 0, coefficient: 0, wireBase64: 'x' }],
  missions: [{ id: 9101, name: '直达挑战一', acceptBattleID: 20369 }, { id: 9102, name: '直达挑战二', acceptBattleID: 20370 }]
 };
}
const ENC = (over = {}) => ({
 name: '测试编队', groupId: 30101,
 monsters: [409, 409, 0, 0, 0, 0, 0, 0, 0, 0], npcs: [], flag: 0, coefficient: 0,
 replaceMission: 9101, ...over
});

test('配置层：默认空、summary、号段常量', () => {
 assert.deepEqual(localEncounters(), []);
 assert.equal(localEncounterSummary().count, 0);
 assert.equal(LOCAL_ENCOUNTER_REVISION, 'local-encounters-20261025-v1');
 assert.equal(LOCAL_GROUP_MIN, 30100);
 assert.equal(LOCAL_GROUP_MAX, 30199);
});

test('编队字节：组号/类型/下一组/flag/系数/10 个怪物槽', () => {
 const wire = Buffer.from(battleGroupWire(30101, [409, 409, 0, 0, 0, 0, 0, 0, 0, 0], [], 0, 0), 'base64');
 assert.equal(wire.length, 2 + 1 + 2 + 1 + 4 + 20, '长度 = 头部 10 + 10 个 short');
 assert.equal(wire.readInt16BE(0), 30101, '开头是组号');
 assert.equal(wire[2], 0, '类型 byte');
 assert.equal(wire.readInt16BE(3), 0, '下一组');
 assert.equal(wire[5], 0, 'flag');
 assert.equal(wire.readInt32BE(6), 0, '系数');
 assert.equal(wire.readInt16BE(10), 409, '第 1 格怪物');
 assert.equal(wire.readInt16BE(12), 409, '第 2 格怪物');
 assert.equal(wire.readInt16BE(14), 0, '第 3 格空');
 // flag&2 时要多 4 个 NPC 槽
 const withNpc = Buffer.from(battleGroupWire(30102, [409, 0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 2, 3, 4], 3, 10), 'base64');
 assert.equal(withNpc.length, 10 + 20 + 8, 'flag=3 ⇒ 多 8 字节 NPC 槽');
 assert.equal(withNpc.readInt32BE(6), 10, '系数');
 assert.equal(withNpc.readInt16BE(30), 1, '第一个 NPC');
});

test('applyLocalEncounters：注册编队 + 改任务指向', () => {
 const official = fakeOfficial();
 const result = applyLocalEncounters(official, [ENC()]);
 assert.deepEqual(result.registered, [30101]);
 assert.deepEqual(result.replaced, [{ mission: 9101, groupId: 30101 }]);
 assert.deepEqual(result.failed, []);
 const group = official.groups.find(g => g.groupId === 30101);
 assert.ok(group, '编队应加入 official.groups');
 assert.deepEqual(group.monsters, [409, 409, 0, 0, 0, 0, 0, 0, 0, 0]);
 assert.ok(group.wireBase64 && group.wireBase64.length > 10, 'wireBase64 应已生成');
 assert.equal(Buffer.from(group.wireBase64, 'base64').readInt16BE(0), 30101);
 // 任务指向被改
 assert.equal(official.missions.find(q => q.id === 9101).acceptBattleID, 30101);
 assert.equal(official.missions.find(q => q.id === 9102).acceptBattleID, 20370, '其它任务不动');
});

test('applyLocalEncounters：号段冲突 / 任务不存在 → failed，不抛错', () => {
 const official = fakeOfficial();
 const conflict = applyLocalEncounters(official, [ENC({ groupId: 409 })]);
 assert.equal(conflict.failed.length, 1);
 assert.match(conflict.failed[0].reason, /占用/);
 const noMission = applyLocalEncounters(official, [ENC({ groupId: 30105, replaceMission: 999999 })]);
 assert.deepEqual(noMission.registered, [30105], '编队仍会注册');
 assert.equal(noMission.failed.length, 1);
 assert.match(noMission.failed[0].reason, /不存在/);
});

test('applyLocalEncounters：坏输入不炸', () => {
 assert.doesNotThrow(() => applyLocalEncounters(null));
 assert.doesNotThrow(() => applyLocalEncounters({}));
 assert.doesNotThrow(() => applyLocalEncounters(fakeOfficial(), []));
});
