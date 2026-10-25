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
export const formationSlotPatchRevision = 'formation-slot-patch-20261025-v1';

/** 安装阵位加成层。req = window.__worldReq，host = window。 */
export function installFormationSlots(req, host) {
  host = host || globalThis;
  if (host.__worldolFormationSlotPatch) return host.__worldolFormationSlotPatch;
  const MAX_POS = 34, LEFT_MAX_POS = 20;     // analysis/modules/0061.js
  const counters = { rolePatches: 0, petPatches: 0, adapters: 0, fallbacks: 0 };
  const hooked = { role: false, petBase: false, petPower: false };
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
   * 阵位**只由玩家角色（3）排**：任务里塞进队伍的 NPC(1)、佣兵(5)、伙伴(11)、军团(10)
   * 都不占角色阵位，否则会把我方角色的名次整体后移、加成错位。
   * 取不到类型时按「非宠物即角色」处理（真包 vo.getType() 一定存在，见 0241.js）。
   */
  function unitType(u) {
    try {
      const vo = u && (u.vo || u);
      return vo && typeof vo.getType === 'function' ? vo.getType() : null;
    } catch (_) { return null; }
  }
  const PLAYER_TYPE = 3;

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
      if (type !== null && type !== PLAYER_TYPE) continue;      // NPC/佣兵/伙伴/军团 都不占位
      list.push(p);
    }
    if (!list.length) return 1;
    list.sort(function (a, b) { return a - b; });
    const i = list.indexOf(pos);
    return i < 0 ? 0 : i + 1;                                   // 自己不在名单里 ⇒ 0（不参与，走原生）
  }

  // ── 找原型 ────────────────────────────────────────────────
  // 角色：getPowerValue 是 8 参方法，且同类有 getSkillPowerValue（0056 PlayerVO）
  function findRoleProto() {
    const cache = req.c; if (!cache) return null;
    for (const key in cache) {
      let mod; try { mod = cache[key]; } catch (_) { continue; }
      const proto = (mod && mod.prototype) || (mod && mod.default && (mod.default.prototype || mod.default)) || null;
      if (!proto) continue;
      if (typeof proto.getPowerValue === 'function' && proto.getPowerValue.length >= 8
        && typeof proto.getSkillPowerValue === 'function') return proto;
    }
    return null;
  }
  // 宠物：有 getPetBaseValue + getPetPowerValue（0042 PetVO）
  function findPetProto() {
    const cache = req.c; if (!cache) return null;
    for (const key in cache) {
      let mod; try { mod = cache[key]; } catch (_) { continue; }
      const proto = (mod && mod.prototype) || (mod && mod.default && (mod.default.prototype || mod.default)) || null;
      if (!proto) continue;
      if (typeof proto.getPetBaseValue === 'function' && typeof proto.getPetPowerValue === 'function') return proto;
    }
    return null;
  }

  function hookRole() {
    if (hooked.role) return true;
    const proto = findRoleProto();
    if (!proto) return false;
    if (Object.prototype.hasOwnProperty.call(proto, '__worldolFormationSlot')) { hooked.role = true; return true; }
    const original = proto.getPowerValue;
    proto.getPowerValue = function () {
      const real = this && this.formationSkill;
      if (!real) { counters.fallbacks++; return original.apply(this, arguments); }
      const adapter = makeAdapter(real, real.id, slotIndexOf(this), false);
      if (!adapter) { counters.fallbacks++; return original.apply(this, arguments); }
      this.formationSkill = adapter;
      counters.rolePatches++;
      try { return original.apply(this, arguments); }
      finally { this.formationSkill = real; }                  // 立刻还原（同步调用，安全）
    };
    proto.__worldolFormationSlot = true;
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

  function hookPet() {
    if (hooked.petBase && hooked.petPower) return true;
    const proto = findPetProto();
    if (!proto) return false;
    if (!Object.prototype.hasOwnProperty.call(proto, '__worldolFormationSlotPet')) {
      hooked.petBase = wrapPetMethod(proto, 'getPetBaseValue');
      hooked.petPower = wrapPetMethod(proto, 'getPetPowerValue');
      proto.__worldolFormationSlotPet = true;
    } else {
      hooked.petBase = hooked.petPower = true;
    }
    return hooked.petBase || hooked.petPower;
  }

  function attach() {
    const role = hookRole();
    const pet = hookPet();
    return role && pet;
  }

  if (!attach()) timer = setInterval(function () { if (attach()) { clearInterval(timer); timer = null; } }, 800);

  const api = {
    revision: 'formation-slot-patch-20261025-v1',
    get status() {
      return {
        roleHooked: hooked.role, petHooked: hooked.petBase || hooked.petPower,
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
