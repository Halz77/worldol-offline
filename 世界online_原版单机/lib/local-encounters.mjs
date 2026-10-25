import fs from 'node:fs';
import {battleGroupWire} from './dungeon-challenge-data.mjs';

/**
 * 自定义怪物编队（第 96 版，2026-10-25）。
 *
 * 目的：自己设计 10 格编队（用已有怪物），并让它**能真的打**。
 *
 * 落地方式（为什么不新造任务）：原版挑战都是「任务 → acceptBattleID → 编队」，
 * 新造任务要同时动 missions/groups/NPC 菜单三处（boss-hub 那种改法）。这里采用
 * **替换**：把某条已有挑战任务（如 9101）的 acceptBattleID 改指你的编队 ——
 * 入口不动（照旧从 boss 直达 / 征战广场接任务），打的就是你的编队。
 *
 * 编队字节用现成的 battleGroupWire（lib/dungeon-challenge-data.mjs）：
 *   short(组) byte(类型) short(下一组) byte(flag) int(系数) + 10×short(怪物) + [flag&2 时 4×short(NPC)]
 * 战斗包 officialMonsterGroups 原样发这份 wire。
 *
 * groupId 段：30100—30199（避开原版、守卫挑战 12100+、试炼等已用号段）。
 *
 * ⚠ 不用 fs.existsSync 门控（第 57 版踩坑，见 local-skill-overrides.mjs 顶部）。
 */
export const LOCAL_ENCOUNTER_REVISION = 'local-encounters-20261025-v1';
export const LOCAL_GROUP_MIN = 30100;
export const LOCAL_GROUP_MAX = 30199;

const FILE = new URL('../data/local-encounters.json', import.meta.url);

function normalizeMonsters(list) {
  const out = new Array(10).fill(0);
  if (Array.isArray(list)) {
    for (let i = 0; i < 10 && i < list.length; i++) {
      const id = Number(list[i]);
      out[i] = Number.isInteger(id) && id > 0 ? id : 0;
    }
  }
  return out;
}
function normalizeNpcs(list) {
  const out = [0, 0, 0, 0];
  if (Array.isArray(list)) for (let i = 0; i < 4 && i < list.length; i++) {
    const id = Number(list[i]);
    out[i] = Number.isInteger(id) && id > 0 ? id : 0;
  }
  return out;
}

let cache;
function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return { revision: null, encounters: [] };
    return { revision: null, encounters: [], error: String(error && error.message || error) };
  }
  const encounters = [];
  const src = raw && Array.isArray(raw.encounters) ? raw.encounters : [];
  const used = new Set();
  for (const item of src) {
    if (!item || typeof item !== 'object') continue;
    let groupId = Number(item.groupId);
    if (!Number.isInteger(groupId) || groupId < LOCAL_GROUP_MIN || groupId > LOCAL_GROUP_MAX || used.has(groupId)) {
      // 没填或越界：自动分配一个空闲号
      groupId = LOCAL_GROUP_MIN;
      while (used.has(groupId) && groupId <= LOCAL_GROUP_MAX) groupId++;
      if (groupId > LOCAL_GROUP_MAX) continue;
    }
    const monsters = normalizeMonsters(item.monsters);
    if (!monsters.some(id => id > 0)) continue;               // 空编队不注册
    used.add(groupId);
    const flag = Number.isInteger(Number(item.flag)) ? Math.max(0, Math.min(255, Number(item.flag))) : 0;
    const coefficient = Number.isFinite(Number(item.coefficient)) ? Math.max(0, Math.min(9999, Math.round(Number(item.coefficient)))) : 0;
    const replaceMission = Number(item.replaceMission);
    encounters.push({
      name: String(item.name || ('自定义编队 ' + groupId)).slice(0, 20),
      groupId,
      monsters,
      npcs: normalizeNpcs(item.npcs),
      flag,
      coefficient,
      replaceMission: Number.isInteger(replaceMission) && replaceMission > 0 ? replaceMission : null
    });
  }
  return { revision: (raw && raw.revision) || LOCAL_ENCOUNTER_REVISION, encounters };
}
function data() { return cache ??= load(); }

export function localEncounters() { return data().encounters.map(e => ({ ...e, monsters: [...e.monsters], npcs: [...e.npcs] })); }

export function localEncounterSummary() {
  const d = data();
  return {
    revision: d.revision || LOCAL_ENCOUNTER_REVISION,
    count: d.encounters.length,
    replacing: d.encounters.filter(e => e.replaceMission).map(e => e.replaceMission),
    error: d.error || null
  };
}

/**
 * 把自定义编队注册进 official（在 official-data.ensure() 建 Map 之前调用）。
 *   · official.groups 里加一条（含 wireBase64）
 *   · replaceMission 指向的任务：acceptBattleID 改成该编队
 * @param {object} official ensure() 里的 official 对象
 * @param {Array} [encounters] 仅供单测注入；生产不传（从 data/local-encounters.json 读）
 * @returns {{registered:number[],replaced:{mission:number,groupId:number}[],failed:{name:string,reason:string}[]}}
 */
export function applyLocalEncounters(official, encounters) {
  const registered = [], replaced = [], failed = [];
  if (!official || !Array.isArray(official.groups) || !Array.isArray(official.missions)) return { registered, replaced, failed };
  const known = new Set(official.groups.map(g => g.groupId));
  for (const e of encounters || data().encounters) {
    try {
      if (known.has(e.groupId)) throw Error('编队号 ' + e.groupId + ' 已被占用');
      official.groups.push({
        groupId: e.groupId,
        monsters: [...e.monsters],
        npcs: [...e.npcs],
        type: 0,
        nextBattleGroupID: 0,
        flag: e.flag,
        coefficient: e.coefficient,
        wireBase64: battleGroupWire(e.groupId, e.monsters, e.npcs, e.flag, e.coefficient),
        sources: [{ origin: 'local-encounter', name: e.name }]
      });
      known.add(e.groupId);
      registered.push(e.groupId);
      if (e.replaceMission) {
        const mission = official.missions.find(q => q.id === e.replaceMission);
        if (!mission) { failed.push({ name: e.name, reason: '任务 ' + e.replaceMission + ' 不存在' }); continue; }
        mission.acceptBattleID = e.groupId;
        replaced.push({ mission: e.replaceMission, groupId: e.groupId });
      }
    } catch (error) {
      failed.push({ name: e.name, reason: String(error && error.message || error) });
    }
  }
  return { registered, replaced, failed };
}

/** 测试/热重载用。 */
export function resetLocalEncounters() { cache = undefined; }
