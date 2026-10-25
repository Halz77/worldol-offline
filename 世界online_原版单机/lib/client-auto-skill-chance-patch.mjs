/**
 * 客户端补丁：自动技能按配置概率触发（第 93 版，2026-10-25）。
 *
 * 需求（用户原话）：给单个自动技能加触发概率，例：只勾了「魔化武器」配 30%，
 * 每回合轮到它时 30% 施放、70% **完全不施放**（不显示、无任何加成）。
 *
 * 落点选择（为什么包装 getAutoSkillIDByRound 而不是 doAutoSkill）：
 *   原版 analysis/modules/0251.js
 *     doAutoSkill(e) → var o = getAutoSkillIDByRound(e); if (0 > o) return; doUseSkillById(e,o,…)
 *     getAutoSkillIDByRound(e) → e.autoSkillID[this.round % e.getAutoSkillCount()]
 *   把 getAutoSkillIDByRound 改成「掷骰不中返回 -1」后，doAutoSkill 里现成的
 *   `0 > o` 判断会自然 return ⇒ 该单位本回合无动作（自动阶段跳过、手动指令阶段
 *   也没有它的指令）——正好是「不施放、不显示、无加成」，且不改原逻辑一行。
 *
 * 配置来源：window.worldolAutoSkillChance = { revision, chance: { 技能id: 百分比 } }
 *   · 电脑版：/skill-auto-chance.js（lib/http-routes.mjs 动态生成）
 *   · APK：安卓打包/standalone/globals.mjs → entry.mjs 的 installGeneratedGlobals
 *   读不到配置 ⇒ 一律走原生行为（不抛错、不阻断）。
 */
export const autoSkillChancePatchRevision = 'auto-skill-chance-patch-20261025-v4';

/**
 * 安装概率层。req = window.__worldReq，host = window。
 *
 * ★ 本函数体会被 toString() 塞进客户端主包执行 ⇒ 必须完全自包含（不能引用模块作用域的常量/函数）。
 */
export function installAutoSkillChance(req, host) {
  host = host || globalThis;
  if (host.__worldolAutoSkillChancePatch) return host.__worldolAutoSkillChancePatch;
  const counters = { rolls: 0, passed: 0, skipped: 0, unconfigured: 0, coerced: 0, memoHits: 0 };
  let hooked = false;
  let timer = null;
  // 同一回合内同一个单位的判定结果固定下来：避免「预览一次、执行一次」两次掷骰结果不同，
  // 也避免某些 UI 反复调用 getAutoSkillIDByRound 时把概率放大/缩小。
  let memoRound = null;
  let memo = null;

  // ── 找战斗类 ─────────────────────────────────────────────
  // ⚠ 第 98 版修正：这个包是 webpack 风格，`__worldReq.c[id]` 存的是
  //   `{i, l, exports}` 这样的**模块记录**，导出在 `.exports` 上（类挂在 exports.default）。
  //   之前直接读 `mod.default` / `mod.prototype` 永远拿不到 ⇒ 三个补丁全部 hooked=false。
  //   现在先解出 exports，再按特征匹配；另外包一层模块工厂，之后才被 require 的模块
  //   在实例化那一刻就能挂上（不依赖轮询时机）。
  function exportCandidates(mod) {
    const out = [];
    if (!mod) return out;
    const ex = mod.exports || mod;
    if (ex) { out.push(ex); if (ex.default) out.push(ex.default); }
    if (mod !== ex) out.push(mod);
    return out;
  }

  function tryHook(proto) {
    if (!proto) return false;
    if (Object.prototype.hasOwnProperty.call(proto, '__worldolAutoSkillChance')) { hooked = true; return true; }
    const original = proto.getAutoSkillIDByRound;
    proto.getAutoSkillIDByRound = function (player) {
      const id = original.apply(this, arguments);
      // 原生返回 -1/-2/-3 等负数 = 本来就不施放，原样放行
      if (typeof id !== 'number' || id <= 0) return id;
      const pct = chanceOf(id);
      if (pct === null) { counters.unconfigured++; return id; }
      if (pct >= 100) { counters.passed++; return id; }
      if (pct <= 0) { counters.skipped++; counters.rolls++; return -1; }
      const pos = player && typeof player.position === 'number' ? player.position : -1;
      const round = this && this.round;
      const memoable = typeof round === 'number' && pos >= 0;   // 回合号拿不到就不记忆，避免永久固化
      const saved = memoable ? memoGet(round, pos) : null;
      if (saved !== null) { counters.memoHits++; return saved ? id : -1; }
      counters.rolls++;
      const ok = Math.random() * 100 < pct;
      if (memoable) memoSet(round, pos, ok);
      if (ok) { counters.passed++; return id; }
      counters.skipped++;
      return -1;                              // ← doAutoSkill 里 `0 > o` 会直接 return（本回合空过）
    };
    proto.__worldolAutoSkillChance = true;
    hooked = true;
    return true;
  }

  function tryModule(mod) {
    const list = exportCandidates(mod);
    for (const c of list) {
      if (!c) continue;
      const proto = c.prototype || (typeof c === 'object' ? c : null);
      if (!proto) continue;
      if (typeof proto.getAutoSkillIDByRound === 'function' && typeof proto.doAutoSkill === 'function') return tryHook(proto);
    }
    return false;
  }

  function scanCache() {
    let cache;
    try { cache = req.c; } catch (_) { return false; }
    if (!cache) return false;
    for (const key in cache) {
      let mod;
      try { mod = cache[key]; } catch (_) { continue; }
      if (tryModule(mod)) return true;
    }
    return false;
  }

  /** 给还没被 require 的模块包一层：实例化完立刻检查导出。 */
  function hookFactories() {
    let factories;
    try { factories = req.m; } catch (_) { return; }
    if (!factories) return;
    for (const id in factories) {
      const fn = factories[id];
      if (typeof fn !== 'function' || fn.__worldolChanceHook) continue;
      factories[id] = (function (orig) {
        return function (module, exports, require) {
          const out = orig.apply(this, arguments);
          try { tryModule(module); } catch (_) {}
          return out;
        };
      })(fn);
      factories[id].__worldolChanceHook = true;
    }
  }

  /** 读配置里的百分比；未配置返回 null（=走原生）。兼容写成字符串的 "30"（编辑器/手改都可能）。 */
  function chanceOf(skillId) {
    const table = host.worldolAutoSkillChance;
    const map = table && table.chance;
    if (!map) return null;
    const raw = map[skillId];
    if (raw === undefined || raw === null || raw === '') return null;
    let pct = raw;
    if (typeof pct !== 'number') {
      pct = Number(raw);
      counters.coerced++;
    }
    if (!Number.isFinite(pct)) return null;
    return pct;
  }

  function memoGet(round, pos) {
    if (memoRound !== round) { memoRound = round; memo = {}; }
    const key = String(pos);
    return Object.prototype.hasOwnProperty.call(memo, key) ? memo[key] : null;
  }
  function memoSet(round, pos, value) {
    if (memoRound !== round) { memoRound = round; memo = {}; }
    memo[String(pos)] = value;
  }

  function attach() {
    // 每次都扫（同一份类可能被多个模块拷贝持有），proto 标记防重复包装
    scanCache();
    hookFactories();                       // 之后才 require 的模块：实例化即刻挂
    return hooked;
  }

  attach();
  // 兜底轮询：工厂包装失效（包结构变了）时还能靠扫描补上。挂上就不再见。
  timer = setInterval(() => { if (attach()) { clearInterval(timer); timer = null; } }, 1000);

  const api = {
    revision: 'auto-skill-chance-patch-20261025-v4',
    get status() {
      const table = host.worldolAutoSkillChance;
      return {
        hooked, rolls: counters.rolls, passed: counters.passed, skipped: counters.skipped,
        unconfigured: counters.unconfigured, coerced: counters.coerced, memoHits: counters.memoHits,
        configLoaded: !!(table && table.chance),
        configuredSkills: table && table.chance ? Object.keys(table.chance).length : 0
      };
    },
    /** 测试钩子：直接判定某个技能 id 本次是否施放（返回 true/false；未配置返回 null）。 */
    peek: skillId => {
      const pct = chanceOf(skillId);
      if (pct === null) return null;
      if (pct >= 100) return true;
      if (pct <= 0) return false;
      return Math.random() * 100 < pct;
    },
    /** 测试钩子：手动触发一次补挂（模拟定时器路径）。 */
    probeAttach: () => attach(),
    stop: () => { if (timer) { clearInterval(timer); timer = null; } }
  };
  host.__worldolAutoSkillChancePatch = api;
  return api;
}

/** 补丁链入口：追加 install 函数到主包末尾。 */
export function patchAutoSkillChance(source) {
  if (source.includes('__worldolAutoSkillChancePatch')) throw Error('Auto skill chance patch already installed');
  if (!source.includes('getAutoSkillIDByRound=function'))
    throw Error('auto skill chance patch mismatch: getAutoSkillIDByRound=function');
  return source + '\n;(' + installAutoSkillChance.toString() + ')(window.__worldReq,window);\n';
}
