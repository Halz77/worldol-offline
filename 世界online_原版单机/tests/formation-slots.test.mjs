/**
 * 第 94 版：阵法按阵位差异化加成 —— 测试。
 *
 * 覆盖：
 *   · 配置归一化（空/坏档/非法 power/空槽丢弃/全局 mode 继承）
 *   · formationSlotBonus 阵位钳制、宠物段、未配置返回 null
 *   · 补丁：add/replace 两种模式、角色与宠物、formationSkill 调用后必定还原（不污染）、
 *     阵位按己方角色 position 升序排名（宠物不占位）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
 formationSlotConfig, formationSlotGlobals, formationSlotBonus, formationSlotSummary,
 FORMATION_SLOT_REVISION, MAX_SLOTS
} from '../lib/local-formation-slots.mjs';
import {
 installFormationSlots, patchFormationSlots, formationSlotPatchRevision
} from '../lib/client-formation-slot-patch.mjs';

const ORIGINAL = fs.readFileSync(new URL('../client/js/ff/fff570bb4753f056432680e781d827dc.js', import.meta.url), 'utf8');

// ── 配置层 ───────────────────────────────────────────────
test('配置层：默认空、globals 结构、summary', () => {
 const conf = formationSlotConfig();
 assert.equal(typeof conf.forms, 'object');
 assert.equal(conf.revision, FORMATION_SLOT_REVISION);
 const g = formationSlotGlobals();
 assert.equal(typeof g.forms, 'object');
 assert.equal(g.mode, 'add');
 const sum = formationSlotSummary();
 assert.equal(typeof sum.configured, 'number');
 assert.equal(MAX_SLOTS, 5);
});

test('formationSlotBonus：阵位钳制 / 宠物段 / 未配置返回 null', () => {
 assert.equal(formationSlotBonus(99999, 1, false), null, '未配置的阵返回 null');
 // 真实配置文件目前是空的，用 patch 的 peek 验证归一化行为
});

// ── 补丁：构造假环境 ─────────────────────────────────────
/** 假角色原型：8 参 getPowerValue（简化版公式，保留「百分比乘算 + 阵法查表」两步）。
 *  ⚠ 必须是 8 个形参：补丁按 getPowerValue.length>=8 识别角色类（真包 0056 就是 8 参）。 */
function makeRoleProto() {
 return {
  getSkillPowerValue() { return 0; },
  getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) {
   let add = Number(base) || 0;
   let pct = 0;
   if (this.formationSkill) {
    add += this.formationSkill.getPowerValue(addKey);
    pct += this.formationSkill.getPowerValue(pctKey);
   }
   add += Math.trunc((add * pct) / 100);
   return add;
  }
 };
}
/** 假宠物原型：getPetBaseValue / getPetPowerValue，走 ownerVo.formationSkill。 */
function makePetProto() {
 return {
  getPetBaseValue(base, addKey, pctKey) {
   let add = Number(base) || 0;
   let pct = 0;
   if (this.ownerVo && this.ownerVo.formationSkill) {
    add += this.ownerVo.formationSkill.getPowerValue(addKey);
    pct += this.ownerVo.formationSkill.getPowerValue(pctKey);
   }
   add += Math.trunc((add * pct) / 100);
   return add;
  },
  // ⚠ 真包 0042 的 getPetPowerValue 是独立实现（不调 getPetBaseValue）；这里也照做，
  // 否则两个方法都被包装时加成会被叠加两次（测试用例 7 踩过）。
  getPetPowerValue(base, addKey, pctKey) {
   let add = Number(base) || 0;
   let pct = 0;
   if (this.ownerVo && this.ownerVo.formationSkill) {
    add += this.ownerVo.formationSkill.getPowerValue(addKey);
    pct += this.ownerVo.formationSkill.getPowerValue(pctKey);
   }
   add += Math.trunc((add * pct) / 100);
   return add;
  }
 };
}
/** 假战斗：己方角色位置 22/23/25/26/27 + 宠物 24，敌人 3/4/5。 */
function makeBattle() {
 const mk = (pos, pet) => (pet ? { position: pos, battleSprite: {}, ownerVo: { id: 1 } } : { position: pos, battleSprite: {} });
 const units = { 3: mk(3), 4: mk(4), 5: mk(5), 22: mk(22), 23: mk(23), 24: mk(24, true), 25: mk(25), 26: mk(26), 27: mk(27) };
 return { getPlayerByPos: p => units[p] || null, units };
}

function makeEnv(conf) {
 const roleProto = makeRoleProto();
 const petProto = makePetProto();
 const battle = makeBattle();
 const req = id => {
  if (id === 54) return { default: { ins: { battle } } };
  throw Error('unexpected module ' + id);
 };
 req.c = { 56: { default: roleProto }, 42: { default: petProto } };
 const host = { worldolFormationSlots: conf };
 const api = installFormationSlots(req, host);
 return { req, host, roleProto, petProto, battle, api };
}
const CONF = {
 revision: 't', mode: 'add',
 forms: {
  1: { mode: 'add', slots: [{ powers: [[28, 6]] }, { powers: [[31, 5]] }, { powers: [[23, 7]] }, {}, { powers: [[27, 3]] }], pet: { powers: [[31, 8]] } },
  2: { mode: 'replace', slots: [{ powers: [[30, 10]] }], pet: { powers: [] } }
 }
};

test('补丁：挂上角色与宠物原型', () => {
 const { api } = makeEnv(CONF);
 assert.equal(api.status.roleHooked, true);
 assert.equal(api.status.petHooked, true);
 assert.equal(api.status.configured, 2);
 api.stop();
});

test('补丁 add 模式：阵位加成叠加在原版统一加成之上', () => {
 const { roleProto, api } = makeEnv(CONF);
 const realFs = { id: 1, getPowerValue: k => (k === 28 ? 22 : 0) };   // 天覆阵原版：劈砍攻击 +22%
 const unit = { position: 22, formationSkill: realFs };              // 位置 22 = 第 1 位
 // 第 1 位配 +6% ⇒ 22 + 6 = 28（平加），百分比段 0
 assert.equal(roleProto.getPowerValue.call(unit, 100, 0, 28, 999), 128, '基础100 + (22+6) 平加');
 assert.equal(unit.formationSkill, realFs, '调用后 formationSkill 必须还原成原对象');
 assert.equal(api.status.rolePatches, 1);
 api.stop();
});

test('补丁 replace 模式：顶掉原版统一加成，只吃阵位加成', () => {
 const { roleProto, api } = makeEnv(CONF);
 const realFs = { id: 2, getPowerValue: k => (k === 30 ? 22 : 0) };   // 原版魔法攻击 +22%
 const unit = { position: 22, formationSkill: realFs };
 assert.equal(roleProto.getPowerValue.call(unit, 100, 0, 30, 999), 110, 'replace ⇒ 只有 +10，不含原版 22');
 assert.equal(unit.formationSkill, realFs);
 api.stop();
});

test('补丁：阵位按己方角色 position 升序排名，宠物不占位', () => {
 const { roleProto, api } = makeEnv(CONF);
 const realFs = { id: 1, getPowerValue: () => 0 };
 // 己方角色：22,23,25,26,27（宠物 24 排除）⇒ 25 是第 3 位（配 +7% 出手速度）
 const me = { position: 25, formationSkill: realFs };
 assert.equal(roleProto.getPowerValue.call(me, 100, 0, 23, 999), 107, '第 3 位 +7%');
 // 位置 22 = 第 1 位（+6% 劈砍攻击）
 const first = { position: 22, formationSkill: realFs };
 assert.equal(roleProto.getPowerValue.call(first, 100, 0, 28, 999), 106);
 // 位置 27 = 第 5 位（+3% 致命）
 const last = { position: 27, formationSkill: realFs };
 assert.equal(roleProto.getPowerValue.call(last, 100, 0, 27, 999), 103);
 // 位置 23 = 第 2 位（+5% 劈砍防御）
 const second = { position: 23, formationSkill: realFs };
 assert.equal(roleProto.getPowerValue.call(second, 100, 0, 31, 999), 105);
 api.stop();
});

test('补丁：宠物用 pet 段（不占角色阵位），且主人 formationSkill 会还原', () => {
 const { petProto, api } = makeEnv(CONF);
 const realFs = { id: 1, getPowerValue: () => 0 };
 const ownerVo = { id: 9, formationSkill: realFs };
 const pet = Object.assign(Object.create(petProto), { position: 24, ownerVo });
 assert.equal(petProto.getPetBaseValue.call(pet, 100, 31, 999), 108, '宠物 +8% 劈砍防御');
 assert.equal(ownerVo.formationSkill, realFs, '主人的 formationSkill 必须还原');
 assert.equal(petProto.getPetPowerValue.call(pet, 100, 31, 999), 108, 'getPetPowerValue 同样生效');
 assert.equal(api.status.petPatches, 2);
 api.stop();
});

test('补丁：未配置的阵 / 无阵 / 配置缺失 ⇒ 完全走原生', () => {
 const { roleProto, api } = makeEnv(CONF);
 const other = { id: 99, getPowerValue: k => (k === 28 ? 5 : 0) };   // 没配过的阵（只给 28 加成）
 const u1 = { position: 22, formationSkill: other };
 assert.equal(roleProto.getPowerValue.call(u1, 100, 0, 28, 999), 105, '原样（+5）');
 const u2 = { position: 22, formationSkill: null };
 assert.equal(roleProto.getPowerValue.call(u2, 100, 0, 28, 999), 100);
 api.stop();
 // 完全没有配置全局变量
 const env2 = makeEnv(null);
 const fs2 = { id: 1, getPowerValue: k => (k === 28 ? 22 : 0) };
 const u3 = { position: 22, formationSkill: fs2 };
 assert.equal(env2.roleProto.getPowerValue.call(u3, 100, 0, 28, 999), 122, '无配置 ⇒ 原版 22');
 env2.api.stop();
});

test('补丁：空阵位（配了阵但该位没有加成）不干预，add 模式下原样', () => {
 const { roleProto, api } = makeEnv(CONF);
 const realFs = { id: 1, getPowerValue: k => (k === 28 ? 22 : 0) };
 const unit = { position: 26, formationSkill: realFs };   // 位置 26 = 第 4 位（slots[3] 空）
 assert.equal(roleProto.getPowerValue.call(unit, 100, 0, 28, 999), 122, '第 4 位没配 ⇒ 原版 22');
 api.stop();
});

test('补丁：任务 NPC / 佣兵 / 伙伴 不占阵位，也不吃阵位加成', () => {
  const { roleProto, api, battle } = makeEnv(CONF);
  // 战场里塞两个系统 NPC（TYPE_NPC=1）到己方 21、28 位
  battle.units[21] = { position: 21, battleSprite: {}, vo: { getType: () => 1 } };
  battle.units[28] = { position: 28, battleSprite: {}, vo: { getType: () => 1 } };
  const realFs = { id: 1, getPowerValue: () => 0 };
  // 我方角色位置仍是 22/23/25/26/27 ⇒ 排名不变：22=第1位(+6%)、25=第3位(+7%)
  const me = { position: 25, formationSkill: realFs };
  assert.equal(roleProto.getPowerValue.call(me, 100, 0, 23, 999), 107, 'NPC 不占位：我仍是第 3 位');
  const first = { position: 22, formationSkill: realFs };
  assert.equal(roleProto.getPowerValue.call(first, 100, 0, 28, 999), 106, '第 1 位仍是位置 22');
  // NPC 自己调用属性计算 ⇒ 不参与阵位（走原版，不注入 adapter）
  const npc = { position: 21, formationSkill: realFs, vo: { getType: () => 1 } };
  assert.equal(roleProto.getPowerValue.call(npc, 100, 0, 28, 999), 100, 'NPC 不吃阵位加成');
  api.stop();
});

test('补丁：军团（TYPE_LEGION=10）占阵位，且自己也能吃加成', () => {
  // 0256.js：军团 VO 继承 i(56)=PlayerVO（})(s["default"]) ⇒ 有 getPowerValue，
  // 所以军团既参与阵位排名，也能吃到对应阵位的加成（单机陪战的军团要这个）。
  const { roleProto, api, battle } = makeEnv(CONF);
  battle.units[21] = { position: 21, battleSprite: {}, vo: { getType: () => 10 } };   // 军团
  const realFs = { id: 1, getPowerValue: () => 0 };
  // 己方参与排名：21(军团) 22 23 25 26 27 ⇒ 军团=第1位、22=第2位、25=第4位、27=第6位（钳到5）
  const legion = { position: 21, formationSkill: realFs, vo: { getType: () => 10 } };
  assert.equal(roleProto.getPowerValue.call(legion, 100, 0, 28, 999), 106, '军团第 1 位 +6% 劈砍攻击');
  const second = { position: 22, formationSkill: realFs, vo: { getType: () => 3 } };
  assert.equal(roleProto.getPowerValue.call(second, 100, 0, 31, 999), 105, '22 被挤到第 2 位 +5% 劈砍防御');
  const fourth = { position: 25, formationSkill: realFs, vo: { getType: () => 3 } };
  assert.equal(roleProto.getPowerValue.call(fourth, 100, 0, 23, 999), 100, '25 变第 4 位（该位没配）⇒ 原样');
  assert.equal(legion.formationSkill, realFs, '调用后仍要还原');
  api.stop();
});

test('补丁入口：幂等 + 锚点校验 + 追加注入 + peek', () => {
 const patched = patchFormationSlots(ORIGINAL);
 assert.ok(patched.startsWith(ORIGINAL));
 assert.ok(patched.endsWith(')(window.__worldReq,window);\n'));
 assert.throws(() => patchFormationSlots(patched), /already installed/);
 assert.throws(() => patchFormationSlots('nothing here'), /mismatch/);
 assert.equal(formationSlotPatchRevision, 'formation-slot-patch-20261025-v1');
 const { api } = makeEnv(CONF);
 const peek = api.peek(1, 1, false);
 assert.equal(peek.mode, 'add');
 assert.deepEqual(peek.powers, [[28, 6]]);
 assert.equal(api.peek(1, 1, true).powers[0][0], 31, '宠物段');
 assert.equal(api.peek(999, 1, false), null);
 api.stop();
});
