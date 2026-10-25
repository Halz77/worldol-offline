/**
 * 第 93 版「技能自定义特效」· 核心逻辑层单测。
 *
 * vm 沙箱 + 假 window/localStorage/icons 表驱动 web/skill-fx-core.js：
 * 覆盖《AI复刻手册》第七节单测清单 —— 三种配置语义 / 清单 CRUD+v1 迁移 /
 * 删除回退 / 结算特例与段外号禁选 / 按角色隔离 / 被动跳过+同名命中 /
 * 旧值兼容+坏档容错 / 分页口径。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const CORE_SRC = readFileSync(new URL('../web/skill-fx-core.js', import.meta.url), 'utf8');
// 假 icons 表：含官方段、自制高段(29990)、结算特例(1320/1333/29998)、段外(42 不在表里)
const ICONS = { 1215: 'd', 1222: 'd', 1305: 'd', 1320: 'd', 1333: 'd', 1470: 'd', 1600: 'd', 29990: 'd', 29998: 'd' };

function makeEnv(roleId = 1001) {
  const storage = new Map();
  const ctx = {
    console,
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k)
    },
    WOL_FX_THUMBS: { icons: ICONS },
    __worldolMyRoleId: () => roleId
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(CORE_SRC, ctx);
  return { ctx, Core: ctx.WolSkillFxCore, storage };
}
const eqArr=(a,b)=>{assert.equal(a.length,b.length,'长度: '+a.length+' vs '+b.length);for(let i=0;i<a.length;i++)assert.equal(a[i],b[i],'下标 '+i+': '+a[i]+' vs '+b[i]);};
const SKILLS = [
  { id: 108, name: '劈砍', level: 22, type: 3 },
  { id: 205, name: '重击(5级)', level: 10, type: 2 },
  { id: 900, name: '基础掌法', level: 1, type: 1 },      // 被动：索引不收
  { id: 901, name: '灵犀一指', level: 5, type: 3 }     // 清单随机用例用
];

test('候选池：剔除结算特例，保留自制高段，段外粗过滤', () => {
  const { Core } = makeEnv();
  const pool = Core.effectPool();
  eqArr(pool, [1215, 1222, 1305, 1470, 1600, 29990]);
  assert.equal(Core.SETTLE_EXCLUDED[1320], true);
});

test('名字索引：只收 type 2/3，被动跳过，去等级后缀归一化', () => {
  const { Core } = makeEnv();
  const idx = Core.buildNameIndex(SKILLS);
  assert.equal(idx['劈砍'].id,108); assert.equal(idx['劈砍'].level,22);
  assert.equal(idx['基础掌法'], undefined, '被动技能不进索引');
  assert.equal(idx['重击(5级)'].id,205); assert.equal(idx['重击(5级)'].level,10);
  assert.equal(idx['重击'].id,205, '归一化键也要能命中'); assert.equal(idx['重击'].level,10);
});

test('三种配置语义：固定号 / 全池随机 / 清单随机', () => {
  const { ctx, Core } = makeEnv();
  const db = Core.loadDb();
  const st = Core.storeFor(db, 1001);
  st.fx[108] = 1305;                                     // 固定
  st.fx[205] = { r: 'all' };                             // 全池随机
  st.pl['1'] = { name: '我的收藏', ids: [1215, 1222] };
  st.fx[901] = { r: '1' };                               // 清单随机
  Core.saveDb(db);
  const resolve = Core.createResolver(() => SKILLS, () => Core.loadDb());
  assert.equal(resolve('劈砍'), 1305, '固定号直接返回');
  const all = new Set();
  for (let i = 0; i < 200; i++) { const v = resolve('重击(5级)'); assert.ok(poolHas(Core, v), '随机必须在池内: ' + v); all.add(v); }
  assert.ok(all.size > 1, '全池随机应该能抽到多个号');
  const fromList = new Set();
  for (let i = 0; i < 100; i++) fromList.add(resolve('灵犀一指'));
  for (const v of fromList) assert.ok([1215, 1222].includes(v), '清单随机只能抽清单内: ' + v);
});

test('resolve 防护：结算特例 / 段外 / icons 缺失号一律不干预', () => {
  const { Core } = makeEnv();
  const db = Core.loadDb();
  const st = Core.storeFor(db, 1001);
  st.fx[108] = 1320;                                      // 结算特例
  st.fx[205] = 42;                                        // 段外（icons 里也没有）
  st.fx[900] = 29998;                                     // 结算特例（高段）
  Core.saveDb(db);
  const resolve = Core.createResolver(() => SKILLS, () => Core.loadDb());
  assert.equal(resolve('劈砍'), null);
  assert.equal(resolve('重击'), null);
  assert.equal(resolve('基础掌法'), null);
});

test('索引 miss ⇒ 强制重建一次（装备穿脱场景）', () => {
  const { Core } = makeEnv();
  let list = SKILLS.slice();
  const db = Core.loadDb();
  Core.storeFor(db, 1001).fx[108] = 1305;
  Core.saveDb(db);
  const resolve = Core.createResolver(() => list, () => Core.loadDb());
  assert.equal(resolve('劈砍'), 1305, '首轮索引就命中');
  list = [];                                               // 模拟装备脱掉、技能从表里消失
  assert.equal(resolve('劈砍'), null, '重建后仍然没有 ⇒ 不干预');
  list = [{ id: 108, name: '劈砍', level: 22, type: 3 }];  // 重新穿上
  assert.equal(resolve('劈砍'), 1305, '索引 miss 后重建应能重新命中');
});

test('按角色 id 隔离', () => {
  const { Core } = makeEnv(1001);
  let db = Core.loadDb();
  Core.storeFor(db, 1001).fx[108] = 1305;
  Core.saveDb(db);
  db = Core.loadDb();
  Core.storeFor(db, 2002).fx[108] = 1222;
  Core.saveDb(db);
  const r1 = Core.createResolver(() => SKILLS, () => Core.loadDb());
  assert.equal(r1('劈砍'), 1305);
  const env2 = makeEnv(2002);                             // 换角色的新上下文（同一 localStorage 由各 env 自带，这里直接改存储验证）
  // 同一份存储里两个角色各配各的：
  const shared = makeEnv(0);
  shared.storage.set('worldol.skillFx', JSON.stringify({ '1001': { fx: { 108: 1305 }, pl: {}, plNext: 1, starTo: null }, '2002': { fx: { 108: 1222 }, pl: {}, plNext: 1, starTo: null } }));
  shared.ctx.__worldolMyRoleId = () => 1001;
  const a = shared.Core.createResolver(() => SKILLS, () => shared.Core.loadDb());
  shared.ctx.__worldolMyRoleId = () => 2002;
  const b = shared.Core.createResolver(() => SKILLS, () => shared.Core.loadDb());
  shared.ctx.__worldolMyRoleId = () => 1001;
  assert.equal(a('劈砍'), 1305);
  shared.ctx.__worldolMyRoleId = () => 2002;
  assert.equal(b('劈砍'), 1222);
  assert.equal(env2.Core.effectPool().length, 6);
});

test('清单 CRUD + v1 fav 迁移 + 删除回退', () => {
  const { Core, storage } = makeEnv();
  // v1 遗留格式：fav 数组
  storage.set('worldol.skillFx', JSON.stringify({ '1001': { fx: { 108: 1215 }, fav: [1222, 1305], pl: {}, plNext: 1, starTo: null } }));
  let db = Core.loadDb();
  let st = Core.storeFor(db, 1001);
  assert.equal(st.pl['1'].name,'我的收藏','fav 应迁移为默认清单'); eqArr(st.pl['1'].ids,[1222,1305]);
  assert.equal(st.starTo, '1', 'starTo 指向迁移出的清单');
  assert.equal(st.fav, undefined, 'fav 应被删除');
  // 建新清单
  const lid = (() => { const d = Core.loadDb(); const s = Core.storeFor(d, 1001); const id = String(s.plNext++); s.pl[id] = { name: '二队', ids: [] }; Core.saveDb(d); return id; })();
  st = Core.storeFor(Core.loadDb(), 1001);
  assert.equal(st.pl[lid].name, '二队');
  // 删清单：引用它的随机配置回退全池
  st.fx[205] = { r: '1' };
  Core.saveDb(Core.loadDb());
  const d2 = Core.loadDb(); const s2 = Core.storeFor(d2, 1001);
  delete s2.pl['1'];
  for (const k of Object.keys(s2.fx)) { const c = s2.fx[k]; if (c && typeof c === 'object' && c.r === '1') delete s2.fx[k]; }
  Core.saveDb(d2);
  const resolve = Core.createResolver(() => SKILLS, () => Core.loadDb());
  assert.equal(resolve('重击'), null, '清单被删后配置应清空（回退=不干预，玩家可再选）');
  assert.equal(resolve('劈砍'), 1215, '无关角色的固定配置不受影响');
});

test('坏档容错：localStorage 里是垃圾 / 存不了都不炸', () => {
  const { ctx, Core } = makeEnv();
  ctx.localStorage.setItem('worldol.skillFx', '{bad json');
  const db = Core.loadDb();
  assert.equal(Object.keys(db).length, 0);
  const st = Core.storeFor(db, 1001);
  st.fx[108] = 1305;
  ctx.localStorage.setItem = () => { throw new Error('quota'); };
  assert.equal(Core.saveDb(db), false, '保存失败应返回 false 不抛');
  const resolve = Core.createResolver(() => SKILLS, () => Core.loadDb());
  assert.equal(resolve('劈砍'), null, '存不进去时按未配置处理');
});

test('旧值兼容 + 无角色时不解析', () => {
  const { ctx, Core } = makeEnv(0);
  ctx.localStorage.setItem('worldol.skillFx', JSON.stringify({ '1001': { fx: { 108: '1305' }, pl: {}, plNext: 1, starTo: null } }));
  const resolve = Core.createResolver(() => SKILLS, () => Core.loadDb());
  ctx.__worldolMyRoleId = () => 0;
  assert.equal(resolve('劈砍'), null, '没进角色不解析');
  ctx.__worldolMyRoleId = () => 1001;
  assert.equal(resolve('劈砍'), null, '字符串旧值（非法 cfg）不采纳');
});

test('分页：页数 / gotoPage 钳制 / 末页页高口径特判', () => {
  const { Core } = makeEnv();
  assert.equal(Core.pageCount(0, 520), 1);
  assert.equal(Core.pageCount(1120, 520), 3, '1120/520 ⇒ 3 页');
  // 末页坑：contentH=1500, viewH=520, rowH=56 → 页数 3，滚动到底 floor(-928/56)+1=17? 不，scroll 域 [-980,0]
  assert.equal(Core.pageOfScroll(0, 520, 1500), 1);
  assert.equal(Core.pageOfScroll(-520, 520, 1500), 2);
  assert.equal(Core.pageOfScroll(-980, 520, 1500), 3, '滚到底必须是末页（floor 公式会少算）');
  assert.equal(Core.pageOfScroll(-979.4, 520, 1500), 2, '特判边界外按公式');
  assert.equal(Core.pageOfScroll(-979.6, 520, 1500), 3, 'y<=-max+0.5 命中末页特判');
  // 整倍数无坑
  assert.equal(Core.pageOfScroll(-1040, 520, 1560), 3);
});

function poolHas(Core, v) { return Core.effectPool().includes(v); }
