/**
 * 惰性加载与启动成本的守卫用例（架构评审 P1-1 / P1-3）。
 *
 * 这两条改动最容易在几个月后被"顺手改回去"：
 *
 *   · 有人为了图方便，把某个 `lib/*.mjs` 顶层的惰性构造改回
 *     `JSON.parse(fs.readFileSync(...))` —— 语法、功能、甚至其它用例都还是绿的，
 *     只有启动内存悄悄涨回去。
 *   · 有人把 `createHttpRouter()` 里的补丁预热改回"构造时就算"，于是每次启动
 *     白白跑一遍 4.4 MB 主包的字符串注入。
 *
 * 所以这里不看实现，只看**行为**：给 `fs.readFileSync` 打桩，再动态 import
 * 目标模块，把「加载期读过的文件」收集回来。断言的是这些大 JSON 一个字节都不该被读。
 *
 * 两个实现细节：
 *   1. 用带查询串的 URL 强制重新执行模块顶层（见 freshImport）——否则同进程里
 *      第二次 import 命中缓存、顶层不重跑，断言会**空过**。这是本项目里踩过的坑。
 *   2. 不用子进程：本机 spawnSync 到 node.exe 恒 EBUSY（WorkBuddy 的二进制被占），
 *      子进程方案在这里根本跑不起来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {lazyBox,lazyJson,isLazy,isLazyReady,force,LAZY_READY} from '../lib/lazy-data.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));

let seq=0;
/** 强制重新执行模块顶层，避开 ESM 的模块缓存。 */
const freshImport=rel=>import(new URL(`${rel}?lazy-guard=${++seq}`,import.meta.url).href);

/** 在打桩窗口里跑 `body`，返回它读过的文件（正斜杠）。 */
async function withReadProbe(body){
 const reads=[];
 const orig=fs.readFileSync;
 fs.readFileSync=function(p,...a){reads.push(String(p).replace(/\\/g,'/'));return orig.call(fs,p,...a);};
 try{ return {value:await body(),reads}; }
 finally{ fs.readFileSync=orig; }
}

/** 这些模块加载时必须一个字节都不读它们自己的大 JSON。 */
const LAZY_MODULES=[
 ['../lib/official-data.mjs','official',['data/official-v305.json']],
 ['../lib/recorded-content.mjs','recorded',['data/recorded-content.json']],
 ['../lib/recorded-expansion.mjs','recordedExpansion',['data/recorded-expansion-20260922.json']],
 ['../lib/career-skills.mjs','careers',['data/career-skills.json','data/career-skill-directory.json']],
 ['../lib/pet-catalog.mjs','petCatalog',['data/pet-catalog.json']],
 ['../lib/daily-activity.mjs','dailyData',['data/daily-activity-v1.json']],
 ['../lib/equipment-skill-levels.mjs','equipmentSkillLevels',['data/equipment-skill-levels.json','data/equipment-skill-levels-extra.json']],
 // item-affixes 没有惰性导出可查（ranges/gemDefinitions 是模块私有的），
 // 只断言它加载时不读那两张表。upgradeRules 是有意留在顶层的 1.4 KB 小文件。
 ['../lib/item-affixes.mjs',null,['data/item-affix-layouts.json','data/manual-item-grants.json']],
 ['../lib/home-feature-data.mjs','homeFeatureData',['data/home-features-v1.json','data/home-feature-catalogs.json']],
 ['../lib/loot.mjs','dropCatalog',['data/drop-catalog.json']],
 ['../lib/restoration.mjs','equipment',['data/restored-v03.json']],
];

for(const [file,exportName,forbidden] of LAZY_MODULES){
 test('惰性：import '+path.basename(file)+' 不解析它自己的大 JSON',async()=>{
  const {value,reads}=await withReadProbe(()=>freshImport(file));
  for(const name of forbidden){
   assert.ok(!reads.some(p=>p.endsWith(name)),
     `${file} 在加载期读了 ${name} —— 顶层是不是又被改回 eager 了？实际读到的 data/ 文件：`
     +(reads.filter(p=>p.includes('data/')).map(p=>p.split('/').pop()).join(', ')||'（无）'));
  }
  // 防空过：模块确实被执行了，而且导出项还没物化。
  if(exportName){
   const exported=value[exportName];
   assert.ok(exported!==undefined,`${file} 没有导出 ${exportName}`);
   assert.equal(isLazyReady(exported),false,`${exportName} 在模块加载期就被物化了`);
  }
 });
}

test('惰性：careerDirectory 与技能表互不牵连（目录原文 9.8 MB 单独待到面板请求）',async()=>{
 // /api/career-skills 是唯一消费者。技能表本身会随「有存档启动」被拉起来，
 // 两者若共用一个 ensure()，目录原文就会跟着每次启动白读 9.8 MB。
 const {value,reads}=await withReadProbe(async()=>{
  const m=await freshImport('../lib/career-skills.mjs');
  m.careers.version;                       // 在探针窗口内把技能表拉起来
  return m;
 });
 assert.ok(reads.some(p=>p.endsWith('career-skills.json')),'访问 careers 应该真的读了技能表');
 assert.ok(!reads.some(p=>p.endsWith('career-skill-directory.json')),'读技能表不该连带读目录原文');
 const {value:after,reads:reads2}=await withReadProbe(()=>value.careerDirectory());
 assert.ok(reads2.some(p=>p.endsWith('career-skill-directory.json')),'调用 careerDirectory() 时才读目录原文');
 assert.equal(typeof after,'string');
});

test('惰性：取用后才物化，且物化后的值与真值一致',async()=>{
 const {value}=await withReadProbe(()=>freshImport('../lib/official-data.mjs'));
 const {official,officialItems,officialMaps}=value;
 assert.equal(isLazyReady(official),false,'加载期不该物化');
 assert.ok(official.missions.length>0,'物化后应能取到任务表');
 assert.equal(isLazyReady(official),true);
 assert.ok(officialItems.size>0&&officialMaps.size>0);
 // 派生索引与主表是同一批对象（不是复制）。
 assert.equal(officialItems.get(official.items[0].id),official.items[0]);
});

test('P1-3：createHttpRouter 构造不读主包、不打补丁；请求 /gd.js 时才打',async()=>{
 const {createHttpRouter}=await import('../lib/http-routes.mjs');
 const makeRouter=()=>createHttpRouter({
  root,raw:path.join(root,'client'),
  store:{data:{characters:[],accounts:[]}},
  log(){},controlToken:'test-token',port:1,
  stats:()=>({}),onMissing(){},onShutdown(){},
 });
 const {value:router,reads}=await withReadProbe(makeRouter);
 assert.ok(!reads.some(p=>p.includes('client/js/ff/')),'构造时不该读客户端主包');
 assert.ok(!reads.some(p=>p.includes('gd.decoded.js')),'构造时不该读引导脚本');
 assert.ok(Array.isArray(router.routes)&&router.routes.length>20,'路由表本身要照常建好');

 // 惰性不等于不加载：请求到了才真的去打补丁。
 const gd=router.routes.find(r=>r.kind==='path'&&r.path==='/gd.js');
 assert.ok(gd,'路由表里应该有 /gd.js');
 const res={writeHead(){},end(){}};
 const {reads:touched}=await withReadProbe(()=>gd.reply({res,req:{method:'GET'},url:new URL('http://x/gd.js'),pathname:'/gd.js'}));
 assert.ok(touched.some(p=>p.includes('gd.decoded.js')),'请求 /gd.js 时才该读引导脚本');
});

// ─────────────────────── 惰性容器本身的语义 ───────────────────────

test('lazyBox：构造前不执行，首次访问才执行且只执行一次',()=>{
 let built=0;
 const box=lazyBox(()=>{built++;return {a:1};});
 assert.equal(built,0,'还没访问就不该构造');
 assert.equal(isLazyReady(box),false);
 assert.equal(box.a,1);
 assert.equal(box.a,1);
 assert.equal(built,1,'重复访问只构造一次');
 assert.equal(isLazyReady(box),true);
});

test('lazyBox：Map 的方法、size、迭代与 forEach 都按真值走',()=>{
 const box=lazyBox(()=>new Map([['a',1],['b',2]]));
 assert.equal(box.get('a'),1);
 assert.equal(box.has('b'),true);
 assert.equal(box.size,2);
 assert.ok(box instanceof Map);
 assert.deepEqual([...box.keys()],['a','b']);
 assert.deepEqual([...box.values()],[1,2]);
 const seen=[];box.forEach((v,k)=>seen.push(k+v));
 assert.deepEqual(seen,['a1','b2']);
 assert.equal(new Map([...box]).get('b'),2);
});

test('lazyBox：对象展开、JSON.stringify、in、Object.keys 与写回',()=>{
 const box=lazyBox(()=>JSON.parse('{"x":1,"y":[1,2],"n":{"z":3}}'));
 assert.deepEqual({...box},{x:1,y:[1,2],n:{z:3}});
 assert.equal(JSON.stringify(box),'{"x":1,"y":[1,2],"n":{"z":3}}');
 assert.ok('x' in box);
 assert.deepEqual(Object.keys(box),['x','y','n']);
 const {x,y}=box;assert.equal(x,1);assert.equal(y.length,2);
 box.w=9;assert.equal(force(box).w,9,'写回要落到真值上');
});

test('lazyBox：拒绝数组真值，避免 Array.isArray 静默失真',()=>{
 // 构造发生在首次访问，所以断言访问时炸，而不是调用 lazyBox 本身。
 assert.throws(()=>lazyBox(()=>[1,2,3]).length,/数组/);
 const box=lazyBox(()=>({rows:[1,2,3]}));
 assert.ok(Array.isArray(box.rows));
});

test('lazyJson：构造阶段不碰盘，读到错误时才抛',()=>{
 const missing=new URL('../data/__not-a-real-file__.json',import.meta.url);
 const box=lazyJson(missing);
 assert.equal(isLazy(box),true);
 assert.equal(isLazyReady(box),false,'构造阶段不该尝试读盘');
 assert.throws(()=>box.anything,/ENOENT/);
});
