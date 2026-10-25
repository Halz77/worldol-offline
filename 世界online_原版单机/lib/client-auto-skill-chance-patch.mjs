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
export const autoSkillChancePatchRevision = 'auto-skill-chance-patch-20261025-v1';

/** 安装概率层。req = window.__worldReq，host = window。 */
export function installAutoSkillChance(req, host) {
  host = host || globalThis;
  if (host.__worldolAutoSkillChancePatch) return host.__worldolAutoSkillChancePatch;
  const counters = { rolls: 0, passed: 0, skipped: 0, unconfigured: 0 };
  let hooked = false;
  let timer = null;

  // 按特征找战斗类（不硬编码模块号：0251 是同源 v305 的号，换包会漂）。
  function findBattleProto() {
    const cache = req.c;
    if (!cache) return null;
    for (const key in cache) {
      let mod;
      try { mod = cache[key]; } catch (_) { continue; }
      // 真环境里模块导出的是类（req(251).default 是构造函数，方法在 .prototype 上）；
      // 少数模块导出单例实例（方法直接在对象上），两种都认。
      const proto = (mod && mod.prototype) || (mod && mod.default && (mod.default.prototype || mod.default)) || null;
      if (proto && typeof proto.getAutoSkillIDByRound === 'function' && typeof proto.doAutoSkill === 'function')
        return proto;
    }
    return null;
  }

  /** 读配置里的百分比；未配置返回 null（=走原生）。 */
  function chanceOf(skillId) {
    const table = host.worldolAutoSkillChance;
    const map = table && table.chance;
    if (!map) return null;
    const pct = map[skillId];
    if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
    return pct;
  }

  function attach() {
    if (hooked) return true;
    const proto = findBattleProto();
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
      counters.rolls++;
      if (Math.random() * 100 < pct) { counters.passed++; return id; }
      counters.skipped++;
      return -1;                              // ← doAutoSkill 里 `0 > o` 会直接 return（本回合空过）
    };
    proto.__worldolAutoSkillChance = true;
    hooked = true;
    return true;
  }

  if (!attach()) timer = setInterval(() => { if (attach()) { clearInterval(timer); timer = null; } }, 800);

  const api = {
    revision: 'auto-skill-chance-patch-20261025-v1',
    get status() { return { hooked, rolls: counters.rolls, passed: counters.passed, skipped: counters.skipped, unconfigured: counters.unconfigured }; },
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
