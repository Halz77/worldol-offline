import fs from 'node:fs';

/**
 * 阵法阵位差异化加成（第 94 版，2026-10-25）。
 *
 * 原版限制（analysis/modules/0057.js fromByteFormationSkill + 0056.js getPowerValue）：
 *   每个阵只有 power1-3/value1-3 三组加成，且 formationSkill 是**全队共用的一个对象**
 *   （0018.js 的 DATA_FORMATION 处理里主人与宠物指向同一实例）⇒ 所有人吃一样的加成。
 *
 * 本模块只做「读配置 + 归一化」，真正的注入在客户端补丁
 * lib/client-formation-slot-patch.mjs：把 this.formationSkill 临时换成按阵位查表的
 * 适配器，原版属性公式一行不改。
 *
 * ⚠ 不能用 fs.existsSync 门控（第 57 版踩坑，详见 local-skill-overrides.mjs 顶部注释）。
 */
export const FORMATION_SLOT_REVISION = 'formation-slots-20261025-v1';
export const MAX_SLOTS = 5;

const FILE = new URL('../data/local-formation-slots.json', import.meta.url);

function normalizePowers(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const power = Number(row[0]);
    const value = Number(row[1]);
    if (!Number.isInteger(power) || power <= 0) continue;
    if (!Number.isFinite(value) || value === 0) continue;
    out.push([power, Math.round(value)]);
  }
  return out;
}

/** 归一化一个槽位：{powers:[[id,v],...]}，空槽返回 {powers:[]}。 */
function normalizeSlot(raw) {
  if (!raw || typeof raw !== 'object') return { powers: [] };
  return { powers: normalizePowers(raw.powers) };
}

function normalizeForm(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const slots = [];
  const input = Array.isArray(raw.slots) ? raw.slots : [];
  for (let i = 0; i < MAX_SLOTS; i++) slots.push(normalizeSlot(input[i]));
  const pet = normalizeSlot(raw.pet);
  const anySlot = slots.some(s => s.powers.length) || pet.powers.length > 0;
  if (!anySlot) return null;                       // 全空 = 没配，等同不存在（不占内存也不生效）
  const mode = raw.mode === 'replace' ? 'replace' : 'add';
  return { mode, slots, pet };
}

let cache;
function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return { revision: null, mode: 'add', forms: {} };
    return { revision: null, mode: 'add', forms: {}, error: String(error && error.message || error) };
  }
  const globalMode = raw && raw.mode === 'replace' ? 'replace' : 'add';
  const forms = {};
  const src = raw && raw.forms && typeof raw.forms === 'object' ? raw.forms : {};
  for (const [key, value] of Object.entries(src)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0) continue;
    const form = normalizeForm(value);
    if (form) forms[id] = { ...form, mode: value.mode === undefined ? globalMode : form.mode };
  }
  return { revision: (raw && raw.revision) || FORMATION_SLOT_REVISION, mode: globalMode, forms };
}
function data() { return cache ??= load(); }

/** 归一化后的配置（服务端/测试用）。 */
export function formationSlotConfig() {
  const d = data();
  return { revision: d.revision || FORMATION_SLOT_REVISION, mode: d.mode, forms: d.forms, error: d.error || null };
}

/** 下发给客户端的全局变量体（电脑版 /formation-slots.js 与 APK globals 共用）。 */
export function formationSlotGlobals() {
  const d = data();
  return { revision: d.revision || FORMATION_SLOT_REVISION, mode: d.mode, forms: d.forms };
}

/** 供 /api/status 展示。 */
export function formationSlotSummary() {
  const d = data();
  return {
    revision: d.revision || FORMATION_SLOT_REVISION,
    configured: Object.keys(d.forms).length,
    mode: d.mode,
    error: d.error || null
  };
}

/**
 * 取某个阵型某个阵位的加成表（服务端/单测用；客户端走补丁自己的实现）。
 * @param {number} formId 阵型 id
 * @param {number} slotIndex 1-based 阵位序号
 * @param {boolean} isPet 是否宠物（true 时用 pet 段）
 * @returns {{mode:string,powers:Array<[number,number]>}|null}
 */
export function formationSlotBonus(formId, slotIndex, isPet) {
  const form = data().forms[formId];
  if (!form) return null;
  if (isPet) return { mode: form.mode, powers: form.pet.powers };
  const slot = form.slots[Math.min(Math.max(1, slotIndex), MAX_SLOTS) - 1];
  return slot ? { mode: form.mode, powers: slot.powers } : null;
}

/** 测试/热重载用。 */
export function resetFormationSlots() { cache = undefined; }
