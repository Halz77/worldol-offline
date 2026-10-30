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

// ── 真实包结构（webpack：req.c[id] = {i,l,exports}）──────────────
test('裸环境：能解出真实 webpack 模块记录里的导出（三个补丁都要挂上）', () => {
  const battleProto = makeBattleProto();
  // 同一个战斗类上还有自动技能的两个方法（概率补丁按这两个特征识别）
  battleProto.getAutoSkillIDByRound = function () { return 108; };
  battleProto.doAutoSkill = function () {};
  const consts = {
    skillAreaText: new Array(39).fill('原版'),
    getSkillAreaString(area) {
      return area < 0 || area >= this.skillAreaText.length ? 'skillArea_' + area : this.skillAreaText[area];
    }
  };
  const roleProto = {
    getSkillPowerValue() { return 0; },
    getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) { return Number(base) || 0; },
    getPowerValueCal(base) { return Number(base) || 0; }
  };
  const petProto = {getPetBaseValue() { return 0; }, getPetPowerValue() { return 0; }};
  const formationProto = {getFormationInfo() { return 'name:'; }};
  const powerMod = {getPowerDesc(id, value) { return '效果' + id + '+' + value; }};

  // ★ 真实形状：模块记录 {i, l, exports}，导出在 exports（类在 exports.default）
  const req = id => (id === 54 ? {default: {ins: {battle: null}}} : undefined);
  req.c = {
    0: {i: 0, l: true, exports: consts},
    4: {i: 4, l: true, exports: {default: function Battle() {}}},
    23: {i: 23, l: true, exports: powerMod},
    42: {i: 42, l: true, exports: {default: function PetVO() {}}},
    56: {i: 56, l: true, exports: {default: function PlayerVO() {}}},
    57: {i: 57, l: true, exports: {default: function FormationSkill() {}}}
  };
  req.c[4].exports.default.prototype = battleProto;
  req.c[42].exports.default.prototype = petProto;
  req.c[56].exports.default.prototype = roleProto;
  req.c[57].exports.default.prototype = formationProto;

  const host = {
    worldolAutoSkillChance: {chance: {108: 50}},
    worldolFormationSlots: {forms: {7: {mode: 'add', slots: [{powers: [[23, 6]]}]}}}
  };
  runBare(installRandomTarget, req, host);
  runBare(installAutoSkillChance, req, host);
  runBare(installFormationSlots, req, host);

  const random = host.__worldolRandomTargetPatch.status;
  assert.equal(random.hooked, true, '随机目标应挂上战斗类');
  assert.equal(random.cursorHooked, true);
  assert.equal(random.labelHooked, true, '作用范围标签应补上');
  assert.equal(consts.getSkillAreaString(44), '敌随机5个');

  const auto = host.__worldolAutoSkillChancePatch.status;
  assert.equal(auto.hooked, true, '概率补丁应挂上战斗类');
  assert.equal(auto.configLoaded, true);

  const fs = host.__worldolFormationSlotPatch.status;
  assert.equal(fs.roleHooked, true, '阵位应挂上角色类');
  assert.equal(fs.calHooked, true);
  assert.equal(fs.petHooked, true, '阵位应挂上宠物类');
  assert.equal(fs.infoHooked, true, '阵法说明应挂上');

  host.__worldolRandomTargetPatch.stop();
  host.__worldolAutoSkillChancePatch.stop();
  host.__worldolFormationSlotPatch.stop();
});

test('裸环境：模块之后才被 require 也能挂上（包模块工厂）', () => {
  const proto = makeBattleProto();
  const host = {};
  const req = {c: {}, m: []};
  req.m[251] = function (module, exports) {
    exports.default = function Battle() {};
    exports.default.prototype = proto;
  };
  runBare(installRandomTarget, req, host);
  assert.equal(host.__worldolRandomTargetPatch.status.hooked, false, '安装时还没加载 ⇒ 不能算挂上');

  // 模拟 webpack runtime：首次 require 时调用工厂
  const mod = {i: 251, l: false, exports: {}};
  req.m[251].call(mod.exports, mod, mod.exports, () => {});
  assert.equal(host.__worldolRandomTargetPatch.status.hooked, true, '工厂被包后应立刻挂上');
  assert.equal(proto.getSelectArea(0, 0, 44).length, 5);
  host.__worldolRandomTargetPatch.stop();
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
  assert.match(text, /阵位加成：\n第1位 效果23\+6  宠物 效果31\+8/, '阵位加成要逐行输出，不能横向出框');

  const arr = inst.getFormationInfo(true);
  assert.ok(Array.isArray(arr), '取数组模式要保持数组');
  assert.equal(arr.length, 2);
  assert.match(arr[1], /阵位加成/);
  api.stop();
});

test('裸环境：非战斗（无 battle）不加成；战斗里军团无 formationSkill 也按玩家阵型吃阵位加成 + 标注', () => {
  const roleProto = {
    getSkillPowerValue() { return 0; },
    getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) {
      let add = Number(base) || 0, pct = 0;
      if (this.formationSkill) {
        add += this.formationSkill.getPowerValue(addKey);
        pct += this.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100);
    }
  };
  // DATA_FORMATION 只挂在玩家身上（模块 5 的 myPlayer），军团/队友那边没有
  const playerFs = {id: 7, getPowerValue: k => (k === 25 ? 18 : 0)};
  // 战斗单例：我方（右侧）4 个军团在 22/24/26/28
  const battleUnits = new Map([
    [22, {vo: {position: 22, getType: () => 10}}],
    [24, {vo: {position: 24, getType: () => 10}}],
    [26, {vo: {position: 26, getType: () => 10}}],
    [28, {vo: {position: 28, getType: () => 10}}]
  ]);
  const battle = {getPlayerByPos(p) { return battleUnits.get(p) || null; }};
  const req = id => {
    if (id === 5) return {myPlayer: {vo: {formationSkill: playerFs}}};
    if (id === 54) return {default: {ins: {battle}}};
    return undefined;
  };
  req.c = {56: {default: function PlayerVO() {}}};
  req.c[56].default.prototype = roleProto;
  const host = {worldolFormationSlots: {forms: {7: {mode: 'add', slots: [{powers: [[55, 30]]}, {powers: [[55, 10]]}]}}}};
  runBare(installFormationSlots, req, host);
  const api = host.__worldolFormationSlotPatch;
  assert.equal(api.status.roleHooked, true);
  assert.equal(api.activeFormation(), 7, '要能从世界单例取到玩家当前阵型');

  // 战斗中：军团 22 = 第 1 位，加 power 55 固定 +30（add 模式 + 无原版阵）
  const legion = Object.create(roleProto);
  legion.position = 22;
  legion.getType = () => 10;
  assert.equal(legion.getPowerValue(100, 0, 55, 25), 130, '100 + 阵位固定 30 = 130（军团无原版阵，只叠阵位）');
  assert.equal(legion.formationSkill, undefined, '原来没有 formationSkill 就不能被留下');
  assert.equal(api.slotLabel(legion), '第1位', '战斗里军团标出第 1 位');

  // 非战斗（battle 为 null）⇒ 不加成、不标注。用**独立原型**（避免上一个 install 已把原型包装、闭包复用）
  const roleProto2 = {
    getSkillPowerValue() { return 0; },
    getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) {
      let add = Number(base) || 0, pct = 0;
      if (this.formationSkill) {
        add += this.formationSkill.getPowerValue(addKey);
        pct += this.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100);
    }
  };
  const reqNoBattle = id => {
    if (id === 5) return {myPlayer: {vo: {formationSkill: playerFs}}};
    if (id === 54) return {default: {ins: {battle: null}}};
    return undefined;
  };
  reqNoBattle.c = {56: {default: function PlayerVO() {}}};
  reqNoBattle.c[56].default.prototype = roleProto2;
  const host2 = {worldolFormationSlots: {forms: {7: {mode: 'add', slots: [{powers: [[55, 30]]}, {powers: [[55, 10]]}]}}}};
  runBare(installFormationSlots, reqNoBattle, host2);
  const api2 = host2.__worldolFormationSlotPatch;
  const panelVo = Object.create(roleProto2);
  panelVo.position = 22;
  panelVo.getType = () => 10;
  assert.equal(panelVo.getPowerValue(100, 0, 55, 25), 100, '非战斗（无 battle）不加成，返回原值');
  assert.equal(api2.slotLabel(panelVo), null, '非战斗不标注');
  api.stop();
  api2.stop();
});

test('裸环境：战斗中按站位标序号，没配加成的阵位不标', () => {
  const roleProto = {
    getSkillPowerValue() { return 0; },
    getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) {
      let add = Number(base) || 0, pct = 0;
      if (this.formationSkill) {
        add += this.formationSkill.getPowerValue(addKey);
        pct += this.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100);
    }
  };
  // 战斗单例：我方（右侧 20—33）有 4 个军团，position 在 vo 上（真实引擎结构）
  const units = new Map([
    [22, {vo: {position: 22, getType: () => 10}}],
    [24, {vo: {position: 24, getType: () => 10}}],
    [26, {vo: {position: 26, getType: () => 10}}],
    [28, {vo: {position: 28, getType: () => 10}}]
  ]);
  const battle = {getPlayerByPos(p) { return units.get(p) || null; }};
  const req = id => {
    if (id === 5) return {myPlayer: {vo: {formationSkill: {id: 7, getPowerValue: () => 0}}}};
    if (id === 54) return {default: {ins: {battle}}};
    return undefined;
  };
  req.c = {56: {default: function PlayerVO() {}}};
  req.c[56].default.prototype = roleProto;
  // 只给第 1 位和第 4 位配了加成
  const host = {worldolFormationSlots: {forms: {7: {mode: 'add', slots: [{powers: [[25, 30]]}, {}, {}, {powers: [[25, 30]]}]}}}};
  runBare(installFormationSlots, req, host);
  const api = host.__worldolFormationSlotPatch;

  // 面板里 e 是 VO（有 position、getLevel 等），slotLabel 直接收 VO
  const vo22 = Object.create(roleProto); vo22.position = 22; vo22.getType = () => 10;
  const vo24 = Object.create(roleProto); vo24.position = 24; vo24.getType = () => 10;
  const vo28 = Object.create(roleProto); vo28.position = 28; vo28.getType = () => 10;

  assert.equal(api.slotLabel(vo22), '第1位', '站位 22 = 第 1 位，配了加成');
  assert.equal(api.slotLabel(vo24), null, '站位 24 = 第 2 位，没配加成 ⇒ 不标');
  assert.equal(api.slotLabel(vo28), '第4位', '站位 28 = 第 4 位，配了加成');
  api.stop();
});

test('裸环境：宠物躲闪走 PlayerVO.getPowerValue 也吃宠物段加成 + 标注「宠物」', () => {
  // 宠物 VO 继承 PlayerVO：躲闪等非五维属性走 PlayerVO.get(DODGE) → getPowerValue，
  // 而不是 getPetBaseValue/getPetPowerValue。补丁要能识别 type=4 并走宠物段。
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
    getType() { return 4; }   // TYPE_PET
  };
  const petProto = {getPetBaseValue() { return 0; }, getPetPowerValue() { return 0; }, getType() { return 4; }};
  // 第 106 版起「在不在战斗里」要求该位置上真的站着单位 ⇒ 假战斗要把宠物摆进去
  const battleUnits = new Map();
  const battle = {getPlayerByPos(p) { return battleUnits.get(p) || null; }};
  const req = id => {
    if (id === 5) return {myPlayer: {vo: {formationSkill: {id: 7, getPowerValue: () => 0}}}};
    if (id === 54) return {default: {ins: {battle}}};
    return undefined;
  };
  req.c = {56: {default: function PlayerVO() {}}, 42: {default: function PetVO() {}}};
  req.c[56].default.prototype = roleProto;
  req.c[42].default.prototype = petProto;
  const host = {worldolFormationSlots: {forms: {7: {mode: 'replace', slots: [{powers: [[25, 30]]}], pet: {powers: [[25, 30]]}}}}};
  runBare(installFormationSlots, req, host);
  const api = host.__worldolFormationSlotPatch;

  const pet = Object.create(roleProto);
  pet.position = 24;
  pet.formationSkill = {id: 7, getPowerValue: k => (k === 25 ? 18 : 0)};  // 原版鸟翔 躲闪%18
  battleUnits.set(24, pet);
  assert.equal(pet.getPowerValue(60, 0, 55, 25, 0, 0, 0, false), 78, '宠物躲闪 replace = 60×1.3 = 78（走宠物段，不是角色第N位）');
  assert.equal(api.slotLabel(pet), '宠物', '宠物标注「宠物」');
  api.stop();
});

test('裸环境：宠物走真实 PetVO.get 路径（default 分支会覆盖 formationSkill）也吃宠物段加成', () => {
  // ★ 第 105 版修的就是这条：PetVO.get() 的 default 分支第一句是
  //   `this.formationSkill = this.ownerVo.formationSkill` —— 会把只注入在 this.formationSkill
  //   上的适配器当场覆盖掉（analysis/modules/0042.js:461）。玩家/军团没有这句所以一直是对的，
  //   宠物就成了「唯一不动的那个」。修法：在 get() 这一层注入，并连持有人的一起换。
  const origFs = {id: 7, getPowerValue: k => (k === 25 ? 18 : 0)};   // 原版鸟翔阵：躲闪%18
  // PlayerVO 原型：get(DODGE=42) = getPowerValue(base, this.dodge, 55, 25)
  const roleProto = {
    getSkillPowerValue() { return 0; },
    getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) {
      let add = Number(base) || 0, pct = 0;
      if (this.formationSkill) {
        add += this.formationSkill.getPowerValue(addKey);
        pct += this.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100) + (Number(t) || 0);
    },
    getType() { return 3; }
  };
  roleProto.get = function (t) {
    if (t !== 42) return 0;
    return this.getPowerValue(60, this.dodge || 0, 55, 25, 0, 0, 0, false);
  };
  // PetVO 原型：default 分支先把 formationSkill 从持有人那里「捞」过来，再走 PlayerVO.get
  const petProto = Object.create(roleProto);
  petProto.getPetBaseValue = function () { return 0; };
  petProto.getPetPowerValue = function () { return 0; };
  petProto.getType = function () { return 4; };                 // TYPE_PET
  petProto.get = function (t) {
    if (this.ownerVo) this.formationSkill = this.ownerVo.formationSkill;
    return roleProto.get.call(this, t);
  };

  const battleUnits = new Map();
  const battle = {getPlayerByPos(p) { return battleUnits.get(p) || null; }};
  const req = id => {
    if (id === 5) return {myPlayer: {vo: {formationSkill: origFs}}};
    if (id === 54) return {default: {ins: {battle}}};
    return undefined;
  };
  req.c = {56: {default: function PlayerVO() {}}, 42: {default: function PetVO() {}}};
  req.c[56].default.prototype = roleProto;
  req.c[42].default.prototype = petProto;
  const host = {worldolFormationSlots: {forms: {7: {mode: 'replace', slots: [{powers: [[25, 30]]}], pet: {powers: [[25, 30]]}}}}};
  runBare(installFormationSlots, req, host);
  const api = host.__worldolFormationSlotPatch;
  assert.equal(api.status.getHooked, true, 'get() 这一层必须挂上（宠物靠它）');

  const owner = {formationSkill: origFs, getType() { return 3; }};
  const pet = Object.create(petProto);
  pet.position = 24;
  pet.dodge = 0;
  pet.ownerVo = owner;
  battleUnits.set(24, pet);

  // 没装补丁（关掉注入）：原版鸟翔 躲闪%18 ⇒ 60×1.18 = 70
  api.setNoSlot(true);
  assert.equal(pet.get(42), 70, '关掉补丁时应回落到原版 18%（70）');
  api.setNoSlot(false);
  // 装上补丁：宠物段 躲闪%30 ⇒ 60×1.30 = 78
  assert.equal(pet.get(42), 78, '宠物应吃到宠物段 30%（78），而不是原版 18%');
  assert.ok(api.status.petCalls > 0, '应有宠物 get 调用被识别');
  // 注入不能把持有人的阵法永久改坏
  assert.equal(owner.formationSkill, origFs, '调用结束后持有人的 formationSkill 必须还原');
  api.stop();
});

test('裸环境：动态单位（get 现算）不会被误当成固化字段去改（第 105 版防回归）', () => {
  // PlayerVO 的 get(DODGE) 是 getPowerValue(base, this.dodge, …) 现算的，
  // this.dodge 只是「平加」，不是总值。对它做「固化字段修正」会把数值算错。
  const origFs = {id: 7, getPowerValue: k => (k === 25 ? 18 : 0)};
  const roleProto = {
    getSkillPowerValue() { return 0; },
    getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) {
      let add = Number(base) || 0, pct = 0;
      if (this.formationSkill) {
        add += this.formationSkill.getPowerValue(addKey);
        pct += this.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100) + (Number(t) || 0);
    },
    getType() { return 3; }
  };
  roleProto.get = function (t) {
    if (t !== 42) return 0;
    return this.getPowerValue(1000, this.dodge || 0, 55, 25, 0, 0, 0, false);
  };
  const battleUnits = new Map([
    [25, Object.assign(Object.create(roleProto), {position: 25, dodge: 500, formationSkill: origFs})]
  ]);
  const battle = {getPlayerByPos(p) { return battleUnits.get(p) || null; }};
  const req = id => {
    if (id === 5) return {myPlayer: {vo: {formationSkill: origFs}}};
    if (id === 54) return {default: {ins: {battle}}};
    return undefined;
  };
  req.c = {56: {default: function PlayerVO() {}}};
  req.c[56].default.prototype = roleProto;
  const host = {worldolFormationSlots: {forms: {7: {mode: 'replace', slots: [{powers: [[25, 30]]}], pet: {powers: [[25, 30]]}}}}};
  runBare(installFormationSlots, req, host);
  const api = host.__worldolFormationSlotPatch;
  const u = battleUnits.get(25);
  api.ensureHook(u);
  assert.equal(u.dodge, 500, '动态单位的 dodge 平加字段不能被改写（否则百分比部分会被算错）');
  // 正确结果应当来自 get() 层的注入：1000×1.3 + 500 = 1800
  assert.equal(u.get(42), 1800, '躲闪 = 1000×1.30 + 500 = 1800');
  api.stop();
});

test('裸环境：战斗外（没有战斗单例 / 该位置没人）一律不加成，宠物也一样（第 106 版防回归）', () => {
  // 玩家实测踩的坑：角色战斗外是对的（2327），宠物战斗外却还挂着一个"战斗中的数"。
  // 根因是宠物段有两条注入路径都只看了「有没有战斗单例」/干脆没看（wrapPetMethod 硬编码 slotIndex=1）。
  // 现在统一用 inBattleFor：战斗单例存在**且**该位置上真的站着单位。
  const origFs = {id: 7, getPowerValue: k => (k === 25 ? 18 : 0)};
  const roleProto = {
    getSkillPowerValue() { return 0; },
    getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) {
      let add = Number(base) || 0, pct = 0;
      if (this.formationSkill) {
        add += this.formationSkill.getPowerValue(addKey);
        pct += this.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100) + (Number(t) || 0);
    },
    getType() { return 3; }
  };
  roleProto.get = function (t) {
    if (t !== 42) return 0;
    return this.getPowerValue(60, this.dodge || 0, 55, 25, 0, 0, 0, false);
  };
  const petProto = Object.create(roleProto);
  petProto.getPetBaseValue = function () { return 0; };
  petProto.getPetPowerValue = function () { return 0; };
  petProto.getType = function () { return 4; };
  petProto.get = function (t) {
    if (this.ownerVo) this.formationSkill = this.ownerVo.formationSkill;
    return roleProto.get.call(this, t);
  };

  // 场景一：完全没有战斗单例（角色/宠物面板）
  let battle = null;
  const req = id => {
    if (id === 5) return {myPlayer: {vo: {formationSkill: origFs}}};
    if (id === 54) return {default: {ins: {battle}}};
    return undefined;
  };
  req.c = {56: {default: function PlayerVO() {}}, 42: {default: function PetVO() {}}};
  req.c[56].default.prototype = roleProto;
  req.c[42].default.prototype = petProto;
  const host = {worldolFormationSlots: {forms: {7: {mode: 'replace', slots: [{powers: [[25, 30]]}], pet: {powers: [[25, 30]]}}}}};
  runBare(installFormationSlots, req, host);
  const api = host.__worldolFormationSlotPatch;

  const owner = {formationSkill: origFs, getType() { return 3; }};
  const pet = Object.create(petProto);
  pet.position = 24;      // 上一次战斗留下的站位，战斗外不会清
  pet.dodge = 0;
  pet.ownerVo = owner;
  assert.equal(pet.get(42), 70, '战斗外宠物必须是原版 18%（70），不能是阵位 30%（78）');

  // 场景二：战斗单例还在（退出战斗但没清干净），但这个位置上没有单位
  battle = {getPlayerByPos() { return null; }};
  assert.equal(pet.get(42), 70, '战斗单例残留但位置上没人 ⇒ 仍然算战斗外，不加成');

  // 场景三：真的打起来了，宠物在 24 号位
  battle = {getPlayerByPos(p) { return p === 24 ? pet : null; }};
  assert.equal(pet.get(42), 78, '进了战斗就该吃宠物段 30%（78）');
  api.stop();
});

test('裸环境：玩家没启用任何阵法时，军团/宠物不得吃阵位加成（不能因为「只配了一个阵」就硬套）', () => {
  // 玩家实测：战斗外根本没勾选鸟翔阵，军团和宠物照样吃到加成。
  // 根因是 activeFormationId() 的兜底「配置里只有一个阵 ⇒ 就用它」，
  // 把配置里的阵硬套给了所有没有 formationSkill 的单位（军团/克隆宠物本来就没有）。
  const roleProto = {
    getSkillPowerValue() { return 0; },
    // ⚠ 必须是 8 个形参：isRoleProto 用 getPowerValue.length>=8 识别 PlayerVO，少一个就挂不上
    getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) {
      let add = Number(base) || 0, pct = 0;
      if (this.formationSkill) {
        add += this.formationSkill.getPowerValue(addKey);
        pct += this.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100) + (Number(t) || 0);
    }
  };
  roleProto.get = function (t) { return t === 42 ? this.getPowerValue(60, 0, 55, 25) : 0; };

  const me = {position: 25, getType: () => 3, formationSkill: null};   // 玩家：没启用阵法
  const legion = {position: 27, getType: () => 10};             // 军团：本来就没有 formationSkill
  const units = new Map([[25, me], [27, legion]]);
  const battle = {getPlayerByPos(p) { return units.get(p) || null; }};
  const req = id => {
    if (id === 5) return {myPlayer: me};                        // 世界单例里也没有 formationSkill
    if (id === 54) return {default: {ins: {battle}}};
    return undefined;
  };
  req.c = {56: {default: function PlayerVO() {}}};
  req.c[56].default.prototype = roleProto;
  // 配置里只有 7 这一个阵（旧代码会在这里兜底成「就用 7」）
  // 配两个阵位：军团在 27 号位排第 2（只配第 1 位的话第 2 位是空配置 ⇒ 加成为 0）
  const host = {worldolFormationSlots: {forms: {7: {mode: 'replace', slots: [{powers: [[25, 30]]}, {powers: [[25, 30]]}], pet: {powers: [[25, 30]]}}}}};
  runBare(installFormationSlots, req, host);
  const api = host.__worldolFormationSlotPatch;

  Object.setPrototypeOf(legion, roleProto);
  Object.setPrototypeOf(me, roleProto);
  me.position = 25;
  assert.equal(legion.get(42), 60, '没启用阵法 ⇒ 军团必须是原值 60，不能是 60×1.3=78');
  assert.equal(api.activeFormation(), null, '没启用阵 ⇒ activeFormation 必须返回 null');

  // 玩家真的启用了鸟翔阵之后，军团才该按玩家当前阵吃阵位加成
  me.formationSkill = {id: 7, getPowerValue: () => 0};
  assert.equal(api.activeFormation(), 7, '启用后 activeFormation 应为 7');
  assert.equal(legion.get(42), 78, '启用鸟翔阵 ⇒ 军团按第 2 位吃 30%（78）');
  api.stop();
});

test('裸环境：总开关 enabled:false 时整个补丁退化成原生行为', () => {
  const origFs = {id: 7, getPowerValue: k => (k === 25 ? 18 : 0)};
  const roleProto = {
    getSkillPowerValue() { return 0; },
    getPowerValue(base, t, addKey, pctKey) {
      let add = Number(base) || 0, pct = 0;
      if (this.formationSkill) {
        add += this.formationSkill.getPowerValue(addKey);
        pct += this.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100) + (Number(t) || 0);
    },
    getType() { return 3; }
  };
  roleProto.get = function (t) { return t === 42 ? this.getPowerValue(60, 0, 55, 25) : 0; };
  const unit = Object.assign(Object.create(roleProto), {position: 25, formationSkill: origFs});
  const battle = {getPlayerByPos(p) { return p === 25 ? unit : null; }};
  const req = id => {
    if (id === 5) return {myPlayer: {vo: {formationSkill: origFs}}};
    if (id === 54) return {default: {ins: {battle}}};
    return undefined;
  };
  req.c = {56: {default: function PlayerVO() {}}};
  req.c[56].default.prototype = roleProto;
  const host = {worldolFormationSlots: {enabled: false, forms: {7: {mode: 'replace', slots: [{powers: [[25, 30]]}]}}}};
  runBare(installFormationSlots, req, host);
  const api = host.__worldolFormationSlotPatch;
  assert.equal(unit.get(42), 70, '总开关关掉 ⇒ 原版 18%（70）');
  assert.equal(api.peek(7, 1, false), null, '总开关关掉 ⇒ peek 也拿不到配置');
  assert.equal(api.status.disabled, true, 'status 要如实标出已被总开关关掉');
  api.stop();
});

test('裸环境：战斗单位的固化属性字段（this.dodge 等）被阵位加成直接修正', () => {
  // 战斗单位的 get(DODGE) 是 `return this.dodge`（战斗开始时固化），动态注入进不去，
  // 必须直接改字段。战斗单位没有 addValue，所以直接赋值。
  const roleProto = {
    getSkillPowerValue() { return 0; },
    getPowerValue(base, t, addKey, pctKey, _r, _s, _l, _u) {
      let add = Number(base) || 0, pct = 0;
      if (this.formationSkill) {
        add += this.formationSkill.getPowerValue(addKey);
        pct += this.formationSkill.getPowerValue(pctKey);
      }
      return add + Math.trunc((add * pct) / 100);
    }
  };
  const origFs = {id: 7, getPowerValue: k => (k === 25 ? 18 : 0)};   // 原版鸟翔阵：躲闪%18
  const battleUnits = new Map([
    [25, {position: 25, getType: () => 3, dodge: 2512, speed: 75616, atk_str: 13013, formationSkill: origFs}]
  ]);
  const battle = {getPlayerByPos(p) { return battleUnits.get(p) || null; }};
  const req = id => {
    if (id === 5) return {myPlayer: {vo: {formationSkill: origFs}}};
    if (id === 54) return {default: {ins: {battle}}};
    return undefined;
  };
  req.c = {56: {default: function PlayerVO() {}}};
  req.c[56].default.prototype = roleProto;
  // replace 模式：第 1 位 躲闪%30（原版鸟翔阵是 躲闪%18）
  const host = {worldolFormationSlots: {forms: {7: {mode: 'replace', slots: [{powers: [[25, 30]]}]}}}};
  runBare(installFormationSlots, req, host);
  const api = host.__worldolFormationSlotPatch;

  const u = battleUnits.get(25);
  // 固化原值 2512（含原版鸟翔阵 躲闪%18）⇒ replace 后：2512/1.18 × 1.30
  const expected = Math.trunc((2512 / 1.18) * 1.3);
  api.ensureHook(u);
  assert.equal(u.dodge, expected, '躲闪固化字段应被改成 replace 后的值（2512 → ' + expected + '）');
  assert.ok(u.dodge > 2512, '躲闪应变大（2512 → ' + u.dodge + '）');
  // 幂等：再调一次不应重复叠加（每次都从原始固化值重算）
  api.ensureHook(u);
  assert.equal(u.dodge, expected, '重复施加不应叠加');
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
