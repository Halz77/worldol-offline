/**
 * 技能自定义特效 · 核心逻辑层（第 93 版，2026-10-25 移植）。
 *
 * 无 Egret 依赖：存储 / resolve 桥 / 技能名索引 / 候选池 / 分页计算全在这里，
 * 供 web/skill-fx.js（UI 层）与单测（vm 沙箱）共用。
 *
 * 移植依据：《技能自定义特效功能-AI复刻手册-20261014.md》第三/四节 +
 * zip 提取包（gen-fx-thumbs 产物、fxEditableOf 之外的纯逻辑）。
 * 与本工程的两处路线差异（注释里标了【本工程】）：
 *   1. 播放层替换、不动字节层 ⇒ 不需要 fxEditableOf 探针；
 *   2. 落盘在 localStorage 而非 data/skill-console.json ⇒ 不碰服务端覆盖层时序。
 */
(function (g) {
 'use strict';

 // ── 候选池 ────────────────────────────────────────────────
 // 池 = worldol-fx-thumbs.js 的 icons 表（181 个号，gen-fx-thumbs 产物：
 // 官方特效模型段筛出的可用号 + 自制段，已剔除 1527~1532 mod67 残留与全黑图）。
 // SETTLE_EXCLUDED：结算特例号绝不可进池（skill-animation-patch 有专属结算
 // 节奏；我们没搬那个补丁，但号本身在客户端有特殊演出语义，一并排除）。
 const SETTLE_EXCLUDED = { 1320: true, 1333: true, 29998: true };
 // 段护栏：粗过滤防手改存档写入离谱号（主校验是 icons 表存在性）。
 // 上限 29999 而非手册的 1699 —— 手册配它自己的 1200~1699 白名单；我们用的
 // 是 zip gen-fx-thumbs 的 181 池（1215~29990，含高段自制号），按 1699 会误杀。
 const FX_MIN = 1200, FX_MAX = 29999;

 function iconsTable() {
  const t = g.WOL_FX_THUMBS && g.WOL_FX_THUMBS.icons;
  return (t && typeof t === 'object') ? t : {};
 }
 function effectPool() {
  const ids = [];
  for (const k in iconsTable()) {
   const id = Number(k);
   if (!Number.isInteger(id)) continue;
   if (id < FX_MIN || id > FX_MAX) continue;         // 段护栏（生成器兜底）
   if (SETTLE_EXCLUDED[id]) continue;                // 结算特例
   ids.push(id);
  }
  return ids.sort((a, b) => a - b);
 }

 // ── 存储（localStorage，按角色 id 隔离）────────────────────
 // { '<角色id>': { fx:{'<skillId>': 号 | {r:'all'|'<清单id>'}},
 //                 pl:{'<清单id>':{name,ids}}, plNext:number, starTo:'<清单id>' } }
 const STORE_KEY = 'worldol.skillFx';
 const REVISION = 'skill-fx-core-20261025-v1';
 function blankRole() { return { fx: {}, pl: {}, plNext: 1, starTo: null }; }
 function loadDb() {
  try {
   const raw = g.localStorage && g.localStorage.getItem(STORE_KEY);
   const db = raw ? JSON.parse(raw) : {};
   return (db && typeof db === 'object') ? db : {};
  } catch (_) { return {}; }
 }
 function saveDb(db) {
  try { g.localStorage && g.localStorage.setItem(STORE_KEY, JSON.stringify(db)); return true; }
  catch (_) { return false; }
 }
 /** 取角色存储；v1 遗留 fav 数组迁移为默认清单。 */
 function storeFor(db, roleId) {
  const key = String(roleId);
  let st = db[key];
  if (!st) { st = blankRole(); db[key] = st; }
  if (!st.fx || typeof st.fx !== 'object') st.fx = {};
  if (!st.pl || typeof st.pl !== 'object') st.pl = {};
  if (!Number.isInteger(st.plNext) || st.plNext < 1) st.plNext = 1;
  if (st.starTo !== null && st.starTo !== undefined && !st.pl[st.starTo]) st.starTo = null;
  if (Array.isArray(st.fav)) {                       // v1 迁移：fav → 「我的收藏」清单
   const id = String(st.plNext++);
   st.pl[id] = { name: '我的收藏', ids: st.fav.filter(x => Number.isInteger(x)) };
   st.starTo = st.starTo || id;
   delete st.fav;
  }
  return st;
 }

 // ── 技能名索引（手册第二节事实 8）────────────────────────
 // 战斗链路拿到的只有技能名。用「我的 PlayerVO.skillList」建 {name→id}，
 // 只收 type=2 回合 / type=3 主动（跳过被动）；另建「去等级后缀」归一化键。
 const normSkillName = n => String(n || '')
  .replace(/[（(]\s*(?:lv|lv\.|等级)?\s*\d+\s*级?\s*[)）]/ig, '')
  .replace(/\s+/g, '').trim();

 function buildNameIndex(skillList) {
  const idx = {};
  try {
   if (skillList && skillList.length) for (const s of skillList) {
    if (!s || (s.type !== 2 && s.type !== 3) || !s.name) continue;
    const rec = { id: s.id, level: Number(s.level) || 0 };
    if (idx[s.name] === undefined) idx[s.name] = rec;
    const nn = normSkillName(s.name);
    if (nn && idx[nn] === undefined) idx[nn] = rec;
   }
  } catch (_) {}
  return idx;
 }

 // ── resolve：单一入口（手册第四节）────────────────────────
 // resolveForBattle(name) → 数字=替换 effect | null=不干预
 function createResolver(getSkillList, getDb) {
  // 索引缓存带「技能表签名」：穿脱装备会改变 skillList（手册事实 8 的坑），
  // 签名一变就重建，而不是等 miss —— 脱装备后旧索引仍会命中并换错特效。
  let nameIdx = null, nameSig = null;
  const sig = () => {
   const l = getSkillList() || [];
   return l.length + ':' + ((l[0] && l[0].id) || 0) + ':' + ((l[l.length - 1] && l[l.length - 1].id) || 0);
  };
  const index = () => {
   const s = sig();
   if (!nameIdx || s !== nameSig) { nameIdx = buildNameIndex(getSkillList()); nameSig = s; }
   return nameIdx;
  };
  return function resolveForBattle(name) {
   const roleId = g.__worldolMyRoleId ? g.__worldolMyRoleId() : null;
   if (!roleId) return null;
   const st = storeFor(getDb(), roleId);
   let hit = index()[name];
   if (hit === undefined) { nameIdx = buildNameIndex(getSkillList()); nameSig = sig(); hit = nameIdx[name]; }
   if (hit === undefined) { const nn = normSkillName(name); if (nn) hit = nameIdx[nn]; }
   if (!hit) return null;
   const cfg = st.fx[hit.id];
   if (cfg === undefined || cfg === null) return null;
   const pool = effectPool();
   if (!pool.length) return null;
   if (typeof cfg === 'number') {
    if (!Number.isInteger(cfg)) return null;
    if (cfg < FX_MIN || cfg > FX_MAX) return null;   // 段护栏
    if (SETTLE_EXCLUDED[cfg]) return null;           // 结算特例
    return Object.prototype.hasOwnProperty.call(iconsTable(), cfg) ? cfg : null; // 号必须真实存在（防手改存档 404）
   }
   if (typeof cfg === 'object' && typeof cfg.r === 'string') {
    const src = cfg.r === 'all' ? pool : ((st.pl[cfg.r] || {}).ids || []);
    const usable = src.filter(x => Number.isInteger(x) && x >= FX_MIN && x <= FX_MAX && !SETTLE_EXCLUDED[x]);
    if (!usable.length) return null;                 // 清单空/被删 ⇒ 回退全池；全池也空 ⇒ 不干预
    return usable[Math.floor(Math.random() * usable.length)];
   }
   return null;
  };
 }

 // ── 分页（手册第五节 v1.9.105）────────────────────────────
 function pageCount(contentH, viewH) {
  if (!(viewH > 0)) return 1;
  return Math.max(1, Math.ceil(contentH / viewH));
 }
 /** 末页口径坑：内容高不是页高整倍数时 floor 公式会少算一页。
  *  ⚠ h 是**页高 viewH** 不是行高 —— v1.9.82 踩过行高口径的坑。 */
 function pageOfScroll(scrollY, viewH, contentH) {
  const pages = pageCount(contentH, viewH);
  const max = Math.max(0, contentH - viewH);
  if (-scrollY >= max - 0.5) return pages;            // y <= -max+0.5 ⇒ 末页特判
  return Math.min(pages, Math.max(1, Math.floor(-scrollY / viewH) + 1));
 }

 g.WolSkillFxCore = {
  REVISION, SETTLE_EXCLUDED, FX_MIN, FX_MAX,
  iconsTable, effectPool, loadDb, saveDb, storeFor, blankRole,
  normSkillName, buildNameIndex, createResolver,
  pageCount, pageOfScroll
 };
})(typeof window !== 'undefined' ? window : globalThis);
