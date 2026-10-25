/**
 * 第 97 版回归测试：客户端补丁必须「在裸环境里也能跑」。
 *
 * 背景（线上事故）：补丁的 install 函数是用 `fn.toString()` 塞进客户端主包末尾执行的。
 * 它在客户端里**没有模块作用域** —— 文件里 import 的东西、顶层 const、辅助函数全都不存在。
 * 第 93 版的随机目标补丁引用了 `decodeRandomArea` / `RANDOM_TARGET_MIN` 这些模块级标识符，
 * 结果客户端每次 getSelectArea 都抛 ReferenceError，技能全都放不出来、概率也判定不了。
 *
 * 这个文件用 `vm.runInNewContext` 造一个**只有内建对象**的空环境来跑 install 源码，
 * 任何越界引用都会立刻以 ReferenceError 暴露 —— 这正是线上那种失败方式。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installRandomTarget} from '../lib/client-random-target-patch.mjs';
import {installAutoSkillChance} from '../lib/client-auto-skill-chance-patch.mjs';
import {installFormationSlots} from '../lib/client-formation-slot-patch.mjs';
import {installDiagnostics} from '../lib/client-diagnostics-patch.mjs';

/** 在「只有内建对象」的沙箱里执行 install 源码（模拟客户端主包末尾）。 */
function runBare(install, req, host) {
  const sandbox = {
    Math, Object, Array, Number, String, JSON, Boolean, Error, RegExp, Date,
    parseInt, parseFloat, isFinite, isNaN, Infinity, NaN, undefined,
    console, setInterval, clearInterval, setTimeout, clearTimeout,
    req, host
  };
  vm.createContext(sandbox);
  vm.runInContext('(' + install.toString() + ')(req, host);', sandbox, {timeout: 5000});
  return sandbox;
}

// ── 随机目标 ─────────────────────────────────────────────
/** 假战斗类：左半场 0—19（我方，0/1 在场），右半场 20—33（敌方，20—24 在场、25 空）。 */
function makeBattleProto() {
  const alive = new Set([0, 1, 20, 21, 22, 23, 24]);
  const side = p => (p < 20 ? 'left' : 'right');
  return {
    getSelectArea(actorPos, targetPos, area) {
      if (area === 19) {
        if (side(actorPos) === side(targetPos)) return null;
        return [20, 21, 22, 23, 24, 25];                 // 敌全体：含空位（原版就是这样）
      }
      if (area === 29) {
        if (side(actorPos) !== side(targetPos)) return null;
        return [0, 1, 2];
      }
      return ['native', area];
    },
    getPlayerByPos(pos) { return alive.has(pos) ? {position: pos, battleSprite: {}, vo: {getType: () => 3}} : null; },
    isValidBattlePlayer(unit) { return !!unit; },
    searchAICursor() { return -1; }                       // 原版对未知 area 的表现：拿不到光标
  };
}

test('裸环境：随机目标补丁不引用模块作用域（ReferenceError 回归）', () => {
  const proto = makeBattleProto();
  const consts = {
    skillAreaText: new Array(39).fill('x'),
    getSkillAreaString(area) {
      return area < 0 || area >= this.skillAreaText.length ? 'skillArea_' + area : this.skillAreaText[area];
    }
  };
  const req = {c: {4: consts, 251: {default: function Battle() {}}}};
  req.c[251].default.prototype = proto;
  const host = {};
  runBare(installRandomTarget, req, host);

  const api = host.__worldolRandomTargetPatch;
  assert.ok(api, '补丁应挂载');
  assert.equal(api.status.hooked, true);

  // 关键：不抛错，且真的随机挑 5 个存活敌人（25 是空位，必须被过滤）
  const picked = proto.getSelectArea(0, 0, 44);
  assert.equal(picked.length, 5);
  assert.ok(picked.every(p => p >= 20 && p <= 24), '不能包含空位 25');

  // 我方随机 2 个
  const mine = proto.getSelectArea(1, 1, 51);
  assert.equal(mine.length, 2);
  assert.ok(mine.every(p => p === 0 || p === 1));

  // 非随机段原样透传
  assert.deepEqual(proto.getSelectArea(0, 0, 0), ['native', 0]);
  api.stop();
});

test('裸环境：随机目标补丁补上 searchAICursor（自动施放选目标走这条）', () => {
  const proto = makeBattleProto();
  const req = {c: {251: {default: function Battle() {}}}};
  req.c[251].default.prototype = proto;
  const host = {};
  runBare(installRandomTarget, req, host);

  const api = host.__worldolRandomTargetPatch;
  assert.equal(api.status.cursorHooked, true, 'searchAICursor 必须也挂上');
  const cursor = proto.searchAICursor({position: 0}, 44);
  assert.ok(cursor >= 20 && cursor <= 24, '光标必须落在敌方存活位上，实际=' + cursor);
  // 没目标时给 0（原版「目标无效」约定）
  const empty = proto.searchAICursor({position: 0}, 44);
  assert.ok(Number.isInteger(empty));
  api.stop();
});

test('裸环境：随机目标补丁把作用范围中文名补进 skillAreaText', () => {
  const proto = makeBattleProto();
  const consts = {
    skillAreaText: new Array(39).fill('原版'),
    getSkillAreaString(area) {
      return area < 0 || area >= this.skillAreaText.length ? 'skillArea_' + area : this.skillAreaText[area];
    }
  };
  const req = {c: {4: consts, 251: {default: function Battle() {}}}};
  req.c[251].default.prototype = proto;
  const host = {};
  runBare(installRandomTarget, req, host);

  const api = host.__worldolRandomTargetPatch;
  assert.equal(api.status.labelHooked, true);
  assert.equal(consts.getSkillAreaString(44), '敌随机5个', '不能再到玩家面前显示 skillArea_44');
  assert.equal(consts.getSkillAreaString(40), '敌随机1个');
  assert.equal(consts.getSkillAreaString(50), '我随机1个');
  assert.equal(consts.getSkillAreaString(59), '我随机10个');
  assert.equal(consts.getSkillAreaString(19), '原版', '原版标签不能被破坏');
  api.stop();
});

test('裸环境：同一次施法多次取目标结果一致（伤害结算与播放控制要对得上）', () => {
  const proto = makeBattleProto();
  proto.round = 5;
  const req = {c: {251: {default: function Battle() {}}}};
  req.c[251].default.prototype = proto;
  const host = {};
  runBare(installRandomTarget, req, host);
  const api = host.__worldolRandomTargetPatch;

  const first = proto.getSelectArea(0, 0, 44);
  const again = proto.getSelectArea(0, 0, 44);
  assert.deepEqual(again, first, '同一回合同一技能必须打同一批人');
  assert.notEqual(again, first, '返回副本，调用方改数组不能污染缓存');

  proto.round = 6;
  const nextRound = proto.getSelectArea(0, 0, 44);
  assert.equal(nextRound.length, 5, '下一回合重新抽（数量仍然对）');
  api.stop();
});

// ── 自动技能概率 ─────────────────────────────────────────
test('裸环境：概率补丁兼容字符串百分比，同回合判定固定', () => {
  const proto = {
    round: 1,
    getAutoSkillIDByRound() { return 108; },
    doAutoSkill() {}
  };
  const req = {c: {251: {default: function Battle() {}}}};
  req.c[251].default.prototype = proto;
  const host = {worldolAutoSkillChance: {revision: 'x', chance: {108: '30'}}};
  runBare(installAutoSkillChance, req, host);

  const api = host.__worldolAutoSkillChancePatch;
  assert.ok(api);
  assert.equal(api.status.hooked, true);
  assert.equal(api.status.configLoaded, true);

  // 同一回合内反复问，结果必须一致（不能每次重掷）
  proto.round = 7;
  const first = proto.getAutoSkillIDByRound({position: 25});
  for (let i = 0; i < 20; i++) assert.equal(proto.getAutoSkillIDByRound({position: 25}), first, '同回合应固定');

  // 跨回合统计应接近 30%（字符串 "30" 也要生效）
  let passed = 0;
  const rounds = 3000;
  for (let i = 0; i < rounds; i++) {
    proto.round = i + 100;
    if (proto.getAutoSkillIDByRound({position: 25}) === 108) passed++;
  }
  const ratio = passed / rounds;
  assert.ok(ratio > 0.24 && ratio < 0.36, '30% 配置下命中率应约三成，实际=' + ratio.toFixed(3));
  api.stop();
});

// ── 阵位加成 ─────────────────────────────────────────────
test('裸环境：阵位补丁同时包 getPowerValue 与 getPowerValueCal，且调用后还原', () => {
  const alive = {0: {battleSprite: {}, vo: {getType: () => 3}}, 1: {battleSprite: {}, vo: {getType: () => 3}}};
  const battle = {getPlayerByPos(p) { return alive[p] || null; }};
  const roleProto = {
    getSkillPowerValue() { return 0; },
    getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) {
      let add = Number(base) || 0, pct = 0;
      if (this.formationSkill) {
        add += this.formationSkill.getPowerValue(addKey);
        pct += this.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100);
    },
    getPowerValueCal(base, t, list, _s, _l) {
      let add = Number(base) || 0, pct = 0;
      for (const item of list) {
        if (!this.formationSkill) continue;
        add += this.formationSkill.getPowerValue(item.powerID);
        pct += this.formationSkill.getPowerValue(item.powerPercentID);
      }
      return add + Math.trunc((add * pct) / 100);
    }
  };
  const petProto = {
    getPetBaseValue(base, addKey, pctKey) {
      let add = Number(base) || 0, pct = 0;
      if (this.ownerVo && this.ownerVo.formationSkill) {
        add += this.ownerVo.formationSkill.getPowerValue(addKey);
        pct += this.ownerVo.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100);
    },
    getPetPowerValue(base, addKey, pctKey) { return this.getPetBaseValue(base, addKey, pctKey); }
  };
  const req = id => (id === 54 ? {default: {ins: {battle}}} : undefined);
  req.c = {56: {default: function PlayerVO() {}}, 42: {default: function PetVO() {}}};
  req.c[56].default.prototype = roleProto;
  req.c[42].default.prototype = petProto;
  const host = {worldolFormationSlots: {forms: {7: {mode: 'add', slots: [{powers: [[28, 6]]}, {powers: [[31, 5]]}], pet: {powers: [[31, 8]]}}}}};
  runBare(installFormationSlots, req, host);

  const api = host.__worldolFormationSlotPatch;
  assert.ok(api);
  assert.equal(api.status.roleHooked, true);
  assert.equal(api.status.calHooked, true, '面板走 getPowerValueCal，必须也包上');
  assert.equal(api.status.petHooked, true);

  const realFs = {id: 7, getPowerValue: k => (k === 28 ? 22 : 0)};    // 原版统一 +22% 劈砍攻击
  const u1 = Object.create(roleProto);
  Object.assign(u1, {formationSkill: realFs, position: 0});
  // 第 1 位：add 模式 = 原版 22 + 阵位 6 = 28
  assert.equal(u1.getPowerValue(100, 0, 28, 27), 128, '(100+28)=128');
  assert.equal(u1.formationSkill, realFs, '调用后必须还原原对象');

  const u2 = Object.create(roleProto);
  Object.assign(u2, {formationSkill: realFs, position: 1});
  // 第 2 位配的是 31 → 28 键只剩原版 22
  assert.equal(u2.getPowerValue(100, 0, 28, 27), 122);

  // getPowerValueCal 也要吃阵位加成（28 → +28）
  assert.equal(u1.getPowerValueCal(100, 0, [{powerID: 28, powerPercentID: 27}], 0, 0), 128);
  api.stop();
});

test('裸环境：阵法说明末尾追加「阵位加成」一行（说明跟着配置变）', () => {
  const formationProto = {
    getFormationInfo(asArray) {
      const text = this.name + ':出手速度+22% 躲闪+18%';
      return asArray ? [text] : text;
    }
  };
  const powerMod = {getPowerDesc(id, value) { return '效果' + id + '+' + value; }};
  const req = id => (id === 54 ? {default: {ins: {battle: null}}} : undefined);
  req.c = {57: {default: function FormationSkill() {}}, 23: powerMod};
  req.c[57].default.prototype = formationProto;
  const host = {worldolFormationSlots: {forms: {7: {mode: 'add', slots: [{powers: [[23, 6]]}, {}], pet: {powers: [[31, 8]]}}}}};
  runBare(installFormationSlots, req, host);

  const api = host.__worldolFormationSlotPatch;
  assert.equal(api.status.infoHooked, true, 'getFormationInfo 必须挂上，否则说明永远不变');

  const inst = Object.create(formationProto);
  inst.id = 7;
  inst.name = '鸟翔阵';
  const text = inst.getFormationInfo();
  assert.match(text, /^鸟翔阵:出手速度\+22% 躲闪\+18%/);
  assert.match(text, /阵位加成：第1位 效果23\+6 · 宠物 效果31\+8/);

  const arr = inst.getFormationInfo(true);
  assert.ok(Array.isArray(arr), '取数组模式要保持数组');
  assert.equal(arr.length, 2);
  assert.match(arr[1], /阵位加成/);
  api.stop();
});

// ── 自检面板 ─────────────────────────────────────────────
test('裸环境：自检面板能画出来，且如实反映「未挂载」', () => {
  const created = [];
  const host = {
    worldolDiagnostics: {overlay: true, logToConsole: false},
    document: {
      body: {appendChild(el) { created.push(el); }},
      createElement() {
        return {id: '', style: {cssText: ''}, textContent: '', addEventListener(t, fn) { this.onclick = fn; }};
      }
    }
  };
  runBare(installDiagnostics, {c: {}}, host);
  const api = host.__worldolDiagnosticsPatch;
  assert.ok(api);
  assert.equal(api.mounted, true);
  assert.match(api.text, /概率\s+✗ 未挂载/);

  // 装上之后应变成「已挂 + 计数」
  host.__worldolAutoSkillChancePatch = {status: {hooked: true, configuredSkills: 1, rolls: 4, passed: 2, skipped: 2, configLoaded: true}};
  host.__worldolFormationSlots = {forms: {}};
  api.refresh();
  assert.match(api.text, /概率\s+✓ 已挂, 配置 1 项/);
  assert.match(api.text, /掷骰 4 \(中2\/跳2\)/);
  api.stop();
});
