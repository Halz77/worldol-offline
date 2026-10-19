/**
 * 世界OL · 战斗属性查询缓存（原版单机）v1.0.0
 *
 * 背景（2026-09-30 用户需求）：释放全体攻击技能（神话武器技能等）时画面明显停顿。
 * CDP Profiler 实测（PC，云若寺 125 级怪群 12 目标 / 46 段）：
 *   doUseSkill 约 460~520ms，其中
 *     getSkillPowerValue 23.5% + getPower 19.6% + getBagEquipPowerValue 15.6% = 58.6%
 *   一次技能内三个函数合计被调用 3.2 万次，但只有 40 个不同的参数组合
 *   —— 99.9% 是同一 (单位, 属性) 的纯重复计算。
 *
 * 做法（零风险）：只加「演算窗口内」的缓存，不改任何公式、不调换调用顺序。
 *   ① 在战斗演算 calDamage（0251）入口开窗、出口关窗（try/finally，含嵌套计数）；
 *   ② 开窗时版本号 +1，缓存按 (对象, 版本号) 隔离 —— 窗口一关，全部缓存立即失效；
 *   ③ 窗口外（背包 UI、属性面板等）一律走原函数，绝不使用缓存；
 *   ④ 只缓存「窗口内返回值恒定」的纯查询：含 buffer / 当前 HP 的调用一律不缓存。
 *
 * 安全性依据：实测同一 (单位, 属性) 在一次演算窗口内返回值 100% 恒定
 *   （getSkillPowerValue / getPower / getBagEquipPowerValue 全部 allConstant）。
 * 额外自检：window.__wolAttrVerify = true 时每次命中都回算原函数并比对，
 *   不一致计入 status().mismatch（应为 0）。
 *
 * 关闭：localStorage['wolAttrCache']='0' 后刷新（默认开启）。
 */
(function () {
  'use strict';

  var VERSION = '1.0.0';
  var ENABLED = true;
  try { ENABLED = localStorage.getItem('wolAttrCache') !== '0'; } catch (e) {}
  // 影子校验开关（热路径只读这个局部变量；window.__wolAttrVerify 由轮询同步进来）
  var VERIFY = false;

  // 演算窗口：DEPTH>0 时才启用缓存；EPOCH 每次开窗 +1
  var EPOCH = 0, DEPTH = 0;

  // 诊断计数
  var stats = {
    windows: 0,
    spv: 0, spvHit: 0,
    pg: 0, pgHit: 0,
    bep: 0, bepHit: 0,
    pet: 0, petHit: 0,
    ipv: 0, ipvHit: 0,
    mismatch: 0,
    installed: { player: 0, item: 0, battle: 0 },
  };
  function verifyOn() { return VERIFY; }

  // 缓存域（同一对象上多个函数共用一张 Map，用高位区分）
  var DOM_POWER = 0 << 26, DOM_SPV = 1 << 26, DOM_BEP = 2 << 26, DOM_PET = 3 << 26, DOM_IPV = 4 << 26;

  function cacheOf(obj) {
    var c = obj.__wolAttrCache;
    if (c === undefined) {
      c = { e: EPOCH, m: new Map() };
      try {
        Object.defineProperty(obj, '__wolAttrCache', { value: c, writable: true, configurable: true, enumerable: false });
      } catch (e) { try { obj.__wolAttrCache = c; } catch (e2) {} }
      return c.m;
    }
    if (c.e !== EPOCH) { c.e = EPOCH; c.m.clear(); }
    return c.m;
  }

  // —— Player 类：getSkillPowerValue / getPower / getBagEquipPowerValue ——
  function wrapPlayer(proto) {
    if (!proto || proto.__wolAttrPlayer) return false;
    if (typeof proto.getSkillPowerValue !== 'function') return false;
    if (typeof proto.getBagEquipPowerValue !== 'function') return false;
    if (typeof proto.getPower !== 'function') return false;
    proto.__wolAttrPlayer = 1;

    var oSPV = proto.getSkillPowerValue, oPG = proto.getPower, oBEP = proto.getBagEquipPowerValue;

    // 技能被动 + 神格加成（图鉴加成第 80 版起已整块删除）：只依赖单位自身静态数据，窗口内恒定
    proto.getSkillPowerValue = function (type, power) {
      if (!ENABLED || DEPTH <= 0 || !(power > 0)) return oSPV.call(this, type, power);
      var m = cacheOf(this), k = DOM_SPV + type * 4096 + power;
      stats.spv++;
      var v = m.get(k);
      if (v !== undefined) {
        stats.spvHit++;
        if (verifyOn()) { var t = oSPV.call(this, type, power); if (t !== v) stats.mismatch++; }
        return v;
      }
      v = oSPV.call(this, type, power);
      m.set(k, v);
      return v;
    };

    // 神格加成（图鉴加成第 80 版起已删除）
    proto.getPower = function (power) {
      if (!ENABLED || DEPTH <= 0 || !(power > 0)) return oPG.call(this, power);
      var m = cacheOf(this), k = DOM_POWER + power;
      stats.pg++;
      var v = m.get(k);
      if (v !== undefined) {
        stats.pgHit++;
        if (verifyOn()) { var t = oPG.call(this, power); if (t !== v) stats.mismatch++; }
        return v;
      }
      v = oPG.call(this, power);
      m.set(k, v);
      return v;
    };

    // 背包装备 + 套装加成；第二参为真时含 buffer 值 → 不缓存
    proto.getBagEquipPowerValue = function (power, useBuffer) {
      if (!ENABLED || DEPTH <= 0 || !(power > 0) || useBuffer) return oBEP.call(this, power, useBuffer);
      var m = cacheOf(this), k = DOM_BEP + power;
      stats.bep++;
      var v = m.get(k);
      if (v !== undefined) {
        stats.bepHit++;
        if (verifyOn()) { var t = oBEP.call(this, power, useBuffer); if (t !== v) stats.mismatch++; }
        return v;
      }
      v = oBEP.call(this, power, useBuffer);
      m.set(k, v);
      return v;
    };

    stats.installed.player++;
    try { console.log('[worldol-battle-attr-cache] Player 属性缓存已安装'); } catch (e) {}
    return true;
  }

  // —— Item 类：getIsItemPetEquip / getPowerValue（getBagEquipPowerValue 的叶子） ——
  function wrapItem(proto) {
    if (!proto || proto.__wolAttrItem) return false;
    if (typeof proto.getIsItemPetEquip !== 'function') return false;
    if (typeof proto.getPowerValue !== 'function') return false;
    proto.__wolAttrItem = 1;

    var oPET = proto.getIsItemPetEquip, oIPV = proto.getPowerValue;

    proto.getIsItemPetEquip = function () {
      if (!ENABLED || DEPTH <= 0) return oPET.call(this);
      var m = cacheOf(this), k = DOM_PET;
      stats.pet++;
      var v = m.get(k);
      if (v !== undefined) { stats.petHit++; return v; }
      v = oPET.call(this);
      m.set(k, v);
      return v;
    };

    proto.getPowerValue = function (power) {
      if (!ENABLED || DEPTH <= 0 || !(power > 0)) return oIPV.apply(this, arguments);
      var m = cacheOf(this), k = DOM_IPV + power;
      stats.ipv++;
      var v = m.get(k);
      if (v !== undefined) {
        stats.ipvHit++;
        if (verifyOn()) { var t = oIPV.apply(this, arguments); if (t !== v) stats.mismatch++; }
        return v;
      }
      v = oIPV.apply(this, arguments);
      m.set(k, v);
      return v;
    };

    stats.installed.item++;
    try { console.log('[worldol-battle-attr-cache] Item 属性缓存已安装'); } catch (e) {}
    return true;
  }

  // —— 战斗演算（0251）：calDamage 开窗/关窗 ——
  function wrapBattle(proto) {
    if (!proto || proto.__wolAttrBattle) return false;
    if (typeof proto.calDamage !== 'function' || typeof proto.doUseSkill !== 'function') return false;
    proto.__wolAttrBattle = 1;
    var orig = proto.calDamage;
    proto.calDamage = function () {
      if (!ENABLED) return orig.apply(this, arguments);
      if (DEPTH === 0) { EPOCH++; stats.windows++; }
      DEPTH++;
      try {
        return orig.apply(this, arguments);
      } finally {
        DEPTH--;
      }
    };
    stats.installed.battle++;
    try { console.log('[worldol-battle-attr-cache] 演算开窗已安装'); } catch (e) {}
    return true;
  }

  function wrapExports(ex) {
    try {
      var e = ex && (ex['default'] || ex);
      if (!e || !e.prototype) return;
      wrapPlayer(e.prototype);
      wrapItem(e.prototype);
      wrapBattle(e.prototype);
    } catch (err) {}
  }

  function tryInstall() {
    var req = window.__worldReq;
    if (!req || !req.c) return installedAll();
    for (var id in req.c) {
      try { wrapExports(req.c[id] && req.c[id].exports); } catch (e) {}
    }
    return installedAll();
  }
  function installedAll() {
    return stats.installed.player > 0 && stats.installed.item > 0 && stats.installed.battle > 0;
  }

  function status() {
    var inst = installedAll();
    return {
      version: VERSION,
      enabled: ENABLED,
      installed: inst,
      detail: stats.installed,
      epoch: EPOCH,
      stats: {
        windows: stats.windows,
        spv: stats.spv, spvHit: stats.spvHit, spvRate: stats.spv ? +(stats.spvHit / stats.spv).toFixed(4) : 0,
        power: stats.pg, powerHit: stats.pgHit, powerRate: stats.pg ? +(stats.pgHit / stats.pg).toFixed(4) : 0,
        bagEquip: stats.bep, bagEquipHit: stats.bepHit, bagEquipRate: stats.bep ? +(stats.bepHit / stats.bep).toFixed(4) : 0,
        itemPetEquip: stats.pet, itemPetEquipHit: stats.petHit,
        itemPowerValue: stats.ipv, itemPowerValueHit: stats.ipvHit,
        mismatch: stats.mismatch,
      },
    };
  }
  function resetStats() {
    for (var k in stats) if (typeof stats[k] === 'number') stats[k] = 0;
    stats.installed = { player: stats.installed.player, item: stats.installed.item, battle: stats.installed.battle };
  }

  window.__worldolAttrCache = {
    version: VERSION, status: status, install: tryInstall, resetStats: resetStats,
    setVerify: function (v) { VERIFY = v === true; window.__wolAttrVerify = VERIFY; },
  };

  var poll = setInterval(function () {
    try {
      tryInstall();
      VERIFY = window.__wolAttrVerify === true;   // 热路径只读局部变量，这里低频同步
    } catch (e) {}
  }, 800);
  try { tryInstall(); VERIFY = window.__wolAttrVerify === true; } catch (e) {}
})();
