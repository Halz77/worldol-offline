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
export const formationSlotPatchRevision = 'formation-slot-patch-20261025-v6';

/** 安装阵位加成层。req = window.__worldReq，host = window。 */
export function installFormationSlots(req, host) {
  host = host || globalThis;
  if (host.__worldolFormationSlotPatch) return host.__worldolFormationSlotPatch;
  const MAX_POS = 34, LEFT_MAX_POS = 20;     // analysis/modules/0061.js
  const counters = { rolePatches: 0, petPatches: 0, adapters: 0, fallbacks: 0, getCalls: 0, lastCall: null, fieldPatches: 0, petCalls: 0 };
  const hooked = { role: false, cal: false, base: false, petBase: false, petPower: false, get: false };
  let timer = null;
  // 重入保护：get(DODGE) 内部会再调 get(AGI)/get(WIS)，嵌套注入会重复叠加（add 模式会翻倍）。
  // 最外层负责换 formationSkill，内层直接用外面那一份。
  let injectDepth = 0;
  // 诊断开关：置 true 后一律不注入（用来量「没装补丁时」的原生值）
  let noSlot = false;

  function cfg() {
    const t = host.worldolFormationSlots;
    // ★ 第 106 版：总开关。enabled:false 时整个补丁退化成原生行为，
    //   用来一锤定音区分「数值是补丁改的」还是「游戏本来就是那个值」。
    if (!t || t.enabled === false) return null;
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

  /**
   * 当前生效的阵型 id。
   *
   * 为什么要这个：DATA_FORMATION 的 formationSkill 只挂在**玩家自己**的单位上，
   * 军团 / 队友 / 宠物那些单位的 formationSkill 常常是 null —— 原版公式里
   * `null != this.formationSkill` 直接跳过，所以「全员」阵位加成对它们从来没生效过。
   * 这里在拿不到 formationSkill 时，从世界单例（模块 5 的 myPlayer）取玩家当前阵型 id，
   * 再用配置里的阵位加成顶上。
   */
  function activeFormationId() {
    try {
      const world = req(5);
      const me = world && (world.myPlayer || (world.default && world.default.myPlayer));
      const fs = me && (me.formationSkill || (me.vo && me.vo.formationSkill));
      if (fs && Number(fs.id) > 0) return Number(fs.id);
    } catch (_) { /* 取不到就退化 */ }
    const conf = cfg();
    const keys = conf ? Object.keys(conf.forms) : [];
    return keys.length === 1 ? Number(keys[0]) : null;          // 只配了一个阵 ⇒ 就用它
  }

  /**
   * 造适配器：继承原 formationSkill（阵名/id 等字段照旧），只覆盖 getPowerValue。
   * realFs 允许为 null —— 军团/队友单位本来就没有 formationSkill，我们只叠加自己的阵位加成。
   */
  function makeAdapter(realFs, formId, slotIndex, isPet) {
    if (noSlot) return null;                                   // 诊断开关：模拟「没装补丁」
    const conf = cfg();
    if (!conf) return null;
    if (!(slotIndex > 0)) return null;                         // 不参与阵位的单位（非战斗、NPC 等）⇒ 不干预
    if (!(Number(formId) > 0)) return null;
    const form = conf.forms[formId];
    if (!form) return null;
    // 每次属性读取都重建适配器太浪费（战斗里 get() 调用非常频繁），按 阵型|阵位|是否宠物 缓存。
    if (cacheConf !== conf) { cacheConf = conf; adapterCache = {}; }
    const key = formId + '|' + (isPet ? 'pet' : slotIndex);
    if (adapterCache[key]) return adapterCache[key];
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
    // 面板要显示「第 N 位」用（只有真的吃加成才标）
    adapter.__worldolSlotIndex = isPet ? 0 : Math.min(Math.max(1, slotIndex), 5);
    adapter.__worldolIsPet = !!isPet;
    counters.adapters++;
    adapterCache[key] = adapter;
    return adapter;
  }
  let cacheConf = null, adapterCache = {};

  /** 给面板用：这个单位吃的是哪个阵位（没配加成的阵位返回 null，不标注）。
   *  入参就是**属性 VO**（战斗信息面板里 `e` 是 VO，直接有 getLevel/getName/formationSkill/position）。 */
  function slotLabel(unit) {
    try { ensureHook(unit); } catch (_) {}                      // 第 103 版：就地补挂（多拷贝兜底）
    const vo = unit || null;
    if (!vo) return null;
    const conf = cfg();
    if (!conf) return null;
    const isPet = isPetUnit(vo);
    if (isPet) {
      const holder = vo.ownerVo || vo.owner;
      const fs = (holder && holder.formationSkill) || vo.formationSkill;
      const form = fs ? conf.forms[fs.id] : conf.forms[activeFormationId()];
      const powers = form && form.pet && form.pet.powers;
      return Array.isArray(powers) && powers.length ? '宠物' : null;
    }
    const fs = vo.formationSkill;
    const form = fs ? conf.forms[fs.id] : conf.forms[activeFormationId()];
    if (!form) return null;
    const idx = slotIndexOf(vo);
    if (!(idx > 0)) return null;
    const slot = Array.isArray(form.slots) ? form.slots[Math.min(idx, 5) - 1] : null;
    const powers = slot && slot.powers;
    return Array.isArray(powers) && powers.length ? ('第' + idx + '位') : null;
  }

  /** 诊断（第 102/103 版）：把面板 e 的运行时结构打出来 + 就地补挂 + 检查是否已包装。 */
  function diag(unit) {
    try { ensureHook(unit); } catch (_) {}                      // 就地补挂（多拷贝兜底）
    const vo = unit && (unit.vo || unit);
    if (!vo) return '【diag】e 为空\n';
    const parts = [];
    let hasVo = false;
    try { hasVo = unit && unit.vo !== undefined; } catch (_) {}
    parts.push('【diag】');
    parts.push('有vo=' + (hasVo ? '是' : '否'));
    let type = '?';
    try { type = typeof vo.getType === 'function' ? vo.getType() : '?'; } catch (_) {}
    parts.push('type=' + type);
    let pos = '?';
    try { pos = (vo.position !== undefined ? vo.position : (unit && unit.position)); } catch (_) {}
    parts.push('pos=' + pos);
    let fs = 'null';
    try { fs = vo.formationSkill ? ('id' + vo.formationSkill.id) : 'null'; } catch (_) {}
    parts.push('formationSkill=' + fs);
    // 关键检查：这个对象实际用的 getPowerValue 是不是我们包装过的（多拷贝问题的决定性证据）
    let wrapped = '?';
    try { wrapped = vo.getPowerValue && vo.getPowerValue.__worldolWrapped ? '是' : '否'; } catch (_) {}
    parts.push('已包装=' + wrapped);
    parts.push('回退=' + counters.fallbacks);
    // 最近一次注入结果（slot/form/ok）
    const lc = counters.lastCall;
    parts.push('注入=' + (lc ? ('位' + lc.slot + '/阵' + lc.form + (lc.pet ? '/宠' : '') + (lc.ok ? '/成' : '/败')) : '无'));
    parts.push('宠物=' + (isPetUnit(vo) ? '是' : '否'));
    // 决定性对比：躲闪(ModelConst.DODGE=42)在「装了补丁」与「关掉补丁」时各是多少。
    // ★ 第 105 版：之前用 `vo.formationSkill=null` 来量「去掉」，但适配器在 fs 为 null 时会退化成
    //   activeFormationId() 照样注入 ⇒ 两个值必然相同，诊断一直是假阴性。改用总开关 noSlot。
    let withFs = '?', withoutFs = '?';
    try {
      if (typeof vo.get === 'function') {
        noSlot = false; withFs = vo.get(42);
        noSlot = true;
        try { withoutFs = vo.get(42); } finally { noSlot = false; }
      }
    } catch (_) { noSlot = false; }
    parts.push('躲闪装补丁=' + withFs + '/关掉=' + withoutFs);
    parts.push('dodge字段=' + (vo.dodge === undefined ? '无' : vo.dodge));
    let battle = '无';
    try { battle = battleRef() ? '有' : '无'; } catch (_) {}
    parts.push('battle=' + battle);
    // ★ 第 106 版：真正决定「注不注入」的是这一项（战斗单例存在 且 该位置有人）
    let inB = '?';
    try { inB = inBattleFor(vo) ? '是' : '否'; } catch (_) {}
    parts.push('战斗内=' + inB);
    return parts.join(' ') + '\n';
  }

  function battleRef() {
    try {
      const mod = req(54);
      const proxy = mod && (mod.default || mod);
      const inst = proxy && proxy.ins;
      return (inst && inst.battle) || null;
    } catch (_) { return null; }
  }

  /**
   * ★ 第 106 版：这个单位**此刻真的在战斗里**吗？
   *
   * 只判断「有没有战斗单例」不够 —— 角色面板/宠物面板都是复用同一个 VO 对象，
   * `position` 是上一次战斗留下的（玩家 25、宠物 24…），单看 position 也判断不出来。
   * 唯一可靠的判据：战斗单例存在，**且** 这个位置上确实站着单位。
   * 战斗结束后 cleanBattleData 会把 battle 置空（analysis/modules/0054.js:146），
   * 于是这里返回 false ⇒ 战斗外一律不注入。
   */
  function inBattleFor(vo) {
    const battle = battleRef();
    if (!battle || typeof battle.getPlayerByPos !== 'function') return false;
    let pos;
    try { pos = vo && vo.position; } catch (_) { pos = undefined; }
    if (typeof pos !== 'number' || pos < 0 || pos >= MAX_POS) return false;
    try { return !!battle.getPlayerByPos(pos); } catch (_) { return false; }
  }

  function isPetUnit(u) {
    try {
      const vo = u && (u.vo || u);
      if (!vo) return false;
      // 宠物 VO 构造时 setType(TYPE_PET=4)（0042.js:35），这个最可靠；
      // ownerVo 只在 processDataPlayerDetail 里赋值（t.pet.ownerVo=t），战斗单位未必有，只作兜底。
      if (typeof vo.getType === 'function' && vo.getType() === 4) return true;
      return !!(vo.ownerVo !== undefined || (u && u.ownerVo !== undefined));
    } catch (_) { return false; }
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

  /** 己方角色按位置升序排名，返回 1-based 阵位序号；不参与阵位的单位返回 0。
   * 入参**永远是属性 VO**（getPowerValue 的 this、或面板里的 e）。VO 上有 position/getType/formationSkill，
   * 没有 `.vo` 包裹。遍历时 battle.getPlayerByPos(p) 返回的是战斗单位（有 .vo），那边用 unitType/isPetUnit 里的 `u.vo||u` 取 VO。
   *
   * ★ 非战斗（角色面板、没有 battle 单例、position 越界）一律返回 0 —— 阵位加成**只在战斗里生效**，
   *   没进战斗前不对属性做任何加成（玩家明确要求）。 */
  function slotIndexOf(unit) {
    let pos;
    try { pos = unit && unit.position; } catch (_) { pos = undefined; }
    if (typeof pos !== 'number' || pos < 0 || pos >= MAX_POS) return 0;   // 非战斗（角色面板）⇒ 0，不参与阵位
    const battle = battleRef();
    if (!battle || typeof battle.getPlayerByPos !== 'function') return 0; // 没有战斗单例 ⇒ 0，不加成
    const side = pos < LEFT_MAX_POS;
    const map = slotMapFor(battle, side);
    const idx = map[pos];
    return idx > 0 ? idx : 0;                                   // 自己不在名单里 ⇒ 0（不参与，走原生）
  }

  /**
   * 己方角色站位 → 阵位序号 的映射表（按位置升序排名）。
   * get() 在战斗里会被非常频繁地调用，每调一次就遍历 34 个位置太浪费；
   * 但战斗刚开局时名单还没齐，所以不能永久缓存 —— 每 64 次调用刷新一次。
   */
  let slotCalls = 0, slotCacheBattle = null, slotCacheSide = null, slotCacheMap = null;
  function slotMapFor(battle, side) {
    slotCalls++;
    const fresh = slotCalls === 1 || slotCalls % 64 === 0;
    if (!fresh && slotCacheMap && slotCacheBattle === battle && slotCacheSide === side) return slotCacheMap;
    const map = {};
    const list = [];
    for (let p = 0; p < MAX_POS; p++) {
      let u;
      try { u = battle.getPlayerByPos(p); } catch (_) { u = null; }
      if (!u) continue;
      if (isPetUnit(u)) continue;                               // 宠物不占角色阵位
      if ((p < LEFT_MAX_POS) !== side) continue;
      const type = unitType(u);
      if (type !== null && !SLOT_TYPES[type]) continue;         // NPC/佣兵/伙伴等 都不占位
      list.push(p);
    }
    // ⚠ 第 99 版：不要用 `u.battleSprite` 过滤 —— 属性计算可能发生在战斗动画建好之前，
    // 那时候所有单位都没有图标，名单会空 ⇒ 阵位算不出来 ⇒ 阵位加成整块不生效。
    list.sort(function (a, b) { return a - b; });
    for (let i = 0; i < list.length; i++) map[list[i]] = i + 1;
    slotCacheBattle = battle; slotCacheSide = side; slotCacheMap = map;
    return map;
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
    if (original.__worldolWrapped) return true;                 // 这份已经包过（多拷贝场景）
    const wrapped = function () {
      if (injectDepth > 0) return original.apply(this, arguments);   // 外层 get() 已经换过了，别重复叠加
      const had = this && this.formationSkill;
      const real = had || null;
      // 军团/队友这些单位自己没挂 formationSkill（阵法块只给玩家），仍然按玩家当前阵型算阵位加成
      const formId = real && Number(real.id) > 0 ? real.id : activeFormationId();
      // ★ 宠物 VO 继承 PlayerVO，它的躲闪等属性走 PlayerVO.get(DODGE) → 这个 getPowerValue
      //   （不是 getPetBaseValue/getPetPowerValue）。这里要识别出宠物（type=4），
      //   让它走「宠物段」加成，而不是按角色阵位算第 N 位（宠物不在角色阵位名单里，会被排除）。
      const isPet = isPetUnit(this);
      // ★ 第 106 版：这里原来硬编码 `1`，等于**战斗外也给宠物加成** ——
      //   宠物面板（复用同一个 VO 对象、position 是上次战斗留下的 24）会显示一个"战斗中的数"。
      //   这就是玩家反馈「角色战斗外正常 2327、宠物战斗外还是 2512」的根因。
      const slotIndex = isPet ? (inBattleFor(this) ? 1 : 0) : slotIndexOf(this);
      const adapter = makeAdapter(real, formId, slotIndex, isPet);
      // 诊断：记录最近一次注入结果（面板那次调用到底成没成功）
      counters.lastCall = {slot: slotIndex, form: formId, pet: isPet, ok: !!adapter, hasFs: !!real};
      if (!adapter) { counters.fallbacks++; return original.apply(this, arguments); }
      this.formationSkill = adapter;
      counters.rolePatches++;
      try { return original.apply(this, arguments); }
      finally { this.formationSkill = had; }                   // 立刻还原（同步调用，安全）
    };
    wrapped.__worldolWrapped = true;                           // 诊断用：diag 检查 vo 的方法带不带这个标记
    proto[name] = wrapped;
    return true;
  }

  /**
   * ★ 第 105 版：直接包 VO 的 `get()` —— 宠物阵位加成的决定性修复。
   *
   * 为什么必须包 get：
   *   · 宠物躲闪走 PetVO.get() 的 default 分支，里面第一件事就是
   *     `this.formationSkill = this.ownerVo.formationSkill` —— **把我们注入的适配器当场覆盖掉**。
   *     所以只在 getPowerValue 里换 `this.formationSkill` 对宠物无效（军团/玩家没有这行，所以它们一直是对的，
   *     这也是「角色和军团都生效、就宠物不动」的根因）。
   *   · 这里把「宠物持有人的 formationSkill」一起换成适配器，宠物内部那句赋值取到的就是适配器。
   *   · 同时它也是最通用的一层：不管属性最终由 getPowerValue / getPowerValueCal / getPetPowerValue
   *     哪条路算出来，只要读 formationSkill 就吃到阵位加成。
   *
   * 重入保护：get(DODGE) 内部会再调 get(AGI)/get(WIS)，嵌套注入会在 add 模式下翻倍，
   * 所以最外层换一次，内层（injectDepth>0）直接放行。
   */
  function wrapGetMethod(proto) {
    const original = proto.get;
    if (typeof original !== 'function') return false;
    if (original.__worldolWrapped) return true;                 // 这份已经包过（多拷贝场景）
    const wrapped = function () {
      counters.getCalls++;
      if (injectDepth > 0) return original.apply(this, arguments);
      const isPet = isPetUnit(this);
      if (isPet) counters.petCalls++;
      const had = this && this.formationSkill;
      const real = had || null;
      const formId = real && Number(real.id) > 0 ? real.id : activeFormationId();
      // ★ 玩家要求：阵位加成只在战斗里生效。宠物段同理 —— 没进战斗就 0（不参与）。
      const slotIndex = isPet ? (inBattleFor(this) ? 1 : 0) : slotIndexOf(this);
      const adapter = makeAdapter(real, formId, slotIndex, isPet);
      counters.lastCall = {slot: slotIndex, form: formId, pet: isPet, ok: !!adapter, hasFs: !!real, via: 'get'};
      if (!adapter) { counters.fallbacks++; return original.apply(this, arguments); }
      // 宠物：连持有人的一起换（PetVO.get 的 default 分支会从 ownerVo 取）
      const holder = isPet ? (this.ownerVo || this.owner) : null;
      const hadHolder = holder ? holder.formationSkill : undefined;
      this.formationSkill = adapter;
      if (holder) holder.formationSkill = adapter;
      injectDepth++;
      try { return original.apply(this, arguments); }
      finally {
        injectDepth--;
        this.formationSkill = had;
        if (holder) holder.formationSkill = hadHolder;
      }
    };
    wrapped.__worldolWrapped = true;
    proto.get = wrapped;
    return true;
  }

  /**
   * 属性 → [字段名, 平加power键, 百分比power键]
   * 从主包 PlayerVO.get() 的各个 case 里提取（case ModelConst.X: … this.getPowerValue(i, this.<字段>,
   * POWER_A, POWER_B)）。例：DODGE → [dodge, 55(POWER_DODGE), 25(POWER_DODGE_PERCENT)]。
   * ★ 第 104 版：战斗单位的 get(DODGE) 等是 **return this.dodge**（战斗开始时固化写死的字段），
   *   动态注入 formationSkill 进不去 ⇒ 阵位加成必须直接改这些字段。
   */
  const ATTR_FIELDS = {
    SPEED: ['speed', 53, 23], ATK_STR: ['atk_str', 58, 28], ATK_AGI: ['atk_agi', 59, 29],
    ATK_MAGIC: ['atk_magic', 60, 30], DEF_STR: ['def_str', 61, 31], DEF_AGI: ['def_agi', 62, 32],
    DEF_MAGIC: ['def_magic', 63, 33], DODGE: ['dodge', 55, 25], HIT_RATE: ['hitrate', 54, 24],
    HIT_MAGIC: ['hitMagic', 56, 26], CRITICAL: ['critical', 57, 27], FORCE_HIT: ['forceHit', 76, 46],
    TOUGH: ['tough', 65, 35], BLOCK: ['block', 67, 37], BRK_ARMOR: ['brkArmor', 69, 39],
    MAGIC_PENETRATION: ['magic_penetration', 75, 45], INSIGHT: ['insight', 68, 38],
    DEF_FIELD: ['def_field', 70, 40], BACK: ['back', 71, 41], MAGIC_BACK: ['magic_back', 72, 42],
    LIFE_ABSORPTION: ['life_absorption', 73, 43], MANA_ABSORPTION: ['mana_absorption', 74, 44],
    HEAL_RECOVERY: ['heal_recovery', 77, 47], MANA_RECOVERY: ['mana_recovery', 78, 48]
  };

  /** ModelConst（模块 12）里的属性 id：把 ATTR_FIELDS 的 key 名（DODGE/SPEED/…）换成数字。 */
  function modelConst() {
    try {
      const m = req(12);
      return (m && (m.ModelConst || m.default || m)) || null;
    } catch (_) { return null; }
  }

  /**
   * ★ 第 105 版：只有「字段就是最终值」的单位才改字段。
   *
   * 取证（analysis/modules）：PlayerVO(0056) 的 get(DODGE) 是**动态**的 ——
   *   `getPowerValue(10*(AGI+WIS)/25, this.dodge, POWER_DODGE, POWER_DODGE_PERCENT, …)`
   *   这里 `this.dodge` 只是**平加**（在百分比之后再加），不是总值；
   * 而 MonsterVO(0091) 的 get(DODGE) 是 `return this.dodge`，字段**就是**总值。
   * 对动态单位改字段 = 只改了平加那一项、还会残留原版加成 ⇒ 数值算错。
   *
   * 判定方法：把字段 +1，看 get(属性) 是不是也正好 +1。是 ⇒ 字段即总值（固化）。
   */
  function fieldIsFrozen(vo, field, constId) {
    if (typeof vo.get !== 'function') return true;              // 没有 get ⇒ 只能靠字段
    if (!(constId > 0)) return false;
    const cur = vo[field];
    if (typeof cur !== 'number' || !isFinite(cur)) return false;
    const probe = cur + 1;
    let same = false;
    try {
      vo[field] = probe;
      same = (vo.get(constId) === probe);
    } catch (_) { same = false; }
    try { vo[field] = cur; } catch (_) {}
    return same;
  }

  /**
   * ★ 第 106 版：把「固化字段修正」还原回战斗前的原始值。
   *
   * 为什么需要：VO 是长期存活的对象（退出战斗后宠物/角色还是同一个），
   * 如果曾经改过它的固化字段，退出战斗后不会自己变回去 —— 面板上就会一直挂着一个
   * 「战斗中的数」。这里在非战斗路径上把改过的字段按记录还原，保证战斗外一定是原值。
   */
  function restoreSlotFields(vo) {
    const base0 = vo && vo.__worldolSlotBase;
    if (!base0) return 0;
    let n = 0;
    for (const field in base0) {
      try {
        if (vo[field] !== base0[field]) { vo[field] = base0[field]; n++; }
      } catch (_) {}
    }
    try { delete vo.__worldolSlotBase; } catch (_) { vo.__worldolSlotBase = null; }
    return n;
  }

  /**
   * ★ 第 104 版：把阵位加成直接写进战斗单位的**固化字段**。
   *
   * 背景：战斗开始时属性被算好写进 vo.speed / vo.dodge / vo.atk_str …（战斗单位的 get(DODGE)
   * 就是 `return this.dodge`），之后再读都是这个固化值。我们在 getPowerValue 里注入阵位加成，
   * 只对「现算」的读取有效，对固化字段无效 ⇒ 面板数值看着完全没变。
   *
   * 算法（近似，但与引擎口径一致）：
   *   固化值 v = (base + 全部平加) × (1 + 全部百分比/100)
   *   去掉原版阵法：v0 = v/(1+fsPct/100) - fsAdd
   *   加上阵位：  v1 = (v0 + newAdd) × (1 + newPct/100)
   *   newAdd/newPct：add 模式 = 原版+阵位；replace 模式 = 只用阵位。
   * 幂等：打过标记的单位不重复施加。
   */
  function applySlotBonusToFields(unit) {
    const vo = unit && (unit.vo || unit);
    if (!vo) return 0;
    const conf = cfg();
    if (!conf) return 0;
    // 非战斗不施加（玩家要求：只有战斗中才有阵位加成）；顺手把以前改过的字段还原回去
    if (!inBattleFor(vo)) { restoreSlotFields(vo); return 0; }
    const isPet = isPetUnit(vo);
    const fs = vo.formationSkill;
    // ★ 原版阵法对象必须先在位：replace 模式要扣掉原版统一加成，缺了它算出来的值是错的。
    //   等阵型就绪后再施加（轮询会再来）。
    if (!fs || typeof fs.getPowerValue !== 'function') return 0;
    const formId = Number(fs.id) > 0 ? fs.id : activeFormationId();
    const form = conf.forms[formId];
    if (!form) return 0;
    const mode = form.mode === 'replace' ? 'replace' : 'add';
    let powers = [];
    if (isPet) powers = (form.pet && form.pet.powers) || [];
    else {
      const idx = slotIndexOf(vo);
      if (!(idx > 0)) return 0;
      powers = (Array.isArray(form.slots) && form.slots[Math.min(Math.max(1, idx), 5) - 1] && form.slots[Math.min(Math.max(1, idx), 5) - 1].powers) || [];
    }
    const map = sumPowers(powers);
    if (!Object.keys(map).length) return 0;
    // 记录施加前的原始固化值：之后每次都从原始值重算（天然幂等，不会重复叠加）。
    let base0 = null;
    try { base0 = vo.__worldolSlotBase || (vo.__worldolSlotBase = {}); } catch (_) { return 0; }
    let changed = 0;
    const MC = modelConst();
    for (const attr in ATTR_FIELDS) {
      const spec = ATTR_FIELDS[attr];
      const field = spec[0], addKey = spec[1], pctKey = spec[2];
      const cur = Number(vo[field]);
      if (!Number.isFinite(cur) || cur === 0) continue;
      const ownAdd = map[addKey] || 0, ownPct = map[pctKey] || 0;
      if (!ownAdd && !ownPct) continue;
      // ★ 第 105 版：只改「字段即总值」的单位。玩家/军团/宠物是动态计算的，改它们会算错。
      const constId = MC ? MC[attr] : 0;
      let frozen = null;
      try { frozen = vo.__worldolFrozen || (vo.__worldolFrozen = {}); } catch (_) { frozen = null; }
      if (frozen) {
        if (frozen[field] === undefined) frozen[field] = fieldIsFrozen(vo, field, constId) ? 1 : 0;
        if (!frozen[field]) continue;
      } else if (!fieldIsFrozen(vo, field, constId)) continue;
      let fsAdd = 0, fsPct = 0;
      try { fsAdd = fs.getPowerValue(addKey) || 0; fsPct = fs.getPowerValue(pctKey) || 0; } catch (_) { fsAdd = 0; fsPct = 0; }
      const newAdd = mode === 'replace' ? ownAdd : fsAdd + ownAdd;
      const newPct = mode === 'replace' ? ownPct : fsPct + ownPct;
      if (base0[field] === undefined) base0[field] = cur;        // 第一次：记原始固化值
      const origin = base0[field];
      const base = origin / (1 + fsPct / 100) - fsAdd;
      const next = Math.max(0, Math.trunc((base + newAdd) * (1 + newPct / 100)));
      if (next === cur) continue;
      try { vo[field] = next; changed++; } catch (_) {}
    }
    if (changed) counters.fieldPatches += changed;
    return changed;
  }

  /**
   * ★ 第 104 版：就地补挂。
   * 上机诊断证实：战斗单位本身就是 VO（无 .vo），pos/formationSkill/getPowerValue 都在，
   * 但数值不变 —— 说明我们包装的那份 PlayerVO 拷贝不是这个对象实际用的那份
   * （客户端存在多份 PlayerVO 拷贝，第 98 版踩过模块缓存多拷贝）。
   * 兜底：面板/属性计算一旦拿到真实 VO，就地包装它的原型（幂等），不管它是哪份拷贝。
   */
  function ensureHook(vo) {
    let proto = null;
    try { proto = Object.getPrototypeOf(vo); } catch (_) { return; }
    if (!proto) return;
    try {
      if (isRoleProto(proto)) hookRoleOn(proto);
      if (isPetProto(proto)) hookPetOn(proto);
    } catch (_) { /* 诊断路径绝不抛错 */ }
    // 固化字段修正：属性是战斗开始时算好写死的，动态注入进不去，必须直接改字段
    try { applySlotBonusToFields(vo); } catch (_) {}
  }

  function hookRoleOn(proto) {
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
    // getBaseValue（6 参）也吃 formationSkill —— 面板五维走这条
    if (!proto.__worldolFormationSlotBase && typeof proto.getBaseValue === 'function') {
      if (wrapRoleMethod(proto, 'getBaseValue')) {
        proto.__worldolFormationSlotBase = true;
        hooked.base = true;
      }
    }
    // ★ 第 105 版：get() 这一层必须注入（宠物就是靠它才吃到加成的）。
    //   getCalls 仍然在这里计数：有计数但 rolePatches 一直是 0 ⇒ 说明实例的方法被别的拷贝遮住了。
    if (!proto.__worldolFormationSlotGet && typeof proto.get === 'function') {
      if (wrapGetMethod(proto)) { proto.__worldolFormationSlotGet = true; hooked.get = true; }
    }
    hooked.role = true;
    return true;
  }

  /** 把宠物两个方法都包上：临时改「持有人」的 formationSkill 字段（调用后还原）。 */
  function wrapPetMethod(proto, name) {
    const original = proto[name];
    if (typeof original !== 'function') return false;
    proto[name] = function () {
      if (injectDepth > 0) return original.apply(this, arguments);   // 外层 get() 已经换过了
      // ★ 第 106 版：这里原来硬编码 slotIndex=1，等于**战斗外也给宠物加成**（角色面板/宠物面板
      //   会显示一个"战斗中的数"）。宠物段同样只在战斗里生效。
      if (!inBattleFor(this)) return original.apply(this, arguments);
      const holder = this && (this.ownerVo || this.owner);
      const had = holder && holder.formationSkill;
      const real = had || null;
      const formId = real && Number(real.id) > 0 ? real.id : activeFormationId();
      const adapter = makeAdapter(real, formId, 1, true);
      if (!adapter) { counters.fallbacks++; return original.apply(this, arguments); }
      if (holder) holder.formationSkill = adapter;
      counters.petPatches++;
      try { return original.apply(this, arguments); }
      finally { if (holder) holder.formationSkill = had; }
    };
    return true;
  }

  function hookPetOn(proto) {
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
    // 战斗信息面板按行渲染、不会自动折行，一行塞 5 个阵位会横向溢出（玩家反馈文字出框）：
    // 每行两个，最多 3 行。
    const lines = [];
    for (let i = 0; i < parts.length; i += 2) lines.push(parts.slice(i, i + 2).join('  '));
    return '\n' + head + '\n' + lines.join('\n');
  }

  let infoHooked = false;
  function hookInfoOn(proto) {
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
      if (isRoleProto(proto)) hookRoleOn(proto);
      if (isPetProto(proto)) hookPetOn(proto);
      if (typeof proto.getFormationInfo === 'function') hookInfoOn(proto);
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

  /** 第 104 版：给战斗里所有己方单位（玩家/军团/宠物）施加阵位加成的固化字段修正。
   *  战斗开始后属性已固化，动态注入无效 ⇒ 必须直接改字段。幂等（打过标记就跳过）。 */
  function applyBattleUnits() {
    const battle = battleRef();
    if (!battle || typeof battle.getPlayerByPos !== 'function') return;
    for (let p = 0; p < MAX_POS; p++) {
      let u = null;
      try { u = battle.getPlayerByPos(p); } catch (_) { u = null; }
      if (!u) continue;
      const vo = u.vo || u;
      let type = null;
      try { type = typeof vo.getType === 'function' ? vo.getType() : null; } catch (_) { type = null; }
      if (type !== null && type !== 3 && type !== 10 && type !== 4) continue;  // 只要玩家/军团/宠物
      try { applySlotBonusToFields(vo); } catch (_) {}
    }
  }

  function attach() {
    // 每次都扫（同一个类可能有多份模块拷贝），proto 标记防重复包装
    scanCache();
    hookFactories();
    try { applyBattleUnits(); } catch (_) {}
    return hooked.role && (hooked.petBase || hooked.petPower);
  }

  attach();
  // 兜底轮询（工厂包装失效时还能靠扫描补上）。全挂上就停。
  timer = setInterval(function () { if (attach() && infoHooked) { clearInterval(timer); timer = null; } }, 1000);

  const api = {
    revision: 'formation-slot-patch-20261025-v6',
    get status() {
      return {
        roleHooked: hooked.role, calHooked: hooked.cal, baseHooked: hooked.base, getHooked: hooked.get,
        petHooked: hooked.petBase || hooked.petPower, infoHooked, getCalls: counters.getCalls,
        rolePatches: counters.rolePatches, petPatches: counters.petPatches, petCalls: counters.petCalls,
        adapters: counters.adapters, fallbacks: counters.fallbacks,
        configured: cfg() ? Object.keys(cfg().forms).length : 0,
        disabled: !cfg()
      };
    },
    /** 诊断开关：true = 一律不注入（量「没装补丁时」的原生值）。 */
    setNoSlot: function (v) { noSlot = !!v; },
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
    /** 战斗信息面板用：这个单位吃哪个阵位（没配加成的返回 null，不标注）。 */
    slotLabel: slotLabel,
    /** 诊断（第 102/103 版）：输出面板 e 的运行时结构。 */
    diag: diag,
    /** 第 103 版：就地补挂（多拷贝兜底），面板 onShow 开头调用。 */
    ensureHook: ensureHook,
    /** 诊断用：当前生效的阵型 id（军团单位没有 formationSkill 时靠它）。 */
    activeFormation: activeFormationId,
    /** 测试钩子：手动补挂（模拟轮询路径）。 */
    probeAttach: attach,
    stop: function () { if (timer) { clearInterval(timer); timer = null; } }
  };
  host.__worldolFormationSlotPatch = api;
  return api;
}

/** 补丁链入口：追加 install 函数到主包末尾。 */
export function patchFormationSlots(source) {
  // 用函数名判断（不能用 __worldolFormationSlotPatch：面板补丁会引用这个全局名，
  // 那条补丁排在本条之前，会让这里误判成「已安装」）
  if (source.includes('function installFormationSlots(')) throw Error('Formation slot patch already installed');
  // 锚点：宠物方法在 v305 主包里唯一，且它的存在意味着 0042/0056 的结构没变
  if (!source.includes('getPetBaseValue=function'))
    throw Error('formation slot patch mismatch: getPetBaseValue=function');
  return source + '\n;(' + installFormationSlots.toString() + ')(window.__worldReq,window);\n';
}
