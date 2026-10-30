import {Writer, Reader} from './codec.mjs';

/**
 * 怪物 AI（MonsterAI）记录的字节编解码（第 95 版）。
 *
 * 为什么需要：战斗包里的 AI 是**原样转发的抓包字节**（official-packets 的 rawRecord），
 * 所以想改「怪物会放什么技能」就必须能把 AI 记录重新编出来。
 *
 * 格式（与客户端 MonsterAI.fromBytes 一致，analysis/modules/0178.js:22）：
 *   short id
 *   byte  轮数 N
 *   每轮：
 *     byte   conType
 *     int    conValue
 *     string msg            ← 3 字节长度 + UTF-16（codec 的 Writer.string）
 *     short  skill1.id
 *     byte   skill1.level
 *     short  skill2.id
 *     byte   skill2.level
 *     byte   targetType
 */
export const AI_MAX_ROUNDS = 8;

/** 一轮的空模板（编辑器/默认值用）。 */
export function emptyAiRound() {
  return {conType: 0, conValue: 0, msg: '', skill1: {id: 0, level: 0}, skill2: {id: 0, level: 0}, targetType: 0};
}

function skillOf(v) {
  if (!v || typeof v !== 'object') return {id: 0, level: 0};
  return {
    id: Math.max(0, Math.min(65535, Math.trunc(Number(v.id) || 0))),
    level: Math.max(0, Math.min(255, Math.trunc(Number(v.level) || 0)))
  };
}

/** 把 JSON 形态的 AI（conType[]/conValue[]/…/targetType[] 或 rounds[]）统一成 rounds[]。 */
export function aiRounds(ai) {
  if (!ai) return [];
  if (Array.isArray(ai.rounds)) {
    return ai.rounds.map(r => ({
      conType: Math.trunc(Number(r && r.conType) || 0),
      conValue: Math.trunc(Number(r && r.conValue) || 0),
      msg: r && r.msg != null ? String(r.msg) : '',
      skill1: skillOf(r && r.skill1),
      skill2: skillOf(r && r.skill2),
      targetType: Math.trunc(Number(r && r.targetType) || 0)
    }));
  }
  const n = Array.isArray(ai.conType) ? ai.conType.length
    : Array.isArray(ai.skill1) ? ai.skill1.length
      : Array.isArray(ai.targetType) ? ai.targetType.length : 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      conType: Math.trunc(Number(ai.conType?.[i]) || 0),
      conValue: Math.trunc(Number(ai.conValue?.[i]) || 0),
      msg: ai.msg?.[i] != null ? String(ai.msg[i]) : '',
      skill1: skillOf(ai.skill1?.[i]),
      skill2: skillOf(ai.skill2?.[i]),
      targetType: Math.trunc(Number(ai.targetType?.[i]) || 0)
    });
  }
  return out;
}

/** rounds[] → 客户端读的那种并列数组形态（保持 JSON/调试可读）。 */
export function aiArrays(rounds) {
  const list = Array.isArray(rounds) ? rounds : [];
  return {
    conType: list.map(r => r.conType | 0),
    conValue: list.map(r => r.conValue | 0),
    msg: list.map(r => String(r.msg ?? '')),
    skill1: list.map(r => skillOf(r.skill1)),
    skill2: list.map(r => skillOf(r.skill2)),
    targetType: list.map(r => r.targetType | 0)
  };
}

/** 编码一条 AI 记录（含 id）。 */
export function aiWireBytes(ai) {
  const rounds = aiRounds(ai);
  if (rounds.length > AI_MAX_ROUNDS) throw Error(`AI 轮数 ${rounds.length} 超过上限 ${AI_MAX_ROUNDS}`);
  const w = new Writer().short(Number(ai && ai.id) || 0).byte(rounds.length);
  for (const r of rounds) {
    const s1 = skillOf(r.skill1), s2 = skillOf(r.skill2);
    w.byte(r.conType & 255).int(r.conValue | 0).string(String(r.msg ?? ''));
    w.short(s1.id).byte(s1.level);
    w.short(s2.id).byte(s2.level);
    w.byte(r.targetType & 255);
  }
  return w.done();
}

/** 解码一条 AI 记录（返回 {id, rounds}，读不了就返回 null）。 */
export function aiFromWire(buf) {
  try {
    const r = new Reader(buf);
    const id = r.short();
    const count = r.byte();
    const rounds = [];
    for (let i = 0; i < count; i++) {
      const conType = r.byte();
      const conValue = r.int();
      const msg = r.string();
      const s1 = {id: r.short(), level: r.byte()};
      const s2 = {id: r.short(), level: r.byte()};
      rounds.push({conType, conValue, msg, skill1: s1, skill2: s2, targetType: r.byte()});
    }
    return {id, rounds};
  } catch (_) {
    return null;
  }
}

/** 这条 AI 引用到的技能键（"id:level"），用于校验技能定义是否存在。 */
export function aiSkillKeys(ai) {
  const keys = new Set();
  for (const r of aiRounds(ai)) {
    for (const s of [r.skill1, r.skill2]) {
      if (s && s.id > 0 && s.level > 0) keys.add(`${s.id}:${s.level}`);
    }
  }
  return keys;
}
