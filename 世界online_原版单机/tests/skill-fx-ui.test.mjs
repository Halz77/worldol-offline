/**
 * 第 93 版「技能自定义特效」· UI 层装配测试（无浏览器环境的 e2e 替代）。
 *
 * 环境没有 playwright（手册的浏览器 e2e 跑不了），这里用 vm + 假 egret stub
 * 驱动真实的 web/skill-fx.js：验证 install 装配 / 桥 setFx / 弹窗开关 /
 * paint 全路径不炸 / 分页钩子口径。真 egret 观感按手册铁律 4 由真机验收。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const load = f => readFileSync(new URL(f, ROOT), 'utf8');

function makeStub() {
  const calls = { addChild: 0, alert: [] };
  const graphics = () => ({ beginFill() {}, drawRoundRect() {}, drawRect() {}, endFill() {}, lineStyle() {}, clear() {}, moveTo() {}, lineTo() {} });
  class Sprite {
   constructor() { this.children = []; this.touchEnabled = false; this._listeners = {}; }
   addChild(c) { this.children.push(c); if (c) c.parent = this; calls.addChild++; return c; }
   removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); }
   removeChildren() { this.children.length = 0; }
   getChildAt(i) { return this.children[i]; }
   get numChildren() { return this.children.length; }
   addEventListener(type, fn, thisObj) { (this._listeners[type] = this._listeners[type] || []).push({ fn, thisObj }); }
   /** 测试专用：触发某类事件的所有监听（真实 egret 由输入系统派发）。 */
   trigger(type, ev) { for (const l of this._listeners[type] || []) l.fn.call(l.thisObj || this, ev || { stopPropagation() {} }); }
   globalToLocal(x, y) { return { x, y }; }
  }
  class Shape extends Sprite { constructor() { super(); this.graphics = graphics(); } }
  class TextField extends Sprite { constructor() { super(); this.text = ''; this.size = 20; } }
  class ImageStub extends Sprite { constructor() { super(); this.width = 0; this.height = 0; } set source(v) { this._src = v; } get source() { return this._src; } }
  class ImageLoader { addEventListener() {} load() {} get data() { return {}; } }
  const egret = {
   Sprite, Shape, TextField,
   ImageLoader,
   Texture: class { _setBitmapData() {} },
   Rectangle: class { constructor(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; } },
   // ⚠ stub 只提供**引擎库实证存在**的 API（client/js/** 全文搜过的）：
   //   TouchEvent/Event/IOErrorEvent/VerticalAlign/Rectangle/Shape/Sprite/TextField/
   //   ImageLoader/Texture/scrollRect/globalToLocal/drawRoundRect/_setBitmapData。
   // 故意**不提供** egret.MouseEvent —— 本定制构建全局 egret 上没有它
   // （MOUSE_WHEEL 常量引擎库全文 0 命中，热修二堆栈实证）。stub 与真构建的
   // API 集对齐，测试才能守住在真机上会炸的点。
   TouchEvent: { TOUCH_TAP: 'tap', TOUCH_BEGIN: 'begin', TOUCH_MOVE: 'move', TOUCH_END: 'end', TOUCH_CANCEL: 'cancel' },
   Event: { COMPLETE: 'complete' },
   IOErrorEvent: { IO_ERROR: 'ioerror' },
   VerticalAlign: { MIDDLE: 'middle' },
   BitmapFillMode: { SCALE: 'scale' }
  };
  const storage = new Map();
  const ctx = {
   console, egret, eui: { Image: ImageStub },
   setTimeout: (fn) => 0, clearTimeout: () => {},     // 弹窗的 180ms 屏蔽/3s 删清单确认在测试里立即失效
   setInterval: () => 0, clearInterval: () => {},     // 行按钮轮询在测试里不真跑
   localStorage: {
    getItem: k => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: k => storage.delete(k)
   },
   document: { createElement: () => ({ style: {}, focus() {}, select() {}, addEventListener() {}, value: '' }), body: { appendChild() {}, removeChild() {} } },
   window: null
  };
  ctx.window = ctx;
  // 假舞台：go.gameStage 是真舞台（zip 同源实证）
  ctx.go = { gameStage: Object.assign(new Sprite(), { stageWidth: 720, stageHeight: 1280 }) };
  // 假 req：UI=1（alertMessage）、World=5（myPlayer）
  ctx.__worldReq = id => {
   if (id === 1) return { default: { alertMessage: m => calls.alert.push(m) } };
   if (id === 5) return { default: { myPlayer: { id: 1001, skillList: [
    { id: 108, name: '劈砍', level: 22, type: 3 },
    { id: 205, name: '重击', level: 10, type: 2 },
    { id: 900, name: '基础掌法', level: 1, type: 1 }
   ] } } };
   throw Error('unexpected module ' + id);
  };
  vm.createContext(ctx);
  vm.runInContext(load('web/skill-fx-core.js'), ctx);
  vm.runInContext(load('web/worldol-fx-thumbs.js'), ctx);
  vm.runInContext(load('web/skill-fx.js'), ctx);
  return { ctx, calls, storage };
}

test('UI 装配：installSkillFx 挂桥，缩略图内嵌表就绪', () => {
  const { ctx } = makeStub();
  const ret = ctx.window.installSkillFx(ctx.__worldReq);
  assert.equal(ret.revision, 'skill-fx-ui-20261025-v4');
  assert.equal(typeof ctx.window.__worldolSkillFx.resolveForBattle, 'function');
  const icons = ctx.WOL_FX_THUMBS.icons;
  const n = Object.keys(icons).length;
  assert.ok(n >= 170, '内嵌缩略图应至少有 170 张，实际 ' + n);
});

test('弹窗生命周期：开 / paint 全路径 / 分页 / 关', () => {
  const { ctx } = makeStub();
  ctx.window.installSkillFx(ctx.__worldReq);
  const ui = ctx.window.__worldolSkillFxUI;
  assert.equal(ui.isOpen(), false);
  ui.open(108, 22, '劈砍');
  assert.equal(ui.isOpen(), true, 'open 后面板应打开（findStage 走 go.gameStage）');
  const info = ui.pageInfo();
  assert.ok(info && info.pages >= 1, 'pageInfo 应有值');
  assert.equal(info.page, 1);
  ui.gotoPage(2);
  assert.equal(ui.pageInfo().page, 2, 'gotoPage(2) 后当前页应为 2');
  ui.gotoPage(99);
  assert.equal(ui.pageInfo().page, info.pages, '越界应钳到末页');
  ui.gotoPage(1);
  assert.equal(ui.pageInfo().page, 1, '回退应到第 1 页');
  ui.close();
  assert.equal(ui.isOpen(), false);
});

test('桥接：setFx 落盘 + resolveForBattle 端到端 + 行高亮查询', () => {
  const { ctx, storage } = makeStub();
  ctx.window.installSkillFx(ctx.__worldReq);
  const bridge = ctx.window.__worldolSkillFx;
  assert.equal(bridge.status().roleId, 1001);
  assert.equal(bridge.getFx(108), null, '初始无配置');
  assert.equal(bridge.setFx(108, 1305), true);
  assert.equal(bridge.getFx(108), 1305);
  assert.equal(bridge.resolveForBattle('劈砍'), 1305, '战斗中按技能名解析出配置号');
  assert.equal(bridge.resolveForBattle('基础掌法'), null, '被动技能不在索引');
  assert.equal(bridge.resolveForBattle('不存在的技能'), null);
  assert.ok(storage.has('worldol.skillFx'), '配置应落 localStorage');
  // 随机模式端到端
  bridge.setFx(205, { r: 'all' });
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(bridge.resolveForBattle('重击'));
  assert.ok(seen.size > 1, '全池随机应能抽到多个号');
  // 清单随机端到端
  const lid = bridge.createList('测试清单');
  bridge.toggleStar(lid, 1215);
  bridge.toggleStar(lid, 1222);
  bridge.setFx(205, { r: lid });
  for (let i = 0; i < 50; i++) assert.ok([1215, 1222].includes(bridge.resolveForBattle('重击')), '清单随机只能抽清单内');
  // 恢复默认
  bridge.setFx(108, null);
  assert.equal(bridge.getFx(108), null);
  assert.equal(bridge.resolveForBattle('劈砍'), null);
});

test('删清单二次确认的语义由桥保证：删除后引用它的配置回退', () => {
  const { ctx } = makeStub();
  ctx.window.installSkillFx(ctx.__worldReq);
  const bridge = ctx.window.__worldolSkillFx;
  const lid = bridge.createList('临时');
  bridge.toggleStar(lid, 1305);
  bridge.setFx(205, { r: lid });
  assert.ok([1305].includes(bridge.resolveForBattle('重击')));
  assert.equal(bridge.deleteList(lid), true);
  assert.equal(bridge.resolveForBattle('重击'), null, '清单删了 ⇒ 配置回退为不干预');
  assert.equal(bridge.deleteList(lid), false, '重复删除返回 false');
});

test('starTo 切换与 e2e 钩子存在性（守门断言对应物）', () => {
  const { ctx } = makeStub();
  ctx.window.installSkillFx(ctx.__worldReq);
  const ui = ctx.window.__worldolSkillFxUI;
  assert.equal(ui.revision, 'skill-fx-ui-20261025-v4');
  assert.equal(typeof ui.gotoPage, 'function');
  assert.equal(typeof ui.pageInfo, 'function');
  const bridge = ctx.window.__worldolSkillFx;
  assert.deepEqual(Object.keys(bridge.lists().pl), []);
  const lid = bridge.createList('A');
  assert.equal(bridge.starTo(lid), true);
  assert.equal(bridge.lists().starTo, lid);
  assert.equal(bridge.starTo(lid), true, '再点一次取消');
  assert.equal(bridge.lists().starTo, null);
});

test('挂载时面板已开着：现存活行也要补到按钮（真机 BUG 回归钉子）', () => {
  // 复现用户反馈：先打开技能面板（行已在舞台上），轮询才扫到 ⇒ 原型补丁只对
  // 之后新建的行生效，已存在的行不走 dataChanged ⇒ 按钮永远不出现。
  const { ctx } = makeStub();
  const stage = ctx.go.gameStage;
  const row = Object.assign(new ctx.egret.Sprite(), {
   textSkillName: {}, btnCheckBox: { x: 433, y: -3, height: 50 }, btnDel: {},
   data: { type: 3, id: 108, name: '劈砍', level: 22 }
  });
  stage.addChild(row);                                     // 行先上舞台
  ctx.window.installSkillFx(ctx.__worldReq);               // 后安装（同步 scanRows 就在此刻跑）
  assert.equal(ctx.window.__worldolSkillFxUI.status().rowsOnStage, 1, '诊断应看到 1 个技能行');
  assert.ok(row.__worldolSkillFxBtn, '挂载时已存在的行必须被补上按钮');
  assert.equal(row.__worldolSkillFxBtn.visible, true, '主动技能行的按钮应可见');
  // 被动行不可见
  const passive = Object.assign(new ctx.egret.Sprite(), {
   textSkillName: {}, btnCheckBox: { x: 433, y: -3, height: 50 }, btnDel: {},
   data: { type: 1, id: 900, name: '基础掌法', level: 1 }
  });
  stage.addChild(passive);
  ctx.window.__worldolSkillFxUI.rescan();
  assert.ok(passive.__worldolSkillFxBtn, '被动行也挂按钮但隐藏');
  assert.equal(passive.__worldolSkillFxBtn.visible, false, '被动行按钮应隐藏');
  // 已配置特效的行：金色高亮（按钮底色图形被重绘过）
  ctx.window.__worldolSkillFx.setFx(108, 1305);
  ctx.window.__worldolSkillFxUI.rescan();
  assert.equal(row.__worldolSkillFxBtn.visible, true);
});

test('点击链路：点「效」按钮 → openForRow → openPanel → paint 全流程不炸', () => {
  // 真机反馈：按钮出来了，点击却报 Cannot read properties of null (reading 'layer')。
  // stub 的 addEventListener 以前是空转，点击路径从未被测试覆盖——这个用例补上盲区。
  const { ctx, calls } = makeStub();
  const stage = ctx.go.gameStage;
  const row = Object.assign(new ctx.egret.Sprite(), {
   textSkillName: {}, btnCheckBox: { x: 433, y: -3, height: 50 }, btnDel: {},
   data: { type: 3, id: 108, name: '劈砍', level: 22 }
  });
  stage.addChild(row);
  ctx.window.installSkillFx(ctx.__worldReq);
  const btn = row.__worldolSkillFxBtn;
  assert.ok(btn, '先要有按钮');
  btn.trigger('tap');                                       // 第一次点：应正常打开
  assert.equal(ctx.window.__worldolSkillFxUI.isOpen(), true, '点击后面板应打开');
  assert.equal(calls.alert.length, 0, '第一次点击不应报错');
  btn.trigger('tap');                                       // 面板开着再点：走 paint 重入，不炸
  assert.equal(calls.alert.length, 0, '重入点击不应报错');
  ctx.window.__worldolSkillFxUI.close();
  btn.trigger('tap');                                       // 关掉再点：重建，不炸
  assert.equal(ctx.window.__worldolSkillFxUI.isOpen(), true, '重建后面板应打开');
  assert.equal(calls.alert.length, 0, '重建点击不应报错');
  // 弹窗里的分页/关闭路径
  ctx.window.__worldolSkillFxUI.gotoPage(2);
  ctx.window.__worldolSkillFxUI.close();
  assert.equal(ctx.window.__worldolSkillFxUI.isOpen(), false);
  assert.equal(calls.alert.length, 0);
});
