/**
 * 第 93 版 B 层：自动技能触发概率 + 技能随机目标 —— 测试。
 *
 * 覆盖：
 *   · 配置读取与百分比规范化（坏档/缺文件/越界值）
 *   · 自动技能补丁：未配置放行 / 100% 放行 / 0% 恒不触发 / 30% 的统计分布 / 原生负数透传
 *   · 随机目标补丁：area 40—59 解码、数量不足返回实际数、池空返回 null、非该段透传
 *   · 技能说明：只给 <100% 的自动技能追加、幂等、不动主动/被动、重算 wireBase64
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 installAutoSkillChance, patchAutoSkillChance, autoSkillChancePatchRevision
} from '../lib/client-auto-skill-chance-patch.mjs';
import {
 installRandomTarget, patchRandomTarget, decodeRandomArea, randomTargetRevision,
 RANDOM_TARGET_MIN, RANDOM_TARGET_MAX
} from '../lib/client-random-target-patch.mjs';
import {
 autoSkillChanceTable, autoSkillChanceGlobals, chanceInfoLine, decorateAutoSkillChance,
 INFO_MARK, AUTO_SKILL_CHANCE_REVISION
} from '../lib/local-auto-skill-chance.mjs';

const ORIGINAL = fs.readFileSync(new URL('../client/js/ff/fff570bb4753f056432680e781d827dc.js', import.meta.url), 'utf8');

// ── 配置层 ───────────────────────────────────────────────
test('配置层：默认空表、globals 结构、百分比说明文案', () => {
 const table = autoSkillChanceTable();
 assert.equal(typeof table, 'object');
 const globals = autoSkillChanceGlobals();
 assert.ok(globals.revision, 'globals 应带 revision');
 assert.equal(typeof globals.chance, 'object');
 assert.equal(AUTO_SKILL_CHANCE_REVISION, 'auto-skill-chance-20261025-v1');
 assert.match(chanceInfoLine(30), /每回合 30% 概率触发/);
 assert.equal(chanceInfoLine(30), '每回合 30% 概率触发', '文案保持简洁：不带任何后缀');
 assert.equal(chanceInfoLine(100), '每回合 100% 概率触发');
 assert.equal(chanceInfoLine(0), '每回合 0% 概率触发');
});

// ── 自动技能概率补丁 ─────────────────────────────────────
function fakeBattleReq(kind) {
 const proto = kind === 'auto'
  ? { getAutoSkillIDByRound() { return 108; }, doAutoSkill() {}, autoSkillID: [108], round: 1, getAutoSkillCount() { return 1; } }
  : (() => {
   // 随机目标用：敌侧池 1—10 里只有 1/2/5/7/9 在场，我方池 11—13 都在场
   const alive = new Set([1, 2, 5, 7, 9, 11, 12, 13]);
   const calls = [];
   return {
    calls,
    getSelectArea(actorPos, targetPos, area) {
     calls.push(area);
     if (area === 19) return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];   // 敌全体：10 个位置（含空）
     if (area === 29) return [11, 12, 13];
     return ['passthrough', area];
    },
    getPlayerByPos(pos) { return alive.has(pos) ? { battleSprite: {} } : null; },
    isValidBattlePlayer(unit) { return !!unit; }
   };
  })();
 const mods = { 251: { default: proto } };
 const req = id => { if (mods[id]) return mods[id]; throw Error('unexpected module ' + id); };
 req.c = { 251: { default: proto } };
 return { req, proto, mods };
}

test('概率补丁：未配置/100% 放行，0% 恒不触发，30% 统计约三成', () => {
 const { req } = fakeBattleReq('auto');
 const host = { worldolAutoSkillChance: { chance: {} } };
 const api = installAutoSkillChance(req, host);
 assert.equal(api.status.hooked, true, '应挂上战斗类');
 const proto = api.__proto || req(251).default;
 // 未配置 ⇒ 原值
 assert.equal(req(251).default.getAutoSkillIDByRound(), 108);
 // 100% ⇒ 原值
 host.worldolAutoSkillChance = { chance: { 108: 100 } };
 assert.equal(req(251).default.getAutoSkillIDByRound(), 108);
 // 0% ⇒ -1（doAutoSkill 里 `0 > o` 会 return，本回合空过）
 host.worldolAutoSkillChance = { chance: { 108: 0 } };
 assert.equal(req(251).default.getAutoSkillIDByRound(), -1);
 // 30% ⇒ 统计
 host.worldolAutoSkillChance = { chance: { 108: 30 } };
 let hit = 0;
 for (let i = 0; i < 2000; i++) { if (req(251).default.getAutoSkillIDByRound() === 108) hit++; }
 const rate = hit / 2000;
 assert.ok(rate > 0.24 && rate < 0.36, '30% 配置应落在 24%—36%，实际 ' + (rate * 100).toFixed(1) + '%');
 assert.ok(api.status.rolls >= 2000 && api.status.skipped > 0);
 api.stop();
});

test('概率补丁：原生返回负数（本来就不施放）原样透传，不重复计数', () => {
 const proto = { getAutoSkillIDByRound() { return -1; }, doAutoSkill() {} };
 const req = id => ({ default: proto });
 req.c = { 251: { default: proto } };
 const api = installAutoSkillChance(req, { worldolAutoSkillChance: { chance: { 108: 0 } } });
 assert.equal(proto.getAutoSkillIDByRound(), -1);
 assert.equal(api.status.rolls, 0, '负数不参与掷骰');
 api.stop();
});

test('概率补丁：入口幂等 + 锚点校验 + 追加注入', () => {
 const patched = patchAutoSkillChance(ORIGINAL);
 assert.ok(patched.startsWith(ORIGINAL), '追加式补丁保留原包');
 assert.ok(patched.endsWith(')(window.__worldReq,window);\n'));
 assert.throws(() => patchAutoSkillChance(patched), /already installed/);
 assert.throws(() => patchAutoSkillChance('no anchor'), /mismatch/);
 assert.equal(autoSkillChancePatchRevision, 'auto-skill-chance-patch-20261025-v1');
});

// ── 随机目标补丁 ─────────────────────────────────────────
test('随机目标：area 号段解码', () => {
 assert.deepEqual(decodeRandomArea(40), { side: 'enemy', count: 1 });
 assert.deepEqual(decodeRandomArea(45), { side: 'enemy', count: 6 });
 assert.deepEqual(decodeRandomArea(49), { side: 'enemy', count: 10 });
 assert.deepEqual(decodeRandomArea(50), { side: 'me', count: 1 });
 assert.deepEqual(decodeRandomArea(55), { side: 'me', count: 6 });
 assert.deepEqual(decodeRandomArea(59), { side: 'me', count: 10 });
 for (const area of [0, 19, 29, 38, 39, 60, 99, -1, 1.5, '45', null, undefined]) {
  assert.equal(decodeRandomArea(area), null, 'area=' + area + ' 不应命中随机段');
 }
 assert.equal(RANDOM_TARGET_MIN, 40); assert.equal(RANDOM_TARGET_MAX, 59);
});

test('随机目标：敌随机 N 从存活池里挑 N 个，不足返回实际数', () => {
 const { req, proto } = fakeBattleReq('target');
 const host = {};
 const api = installRandomTarget(req, host);
 assert.equal(api.status.hooked, true);
 // 敌全体池 = [1..10]，存活只有 1,2,5,7,9 ⇒ 5 个
 const five = proto.getSelectArea(1, 1, 45);          // 敌随机 6 个
 assert.equal(five.length, 5, '池里只有 5 个存活 ⇒ 返回 5 个（不返回 null）');
 assert.ok(five.every(p => [1, 2, 5, 7, 9].includes(p)), '只能挑存活位置');
 assert.equal(new Set(five).size, 5, '不能重复');
 const two = proto.getSelectArea(1, 1, 42);           // 敌随机 3 个
 assert.equal(two.length, 3);
 // 我方随机
 const mine = proto.getSelectArea(1, 1, 52);
 assert.ok(mine.length <= 3);
 // 非随机段 ⇒ 原样透传（area 19/29 是随机段内部借用的「全体池」，不算透传样本）
 assert.deepEqual(proto.getSelectArea(1, 1, 0), ['passthrough', 0]);
 assert.deepEqual(proto.getSelectArea(1, 1, 38), ['passthrough', 38]);
 assert.equal(api.status.randomCalls, 3);
 api.stop();
});

test('随机目标：池为空返回 null（原版语义=目标无效）', () => {
 const proto = {
  getSelectArea(actorPos, targetPos, area) { return area === 19 ? [] : null; },
  getPlayerByPos() { return null; }
 };
 const req = id => ({ default: proto });
 req.c = { 251: { default: proto } };
 const api = installRandomTarget(req, {});
 assert.equal(proto.getSelectArea(1, 1, 41), null);
 assert.equal(api.status.empty, 1);
 api.stop();
});

test('随机目标：入口幂等 + 锚点校验 + pick 钩子', () => {
 const patched = patchRandomTarget(ORIGINAL);
 assert.ok(patched.startsWith(ORIGINAL));
 assert.throws(() => patchRandomTarget(patched), /already installed/);
 assert.throws(() => patchRandomTarget('nothing'), /mismatch/);
 assert.equal(randomTargetRevision, 'random-target-patch-20261025-v1');
 const pool = [1, 2, 3, 4, 5];
 // 这个 req 找不到战斗类 ⇒ install 会起 800ms 轮询补挂，必须 stop() 否则测试进程不退出
 const api = installRandomTarget(id => ({ default: {} }), {});
 const picked = api.pick(pool, 2);
 assert.equal(picked.length, 2);
 assert.ok(picked.every(p => pool.includes(p)));
 api.stop();
});

// ── 技能说明追加 ─────────────────────────────────────────
const fakeSkillBytes = s => ({ toString: () => 'wire:' + (s.info || '') });

test('技能说明：只给配了 <100% 的自动技能追加一行，并重算 wire', () => {
 const auto = { id: 108, name: '魔化武器', type: 2, levels: [
  { level: 1, info: '提升攻击力。', wireBase64: 'old', monsterWireBase64: 'oldM' },
  { level: 5, info: '提升攻击力。', wireBase64: 'old5' }
 ] };
 const active = { id: 205, name: '重击', type: 3, levels: [{ level: 1, info: '造成伤害。' }] };
 const untouched = { id: 300, name: '别的自动技能', type: 2, levels: [{ level: 1, info: '原文。' }] };
 const map = new Map([[108, auto], [205, active], [300, untouched]]);
 const changed = decorateAutoSkillChance(map, fakeSkillBytes, { table: { 108: 30 }, mode: 'changed' });
 assert.equal(changed.length, 1);
 assert.equal(changed[0].id, 108);
 assert.match(auto.levels[0].info, /^提升攻击力。\n每回合 30% 概率触发/);
 assert.ok(auto.levels[0].info.includes('每回合 30% 概率触发'));
 assert.match(auto.levels[1].info, /每回合 30% 概率触发/, '每个等级都要带说明');
 // 注意：wire 里含换行，正则必须用 [\s\S] 而不是 .*
 assert.match(auto.levels[0].wireBase64, /^wire:[\s\S]*每回合 30% 概率触发/, 'wireBase64 必须重算');
 assert.match(auto.levels[0].monsterWireBase64, /^wire:[\s\S]*每回合 30% 概率触发/, 'monsterWireBase64 也要重算');
 assert.equal(active.levels[0].info, '造成伤害。', '主动技能不动');
 assert.equal(untouched.levels[0].info, '原文。', '未配置的自动技能不动（默认 100%）');
});

test('技能说明：幂等（重复调用不会叠加标记行）+ infoMode=all 覆盖 100%', () => {
 const auto = { id: 108, type: 2, levels: [{ level: 1, info: '提升攻击力。' }] };
 const map = new Map([[108, auto]]);
 decorateAutoSkillChance(map, fakeSkillBytes, { table: { 108: 30 }, mode: 'changed' });
 decorateAutoSkillChance(map, fakeSkillBytes, { table: { 108: 30 }, mode: 'changed' });
 const countLine = () => auto.levels[0].info.split('概率触发').length - 1;   // 文案改简洁后没有【】前缀，按「概率触发」计数
 const marks = countLine();
 assert.equal(marks, 1, '概率行只能有一条');
 // 改概率后说明应更新为新数值，而不是再追加
 decorateAutoSkillChance(map, fakeSkillBytes, { table: { 108: 60 }, mode: 'changed' });
 assert.match(auto.levels[0].info, /60% 概率触发/);
 assert.equal(countLine(), 1, '改值后仍只有一条');
 // all 模式：100%
 const auto2 = { id: 300, type: 2, levels: [{ level: 1, info: '原文。' }] };
 decorateAutoSkillChance(new Map([[300, auto2]]), fakeSkillBytes, { table: {}, mode: 'all' });
 assert.match(auto2.levels[0].info, /每回合 100% 概率触发/);
});

test('技能说明：不污染上游等级对象（浅拷贝替换）', () => {
 const upstreamLevel = { level: 1, info: '原始说明。' };
 const map = new Map([[108, { id: 108, type: 2, levels: [upstreamLevel] }]]);
 decorateAutoSkillChance(map, fakeSkillBytes, { table: { 108: 30 }, mode: 'changed' });
 assert.equal(upstreamLevel.info, '原始说明。', '上游对象不能被改');
 assert.match(map.get(108).levels[0].info, /每回合 30% 概率触发/, '表里换成新对象');
});
