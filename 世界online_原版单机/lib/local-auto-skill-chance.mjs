import fs from 'node:fs';

/**
 * 自动技能触发概率（第 93 版）。
 *
 * 为什么单独一个文件、不进 local-skill-overrides.json：
 *   概率不是技能字节里的字段（skillBytes 定长结构没有它），覆盖层的
 *   OVERRIDABLE_FIELDS 白名单也会拒绝越界键。它是「本地玩法配置」，
 *   只被客户端补丁 client-auto-skill-chance-patch.mjs 消费。
 *
 * 下发路径：
 *   电脑版  lib/http-routes.mjs 的 /skill-auto-chance.js → window.worldolAutoSkillChance
 *   APK     安卓打包/standalone/globals.mjs → entry.mjs 的 installGeneratedGlobals
 *
 * ⚠ 不能用 fs.existsSync 做门控（第 57 版踩过：APK 里 fs 是 VFS shim，existsSync
 *   只查预载表，data/ 是运行时按需取的，恒为 false ⇒ 配置静默失效）。
 */
export const AUTO_SKILL_CHANCE_REVISION = 'auto-skill-chance-20261025-v1';

const FILE = new URL('../data/local-auto-skill-chance.json', import.meta.url);

function normalizePercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return 0;
  if (n >= 100) return 100;
  return Math.round(n);
}

let cache;
function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return { revision: null, chance: {} };
    // 坏档不阻断启动：当成「没有配置」，游戏行为退化为原版
    return { revision: null, chance: {}, error: String(error && error.message || error) };
  }
  const table = {};
  const src = raw && typeof raw === 'object' && raw.chance && typeof raw.chance === 'object' ? raw.chance : {};
  for (const [key, value] of Object.entries(src)) {
    const id = Number(key);
    const pct = normalizePercent(value);
    if (!Number.isInteger(id) || id <= 0 || pct === null) continue;
    table[id] = pct;
  }
  return { revision: (raw && raw.revision) || AUTO_SKILL_CHANCE_REVISION, chance: table };
}
function data() { return cache ??= load(); }

/** { 技能id: 百分比 }；100 与未配置等价，但保留条目便于编辑器回显。 */
export function autoSkillChanceTable() { return { ...data().chance }; }

/** 生成给客户端的全局变量体（/skill-auto-chance.js 与 APK globals 共用同一份）。 */
export function autoSkillChanceGlobals() {
  return { revision: data().revision || AUTO_SKILL_CHANCE_REVISION, chance: { ...data().chance } };
}

/** 供 /api/status 展示。 */
export function autoSkillChanceSummary() {
  const d = data();
  return { revision: d.revision || AUTO_SKILL_CHANCE_REVISION, configured: Object.keys(d.chance).length, error: d.error || null };
}

/** 测试/热重载用：清缓存后下次读盘。 */
export function resetAutoSkillChance() { cache = undefined; }

// ---------------------------------------------------------------------------
// 把概率写进技能说明（info），让玩家在游戏里能看见
// ---------------------------------------------------------------------------

/** 说明行标记（旧版用它做幂等判断；新版改用正则，常量保留给兼容检测）。 */
export const INFO_MARK = '【自动释放】';
/** 说明行的识别正则：新旧写法都能匹配，替换时整行摘掉。 */
export const INFO_LINE_RE = /每回合\s*\d+%\s*概率触发|【自动释放】.*$/;

/**
 * 读 infoMode 配置（导出给 restoration 用：装备技能/导入技能要靠它判断要不要补说明）：
 *   'changed'（默认）—— 只给配了 <100% 的技能追加说明
 *   'all'          —— 所有自动技能都追加，未配置的显示 100%
 */
export function autoSkillInfoMode() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { return 'changed'; }
  const mode = raw && typeof raw === 'object' ? raw.infoMode : null;
  return mode === 'all' ? 'all' : 'changed';
}

/** 生成说明行：统一成「每回合 X% 概率触发」（100% 也写数字）。 */
export function chanceInfoLine(pct) {
  const n = pct >= 100 ? 100 : (pct <= 0 ? 0 : Math.round(pct));
  return '每回合 ' + n + '% 概率触发';
}

/**
 * 给运行时技能表里的自动技能追加/更新概率说明，并重算 wireBase64
 * （客户端技能面板的帮助气泡读的就是 wire 里的 info）。
 *
 * 原地替换 skills Map 里对应技能的 levels 数组元素（浅拷贝），**不改上游 careerSkills**。
 * 幂等：同一技能重复调用不会重复追加（已有标记的行会被替换成最新数值）。
 * @param {Map} skills 运行时技能表（restoration.mjs 的 skills）
 * @param {(skill:object)=>{toString:()=>string}} skillBytes 编码器（character-import-codec 的 skillBytes）
 * @param {{table?:object,mode?:'changed'|'all'}} [options] 仅供单测注入；生产不传
 * @returns {{id:number,pct:number}[]} 实际改动的技能列表
 */
export function decorateAutoSkillChance(skills, skillBytes, options) {
  if (!skills || typeof skills.forEach !== 'function') return [];
  const table = (options && options.table) || autoSkillChanceTable();
  const mode = (options && options.mode) || autoSkillInfoMode();
  const changed = [];
  for (const skill of skills.values()) {
    if (!skill || Number(skill.type) !== 2) continue;          // 只处理自动技能
    const configured = table[skill.id];
    const pct = configured === undefined ? 100 : configured;
    if (pct >= 100 && mode !== 'all') continue;               // 默认 100% ⇒ 不加噪音
    if (!Array.isArray(skill.levels) || !skill.levels.length) continue;
    const line = chanceInfoLine(pct);
    let touched = false;
    skill.levels = skill.levels.map(level => {
      if (!level) return level;
      const base = String(level.info || '')
        .split('\n')
        .filter(l => !INFO_LINE_RE.test(l))                    // 幂等：先摘掉旧的概率行（新旧写法都认）
        .join('\n')
        .trimEnd();
      const info = base ? base + '\n' + line : line;
      if (info === level.info) return level;
      touched = true;
      const next = { ...level, info };
      if (next.wireBase64 !== undefined) next.wireBase64 = skillBytes(next).toString('base64');
      if (next.monsterWireBase64 !== undefined) next.monsterWireBase64 = skillBytes(next).toString('base64');
      return next;
    });
    if (touched) changed.push({ id: skill.id, pct });
  }
  return changed;
}

/**
 * 把概率说明补到一份技能定义上 —— 用于**绕过运行时技能表**的两种情况：
 *   · 装备自带的技能（activeSkills 用 item.skill，等级是装备加成出来的，表里可能没有该级）
 *   · 存档导入的技能定义（learned 的 importedSkillDefinitions 分支）
 * 概率本来就按**技能 id** 配置（与等级无关），所以不需要查等级。
 * @param {object} def 技能定义（含 info / wireBase64）
 * @param {number} skillId 技能 id
 * @param {(skill:object)=>{toString:()=>string}} skillBytes 编码器（character-import-codec 的 skillBytes）
 * @param {number} [typeHint] def 上没有 type 时用它判断是不是自动技能
 */
export function withChanceInfo(def, skillId, skillBytes, typeHint) {
  if (!def) return def;
  const type = def.type !== undefined ? Number(def.type) : Number(typeHint);
  if (type !== 2) return def;                                 // 只处理自动技能
  const table = autoSkillChanceTable();
  const pct = table[skillId] === undefined ? 100 : table[skillId];
  if (pct >= 100 && autoSkillInfoMode() !== 'all') return def;
  const line = chanceInfoLine(pct);
  const base = String(def.info || '').split('\n').filter(l => !INFO_LINE_RE.test(l)).join('\n').trimEnd();
  const info = base ? base + '\n' + line : line;
  if (info === def.info) return def;
  const next = { ...def, info };
  if (next.wireBase64 !== undefined) next.wireBase64 = skillBytes(next).toString('base64');
  if (next.monsterWireBase64 !== undefined) next.monsterWireBase64 = skillBytes(next).toString('base64');
  return next;
}
