// 英雄图鉴（收集系统）—— 服务端实装（第 77 版）。
//
// 原版客户端的图鉴（模块 0179 BookGroupModel / 1150 图鉴主页 / 1154 图鉴等级 /
// 1157 图鉴点亮）本来就是「服务端说哪些条目光了、每页收集率多少、加什么属性」，
// 客户端只负责画。本工程以前只回了 32102（一页一条，全部未点亮）、32103 直接提示
// 「尚未接入」—— 于是图鉴是死的，等级/收集率/加成都读不到。
//
// 这一版把整条链接上，并且加成**落在服务端**（客户端显示只是镜像）：
//   32101 C2S_HAND_BOOK_INFO   → 32102（真实 unlock/level/rate/canUnlock）
//   32103 C2S_HAND_BOOK_UNLOCK → 32104（本页全部点亮）+ 32109
//   32107 进世界时随组列表推 → 另外补推一次 32109（把存档里的旧加成喂给客户端）
//   道具「点亮所有图鉴」→ lit=true（全部分类 100%，等级拉满）
//
// 加成表与档位换算照抄参考实现「幻想世界OL 3.0 最终版」（web/offline.js 的
// getGroupBonus / rateToLevel）：收集率 100% → 70 级，宠物 7·8·9·41、坐骑 11、
// 特殊 19·24·34·37·39 各有一张表，其余（普通武器/防具）走「物攻/魔攻/武器伤害」那张。
//
// 加成是「全局能力值增量」：客户端把它加在 `getSkillPowerValue` 的前半段
// （原版 `getPower(key)` 里 RoleGodData + BookGroupModel.getBookGroupPower），
// 所以服务端落在 native-character-stats.nativePlayer 的 getSkillPowerValue 上，
// 与特征加成（featurePowers）同一层。
//
// 状态字段：p.handbook = {unlocked:{"组:类":[条目编号…]}, lit:false, powers:{"能力编号":值}}。
//   · unlocked / lit 是**唯一真源**（玩家做过什么）；
//   · powers 是派生缓存，每次状态变化 + 每次进世界都会 refreshHandbook() 重算 ——
//     换一张加成表老存档也能在下次登录后生效，而 nativePlayer 读它时不必 import 本模块
//     （native-character-stats ↔ restoration 已经是循环，再挂一手容易出事）。
import {official} from './official-data.mjs';

export const HANDBOOK_PET_TYPES = [7, 8, 9, 41];
export const HANDBOOK_MOUNT_TYPE = 11;
export const HANDBOOK_SPECIAL_TYPES = [19, 24, 34, 37, 39];
export const HANDBOOK_MAX_LEVEL = 70;

// 收集率 → 图鉴等级（0% 无加成；100% → 70 级；1%–1% 之间取最近整数，最低 1 级）
export function handbookLevel(rate) {
  if (!(rate > 0)) return 0;
  return Math.max(1, Math.round((rate / 100) * HANDBOOK_MAX_LEVEL));
}

// 八档：≥70 / ≥60 / ≥50 / ≥40 / ≥30 / ≥20 / ≥10 / 其余
function tierIndex(level) {
  return level >= 70 ? 0 : level >= 60 ? 1 : level >= 50 ? 2 : level >= 40 ? 3 : level >= 30 ? 4 : level >= 20 ? 5 : level >= 10 ? 6 : 7;
}

// 与客户端 bookList（入门1-9 … 终极70-100）一一对应，档位名只为可读性保留。
export const HANDBOOK_TIERS = [
  {lvlName: '入门', minLv: 1, maxLv: 9},
  {lvlName: '新手', minLv: 10, maxLv: 19},
  {lvlName: '熟练', minLv: 20, maxLv: 29},
  {lvlName: '达人', minLv: 30, maxLv: 39},
  {lvlName: '宗师', minLv: 40, maxLv: 49},
  {lvlName: '传奇', minLv: 50, maxLv: 59},
  {lvlName: '神话', minLv: 60, maxLv: 69},
  {lvlName: '终极', minLv: 70, maxLv: 100},
];

// 每个分类一张表：pet 是「同一个值铺满一批能力」，其余是「一项能力一个值」。
const BONUS_TABLES = {
  pet: {
    keys: [2, 4, 6, 8, 10, 89, 90, 91, 92, 93, 94, 95, 96, 232],
    values: [100, 80, 60, 50, 40, 30, 20, 10],
  },
  mount: {
    keys: [57, 173, 130],
    values: [[700, 700, 7], [600, 600, 6], [500, 500, 5], [400, 400, 4], [300, 300, 3], [200, 200, 2], [100, 100, 2], [50, 50, 1]],
  },
  special: {
    keys: [171, 169, 56],
    values: [[1000, 1000, 500], [700, 700, 350], [500, 500, 250], [400, 400, 180], [300, 300, 120], [200, 200, 80], [100, 100, 50], [50, 50, 20]],
  },
  plain: {
    keys: [58, 59, 60, 141],
    values: [[500, 500, 500, 20], [450, 450, 450, 16], [350, 350, 350, 13], [250, 250, 250, 10], [200, 200, 200, 8], [150, 150, 150, 5], [100, 100, 100, 3], [50, 50, 50, 1]],
  },
};

export function handbookTable(type) {
  if (HANDBOOK_PET_TYPES.includes(type)) return 'pet';
  if (type === HANDBOOK_MOUNT_TYPE) return 'mount';
  if (HANDBOOK_SPECIAL_TYPES.includes(type)) return 'special';
  return 'plain';
}

/** 该分类在该等级贡献的能力值；等级 0（一条都没亮）返回 null。 */
export function handbookBonus(type, level) {
  if (!(level > 0)) return null;
  const table = BONUS_TABLES[handbookTable(type)];
  const raw = table.values[tierIndex(level)];
  const values = Array.isArray(raw) ? raw : table.keys.map(() => raw);
  return Object.fromEntries(table.keys.map((key, index) => [key, values[index]]));
}

// 目录 → 页索引：组:类 → 条目数组。只建一次（原版目录 2240 条，32 个页）。
let indexCache = null;
function catalogIndex() {
  if (indexCache) return indexCache;
  const pages = new Map(), order = [];
  for (const row of official.catalog) {
    const seen = new Set();
    for (const source of row.sources || []) {
      const group = source.group || 0, type = source.type || 0, key = group + ':' + type;
      if (seen.has(key)) continue;
      seen.add(key);
      let page = pages.get(key);
      if (!page) {
        page = {group, type, rows: [], ids: new Set()};
        pages.set(key, page);
        order.push(page);
      }
      if (page.ids.has(row.itemId)) continue;
      page.ids.add(row.itemId);
      page.rows.push({itemId: row.itemId, icon: row.icon, name: row.name, bagIcon: row.bagIcon, info: row.info, type: row.type, grade: row.grade, sort: source.sort || 0});
    }
  }
  indexCache = {pages, order};
  return indexCache;
}

/** 全部图鉴页（组+类），顺序与目录一致 —— 用于汇总加成。 */
export function handbookPages() {
  return catalogIndex().order;
}

/** 某一页的条目（不含玩家状态）。 */
export function handbookRows(group, type) {
  const page = catalogIndex().pages.get(group + ':' + type);
  return page ? page.rows : [];
}

function unlockedIds(state, group, type) {
  const list = state.unlocked[group + ':' + type];
  return Array.isArray(list) ? list : [];
}

/** 取角色的图鉴状态（**只读**，绝不写角色 —— 查询类接口的纪律见 AGENTS）。老存档 /
 *  从没打开过图鉴的角色拿到的是一个空的临时对象，它不会进存档。 */
export function handbookState(p) {
  const state = p && typeof p === 'object' ? p.handbook : null;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return {unlocked: {}, lit: false, powers: {}};
  const unlocked = state.unlocked && typeof state.unlocked === 'object' && !Array.isArray(state.unlocked) ? state.unlocked : {};
  return {unlocked, lit: state.lit === true, powers: state.powers && typeof state.powers === 'object' ? state.powers : {}};
}

/** 写路径用：取存档里的真对象并补全字段（会写回 p.handbook）。 */
export function ensureHandbookState(p) {
  const state = p.handbook && typeof p.handbook === 'object' && !Array.isArray(p.handbook) ? p.handbook : (p.handbook = {});
  if (!state.unlocked || typeof state.unlocked !== 'object' || Array.isArray(state.unlocked)) state.unlocked = {};
  if (typeof state.lit !== 'boolean') state.lit = false;
  return state;
}

function progress(state, group, type, rows) {
  const total = rows.length;
  if (state.lit) return {count: total, rate: total ? 100 : 0, level: total ? HANDBOOK_MAX_LEVEL : 0};
  const ids = unlockedIds(state, group, type);
  if (!ids.length) return {count: 0, rate: 0, level: 0};
  const wanted = new Set(rows.map(row => row.itemId));
  let count = 0;
  for (const id of ids) if (wanted.has(id)) count++;
  const rate = total ? Math.round((count / total) * 100) : 0;
  return {count, rate, level: handbookLevel(rate)};
}

/** 一页的完整状态（32102 用的就是它）。 */
export function handbookView(p, group, type) {
  const state = handbookState(p), rows = handbookRows(group, type);
  const lit = state.lit, have = new Set(lit ? [] : unlockedIds(state, group, type));
  const items = rows.map(row => ({...row, unlock: lit || have.has(row.itemId)}));
  const {count, rate, level} = progress(state, group, type, rows);
  return {group, type, items, total: rows.length, count, rate, level, lit, canUnlock: !lit && count < rows.length};
}

/** 32103：一页全部点亮（客户端只发 group+type，点哪些由服务端说了算）。 */
export function unlockHandbookPage(p, group, type) {
  const state = ensureHandbookState(p), rows = handbookRows(group, type), key = group + ':' + type;
  const ids = new Set(unlockedIds(state, group, type));
  for (const row of rows) ids.add(row.itemId);
  state.unlocked[key] = [...ids];
  return handbookView(p, group, type);
}

/** 背包里已有的条目自动点亮（和参考实现的 autoUnlockGroup 同义），返回是否变化。 */
export function unlockOwnedItems(p) {
  const state = ensureHandbookState(p);
  if (state.lit) return false;
  const owned = new Set();
  // inventory 同时覆盖装备栏（slot<30）与背包；quantity=0 的幽灵道具不算「已拥有」。
  for (const instance of p.inventory || []) if (instance && instance.quantity !== 0) owned.add(instance.itemId);
  if (!owned.size) return false;
  let changed = false;
  for (const page of catalogIndex().order) {
    const key = page.group + ':' + page.type, ids = new Set(unlockedIds(state, page.group, page.type));
    const before = ids.size;
    for (const row of page.rows) if (owned.has(row.itemId)) ids.add(row.itemId);
    if (ids.size !== before) {
      state.unlocked[key] = [...ids];
      changed = true;
    }
  }
  return changed;
}

/** 重算「图鉴加成合计」并写回存档（返回 能力编号 → 数值）。 */
export function refreshHandbook(p) {
  const state = ensureHandbookState(p), powers = {};
  for (const page of catalogIndex().order) {
    const {level} = progress(state, page.group, page.type, page.rows);
    const bonus = handbookBonus(page.type, level);
    if (!bonus) continue;
    for (const [key, value] of Object.entries(bonus)) powers[key] = (powers[key] || 0) + value;
  }
  state.powers = powers;
  return powers;
}

/** 「点亮所有图鉴」：全部条目点亮（等级拉满），并立刻重算加成。 */
export function lightAllHandbook(p) {
  const state = ensureHandbookState(p);
  state.lit = true;
  state.unlocked = {};
  return refreshHandbook(p);
}

/** 存档里的加成合计（native-character-stats 只读这里，不 import 本模块）。 */
export function handbookPowers(p) {
  const state = p?.handbook;
  return state && typeof state === 'object' && state.powers && typeof state.powers === 'object' ? state.powers : {};
}
