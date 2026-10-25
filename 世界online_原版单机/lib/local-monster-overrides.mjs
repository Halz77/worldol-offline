import fs from 'node:fs';
import {monsterWireBytes} from './monster-balance.mjs';

/**
 * 怪物属性覆盖（第 94 版，2026-10-25）。
 *
 * 为什么能改：战斗包里的怪物不是原样转发抓包字节，而是
 *   lib/official-packets.mjs officialMonsterModels → balancedMonsterPacket(m)
 *     ├ 有 monsterBalance 配置的怪 → monsterWireBytes(balancedMonster(m))（逐字段现编）
 *     └ 其它怪 → 原样发 m.wireBase64
 * 所以覆盖层要**同时改字段和 wireBase64**（用 monsterWireBytes 重编码），
 * 两条路径都能拿到新数据。
 *
 * 套用时机：official-data.ensure() 建好 officialMonsters 之后、任何索引/打包之前
 * （AGENTS.md 的时序铁律；提前改会被 captured81 的冲突检查拦下）。
 *
 * ⚠ 不用 fs.existsSync 门控（第 57 版踩坑，见 local-skill-overrides.mjs 顶部）。
 */
export const MONSTER_OVERRIDE_REVISION = 'monster-overrides-20261025-v1';

const FILE = new URL('../data/local-monster-overrides.json', import.meta.url);

/** 可写字段 → 值域（byte/short/int/long 的上限与 monsterWireBytes 的 Writer 方法一致）。 */
export const MONSTER_FIELD_TYPES = {
  name: 'string', icon1: 'long', level: 'byte', monstertype: 'byte',
  hpMax: 'int', mpMax: 'int', speed: 'int',
  atkType: 'byte', atkMin: 'int', atkMax: 'int', atk_time: 'byte',
  dodge: 'int', atk_str: 'int', atk_str_nearby: 'int', atk_str_range: 'int',
  atk_agi: 'int', atk_agi_nearby: 'int', atk_agi_range: 'int',
  atk_magic: 'int',
  def_str: 'int', def_str_nearby: 'int', def_str_range: 'int',
  def_agi: 'int', def_agi_nearby: 'int', def_agi_range: 'int',
  def_magic: 'int',
  hitrate: 'int', hitMagic: 'int', critical: 'short',
  ignoreCritical: 'int', criticalDmg: 'int', ignore_back: 'int', ignore_magic_back: 'int',
  ignore_block: 'int', ignore_insight: 'int', ignore_touch: 'int', ignore_wil: 'int',
  wil: 'int', tough: 'int', block: 'int', brkArmor: 'int', insight: 'int',
  def_field: 'int', back: 'int', magic_back: 'int',
  life_absorption: 'int', mana_absorption: 'int', magic_penetration: 'int',
  bornStatus: 'long', newReflection: 'int'
};
const LIMITS = { byte: 127, short: 32767, int: 2147483647, long: Number.MAX_SAFE_INTEGER };

function checkValue(key, value) {
  const type = MONSTER_FIELD_TYPES[key];
  if (!type) return { ok: false, reason: '不允许改这个字段：' + key };
  if (type === 'string') {
    const text = String(value).slice(0, 40);
    return text ? { ok: true, value: text } : { ok: false, reason: key + ' 不能为空' };
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return { ok: false, reason: key + ' 不是数字：' + value };
  if (!Number.isSafeInteger(n)) return { ok: false, reason: key + ' 必须是整数' };
  if (n < 0 || n > LIMITS[type]) return { ok: false, reason: key + ' 超出 ' + type + ' 范围（0—' + LIMITS[type] + '）' };
  return { ok: true, value: n };
}

let cache;
function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return { revision: null, monsters: {} };
    return { revision: null, monsters: {}, error: String(error && error.message || error) };
  }
  const out = {};
  const src = raw && raw.monsters && typeof raw.monsters === 'object' ? raw.monsters : {};
  for (const [key, patch] of Object.entries(src)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (!patch || typeof patch !== 'object') continue;
    const fields = {};
    for (const [field, value] of Object.entries(patch)) {
      const checked = checkValue(field, value);
      if (checked.ok) fields[field] = checked.value;
    }
    if (Object.keys(fields).length) out[id] = fields;
  }
  return { revision: (raw && raw.revision) || MONSTER_OVERRIDE_REVISION, monsters: out };
}
function data() { return cache ??= load(); }

/** { 怪物id: {字段:值} }（已按值域过滤，非法项静默丢弃并在 summary 里报数量）。 */
export function monsterOverrides() { return { ...data().monsters }; }

export function monsterOverrideSummary() {
  const d = data();
  return { revision: d.revision || MONSTER_OVERRIDE_REVISION, configured: Object.keys(d.monsters).length, error: d.error || null };
}

/**
 * 把覆盖套到 officialMonsters（Map<id, monster>）上。
 * 每个被改的怪：字段合并 + 用 monsterWireBytes 重编码 wireBase64（战斗包两条路径都能拿到新数据）。
 * 原地修改 Map（替换成新对象，不污染 official.monsters 的原始对象）。
 * @param {Map} map officialMonsters
 * @param {object} [overrides] 仅供单测注入；生产不传（从 data/local-monster-overrides.json 读）
 * @returns {{applied:number[],failed:{id:number,reason:string}[]}}
 */
export function applyMonsterOverrides(map, overrides) {
  const applied = [];
  const failed = [];
  if (!map || typeof map.set !== 'function') return { applied, failed };
  for (const [id, patch] of Object.entries(overrides || data().monsters)) {
    const monsterId = Number(id);
    const origin = map.get(monsterId);
    if (!origin) { failed.push({ id: monsterId, reason: '怪物不存在' }); continue; }
    try {
      const next = { ...origin, ...patch };
      next.wireBase64 = monsterWireBytes(next).toString('base64');
      map.set(monsterId, next);
      applied.push(monsterId);
    } catch (error) {
      failed.push({ id: monsterId, reason: String(error && error.message || error) });
    }
  }
  return { applied, failed };
}

/** 测试/热重载用。 */
export function resetMonsterOverrides() { cache = undefined; }
