// 英雄图鉴（收集系统）—— 服务端实装（第 77 版）。
//
// 原版客户端的图鉴（模块 0179 BookGroupModel / 1150 图鉴主页 / 1154 图鉴等级 /
// 1157 图鉴点亮）本来就是「服务端说哪些条目光了、每页收集率多少」，
// 客户端只负责画。本工程以前只回了 32102（一页一条，全部未点亮）、32103 直接提示
// 「尚未接入」—— 于是图鉴是死的，等级/收集率都读不到。
//
// 这一版把整条链接上：
//   32101 C2S_HAND_BOOK_INFO   → 32102（真实 unlock/level/rate/canUnlock）
//   32103 C2S_HAND_BOOK_UNLOCK → 32104（本页全部点亮）+ 32109
//   32107 进世界时随组列表推 → 另外补推一次 32109
//   道具「点亮所有图鉴」→ lit=true（全部分类 100%）
//
// ★ 第 80 版：**图鉴不再提供任何属性加成**（用户决定，加成整块删除）。
//   第 77 版曾照参考实现「幻想世界OL 3.0 最终版」做四张加成表（宠物 7·8·9·41、
//   坐骑 11、特殊 19·24·34·37·39、其余走「物攻/魔攻/武器伤害」那张），落点是
//   `native-character-stats` 的 getSkillPowerValue，并把同一份合计用 32109 发给客户端
//   （客户端 `onHandBookPowerInfo` 塞进静态的 `BookGroupModel.bookGroupPower`，
//   战斗单位 `getPower(key)` 再把它加进去 —— 原版落点是 getPower，不是 getSkillPowerValue）。
//   实测这份表**过于变态**：一个 97 级角色点亮几页就有「攻击次数+50」「魔攻+600」，
//   客户端算出的宠物血蓝上限比服务端高 7.5%，12502 的「宠物战斗状态不完整」把每一场
//   结算都拒掉（奖励全不发）。所以整块删掉：powers 恒为 {}、32109 恒发空包，
//   属性完全不受图鉴影响。收集率/图鉴等级（handbookLevel）只用于界面显示。
//
// 状态字段：p.handbook = {unlocked:{"组:类":[条目编号…]}, lit:false, powers:{}}。
//   · unlocked / lit 是**唯一真源**（玩家收集到哪些条目、有没有一键点亮过）；
//   · powers 是历史字段，第 80 版起恒为空对象 —— 留着只为吃下老存档里那份旧加成，
//     进世界时由 refreshHandbook() 覆盖成 {}（服务端与客户端一起回到无加成）。
import {official} from './official-data.mjs';

export const HANDBOOK_MAX_LEVEL = 70;

// 收集率 → 图鉴等级（只用于显示：0% 没有等级；100% → 70 级；其余取最近整数，最低 1 级）
export function handbookLevel(rate) {
  if (!(rate > 0)) return 0;
  return Math.max(1, Math.round((rate / 100) * HANDBOOK_MAX_LEVEL));
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

/**
 * 重算并写回图鉴状态。
 * 【第 80 版】加成已整块删除，这里只剩**清理**作用：把 powers 写成 {}（老存档里那份
 * 旧加成就是靠这一步在进世界时消失的）。保留这个函数是因为状态变化（点亮/一键点亮）
 * 与进世界都需要一个统一收口，将来真要恢复加成也从这里进。
 */
export function refreshHandbook(p) {
  const state = ensureHandbookState(p);
  state.powers = {};
  return state.powers;
}

/** 「点亮所有图鉴」：全部条目点亮（等级拉满），并立刻清一次加成缓存。 */
export function lightAllHandbook(p) {
  const state = ensureHandbookState(p);
  state.lit = true;
  state.unlocked = {};
  return refreshHandbook(p);
}

/**
 * 图鉴加成合计 —— **第 80 版起恒为空**（见文件头）。
 * 客户端 `onHandBookPowerInfo` 收到空包会把静态的 `bookGroupPower` 清空（回到无加成），
 * 所以这里直接返回空对象就等于「图鉴不加任何属性」，客户端一行都不用改。
 * ⚠️ 别再让它去读 p.handbook.powers：老存档里还留着第 77 版算出来的旧值。
 */
export function handbookPowers(p) {
  void p;
  return {};
}
