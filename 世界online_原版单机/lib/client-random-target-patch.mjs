/**
 * 客户端补丁：技能随机目标（第 93 版，2026-10-25；第 97 版修正）。
 *
 * 需求：技能的作用范围可以设成「敌方随机 N 个」「我方随机 N 个」，N 自己填。
 *
 * 为什么用 area 号段编码而不是另开配置文件：
 *   1. `area` 本来就是技能 wire 字段里的一项，覆盖层 OVERRIDABLE_FIELDS 允许改，
 *      技能编辑器改一个下拉就落到技能定义上 —— 不需要额外的下发链路；
 *   2. 目标是「数量可调」，一个字节足够：area 值直接编码数量，编辑器把它换算成
 *      中文选项（敌随机 1—10 / 我随机 1—10），玩家看到的仍是「作用范围」一项。
 *
 * 号段约定（原版 0—38 已占用，见 skillAreaText 表）：
 *   40—49 = 敌方随机 N（N = area - 39，即 40=随机1个 … 49=随机10个）
 *   50—59 = 我方随机 N（N = area - 49）
 *   39 留空作为缓冲，60+ 未使用。
 *
 * ⚠ 第 97 版修的两个线上问题（都是「补丁塞进客户端后」才会暴露的）：
 *   1. **不能引用模块作用域的任何东西**。install 函数会被 toString() 塞进客户端主包执行，
 *      那边的 window 上不存在 decodeRandomArea / RANDOM_TARGET_MIN 这些标识符 ⇒
 *      每次 getSelectArea 都抛 ReferenceError，导致**所有技能都放不出来**。
 *      现在全部常量和辅助函数都写在 install 内部（自包含），并加了单测钉住。
 *   2. **自动施放不走 getSelectArea 选光标**，走 Battle.prototype.searchAICursor(单位, area)。
 *      只包 getSelectArea 时，area 40—59 在 searchAICursor 里算不出光标 ⇒
 *      doAutoSkill 拿到的目标位置无效 ⇒ 该技能「每到它的回合都不放」。现在一并包上。
 *
 * 另外补了 **作用范围中文标签**：客户端 skillAreaText 只有 0—38，40—59 会直接显示
 * 成 `skillArea_44`（玩家看到的就是「乱码」）。这里把 40—59 的中文名补进表里。
 */
export const randomTargetRevision = 'random-target-patch-20261025-v4';

/** area 号段：40—49 敌随机、50—59 我随机。 */
export const RANDOM_TARGET_MIN = 40;
export const RANDOM_TARGET_MAX = 59;
export const AREA_ENEMY_ALL = 19;
export const AREA_ME_ALL = 29;

/** 把 area 解析成 {side:'enemy'|'me', count}；不是随机段返回 null。纯函数，单测直接用。 */
export function decodeRandomArea(area) {
  if (!Number.isInteger(area)) return null;
  if (area < RANDOM_TARGET_MIN || area > RANDOM_TARGET_MAX) return null;
  const enemy = area < 50;
  return { side: enemy ? 'enemy' : 'me', count: enemy ? area - 39 : area - 49 };
}

/** 40—59 的中文名（和技能编辑器的下拉一致）。 */
export function randomAreaLabel(area) {
  const spec = decodeRandomArea(area);
  if (!spec) return null;
  return (spec.side === 'enemy' ? '敌随机' : '我随机') + spec.count + '个';
}

/**
 * 安装随机目标层。req = window.__worldReq，host = window。
 *
 * ★ 本函数体会被 toString() 原样塞进客户端主包执行 ⇒ **必须完全自包含**：
 *   ​不能引用本文件里其它的常量 / 函数（客户端里不存在），否则运行时 ReferenceError。
 */
export function installRandomTarget(req, host) {
  host = host || globalThis;
  if (host.__worldolRandomTargetPatch) return host.__worldolRandomTargetPatch;

  const AREA_MIN = 40, AREA_MAX = 59, ENEMY_ALL = 19, ME_ALL = 29, LEFT_MAX_POS = 20;
  const counters = { randomCalls: 0, returned: 0, empty: 0, passthrough: 0, cursorCalls: 0, labelHooked: false };
  const state = { hooked: false, cursorHooked: false, native: null };
  let timer = null;

  function decodeArea(area) {
    if (!Number.isInteger(area)) return null;
    if (area < AREA_MIN || area > AREA_MAX) return null;
    var enemy = area < 50;
    return { side: enemy ? 'enemy' : 'me', count: enemy ? area - 39 : area - 49 };
  }

  function areaLabel(area) {
    var spec = decodeArea(area);
    if (!spec) return null;
    return (spec.side === 'enemy' ? '敌随机' : '我随机') + spec.count + '个';
  }

  // ── 模块导出解析（webpack：req.c[id] = {i,l,exports}） ────────────────
  // 第 98 版修正：之前直接读 mod / mod.default，而这层是模块记录、导出在 .exports ⇒ 永远匹配不到。
  function exportCandidates(mod) {
    var out = [];
    if (!mod) return out;
    var ex = mod.exports || mod;
    if (ex) { out.push(ex); if (ex.default) out.push(ex.default); }
    if (mod !== ex) out.push(mod);
    return out;
  }

  // ── 作用范围中文标签（skillAreaText 只有 0—38） ───────────────────
  function hookAreaLabelsOn(holder) {
    if (!holder || !Array.isArray(holder.skillAreaText)) return false;
    var arr = holder.skillAreaText;
    for (var area = AREA_MIN; area <= AREA_MAX; area++) arr[area] = areaLabel(area) || '';
    if (!arr[39]) arr[39] = '—';
    // getSkillAreaString 用 `t >= skillAreaText.length` 判越界，写 59 后 length=60，
    // 40—59 就能正常工作；再加一层兜底：表被换来换去时也不至于退回 skillArea_xx。
    if (typeof holder.getSkillAreaString === 'function' && !holder.__worldolAreaLabel) {
      var nativeString = holder.getSkillAreaString;
      holder.getSkillAreaString = function (value) {
        var text = nativeString.apply(this, arguments);
        if (typeof text === 'string' && text.indexOf('skillArea_') === 0) {
          var label = areaLabel(value);
          if (label) return label;
        }
        return text;
      };
      holder.__worldolAreaLabel = true;
    }
    counters.labelHooked = true;
    return true;
  }

  /** 尝试把一个模块的导出挂上（标签表 + 战斗类）。 */
  function tryModule(mod) {
    var list = exportCandidates(mod);
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c) continue;
      if (hookAreaLabelsOn(c)) break;
    }
    for (var j = 0; j < list.length; j++) {
      var d = list[j];
      if (!d) continue;
      var proto = d.prototype || (typeof d === 'object' ? d : null);
      if (proto && typeof proto.getSelectArea === 'function' && typeof proto.getPlayerByPos === 'function') return hookBattle(proto);
    }
    return false;
  }

  function scanCache() {
    var cache;
    try { cache = req.c; } catch (_) { return false; }
    if (!cache) return false;
    for (var key in cache) {
      var mod;
      try { mod = cache[key]; } catch (_) { continue; }
      tryModule(mod);
    }
    return state.hooked;
  }

  /** 给还没 require 的模块包一层：实例化完立刻检查导出。 */
  function hookFactories() {
    var factories;
    try { factories = req.m; } catch (_) { return; }
    if (!factories) return;
    for (var id in factories) {
      var fn = factories[id];
      if (typeof fn !== 'function' || fn.__worldolRandomHook) continue;
      factories[id] = (function (orig) {
        return function (module, exports, require) {
          var out = orig.apply(this, arguments);
          try { tryModule(module); } catch (_) {}
          return out;
        };
      })(fn);
      factories[id].__worldolRandomHook = true;
    }
  }

  /**
   * 算候选池并按原版语义过滤出存活单位。
   *
   * ⚠ 第 99 版修正：**不能要求 `unit.battleSprite` 存在**。施法规划/AI 选目标时战斗动画还没建，
   * 单位上根本没有 battleSprite，于是池子被过滤成空 ⇒ getSelectArea 返回 null ⇒ 技能放不出来
   * （上机就是这样：随机 调用 2 / 回 0 / 空 2）。原版 `countNotNullPlayerPos` 也只判
   * `isValidBattlePlayer`（null / 已死 / 逃跑），不判图标。
   */
  function pickPool(battle, pos, side) {
    if (!battle) return null;
    if (typeof pos !== 'number' || pos < 0 || pos >= 34) return null;
    var probe = side === 'enemy' ? (pos < LEFT_MAX_POS ? LEFT_MAX_POS : 0) : pos;
    var pool = null;
    try {
      if (state.native) pool = state.native.call(battle, pos, probe, side === 'enemy' ? ENEMY_ALL : ME_ALL);
    } catch (_) { pool = null; }
    if (!pool || !pool.length) {
      // 原生拿不到（rowLeft/rowRight 未初始化等）⇒ 退回自己枚举全部位置，敌我靠 isSameSide 判
      pool = [];
      for (var i = 0; i < 34; i++) pool.push(i);
    }
    var alive = [];
    for (var k = 0; k < pool.length; k++) {
      var p = pool[k], u = null;
      try { u = battle.getPlayerByPos(p); } catch (_) { u = null; }
      if (!u) continue;                                          // 空位
      var same;
      try {
        same = typeof battle.isSameSide === 'function'
          ? !!battle.isSameSide(pos, p)
          : ((p < LEFT_MAX_POS) === (pos < LEFT_MAX_POS));
      } catch (_) { continue; }
      if (side === 'enemy' ? same : !same) continue;              // 只要对面 / 只要自己这边
      try {
        if (typeof battle.isValidBattlePlayer === 'function' && !battle.isValidBattlePlayer(u)) continue;  // 已阵亡/逃跑
        else if (typeof u.isDeadNoWithDelay === 'function' && u.isDeadNoWithDelay()) continue;
      } catch (_) { continue; }
      alive.push(p);
    }
    return alive.length ? alive : null;
  }

  function shufflePick(list, count) {
    var alive = list.slice();
    for (var i = alive.length - 1; i > 0; i--) {
      var j = (Math.random() * (i + 1)) | 0;
      var t = alive[i]; alive[i] = alive[j]; alive[j] = t;
    }
    return alive.slice(0, Math.min(count, alive.length));
  }

  /** 同一次施法里 getSelectArea 会被调用多次（伤害结算一次、播放控制一次）——
   *  随机结果必须稳定，否则会出现「动画打这 5 个、实际掉血的是另 5 个」。 */
  var memoKey = null;
  var memoPick = null;

  function pickFor(round, actorPos, area, compute) {
    var key = (typeof round === 'number' ? round : '-') + ':' + actorPos + ':' + area;
    if (memoKey === key && memoPick) return memoPick.slice();
    var picked = compute();
    if (picked && picked.length) { memoKey = key; memoPick = picked; }
    return picked;
  }

  /** 给战斗类挂上随机目标（getSelectArea + searchAICursor）。 */
  function hookBattle(proto) {
    if (!proto) return false;
    if (Object.prototype.hasOwnProperty.call(proto, '__worldolRandomTarget')) { state.hooked = true; return true; }

    state.native = proto.getSelectArea;                         // ★ 先留原生的，池子要用
    proto.getSelectArea = function (actorPos, targetPos, area) {
      var spec = decodeArea(area);
      if (!spec) { counters.passthrough++; return state.native.apply(this, arguments); }
      counters.randomCalls++;
      var battle = this;
      return pickFor(this && this.round, actorPos, area, function () {
        var pool = pickPool(battle, actorPos, spec.side);
        if (!pool) { counters.empty++; return null; }
        counters.returned++;
        return shufflePick(pool, spec.count);                   // 不足 N 个时返回实际数量
      });
    };
    proto.__worldolRandomTarget = true;
    state.hooked = true;

    // ── 自动施放 / AI 选光标（doAutoSkill 走这里，不是 getSelectArea） ──
    if (typeof proto.searchAICursor === 'function' && !proto.__worldolRandomCursor) {
      var nativeCursor = proto.searchAICursor;
      proto.searchAICursor = function (unit, area) {
        var spec = decodeArea(area);
        if (!spec) return nativeCursor.apply(this, arguments);
        counters.cursorCalls++;
        var pool = pickPool(this, unit && unit.position, spec.side);
        if (!pool) return 0;                                    // 没有目标 ⇒ 0（原版「无效目标」约定）
        return pool[(Math.random() * pool.length) | 0];
      };
      proto.__worldolRandomCursor = true;
      state.cursorHooked = true;
    }
    return true;
  }

  function attach() {
    // 每次都扫：同一个类可能有多份模块拷贝（后加载的那份必须也挂上），
    // 靠 proto 上的标记防重复包装。
    scanCache();
    hookFactories();
    return state.hooked;
  }

  attach();
  // 兜底轮询：工厂包装失效（包结构变了）时靠扫描补上。全挂上就停。
  timer = setInterval(function () {
    attach();
    if (state.hooked && counters.labelHooked) { clearInterval(timer); timer = null; }
  }, 1000);

  var api = {
    revision: 'random-target-patch-20261025-v4',
    get status() {
      return {
        hooked: state.hooked, cursorHooked: state.cursorHooked, labelHooked: counters.labelHooked,
        randomCalls: counters.randomCalls, returned: counters.returned,
        empty: counters.empty, passthrough: counters.passthrough, cursorCalls: counters.cursorCalls
      };
    },
    get areaLabelHooked() { return counters.labelHooked; },
    /** 测试钩子：area → {side,count}（与生产同一份实现）。 */
    decode: decodeArea,
    label: areaLabel,
    /** 测试钩子：把候选池按规则挑 N 个（不依赖战斗实例，纯逻辑复用）。 */
    pick: function (pool, count) {
      var list = pool.slice();
      for (var i = list.length - 1; i > 0; i--) {
        var j = (Math.random() * (i + 1)) | 0;
        var t = list[i]; list[i] = list[j]; list[j] = t;
      }
      return list.slice(0, Math.min(count, list.length));
    },
    probeAttach: attach,
    stop: function () { if (timer) { clearInterval(timer); timer = null; } }
  };
  host.__worldolRandomTargetPatch = api;
  return api;
}

/** 补丁链入口：追加 install 函数到主包末尾。 */
export function patchRandomTarget(source) {
  if (source.includes('__worldolRandomTargetPatch')) throw Error('Random target patch already installed');
  if (!source.includes('getSelectArea=function'))
    throw Error('random target patch mismatch: getSelectArea=function');
  return source + '\n;(' + installRandomTarget.toString() + ')(window.__worldReq,window);\n';
}
