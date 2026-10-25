/**
 * 技能自定义特效 · UI 层（第 93 版，2026-10-25 移植）。
 *
 * 用法：技能面板每一行（主动/自动）多一个「效」小按钮 → 点开弹窗：
 * 左收藏清单栏 + 右特效缩略图网格（◀/▶ 分页 + 自管滚动）。
 * 点格子=指定特效；点「随机来源」行=每次施放随机抽；☆=收进清单。
 * 配置按角色 id 隔离存 localStorage，战斗中只有「我」的施放会替换特效。
 *
 * 施工依据：《技能自定义特效功能-AI复刻手册-20261014.md》第二/三/五节；
 * 纯逻辑在 web/skill-fx-core.js（存储/resolve/池/分页），本文件只碰 Egret。
 * 安装：由 web/offline.js 的 offlineInstall() 调 window.installSkillFx(req)。
 *
 * 真机实证的引擎事实（改前必读，全部来自手册 + zip 同源取证）：
 *   1. 真舞台是 go.gameStage（本定制构建没有 egret.MainContext）。
 *   2. 技能行是模块内局部渲染器类，必须从**活行实例**反查原型打 dataChanged；
 *      自属标记必须 hasOwnProperty 判定，否则先打子类后打基类会被误跳过。
 *   3. 本构建无 eui.Scroller 皮肤 / 无 egret.TextInput ⇒ 滚动自绘、输入用 DOM 覆盖层。
 *   4. dataURL 不能直接赋 eui.Image.source ⇒ ImageLoader → Texture._setBitmapData。
 *   5. createBattleUseSkillControl 首参是位置不是 actor（补丁层已按此实现）。
 */
window.installSkillFx = req => {
 'use strict';
 const World = req(5).default, UI = req(1).default;
 const Core = window.WolSkillFxCore;
 if (!Core) return { revision: null, error: 'skill-fx-core.js 未加载' };
 const BTN_KEY = '__worldolSkillFxBtn';
 const REVISION = 'skill-fx-ui-20261025-v4';

 // ── 数据库缓存（resolve 每施放读一次，不能每次 JSON.parse）──
 let dbCache = null;
 const db = () => dbCache || (dbCache = Core.loadDb());
 const touch = () => { dbCache = null; };
 const roleId = () => { try { return World.myPlayer && World.myPlayer.id || null; } catch (_) { return null; } };
 const skillList = () => { try { return (World.myPlayer && World.myPlayer.skillList) || []; } catch (_) { return []; } };
 // core 的 resolver 通过这个全局拿当前角色（播放层补丁间接依赖同一链路）
 window.__worldolMyRoleId = roleId;

 // ── 战斗桥（lib/client-skill-fx-patch.mjs 读它）──────────
 const bridge = {
  revision: REVISION,
  resolveForBattle: Core.createResolver(skillList, db),
  effects: () => Core.effectPool(),
  /** 写配置：cfg=数字 | {r:'all'|清单id}；null=恢复默认。 */
  setFx: (skillId, cfg) => {
   const id = roleId(); if (!id) return false;
   const d = db(); const st = Core.storeFor(d, id);
   if (cfg === null || cfg === undefined) delete st.fx[skillId]; else st.fx[skillId] = cfg;
   const ok = Core.saveDb(d); touch(); refreshRows(); return ok;
  },
  getFx: skillId => { const id = roleId(); if (!id) return null; const st = Core.storeFor(db(), id); return st.fx[skillId] ?? null; },
  // 清单 CRUD
  lists: () => { const id = roleId(); if (!id) return { starTo: null, pl: {} }; const st = Core.storeFor(db(), id); return { starTo: st.starTo, pl: st.pl }; },
  createList: name => {
   const id = roleId(); if (!id) return null;
   const d = db(); const st = Core.storeFor(d, id);
   const lid = String(st.plNext++);
   st.pl[lid] = { name: String(name || '').slice(0, 12) || ('清单 ' + lid), ids: [] };
   Core.saveDb(d); touch(); return lid;
  },
  deleteList: lid => {
   const id = roleId(); if (!id) return false;
   const d = db(); const st = Core.storeFor(d, id);
   if (!st.pl[lid]) return false;
   delete st.pl[lid];
   if (st.starTo === lid) st.starTo = null;
   for (const k of Object.keys(st.fx)) { const c = st.fx[k]; if (c && typeof c === 'object' && c.r === lid) delete st.fx[k]; }
   Core.saveDb(d); touch(); refreshRows(); return true;
  },
  renameList: (lid, name) => {
   const id = roleId(); if (!id) return false;
   const d = db(); const st = Core.storeFor(d, id);
   if (!st.pl[lid]) return false;
   st.pl[lid].name = String(name || '').slice(0, 12); Core.saveDb(d); touch(); return true;
  },
  starTo: lid => {
   const id = roleId(); if (!id) return false;
   const d = db(); const st = Core.storeFor(d, id);
   st.starTo = st.starTo === lid ? null : lid;          // 再点一次取消
   Core.saveDb(d); touch(); return true;
  },
  toggleStar: (lid, fxId) => {
   const id = roleId(); if (!id) return false;
   const d = db(); const st = Core.storeFor(d, id);
   const l = st.pl[lid]; if (!l) return false;
   const at = l.ids.indexOf(fxId);
   if (at >= 0) l.ids.splice(at, 1); else l.ids.push(fxId);
   Core.saveDb(d); touch(); return true;
  },
  status: () => ({ revision: REVISION, poolSize: Core.effectPool().length, roleId: roleId() })
 };
 window.__worldolSkillFx = bridge;

 // ── 舞台（本定制构建：go.gameStage 是真舞台）────────────
 const isStage = s => !!(s && typeof s.addChild === 'function' && typeof s.stageWidth === 'number');
 function findStage() {
  try { const s = window.go && window.go.gameStage; if (isStage(s)) return s; } catch (_) {}
  try { const mc = window.egret && window.egret.MainContext; if (mc && mc.instance && isStage(mc.instance.stage)) return mc.instance.stage; } catch (_) {}
  try { if (isStage(window.__wolStage)) return window.__wolStage; } catch (_) {}
  try { for (const k in window) { let v; try { v = window[k]; } catch (_) { continue; } if (isStage(v)) return v; if (v && typeof v === 'object' && isStage(v.stage)) return v.stage; } } catch (_) {}
  return null;
 }

 // ── 行内「效」按钮 ────────────────────────────────────────
 const BTN_W = 34, BTN_H = 24, SKILL_ROUND = 2, SKILL_ACTIVE = 3;
 const isSkillRow = v => { try { return !!(v && v.textSkillName && v.btnCheckBox && v.btnDel && v.data); } catch (_) { return false; } };
 const hasOwnMarker = p => { try { return !!p && Object.prototype.hasOwnProperty.call(p, '__worldolSkillFx'); } catch (_) { return false; } };
 function roundRect(gr, w, h, r, fill, line, lineW) {
  gr.graphics.beginFill(fill[0], fill.length > 1 ? fill[1] : 1);
  if (line) gr.graphics.lineStyle(lineW || 1, line[0], line.length > 1 ? line[1] : 1);
  gr.graphics.drawRoundRect(0, 0, w, h, r, r);
  gr.graphics.endFill();
 }
 function makeRowButton(renderer) {
  const spr = new egret.Sprite();
  spr.touchEnabled = true;
  const bg = new egret.Shape();
  roundRect(bg, BTN_W, BTN_H, 5, [0x2c4a8f, 0.95], [0x6f9fe8], 1);
  spr.addChild(bg);
  const tx = new egret.TextField();
  tx.size = 14; tx.bold = true; tx.textColor = 0xffe9a8; tx.fontFamily = 'Microsoft YaHei, sans-serif';
  tx.text = '效'; tx.width = BTN_W; tx.height = BTN_H; tx.textAlign = 'center'; tx.verticalAlign = egret.VerticalAlign.MIDDLE;
  spr.addChild(tx);
  spr.addEventListener(egret.TouchEvent.TOUCH_TAP, ev => {
   ev.stopPropagation();
   const d = renderer.data;
   if (!d || (d.type !== SKILL_ACTIVE && d.type !== SKILL_ROUND)) return;
   openForRow(d).catch(e => {
    // 带堆栈：线上排错只看 message 定位不到行（真机点击报错复盘过）。
    try { UI && UI.alertMessage && UI.alertMessage(String(e && e.message || e) + '\n' + String(e && e.stack || '').split('\n').slice(1, 3).join('\n')); } catch (_) {}
   });
  }, renderer);
  renderer.addChild(spr);
  return spr;
 }
 function placeRowButton(renderer, btn) {
  let cbX = 433, cbY = -3, cbH = 50;
  try {
   const cb = renderer.btnCheckBox;
   if (cb && typeof cb.x === 'number') { cbX = cb.x; if (typeof cb.y === 'number') cbY = cb.y; if (typeof cb.height === 'number' && cb.height > 0) cbH = cb.height; }
  } catch (_) {}
  btn.x = cbX - BTN_W - 8;
  btn.y = cbY + (cbH - BTN_H) / 2;
 }
 function syncRowButton(renderer, btn) {
  const d = renderer.data;
  const show = !!(d && (d.type === SKILL_ACTIVE || d.type === SKILL_ROUND));
  btn.visible = show;
  if (!show) return;
  placeRowButton(renderer, btn);
  const configured = bridge.getFx(d.id) !== null;      // 已配特效 ⇒ 金色高亮
  const gr = btn.getChildAt(0);
  gr.graphics.clear();
  roundRect(gr, BTN_W, BTN_H, 5, configured ? [0x8f6a1f, 0.95] : [0x2c4a8f, 0.95], configured ? [0xffd76e] : [0x6f9fe8], 1);
 }
 function hookRenderer(proto) {
  if (!proto || hasOwnMarker(proto)) return false;
  proto.__worldolSkillFx = true;
  const changed = proto.dataChanged;
  proto.dataChanged = function (...args) {
   const r = typeof changed === 'function' ? changed.apply(this, args) : undefined;
   try {
    if (isSkillRow(this)) {
     let btn = this[BTN_KEY];
     if (!btn || !btn.parent) { btn = makeRowButton(this); this[BTN_KEY] = btn; }
     syncRowButton(this, btn);
    }
   } catch (_) { /* 注入失败不能影响技能行本身 */ }
   return r;
  };
  return true;
 }
/** 遍历舞台显示树收集活技能行。
 *  ⚠ numChildren 在 egret 里是**只读 getter（number）不是方法** —— 写成
 *  typeof node.numChildren!=='function' 会让整个扫描第一行就退出（真机「没有
 * 按钮」的首因）。这里按 number 取值，并兼容极少数构建的方法形态。 */
function collectSkillRows(node, out) {
  try {
   if (!node) return;
   const count = typeof node.numChildren === 'number' ? node.numChildren
    : (typeof node.getNumChildren === 'function' ? node.getNumChildren() : 0);
   if (isSkillRow(node)) out.push(node);
   for (let i = 0; i < count; i++) collectSkillRows(node.getChildAt(i), out);
  } catch (_) {}
}
let hooked = false;
function scanRows() {
  const stage = findStage(); if (!stage) return;
  const rows = []; collectSkillRows(stage, rows);
  for (const row of rows) {
   hookRenderer(Object.getPrototypeOf(row));            // 幂等（自属标记）
   // 关键修复：原型补丁只对「之后新建的行」生效。若挂载发生在技能面板已打开
   // 之后（用户先开面板、轮询才扫到），已存在的行永远不会重走 dataChanged ⇒
   // 按钮永远不出现。所以每次扫描都要顺手给现存活行补按钮（同样幂等）。
   try {
    if (isSkillRow(row)) {
     let btn = row[BTN_KEY];
     if (!btn || !btn.parent) { btn = makeRowButton(row); row[BTN_KEY] = btn; }
     syncRowButton(row, btn);
    }
   } catch (_) { /* 补按钮失败不能影响技能行本身 */ }
  }
  if (rows.length) hooked = true;
}
// 常驻轮询（幂等）：面板开合的时机不可控，只在挂载时扫一次会漏掉「挂载时面板
// 已开着」的场景。遍历整棵显示树的成本约等于 native-features 的每秒名单刷新。
const scanTimer = setInterval(scanRows, 800);
scanRows();
 function refreshRows() {
  const stage = findStage(); if (!stage) return;
  const rows = []; collectSkillRows(stage, rows);
  for (const row of rows) if (row[BTN_KEY]) syncRowButton(row, row[BTN_KEY]);
 }

 // ── 弹窗 ─────────────────────────────────────────────────
 // 布局（640×720）：标题区 0-56 / 列表+网格 64-610 / 分页 616-644 /
 // 状态行 650-676 / 按钮行 682-710。格子 117×68：上半缩略图 103×50，
 // 下半编号条 14px（星标放编号行右端，不遮图）。
 const PANEL_W = 640, PANEL_H = 720, LIST_W = 148, ROW_H = 68, COLS = 4;
 const GRID_X = LIST_W + 14, GRID_Y = 64, GRID_W = PANEL_W - GRID_X - 12, GRID_H = 546;
 const CELL_W = Math.floor(GRID_W / COLS), CELL_H = ROW_H;
 const THUMB_W = CELL_W - 14, THUMB_H = 50, THUMB_Y = 5;
 const PAGER_Y = 616, STATUS_Y = 650, BUTTON_Y = 682, BUTTON_H = 28;
 // 配色（深蓝面板 + 金黄强调，和原版技能面板的深蓝调一致）
 const C = {
  panel: 0x1b2340, panelEdge: 0x4a6db8, section: 0x151c33, sectionEdge: 0x36477a,
  cell: 0x232c4d, cellEdge: 0x3f5187, cellSel: 0x3d3320, cellSelEdge: 0xffd76e,
  text: 0xdfe7f7, textDim: 0x8fa3c8, gold: 0xffe9a8, goldDim: 0xc8a34d,
  btn: 0x2e4270, btnEdge: 0x5c7fbd, bar: 0x5b7ab8
 };
 let popup = null, locked = null, view = 'all', scrollY = 0, delArm = null, inputEl = null;
 const texCache = new Map(), texWait = new Map();

 function loadTexture(id, cb) {
  const hit = texCache.get(id);
  if (hit) { cb(hit); return; }
  const q = texWait.get(id);
  if (q) { q.push(cb); return; }
  texWait.set(id, [cb]);
  const loader = new egret.ImageLoader();
  const done = tex => { const list = texWait.get(id) || []; texWait.delete(id); for (const f of list) { try { f(tex); } catch (_) {} } };
  loader.addEventListener(egret.Event.COMPLETE, () => {
   let tex = null;
   try { tex = new egret.Texture(); tex._setBitmapData(loader.data); texCache.set(id, tex); } catch (_) {}
   done(tex);
  }, null);
  loader.addEventListener(egret.IOErrorEvent.IO_ERROR, () => done(null), null);
  try { loader.load((window.WOL_FX_THUMBS && window.WOL_FX_THUMBS.icons && window.WOL_FX_THUMBS.icons[id]) || ('/fx-thumbs/' + id + '.png')); }
  catch (_) { done(null); }
 }

 // 自管滚动区：scrollRect 裁切 + TOUCH_BEGIN/MOVE 拖动 + mouseWheel + 右缘滚动条。
 // ⚠ 只用 scrollRect，**不设 layer.mask** —— zip 同源实证的方案（「scrollRect 裁剪
 // + 偏移，拖动时只改 scrollRect 绝不重画」）；mask 在部分定制 egret 构建上有坑，
 // 第 93 版热修时点的「Cannot read properties of null (reading 'layer')」怀疑就从
 // 这来的（未获堆栈证实，但去掉它零成本且 zip 同功能验证过 scrollRect 足够）。
 function makeScrollArea(parent, x, y, w, h, tag) {
  const layer = new egret.Sprite();
  layer.x = x; layer.y = y;
  layer.scrollRect = new egret.Rectangle(0, 0, w, h);   // 初始裁切（apply 里持续维护）
  parent.addChild(layer);
  const bar = new egret.Sprite();
  const BAR_W = 6;
  const track = new egret.Shape(); track.graphics.beginFill(0x0b1022, 0.45); track.graphics.drawRoundRect(0, 0, BAR_W, h, 3, 3); track.graphics.endFill();
  const thumb = new egret.Shape(); thumb.graphics.beginFill(C.bar, 0.9); thumb.graphics.drawRoundRect(0, 0, BAR_W, 30, 3, 3); thumb.graphics.endFill();
  bar.addChild(track); bar.addChild(thumb); bar.touchEnabled = true;
  // ⚠ bar 是挂在 parent（面板）坐标系上的，必须把滚动区自身的 (x,y) 偏移算进去——
  // 只写 w-BAR_W 会让滚动条跑到面板中部（第 93 版 v4 真机反馈红框实证）。
  bar.x = x + w - BAR_W; bar.y = y;
  parent.addChild(bar);
  const st = { layer, tag, contentH: 0, scroll: 0, viewH: h, moved: 0, dragging: false, lastY: 0, barDrag: false };
  const clampScroll = v => Math.max(Math.min(0, v), -(Math.max(0, st.contentH - st.viewH)));
  const apply = () => {
   const max = Math.max(0, st.contentH - st.viewH);
   layer.scrollRect = new egret.Rectangle(0, -st.scroll, w, st.viewH);
   const tH = max > 0 ? Math.max(20, st.viewH * st.viewH / st.contentH) : h;
   thumb.height = tH; thumb.visible = max > 0; track.visible = max > 0;
   thumb.y = max > 0 ? (st.viewH - tH) * (-st.scroll / max) : 0;
   if (typeof st.onScroll === 'function') st.onScroll(st.scroll);
  };
  st.setContentH = v => { st.contentH = Math.max(0, v); st.scroll = clampScroll(st.scroll); apply(); };
  st.setScroll = v => { st.scroll = clampScroll(v); apply(); };
  st.scrollBy = d => st.setScroll(st.scroll + d);
  st.pages = () => Core.pageCount(st.contentH, st.viewH);
  st.gotoPage = n => {
   const pages = st.pages();
   const target = Math.min(Math.max(1, n), pages);
   st.setScroll(-(target - 1) * st.viewH);
   return target;
  };
  st.pageNow = () => Core.pageOfScroll(st.scroll, st.viewH, st.contentH);
  const localY = ev => { try { return layer.globalToLocal(ev.stageX, ev.stageY).y; } catch (_) { return 0; } };
  layer.touchEnabled = true;
  layer.addEventListener(egret.TouchEvent.TOUCH_BEGIN, ev => {
   st.dragging = true; st.moved = 0; st.lastY = localY(ev);
  }, st);
  layer.addEventListener(egret.TouchEvent.TOUCH_MOVE, ev => {
   if (!st.dragging) return;
   const y = localY(ev); const d = y - st.lastY; st.lastY = y;
   st.moved += Math.abs(d);
   st.setScroll(st.scroll + d);                        // 内容跟随手指（scroll 为负值域）
  }, st);
  const endDrag = () => { if (st.dragging) { st.dragging = false; setTimeout(() => { st.moved = 0; }, 180); } };
  layer.addEventListener(egret.TouchEvent.TOUCH_END, endDrag, st);
  layer.addEventListener(egret.TouchEvent.TOUCH_CANCEL, endDrag, st);
  // ⚠ 不注册 mouseWheel：本定制构建的全局 egret 上没有 MouseEvent.MOUSE_WHEEL
  // （引擎库全文搜不到该常量，运行时 egret.MouseEvent 取到 undefined —— 第 93 版
  // 热修二的堆栈实证）。电脑版滚轮操作用拖动 + 右缘滚动条代替，功能不受影响。
  bar.addEventListener(egret.TouchEvent.TOUCH_BEGIN, ev => { st.barDrag = true; st.barY = localY(ev); }, st);
  bar.addEventListener(egret.TouchEvent.TOUCH_MOVE, ev => {
   if (!st.barDrag) return;
   const max = Math.max(0, st.contentH - st.viewH);
   const y = localY(ev) - st.barY;
   const tH = Math.max(20, st.viewH * st.viewH / st.contentH);
   st.setScroll(-max * Math.min(1, Math.max(0, (thumb.y + y) / (st.viewH - tH))));
   st.barY = localY(ev);
  }, st);
  bar.addEventListener(egret.TouchEvent.TOUCH_END, () => { st.barDrag = false; }, st);
  apply();
  return st;
 }
 const justDragged = st => st.moved > 8;              // 防拖动误选

 function text(sprite, x, y, w, h, str, size, color, align) {
  const t = new egret.TextField();
  t.x = x; t.y = y; t.width = w; t.height = h;
  t.size = size || 20; t.textColor = color || 0xffffff;
  t.fontFamily = 'Microsoft YaHei, sans-serif';
  t.textAlign = align || 'left'; t.verticalAlign = egret.VerticalAlign.MIDDLE;
  t.text = String(str == null ? '' : str);
  sprite.addChild(t);
  return t;
 }
 function button(parent, x, y, w, h, label, act, size) {
  const b = new egret.Sprite();
  const bg = new egret.Shape();
  roundRect(bg, w, h, 6, [C.btn, 0.95], [C.btnEdge], 1);
  b.addChild(bg);
  const t = text(b, 0, 0, w, h, label, size || 18, 0xffffff, 'center');
  b.x = x; b.y = y; b.touchEnabled = true;
  b.addEventListener(egret.TouchEvent.TOUCH_TAP, ev => { ev.stopPropagation(); act(); }, b);
  parent.addChild(b);
  return b;
 }

 // DOM 输入覆盖层（本构建无 egret.TextInput，输入框打不了字）
 function domInput(cur, onOk) {
  closeDomInput();
  const stage = findStage(); if (!stage) return;
  const scale = (window.innerWidth || 640) / (stage.stageWidth || 640);
  const px = (stage.x || 0) + 120 * scale, py = (stage.y || 0) + 260 * scale;
  const el = document.createElement('input');
  el.type = 'text'; el.value = cur || '';
  el.maxLength = 12;
  el.style.cssText = 'position:fixed;left:' + px + 'px;top:' + py + 'px;width:' + Math.round(160 * scale) + 'px;z-index:99999;font-size:' + Math.round(16 * scale) + 'px;padding:4px;border:2px solid #6f9fe8;border-radius:6px;';
  document.body.appendChild(el);
  el.focus(); el.select();
  const done = ok => { const v = el.value; closeDomInput(); if (ok) onOk(v); };
  el.addEventListener('keydown', ev => {
   if (ev.key === 'Enter') done(true);
   else if (ev.key === 'Escape') done(false);
   ev.stopPropagation();
  });
  inputEl = el;
 }
 function closeDomInput() { if (inputEl && inputEl.parentNode) inputEl.parentNode.removeChild(inputEl); inputEl = null; }

 function openForRow(d) {
  return new Promise((resolve, reject) => {
   if (!roleId()) return reject(new Error('请先进入角色。'));
   if (d.type !== SKILL_ACTIVE && d.type !== SKILL_ROUND) return reject(new Error('被动技能不播放技能动画，无需换特效。'));
   locked = { kind: 'skill', id: d.id, level: Number(d.level) || 0, name: d.name || ('技能 ' + d.id) };
   openPanel(); resolve();
  });
 }

 let listScroll = null, gridScroll = null, pageLabel = null, starBtn = null, srcLabel = null, listNodes = [];
 function openPanel() {
  // 半成品保护：openPanel 中途失败过（popup 已建但 scroll 没建完）时会留下
  // popup≠null + listScroll/gridScroll=null 的状态，再点「效」走这条捷径会在
  // paint() 里读 null.layer（真机「Cannot read properties of null (reading 'layer')」）。
  // 遇到半成品先彻底关掉再重建，不要把残状态留给 paint()。
  if (popup) {
   if (listScroll && gridScroll) { paint(); return; }
   closePanel();                                        // 残状态：清掉后走下面的重建
  }
  const stage = findStage();
  if (!stage) throw new Error('游戏画面还没准备好，请稍后再试。');
  view = 'all'; scrollY = 0;
  popup = new egret.Sprite();
  popup.name = 'wolSkillFxPopup';
  const mask = new egret.Shape();
  mask.graphics.beginFill(0x000000, 0.55); mask.graphics.drawRect(0, 0, stage.stageWidth, stage.stageHeight); mask.graphics.endFill();
  mask.touchEnabled = true;
  mask.addEventListener(egret.TouchEvent.TOUCH_TAP, () => closePanel(), mask);
  popup.addChild(mask);
  const panel = new egret.Sprite();
  const bg = new egret.Shape();
  roundRect(bg, PANEL_W, PANEL_H, 12, [C.panel, 0.98], [C.panelEdge], 2);
  panel.addChild(bg);
  panel.x = (stage.stageWidth - PANEL_W) / 2; panel.y = (stage.stageHeight - PANEL_H) / 2;
  popup.addChild(panel);
  text(panel, 16, 6, 300, 32, '技能特效', 25, C.gold, 'left');
  text(panel, 16, 34, 420, 20, (locked ? locked.name : ''), 15, C.textDim, 'left');
  const topLine = new egret.Shape();
  topLine.graphics.beginFill(C.sectionEdge, 0.9); topLine.graphics.drawRect(16, 56, PANEL_W - 32, 1); topLine.graphics.endFill();
  panel.addChild(topLine);
  button(panel, PANEL_W - 48, 10, 32, 32, '×', () => closePanel(), 20);
  // 左：收藏清单（外框 + 标签 + 滚动区）
  const listBox = new egret.Shape();
  roundRect(listBox, LIST_W + 2, GRID_H + 6, 8, [C.section, 0.8], [C.sectionEdge, 0.85], 1);
  listBox.x = 10; listBox.y = GRID_Y - 4;
  panel.addChild(listBox);
  text(panel, 18, GRID_Y, LIST_W, 20, '收藏清单', 14, C.textDim, 'left');
  listScroll = makeScrollArea(panel, 14, GRID_Y + 22, LIST_W - 10, GRID_H - 26, 'list');
  // 右：特效网格（外框 + 滚动区）
  const gridBox = new egret.Shape();
  roundRect(gridBox, GRID_W + 8, GRID_H + 6, 8, [C.section, 0.6], [C.sectionEdge, 0.75], 1);
  gridBox.x = GRID_X - 4; gridBox.y = GRID_Y - 4;
  panel.addChild(gridBox);
  gridScroll = makeScrollArea(panel, GRID_X, GRID_Y, GRID_W, GRID_H, 'grid');
  // 分页器（居中于网格区下方）
  const pagerCx = GRID_X + GRID_W / 2;
  button(panel, pagerCx - 62, PAGER_Y, 30, 26, '◀', () => gotoPage(gridScroll.pageNow() - 1), 15);
  pageLabel = text(panel, pagerCx - 26, PAGER_Y, 52, 26, '', 15, C.textDim, 'center');
  button(panel, pagerCx + 30, PAGER_Y, 30, 26, '▶', () => gotoPage(gridScroll.pageNow() + 1), 15);
  // 状态行：左收藏目标 + 右当前配置
  starBtn = button(panel, 16, STATUS_Y, 250, 26, '★ 收藏到：全部特效池', () => cycleStar(), 15);
  srcLabel = text(panel, 276, STATUS_Y, 348, 26, '', 15, C.textDim, 'right');
  // 按钮行：4 个等宽（640 - 左右各 16 - 3 个 6px 间距）
  const bw = Math.floor((PANEL_W - 32 - 18) / 4);
  button(panel, 16, BUTTON_Y, bw, BUTTON_H, '+ 新建清单', () => {
   domInput('', name => { if (name && name.trim()) { bridge.createList(name.trim()); paint(); } });
  }, 15);
  button(panel, 16 + bw + 6, BUTTON_Y, bw, BUTTON_H, '删除当前清单', () => {
   if (view === 'all') { try { UI.alertMessage && UI.alertMessage('当前在看全部特效池，没有可删的清单。'); } catch (_) {} return; }
   if (delArm !== view) { delArm = view; setTimeout(() => { delArm = null; }, 3000); paint(); return; }
   bridge.deleteList(view); view = 'all'; delArm = null; paint();
  }, 15);
  button(panel, 16 + 2 * (bw + 6), BUTTON_Y, bw, BUTTON_H, '本技能随机来源', () => {
   const cur = bridge.getFx(locked.id);
   const next = cur && typeof cur === 'object' && cur.r === 'all' ? { r: view === 'all' ? 'all' : view } : { r: 'all' };
   bridge.setFx(locked.id, next); paint();
  }, 15);
  button(panel, 16 + 3 * (bw + 6), BUTTON_Y, bw, BUTTON_H, '恢复默认', () => { bridge.setFx(locked.id, null); paint(); }, 15);
  stage.addChild(popup);
  paint();
 }
 function gotoPage(n) {
  const target = gridScroll.gotoPage(n);
  pageLabel.text = target + ' / ' + gridScroll.pages();
 }
 function cycleStar() {
  const lists = bridge.lists();
  const ids = Object.keys(lists.pl);
  if (!ids.length) { try { UI.alertMessage && UI.alertMessage('还没有清单，点「+ 新建清单」创建。'); } catch (_) {} return; }
  const at = ids.indexOf(lists.starTo);
  bridge.starTo(ids[(at + 1) % ids.length]);
  paint();
 }
 function closePanel() {
  closeDomInput();
  if (popup && popup.parent) popup.parent.removeChild(popup);
  popup = null; locked = null; listScroll = null; gridScroll = null;
 }
 function paint() {
  if (!popup) return;
  const lists = bridge.lists();
  // 清单栏
  listScroll.layer.removeChildren();
  listNodes = [];
  let y = 0;
  const addRow = (label, act, active) => {
   const row = new egret.Sprite();
   const bg = new egret.Shape();
   roundRect(bg, LIST_W - 14, 30, 6, active ? [0x35467a, 0.95] : [C.cell, 0.85], active ? [C.goldDim, 0.9] : [C.cellEdge, 0.7], 1);
   row.addChild(bg);
   if (active) {                                        // 选中条目：左侧金色竖条
    const mark = new egret.Shape();
    mark.graphics.beginFill(C.cellSelEdge, 1); mark.graphics.drawRoundRect(0, 5, 3, 20, 1.5, 1.5); mark.graphics.endFill();
    row.addChild(mark);
   }
   text(row, 10, 0, LIST_W - 28, 30, label, 15, active ? C.gold : C.text, 'left');
   row.touchEnabled = true;
   row.addEventListener(egret.TouchEvent.TOUCH_TAP, ev => { ev.stopPropagation(); if (!justDragged(listScroll)) act(); }, row);
   row.y = y; y += 34;
   listScroll.layer.addChild(row);
   listNodes.push(row);
   return row;
  };
  addRow('全部特效池', () => { view = 'all'; paint(); }, view === 'all');
  for (const id of Object.keys(lists.pl).sort((a, b) => Number(a) - Number(b))) {   // 铁律 49：显式数值升序，禁 for...in 顺序
   const l = lists.pl[id];
   addRow(l.name + '（' + l.ids.length + '）', () => { view = id; paint(); }, view === id);
  }
  listScroll.setContentH(y);
  listScroll.setScroll(0);
  // 网格
  gridScroll.layer.removeChildren();
  const pool = Core.effectPool();
  const inView = view === 'all' ? pool : ((lists.pl[view] || {}).ids || []).filter(x => pool.includes(x));
  const rows = Math.ceil(inView.length / COLS);
  const cur = locked ? bridge.getFx(locked.id) : null;
  for (let i = 0; i < inView.length; i++) {
   const id = inView[i];
   const cx = (i % COLS) * CELL_W, cy = Math.floor(i / COLS) * CELL_H;
   const cell = new egret.Sprite();
   const bg = new egret.Shape();
   const selected = cur === id;
   roundRect(bg, CELL_W - 4, CELL_H - 4, 6, selected ? [C.cellSel, 0.95] : [C.cell, 0.92], selected ? [C.cellSelEdge, 1] : [C.cellEdge, 0.9], selected ? 2 : 1);
   cell.addChild(bg);
   // 缩略图铺满上半（居中，103×50）
   const img = new eui.Image();
   img.width = THUMB_W; img.height = THUMB_H;
   img.x = Math.round((CELL_W - 4 - THUMB_W) / 2); img.y = THUMB_Y;
   cell.addChild(img);
   loadTexture(id, tex => { if (tex && img.parent) { try { img.source = tex; } catch (_) {} } });
   // 编号条：左编号、右星标（不遮图）
   text(cell, 8, CELL_H - 24, CELL_W - 36, 16, String(id), 12, selected ? C.gold : C.textDim, 'left');
   // ☆ 星标（半径 7 的小星，中心 (7,7)）
   const star = new egret.Shape();
   star.graphics.beginFill((lists.starTo && lists.pl[lists.starTo] && lists.pl[lists.starTo].ids.includes(id)) ? C.cellSelEdge : 0x5a6d96, 0.95);
   for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 === 0 ? 7 : 3.2;
    const px = 7 + Math.cos(a) * r, py = 7 + Math.sin(a) * r;
    if (k === 0) star.graphics.moveTo(px, py); else star.graphics.lineTo(px, py);
   }
   star.graphics.endFill();
   star.x = CELL_W - 4 - 18; star.y = CELL_H - 22; star.touchEnabled = true;
   star.addEventListener(egret.TouchEvent.TOUCH_TAP, ev => {
    ev.stopPropagation();
    const to = lists.starTo || Object.keys(lists.pl).sort((a, b) => Number(a) - Number(b))[0];
    if (!to) { try { UI.alertMessage && UI.alertMessage('还没有清单，点「+ 新建清单」创建。'); } catch (_) {} return; }
    bridge.toggleStar(to, id); paint();
   }, star);
   cell.addChild(star);
   cell.touchEnabled = true;
   cell.addEventListener(egret.TouchEvent.TOUCH_TAP, ev => {
    ev.stopPropagation();
    if (justDragged(gridScroll)) return;
    bridge.setFx(locked.id, id); paint();
   }, cell);
   cell.x = cx; cell.y = cy;
   gridScroll.layer.addChild(cell);
  }
  gridScroll.setContentH(rows * CELL_H);
  gridScroll.setScroll(0);
  gotoPage(1);
  // 底部状态
  starBtn.getChildAt(1).text = '★ 收藏到：' + (lists.starTo && lists.pl[lists.starTo] ? lists.pl[lists.starTo].name : '全部特效池');
  srcLabel.text = cur && typeof cur === 'object' && cur.r ? ('随机来源：' + (cur.r === 'all' ? '全部特效池' : ((lists.pl[cur.r] || {}).name || '已删清单')))
   : (cur ? '已设置固定特效 ' + cur : '未配置（使用默认特效）');
 }

 // ── 测试/诊断钩子（无浏览器环境下的 e2e 替代 + 线上排查）────────────────
 window.__worldolSkillFxUI = {
  revision: REVISION,
  open: (skillId, level, name) => { locked = { kind: 'skill', id: skillId, level: level || 0, name: name || ('技能 ' + skillId) }; openPanel(); },
  close: closePanel,
  paint,
  gotoPage: n => gotoPage(n),
  isOpen: () => !!popup,
  pageInfo: () => gridScroll ? { page: gridScroll.pageNow(), pages: gridScroll.pages() } : null,
  rowCount: () => { const stage = findStage(); if (!stage) return 0; const rows = []; collectSkillRows(stage, rows); return rows.length; },
  hooked: () => hooked,
  /** 诊断：控制台跑 window.__worldolSkillFxUI.status() 一眼定位「没有按钮」卡在哪一环。 */
  status: () => ({
   rev: REVISION,
   stageFound: !!findStage(),                              // false=舞台没找到（go.gameStage 变了？）
   bridgeLoaded: !!window.__worldolSkillFx,                // false=skill-fx.js 没加载（缓存/404）
   icons: Object.keys(Core.iconsTable()).length,           // 0=worldol-fx-thumbs.js 没加载
   poolSize: Core.effectPool().length,
   rowsOnStage: (() => { const stage = findStage(); if (!stage) return 0; const rows = []; collectSkillRows(stage, rows); return rows.length; })(),
   protoHooked: hooked,                                    // false=从没扫到过技能行
   scanTimerAlive: !!scanTimer
  }),
  /** 诊断辅助：手动跑一次行扫描（改完不等轮询立即验证）。 */
  rescan: () => { scanRows(); return window.__worldolSkillFxUI.status(); }
 };

 return { revision: REVISION, bridge, scanTimer };
};
