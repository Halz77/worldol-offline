/**
 * 第 95 版：怪物 AI / 技能覆盖 —— 测试。
 *
 * 覆盖：
 *   · AI 记录编解码：真实抓包的 301 条必须逐字节往返一致（改技能全靠这个）
 *   · 套用：改技能后 wireBase64 跟着变，解回来就是配置的 id/level
 *   · 技能在 official.skills 里没有同 id 同等级 → 清零 + 警告（不然客户端拿不到定义，怪站着不动）
 *   · 原 AI 行没有这只怪 → 新增一条（mapBattleData 按怪物 id 过滤 ai，补上就会发出去）
 *   · 不写 msg 时按轮次沿用原台词
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {aiWireBytes, aiFromWire, aiRounds, aiArrays, aiSkillKeys, AI_MAX_ROUNDS} from '../lib/ai-wire.mjs';
import {applyMonsterAiOverrides, MONSTER_AI_OVERRIDE_REVISION} from '../lib/local-monster-ai-overrides.mjs';

const OFFICIAL = JSON.parse(fs.readFileSync(new URL('../data/official-v305.json', import.meta.url), 'utf8'));

test('AI 编解码：真实抓包 301 条逐字节往返一致', () => {
  assert.ok(OFFICIAL.ai.length >= 300, '数据文件里应该有整批 AI');
  let bad = 0;
  for (const row of OFFICIAL.ai) {
    const original = Buffer.from(row.wireBase64, 'base64');
    const encoded = aiWireBytes(row);
    if (Buffer.compare(original, encoded) !== 0) bad++;
  }
  assert.equal(bad, 0, '有任何一条对不上就说明字段顺序/编码解错了');
});

test('AI 解码：能把 14 号（两轮 + 台词）读成 rounds', () => {
  const row = OFFICIAL.ai.find(a => a.id === 414);
  const decoded = aiFromWire(Buffer.from(row.wireBase64, 'base64'));
  assert.equal(decoded.id, 414);
  assert.equal(decoded.rounds.length, 2);
  assert.equal(decoded.rounds[0].msg, row.msg[0]);
  assert.equal(decoded.rounds[0].conValue, row.conValue[0]);
  assert.equal(decoded.rounds[1].targetType, row.targetType[1]);
  // rounds ↔ 并列数组 两条路必须等价
  const back = aiArrays(decoded.rounds);
  assert.deepEqual(back.msg, row.msg);
  assert.deepEqual(back.targetType, row.targetType);
  assert.deepEqual(aiRounds(row), aiRounds({rounds: decoded.rounds}));
});

test('套用：改技能 → wireBase64 变、解回来就是新技能、台词保留', () => {
  const row = OFFICIAL.ai.find(a => a.id === 414);
  const official = {ai: [{...row}], skills: [{id: 5122, level: 6, name: '南瓜屏障'}]};
  const beforeWire = official.ai[0].wireBase64;

  const result = applyMonsterAiOverrides(official, {
    414: {rounds: [{skill1: {id: 5122, level: 6}, skill2: {id: 0, level: 0}, targetType: 4}]}
  });
  assert.deepEqual(result.applied, [{id: 414, rounds: 1}]);
  assert.deepEqual(result.warnings, []);
  const next = official.ai[0];
  assert.notEqual(next.wireBase64, beforeWire, '必须重编码');
  assert.equal(next.skill1[0].id, 5122);
  assert.equal(next.skill1[0].level, 6);
  assert.equal(next.targetType[0], 4);
  // 客户端读的是 wire，所以解出来必须是同一份数据
  const decoded = aiFromWire(Buffer.from(next.wireBase64, 'base64'));
  assert.deepEqual(decoded.rounds[0].skill1, {id: 5122, level: 6});
  assert.equal(decoded.rounds[0].targetType, 4);
  // 没写 msg ⇒ 沿用原版第 1 轮台词
  assert.equal(decoded.rounds[0].msg, row.msg[0]);
});

test('套用：技能定义不存在 → 清零并警告（不能发一条客户端没有定义的技能）', () => {
  const row = OFFICIAL.ai.find(a => a.id === 414);
  const official = {ai: [{...row}], skills: [{id: 5122, level: 6}]};
  const result = applyMonsterAiOverrides(official, {
    414: {rounds: [{skill1: {id: 5122, level: 99}, skill2: {id: 77777, level: 1}}]}
  });
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /没有定义|已清零/);
  assert.equal(official.ai[0].skill1[0].id, 0);
  assert.equal(official.ai[0].skill2[0].id, 0);
});

test('套用：等级填 0 → 视为没配，清零提示', () => {
  const row = OFFICIAL.ai.find(a => a.id === 414);
  const official = {ai: [{...row}], skills: [{id: 5122, level: 6}]};
  const result = applyMonsterAiOverrides(official, {414: {rounds: [{skill1: {id: 5122, level: 0}}]}});
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /等级/);
  assert.equal(official.ai[0].skill1[0].id, 0);
});

test('套用：原来没有 AI 行的怪 → 新增一条', () => {
  const official = {ai: [], skills: [{id: 5122, level: 6}]};
  const result = applyMonsterAiOverrides(official, {
    4204: {rounds: [{skill1: {id: 5122, level: 6}, targetType: 2}]}
  });
  assert.deepEqual(result.applied, [{id: 4204, rounds: 1}]);
  assert.equal(official.ai.length, 1);
  const added = official.ai[0];
  assert.equal(added.id, 4204);
  assert.equal(added.skill1[0].id, 5122);
  const decoded = aiFromWire(Buffer.from(added.wireBase64, 'base64'));
  assert.equal(decoded.id, 4204);
  assert.equal(decoded.rounds[0].skill2.id, 0);
});

test('套用：空配置不动任何东西', () => {
  const row = OFFICIAL.ai.find(a => a.id === 414);
  const official = {ai: [{...row}], skills: []};
  const before = official.ai[0].wireBase64;
  const result = applyMonsterAiOverrides(official, {});
  assert.deepEqual(result.applied, []);
  assert.equal(official.ai[0].wireBase64, before);
});

test('工具函数：轮数上限、技能键集合、revision', () => {
  assert.equal(AI_MAX_ROUNDS, 8);
  assert.match(MONSTER_AI_OVERRIDE_REVISION, /^monster-ai-overrides-/);
  const keys = aiSkillKeys({rounds: [
    {skill1: {id: 1, level: 2}, skill2: {id: 3, level: 4}},
    {skill1: {id: 0, level: 0}, skill2: {id: 1, level: 2}}
  ]});
  assert.deepEqual([...keys].sort(), ['1:2', '3:4']);
  assert.throws(() => aiWireBytes({id: 1, rounds: new Array(AI_MAX_ROUNDS + 1).fill({skill1: {id: 0, level: 0}})}), /轮数/);
});
