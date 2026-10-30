import fs from 'node:fs';
import {aiWireBytes, aiRounds, aiSkillKeys, AI_MAX_ROUNDS} from './ai-wire.mjs';

/**
 * 怪物 AI / 技能覆盖（第 95 版）。
 *
 * 做什么：让「这只怪会放什么技能」可以配。怪物在战斗里放技能由 AI 记录决定：
 *   official-packets.mapBattleData() 把 ai 行（rawRecord 原样字节）连同它引用到的技能定义
 *   一起塞进 10503 战斗包 → 客户端 MonsterAI.fromBytes 读 skill1/skill2/targetType。
 * 所以改技能 = 改 AI 行 + 把 wireBase64 重新编码（lib/ai-wire.mjs）。
 *
 * 配置位置：与属性覆盖同一个文件 data/local-monster-overrides.json 的 "ai" 段，
 *   { "ai": { "<怪物id>": { "rounds": [ { skill1:{id,level}, skill2:{id,level}, targetType, conType, conValue, msg } ] } } }
 *   · rounds 不写 msg 时，按序号沿用原 AI 的台词（老怪改技能不会把话说没了）。
 *   · 技能必须同时存在 `id:level` 的定义，否则战斗包里不会发这条技能 ⇒ 该格自动清零并记账。
 *
 * 套用时机：official-data.ensure() 里 applyMonsterOverrides 之后、return built 之前
 * （任何战斗打包/任何 mapBattleData 缓存之前；缓存一旦建好就不会再变了）。
 *
 * ⚠ 不用 fs.existsSync 门控（第 57 版踩坑，见 local-skill-overrides.mjs 顶部）。
 */
export const MONSTER_AI_OVERRIDE_REVISION = 'monster-ai-overrides-20261030-v1';

const FILE = new URL('../data/local-monster-overrides.json', import.meta.url);

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

/** 一条 round 的宽松清洗（id/level 超范围就截断，不抛错；配错不该让服务端起不来）。 */
function cleanRound(value, index, fallback) {
  const r = value && typeof value === 'object' ? value : {};
  const pick = (skill) => ({
    id: clampInt(skill && skill.id, 0, 65535, 0),
    level: clampInt(skill && skill.level, 0, 255, 0)
  });
  if (!r.skill1 && !r.skill2 && r.targetType == null && r.conType == null && r.msg == null) return null;
  return {
    conType: clampInt(r.conType, 0, 255, fallback ? fallback.conType : 0),
    conValue: clampInt(r.conValue, -2147483648, 2147483647, fallback ? fallback.conValue : 0),
    msg: r.msg != null ? String(r.msg) : (fallback ? fallback.msg : ''),
    skill1: pick(r.skill1),
    skill2: pick(r.skill2),
    targetType: clampInt(r.targetType, 0, 255, fallback ? fallback.targetType : 0),
    index
  };
}

let cache;
function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return {revision: null, ai: {}};
    return {revision: null, ai: {}, error: String(error && error.message || error)};
  }
  const out = {};
  const src = raw && raw.ai && typeof raw.ai === 'object' ? raw.ai : {};
  for (const [key, patch] of Object.entries(src)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0) continue;
    const rounds = Array.isArray(patch && patch.rounds) ? patch.rounds : [];
    const cleaned = rounds.slice(0, AI_MAX_ROUNDS)
      .map((r, i) => cleanRound(r, i, null))
      .filter(Boolean);
    if (cleaned.length) out[id] = {rounds: cleaned};
  }
  return {revision: (raw && raw.revision) || MONSTER_AI_OVERRIDE_REVISION, ai: out};
}
function data() { return cache ??= load(); }

/** { 怪物id: {rounds:[...]} }（已清洗）。 */
export function monsterAiOverrides() { return { ...data().ai }; }

export function monsterAiOverrideSummary() {
  const d = data();
  return {revision: d.revision || MONSTER_AI_OVERRIDE_REVISION, configured: Object.keys(d.ai).length, error: d.error || null};
}

/**
 * 把 AI 覆盖套到 official.ai 上（原地替换条目 / 必要时新增条目）。
 * @param {object} official official-data 的大对象（读 official.ai 与 official.skills）
 * @param {object} [overrides] 仅供单测注入
 * @returns {{applied:{id:number,rounds:number}[], warnings:string[]}}
 */
export function applyMonsterAiOverrides(official, overrides) {
  const applied = [];
  const warnings = [];
  if (!official || !Array.isArray(official.ai)) return {applied, warnings};
  const skills = Array.isArray(official.skills) ? official.skills : [];
  const skillSet = new Set();
  for (const s of skills) if (s && s.id != null) skillSet.add(`${s.id}:${s.level}`);
  const index = new Map();
  for (const row of official.ai) index.set(Number(row.id), row);

  for (const [key, cfg] of Object.entries(overrides || data().ai)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0) continue;
    // AI 记录的 id 在线上是 short（客户端 MonsterAI.fromBytes 用 getShort 读）⇒ 超过 65535 写进去也是错的
    if (id > 65535) { warnings.push(`怪物 ${id}：id 超出 short 范围，跳过`); continue; }
    const existing = index.get(id) || null;
    const baseRounds = aiRounds(existing);
    const wanted = Array.isArray(cfg && cfg.rounds) ? cfg.rounds : [];
    if (!wanted.length) continue;
    const rounds = wanted.slice(0, AI_MAX_ROUNDS).map((r, i) => {
      const fallback = baseRounds[i] || baseRounds[0] || null;
      const cleaned = cleanRound(r, i, fallback);
      return cleaned || {
        conType: fallback ? fallback.conType : 0,
        conValue: fallback ? fallback.conValue : 0,
        msg: fallback ? fallback.msg : '',
        skill1: {id: 0, level: 0},
        skill2: {id: 0, level: 0},
        targetType: fallback ? fallback.targetType : 0
      };
    });
    // 技能定义必须存在（客户端 getSkillById 按 id+level 精确查；查不到这只怪就傻站着）
    for (const r of rounds) {
      for (const slot of [r.skill1, r.skill2]) {
        if (!slot || slot.id <= 0) continue;
        if (slot.level <= 0) { warnings.push(`怪物 ${id}：技能 ${slot.id} 没填等级，已清零`); slot.id = 0; continue; }
        if (!skillSet.has(`${slot.id}:${slot.level}`)) {
          warnings.push(`怪物 ${id}：技能 ${slot.id}:${slot.level} 没有定义，已清零`);
          slot.id = 0;
          slot.level = 0;
        }
      }
    }
    const next = {id, rounds};
    const arrays = {
      conType: rounds.map(r => r.conType | 0),
      conValue: rounds.map(r => r.conValue | 0),
      msg: rounds.map(r => String(r.msg ?? '')),
      skill1: rounds.map(r => ({id: r.skill1.id, level: r.skill1.level, definitionFound: true})),
      skill2: rounds.map(r => ({id: r.skill2.id, level: r.skill2.level, definitionFound: true})),
      targetType: rounds.map(r => r.targetType | 0)
    };
    try {
      const wireBase64 = aiWireBytes(next).toString('base64');
      if (existing) {
        // 留一份原始字节：编辑器重新生成内嵌数据时要用「原版」而不是「已被覆盖过」的 AI
        if (!existing.__originalWire) existing.__originalWire = existing.wireBase64;
        Object.assign(existing, arrays, {wireBase64});
      } else {
        // 这只怪原来没有 AI 行 ⇒ 补一条（mapBattleData 按怪物 id 过滤 ai，补上就会被发出去）
        const row = {id, ...arrays, wireBase64, sources: [{origin: 'local-override'}]};
        official.ai.push(row);
        index.set(id, row);
      }
      applied.push({id, rounds: rounds.length});
    } catch (error) {
      warnings.push(`怪物 ${id}：AI 重编码失败（${String(error && error.message || error)}），已跳过`);
    }
  }
  return {applied, warnings};
}

/** 测试/热重载用。 */
export function resetMonsterAiOverrides() { cache = undefined; }
