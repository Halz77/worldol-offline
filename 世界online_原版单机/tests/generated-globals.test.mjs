/**
 * 「动态生成的客户端全局变量」两个投放口必须一致 —— 第 37 版 APK 在这里翻过车。
 *
 * 有三个 `<script>` 原本由服务端按请求现算，它们有**两个投放口**：服务端走 HTTP
 * （lib/http-routes.mjs 把对象 JSON.stringify 进脚本正文），安卓包没有 HTTP，改由
 * 安卓打包/standalone/globals.mjs 在 entry 里直接铺全局变量。
 *
 * 第 37 版把 `upgradeIdentifyItemIds` 从数组常量改成函数（为了惰性加载鉴定表）时，
 * **只改了服务端那一份**，包里那份还是 `identifyItemIds: upgradeIdentifyItemIds`
 * （函数本身）。客户端 `new Set(rules.advanced.identifyItemIds)` 当场抛
 * `function is not iterable (cannot read property Symbol(Symbol.iterator))`，
 * 整个单机菜单加载不出来 —— 而当时 414 条用例全绿，因为我写的 HTTP 冒烟只打了
 * 服务端那一份，`globals.mjs` 根本不在 lib/ 与 web/ 里。第 38 版补的语法基线也抓不到：
 * 它是**类型错**，不是语法错。
 *
 * 所以这里钉三件事：
 *   1. 两条投放口产出的对象逐字段一致（同一份 lib/generated-globals.mjs）；
 *   2. 这些对象必须是**纯数据**（不含函数 —— 函数在 JSON.stringify 里会被静默丢掉，
 *      两条路给客户端的形状就不一样了），并且客户端会 new Set / 展开的字段必须是数组；
 *   3. 三条生成脚本定义的每个全局量，standalone 的 entry 都得铺上，且 build.mjs 的
 *      generated 列表与路由表对得上。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {createHttpRouter} from '../lib/http-routes.mjs';
import {codeOnly} from './source-scan.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const standalone=path.resolve(root,'..','安卓打包','standalone');
const globals=await import(new URL('../../安卓打包/standalone/globals.mjs',import.meta.url).href);

/** 这三条由服务端动态生成，standalone 下由 entry.mjs 铺成全局变量。 */
const GENERATED=['/equipment-rules.js','/equipment-composition-data.js','/pet-snapshot-data.js'];

/** 客户端会直接 new Set / 展开的字段：不是数组就会当场炸（本用例存在的理由）。 */
const MUST_BE_ARRAY=[
 ['equipmentRules','advanced.identifyItemIds'],
 ['equipmentRules','advanced.identifyScrolls'],
 ['equipmentRules','advanced.starScrolls'],
 ['equipmentRules','star.bands'],
 ['compositionData','sets'],
];

const at=(object,path)=>path.split('.').reduce((value,key)=>value?.[key],object);

/** 找出对象里所有函数值（含嵌套）的路径。 */
function findFunctions(value,prefix=''){
 if(typeof value==='function')return[prefix||'(根)'];
 if(!value||typeof value!=='object')return[];
 return Object.keys(value).flatMap(key=>findFunctions(value[key],prefix?prefix+'.'+key:key));
}

/** 取三条生成脚本的正文、在同一个沙箱里求值，返回那条投放口铺出的全局量。 */
function captureServerGlobals(){
 const router=createHttpRouter({
  root,raw:path.join(root,'client'),
  store:{data:{characters:[],accounts:[]}},
  log(){},controlToken:'test-token',port:1,stats:()=>({}),onMissing(){},onShutdown(){},
 });
 const sandbox={};sandbox.window=sandbox;
 vm.createContext(sandbox);
 for(const target of GENERATED){
  const route=router.routes.find(r=>r.kind==='path'&&r.path===target);
  assert.ok(route,`路由表里没有 ${target} —— build.mjs 的 generated 列表和它对不上`);
  let body='';
  const res={writeHead(){},end(text=''){body+=text;}};
  route.reply({res,req:{method:'GET',headers:{}},url:new URL('http://x'+target),pathname:target});
  assert.ok(body.length>10,`${target} 没有产出任何内容`);
  vm.runInContext(body,sandbox,{timeout:5000,filename:target});
 }
 return {sandbox,routes:router.routes};
}

const server=captureServerGlobals();

/**
 * 两边都过一遍 JSON 往返再比。
 *
 * 坑：vm 沙箱里的对象属于**另一个 realm**，原型不是宿主这边的 Object.prototype，
 * 而 assert/strict 的 deepEqual 是 deepStrictEqual、要连原型一起比 —— 直接比会
 * 报「不一致」却看不到任何字段差异。JSON 往返把两边都拉回宿主 realm，也顺带把
 * 「客户端实际拿到的形状」定死了（客户端拿到的本来就是 JSON 那一份）。
 */
const plain=value=>JSON.parse(JSON.stringify(value));

test('生成脚本：两条投放口（HTTP 正文 / standalone 全局量）给的形状逐字段一致',()=>{
 assert.deepEqual(plain(globals.equipmentRules),plain(server.sandbox.worldolEquipmentRules),
   'lib/generated-globals.mjs 与 安卓打包/standalone/globals.mjs 分叉了');
 assert.deepEqual(plain(globals.compositionData),plain(server.sandbox.worldolCompositionData));
 assert.deepEqual(plain(globals.petSnapshotDirectory([])),plain(server.sandbox.offlinePetSnapshotProfiles));
 assert.equal(typeof globals.starLimit,'function','starLimit 两条路都是同一个函数');
});

test('生成脚本：必须是纯数据，不许有函数漏进客户端对象',()=>{
 // 这一条就是第 37 版事故的直接断言：identifyItemIds 变成了函数。
 assert.deepEqual(findFunctions(globals.equipmentRules),[],
   'equipmentRules 里有函数值 —— JSON.stringify 会把它静默丢掉，'
   +'服务端那条投放口给客户端的字段会凭空消失（第 37 版就是这么炸的）');
 assert.deepEqual(findFunctions(globals.compositionData),[]);
 assert.deepEqual(findFunctions(server.sandbox.worldolEquipmentRules),[]);
 assert.deepEqual(findFunctions(server.sandbox.worldolCompositionData),[]);
});

test('生成脚本：客户端会 new Set / 展开的字段必须是数组',()=>{
 for(const [owner,field] of MUST_BE_ARRAY){
  const value=at(globals[owner],field);
  assert.ok(Array.isArray(value),`${owner}.${field} 必须是数组，实际是 ${typeof value} —— 客户端 new Set / 展开会抛 "is not iterable"`);
 }
 // 客户端 web/equipment-workshop.js 第 6 行的原样动作。
 assert.ok(new Set(globals.equipmentRules.advanced.identifyItemIds).size>0);
 assert.ok([...new Set(globals.equipmentRules.advanced.identifyItemIds)].every(Number.isInteger));
});

test('生成脚本：每条脚本定义的全局量，standalone 的 entry 都要铺上',()=>{
 const defined=Object.keys(server.sandbox).filter(name=>/^(worldol|offline)/.test(name)).sort();
 // 数量钉死，避免「加了第 4 条生成脚本但忘了同步这里」变成静默空过。
 assert.deepEqual(defined,['offlinePetSnapshotProfiles','worldolCompositionData','worldolEquipmentRules','worldolStarLimit']);
 const entry=codeOnly(fs.readFileSync(path.join(standalone,'entry.mjs'),'utf8'));
 for(const name of defined){
  assert.match(entry,new RegExp('globalThis\\.'+name+'\\s*='),`entry.mjs 没有铺 ${name}，安卓包里它会是 undefined`);
 }
 // 防空过：entry.mjs 确实读了这份文件，而不是把这些赋值写在别处。
 assert.match(entry,/globals\.mjs/);
});

test('生成脚本：build.mjs 的 generated 列表与路由表对得上',()=>{
 const build=codeOnly(fs.readFileSync(path.join(standalone,'build.mjs'),'utf8'));
 const block=/const generated\s*=\s*\[([^\]]*)\]/.exec(build);
 assert.ok(block,'build.mjs 里找不到 generated 列表 —— 形态变了就同步这个用例');
 const listed=[...block[1].matchAll(/['"]([^'"]+)['"]/g)].map(m=>m[1]);
 // 这两条必须相等：build.mjs 负责把这三条从 index.html 里摘掉、由 entry 注入全局量，
 // 少摘一条客户端会去请求一个不存在的静态文件，多摘一条这个全局量就没人铺了。
 assert.deepEqual([...listed].sort(),[...GENERATED].sort());
});
