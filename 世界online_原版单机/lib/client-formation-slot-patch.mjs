/**
 * 客户端补丁：阵法按阵位差异化加成（第 94 版，2026-10-25）。
 *
 * 需求：同一个阵，第 1 个角色加伤害、第 2 个加减伤、第 3 个加速度、宠物全体加减伤。
 *
 * 原版限制（取证见 analysis/modules/）：
 *   · 0057.js fromByteFormationSkill：每个阵只有 power1-3/value1-3 三组加成，没有位置字段；
 *   · 0018.js DATA_FORMATION：master.formationSkill 与 pet.formationSkill 指向**同一个对象**；
 *   · 0056.js getPowerValue(e,t,i,o,r,s,l,u)：
 *       _ += this.formationSkill.getPowerValue(i)   // 平加
 *       d += this.formationSkill.getPowerValue(o)   // 百分比
 *     0042.js getPetBaseValue / getPetPowerValue 同样读 this.ownerVo.formationSkill。
 *
 * 实现：**不改公式，只换查表源** —— 在三个方法内部把 formationSkill 临时替换成
 * 「按阵位查表的适配器」（Object.create 继承原对象，只覆盖 getPowerValue），
 * 调用完立刻还原。这样：
 *   · 百分比乘算、封顶、其它字段（阵名/id 被面板读）全部保持原样；
 *   · add 模式 = 原版统一加成 + 阵位加成；replace 模式 = 只吃阵位加成；
 *   · 宠物用配置里的 pet 段，不占角色阵位。
 *
 * 阵位口径：己方「角色」（排除宠物）按战场位置编号升序排名，第 1 名 = 第 1 位
 * （本地战斗布阵见 analysis/modules/0228.js getLocalBattlePlayerList：我=25、宠物=24、
 *  队友=23/22/27/26，升序排名后稳定可预测）。非战斗（角色面板）一律按第 1 位。
 *
 * 配置来源：window.worldolFormationSlots（/formation-slots.js 或 APK globals），
 * 结构 { revision, mode:'add'|'replace', forms:{ [阵型id]:{mode,slots:[{powers}],pet:{powers}} } }。
 * 读不到配置 ⇒ 一律走原生行为。
 */
export const formationSlotPatchRevision = 'formation-slot-patch-20261025-v3';

/** 安装阵位加成层。req = window.__worldReq，host = window。 */
export function installFormationSlots(req, host) {
  host = host || globalThis;
  if (host.__worldolFormationSlotPatch) return host.__worldolFormationSlotPatch;
  const MAX_POS = 34, LEFT_MAX_POS = 20;     // analysis/modules/0061.js
  const counters = { rolePatches: 0, petPatches: 0, adapters: 0, fallbacks: 0 };
  const hooked = { role: false, cal: false, petBase: false, petPower: false };
  let timer = null;

  function cfg() {
    const t = host.worldolFormationSlots;
    return t && t.forms && typeof t.forms === 'object' ? t : null;
  }

  /** 预聚合 [[powerId,value],…] → {powerId:value}。 */
  function sumPowers(list) {
    const map = {};
    if (!Array.isArray(list)) return map;
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const p = Number(row[0]), v = Number(row[1]);
      if (Number.isInteger(p) && p > 0 && Number.isFinite(v) && v !== 0) map[p] = (map[p] || 0) + v;
    }
    return map;
  }

  /** 造适配器：继承原 formationSkill（阵名/id 等字段照旧），只覆盖 getPowerValue。 */
  function makeAdapter(realFs, formId, slotIndex, isPet) {
    const conf = cfg();
    if (!conf) return null;
    if (!isPet && !(slotIndex > 0)) return null;              // 不参与阵位的单位（NPC 等）⇒ 不干预
    const form = conf.forms[formId];
    if (!form) return null;
    const mode = form.mode === 'replace' ? 'replace' : 'add';
    let powers = [];
    if (isPet) powers = (form.pet && form.pet.powers) || [];
    else {
      const idx = Math.min(Math.max(1, slotIndex), 5) - 1;
      powers = (Array.isArray(form.slots) && form.slots[idx] && form.slots[idx].powers) || [];
    }
    const map = sumPowers(powers);
    const hasOwn = Object.keys(map).length > 0;
    if (!hasOwn && mode !== 'replace') return null;             // 这个阵位没配 ⇒ 不干预
    const adapter = Object.create(realFs || null);
    adapter.getPowerValue = function (key) {
      const own = map[key] || 0;
      if (mode === 'replace') return own;
      const base = realFs && typeof realFs.getPowerValue === 'function' ? realFs.getPowerValue(key) : 0;
      return base + own;
    };
    counters.adapters++;
    return adapter;
  }

  function battleRef() {
    try {
      const mod = req(54);
      const proxy = mod && (mod.default || mod);
      const inst = proxy && proxy.ins;
      return (inst && inst.battle) || null;
    } catch (_) { return null; }
  }

  function isPetUnit(u) {
    try { return u && u.ownerVo !== undefined; } catch (_) { return false; }
  }

  /**
   * 单位类型（MODEL_TYPE，见 analysis/modules/0004.js）：
   *   1=NPC 2=怪 3=玩家角色 4=宠物 5=佣兵 6=玩家怪 7=宠物怪 8=竞速 9=竞速宠 10=军团 11=伙伴
   * 阵位由「玩家角色(3) + 军团(10)」参与排名 —— 军团是单机里陪玩家打的人形单位，要算。
   * 任务里塞进来的系统 NPC(1)、宠物(4，走宠物段)、佣兵(5)、伙伴(11) 不占角色阵位，
   * 否则会把我方角色的名次整体后移、加成错位。
   * 取不到类型时按「非宠物即角色」处理（真包 vo.getType() 一定存在，见 0241.js）。
   */
  function unitType(u) {
    try {
      const vo = u && (u.vo || u);
      return vo && typeof vo.getType === 'function' ? vo.getType() : null;
    } catch (_) { return null; }
  }
  const SLOT_TYPES = { 3: true, 10: true };   // 3=玩家角色 10=军团

  /** 己方角色按位置升序排名，返回 1-based 阵位序号；不参与阵位的单位返回 0。 */
  function slotIndexOf(unit) {
    let pos;
    try { pos = unit && unit.position; } catch (_) { pos = undefined; }
    if (typeof pos !== 'number' || pos < 0 || pos >= MAX_POS) return 1;
    const battle = battleRef();
    if (!battle || typeof battle.getPlayerByPos !== 'function') return 1;
    const side = pos < LEFT_MAX_POS;
    const list = [];
    for (let p = 0; p < MAX_POS; p++) {
      let u;
      try { u = battle.getPlayerByPos(p); } catch (_) { u = null; }
      if (!u || !u.battleSprite) continue;
      if (isPetUnit(u)) continue;                               // 宠物不占角色阵位
      if ((p < LEFT_MAX_POS) !== side) continue;
      const type = unitType(u);
      if (type !== null && !SLOT_TYPES[type]) continue;         // NPC/佣兵/伙伴等 都不占位
      list.push(p);
    }
    if (!list.length) return 1;
    list.sort(function (a, b) { return a - b; });
    const i = list.indexOf(pos);
    return i < 0 ? 0 : i + 1;                                   // 自己不在名单里 ⇒ 0（不参与，走原生）
  }

  // ── 模块导出解析 ────────────────────────────────────────────
  // ⚠ 第 98 版修正：这个包是 webpack 风格，`__worldReq.c[id]` 是模块记录 `{i,l,exports}`，
  //   导出在 `.exports`（类在 exports.default）。之前直接读 mod / mod.default ⇒ 一个都匹配不到，
  //   面板上三个补丁全显示 hooked=false。
  function exportCandidates(mod) {
    const out = [];
    if (!mod) return out;
    const ex = mod.exports || mod;
    if (ex) { out.push(ex); if (ex.default) out.push(ex.default); }
    if (mod !== ex) out.push(mod);
    return out;
  }

  // 角色：getPowerValue 是 8 参方法，且同类有 getSkillPowerValue（0056 PlayerVO）
  function isRoleProto(p) {
    return !!p && typeof p.getPowerValue === 'function' && p.getPowerValue.length >= 8
      && typeof p.getSkillPowerValue === 'function';
  }
  // 宠物：有 getPetBaseValue + getPetPowerValue（0042 PetVO）
  function isPetProto(p) {
    return !!p && typeof p.getPetBaseValue === 'function' && typeof p.getPetPowerValue === 'function';
  }

  /**
   * 包一层角色 VO 的属性计算：临时把 formationSkill 换成按阵位查表的适配器，调用完还原。
   * 同一套逻辑要挂两个方法（都在 PlayerVO.prototype 上）：
   *   · getPowerValue(base, 上限, 平加键, 百分比键, …)        —— 单个属性，战斗/面板都用
   *   · getPowerValueCal(base, 上限, 描述数组, …)             —— 多属性一次算（面板、伤害预估走这个）
   * 第 97 版补：之前只包了 getPowerValue，走 getPowerValueCal 的界面看起来「没生效」。
   */
  function wrapRoleMethod(proto, name) {
    const original = proto[name];
    if (typeof original !== 'function') return false;
    proto[name] = function () {
      const real = this && this.formationSkill;
      if (!real) { counters.fallbacks++; return original.apply(this, arguments); }
      const adapter = makeAdapter(real, real.id, slotIndexOf(this), false);
      if (!adapter) { counters.fallbacks++; return original.apply(this, arguments); }
      this.formationSkill = adapter;
      counters.rolePatches++;
      try { return original.apply(this, arguments); }
      finally { this.formationSkill = real; }                  // 立刻还原（同步调用，安全）
    };
    return true;
  }

  function hookRoleOn(proto) {
    if (hooked.role) return true;
    if (!isRoleProto(proto)) return false;
    if (!Object.prototype.hasOwnProperty.call(proto, '__worldolFormationSlot')) {
      wrapRoleMethod(proto, 'getPowerValue');
      proto.__worldolFormationSlot = true;
    }
    // getPowerValueCal 是可选加成：有就挂，没有不影响主路径
    if (!proto.__worldolFormationSlotCal && typeof proto.getPowerValueCal === 'function') {
      if (wrapRoleMethod(proto, 'getPowerValueCal')) {
        proto.__worldolFormationSlotCal = true;
        hooked.cal = true;
      }
    }
    hooked.role = true;
    return true;
  }

  /** 把宠物两个方法都包上：临时改「持有人」的 formationSkill 字段（调用后还原）。 */
  function wrapPetMethod(proto, name) {
    const original = proto[name];
    if (typeof original !== 'function') return false;
    proto[name] = function () {
      const holder = this && (this.ownerVo || this.owner);
      const real = holder && holder.formationSkill;
      if (!real) { counters.fallbacks++; return original.apply(this, arguments); }
      const adapter = makeAdapter(real, real.id, 1, true);
      if (!adapter) { counters.fallbacks++; return original.apply(this, arguments); }
      holder.formationSkill = adapter;
      counters.petPatches++;
      try { return original.apply(this, arguments); }
      finally { holder.formationSkill = real; }
    };
    return true;
  }

  function hookPetOn(proto) {
    if (hooked.petBase && hooked.petPower) return true;
    if (!isPetProto(proto)) return false;
    if (!Object.prototype.hasOwnProperty.call(proto, '__worldolFormationSlotPet')) {
      hooked.petBase = wrapPetMethod(proto, 'getPetBaseValue');
      hooked.petPower = wrapPetMethod(proto, 'getPetPowerValue');
      proto.__worldolFormationSlotPet = true;
    } else {
      hooked.petBase = hooked.petPower = true;
    }
    return hooked.petBase || hooked.petPower;
  }

  // ── 阵法说明补一行「阵位加成」 ──────────────────────────────
  // 原版说明是 FormationSkill.prototype.getFormationInfo(取数组?) —— 只拼 power1-3 + 人数，
  // 根本没有阵位概念，所以玩家改完阵位加成后点开说明还是老样子。这里在末尾追加一行。
  /** 效果名格式化函数（原版 getPowerDesc(powerId,value,vo) → "出手速度+22%"）。
   *  扫描模块时顺手抓一个存下来（同一个导出对象上）。 */
  let powerDescFn = null;
  function grabPowerDesc(holder) {
    if (powerDescFn || !holder || typeof holder.getPowerDesc !== 'function') return;
    try { powerDescFn = holder.getPowerDesc.bind(holder); } catch (_) { powerDescFn = null; }
  }
  function findPowerDesc() { return powerDescFn; }

  function describePowers(list, desc) {
    const out = [];
    if (!Array.isArray(list)) return out;
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const id = Number(row[0]), value = Number(row[1]);
      if (!id || !value) continue;
      let text = null;
      if (desc) { try { text = desc(id, value, null); } catch (_) { text = null; } }
      out.push(String(text || ('效果' + id + (value > 0 ? '+' : '') + value)).replace(/\s+$/, ''));
    }
    return out;
  }

  function slotInfoLine(formSkill) {
    const conf = cfg();
    if (!conf || !formSkill) return null;
    const form = conf.forms[formSkill.id];
    if (!form) return null;
    const desc = findPowerDesc();
    const parts = [];
    const slots = Array.isArray(form.slots) ? form.slots : [];
    for (let i = 0; i < slots.length; i++) {
      const text = describePowers(slots[i] && slots[i].powers, desc).join('、');
      if (text) parts.push('第' + (i + 1) + '位 ' + text);
    }
    const petText = describePowers(form.pet && form.pet.powers, desc).join('、');
    if (petText) parts.push('宠物 ' + petText);
    if (!parts.length) return null;
    const head = form.mode === 'replace' ? '阵位加成（替换原效果）：' : '阵位加成：';
    return '\n' + head + parts.join(' · ');
  }

  let infoHooked = false;
  function hookInfoOn(proto) {
    if (infoHooked) return true;
    if (!proto || typeof proto.getFormationInfo !== 'function') return false;
    if (proto.__worldolFormationInfo) { infoHooked = true; return true; }
    const original = proto.getFormationInfo;
    proto.getFormationInfo = function (asArray) {
      const out = original.apply(this, arguments);
      let line = null;
      try { line = slotInfoLine(this); } catch (_) { line = null; }
      if (!line) return out;
      if (Array.isArray(out)) { out.push(line.replace(/^\n/, '')); return out; }
      return (out == null ? '' : String(out)) + line;
    };
    proto.__worldolFormationInfo = true;
    infoHooked = true;
    return true;
  }

  /** 一个模块的导出：顺手抓 getPowerDesc，然后按特征挂角色/宠物/阵法说明。 */
  function tryModule(mod) {
    const list = exportCandidates(mod);
    for (const c of list) {
      if (!c) continue;
      grabPowerDesc(c);
      const proto = c.prototype || (typeof c === 'object' ? c : null);
      if (!proto) continue;
      if (!hooked.role && isRoleProto(proto)) hookRoleOn(proto);
      if (!(hooked.petBase && hooked.petPower) && isPetProto(proto)) hookPetOn(proto);
      if (!infoHooked && typeof proto.getFormationInfo === 'function') hookInfoOn(proto);
    }
    return hooked.role;
  }

  function scanCache() {
    let cache;
    try { cache = req.c; } catch (_) { return false; }
    if (!cache) return false;
    for (const key in cache) {
      let mod;
      try { mod = cache[key]; } catch (_) { continue; }
      tryModule(mod);
    }
    return hooked.role;
  }

  /** 给还没 require 的模块包一层：实例化完立刻检查导出。 */
  function hookFactories() {
    let factories;
    try { factories = req.m; } catch (_) { return; }
    if (!factories) return;
    for (const id in factories) {
      const fn = factories[id];
      if (typeof fn !== 'function' || fn.__worldolSlotHook) continue;
      factories[id] = (function (orig) {
        return function (module, exports, require) {
          const out = orig.apply(this, arguments);
          try { tryModule(module); } catch (_) {}
          return out;
        };
      })(fn);
      factories[id].__worldolSlotHook = true;
    }
  }

  function attach() {
    if (!hooked.role) scanCache();
    if (!hooked.role || !(hooked.petBase && hooked.petPower) || !infoHooked) hookFactories();
    return hooked.role && (hooked.petBase || hooked.petPower);
  }

  attach();
  // 兜底轮询（工厂包装失效时还能靠扫描补上）。全挂上就停。
  timer = setInterval(function () { if (attach() && infoHooked) { clearInterval(timer); timer = null; } }, 1000);

  const api = {
    revision: 'formation-slot-patch-20261025-v3',
    get status() {
      return {
        roleHooked: hooked.role, calHooked: hooked.cal, petHooked: hooked.petBase || hooked.petPower, infoHooked,
        rolePatches: counters.rolePatches, petPatches: counters.petPatches,
        adapters: counters.adapters, fallbacks: counters.fallbacks,
        configured: cfg() ? Object.keys(cfg().forms).length : 0
      };
    },
    /** 测试钩子：算某阵某阵位的加成表（不依赖战斗实例）。 */
    peek: function (formId, slotIndex, isPet) {
      const conf = cfg();
      if (!conf) return null;
      const form = conf.forms[formId];
      if (!form) return null;
      const mode = form.mode === 'replace' ? 'replace' : 'add';
      const powers = isPet ? ((form.pet && form.pet.powers) || [])
        : ((Array.isArray(form.slots) && form.slots[Math.min(Math.max(1, slotIndex), 5) - 1] && form.slots[Math.min(Math.max(1, slotIndex), 5) - 1].powers) || []);
      return { mode: mode, powers: powers };
    },
    /** 测试钩子：手动补挂（模拟轮询路径）。 */
    probeAttach: attach,
    stop: function () { if (timer) { clearInterval(timer); timer = null; } }
  };
  host.__worldolFormationSlotPatch = api;
  return api;
}

/** 补丁链入口：追加 install 函数到主包末尾。 */
export function patchFormationSlots(source) {
  if (source.includes('__worldolFormationSlotPatch')) throw Error('Formation slot patch already installed');
  // 锚点：宠物方法在 v305 主包里唯一，且它的存在意味着 0042/0056 的结构没变
  if (!source.includes('getPetBaseValue=function'))
    throw Error('formation slot patch mismatch: getPetBaseValue=function');
  return source + '\n;(' + installFormationSlots.toString() + ')(window.__worldReq,window);\n';
}
