/**
 * 语法基线的守卫用例（架构评审第 9 条的第 1 件）。
 *
 * 这条检查本身就是个「检查器」，所以它必须被钉住两件事，否则会变成一个永远绿的摆设：
 *
 *   1. 它**真的能抓到错**。样本就用第 37 版我自己犯过的那个：把
 *      `recordedExpansionRevision` 改成函数后，对象字面量里的简写属性被顺手改成了
 *      调用 `recordedExpansionRevision()` —— 语法错误，当时是靠跑到探针阶段才炸出来的。
 *   2. 它**真的在扫该扫的文件**，尤其是 web/ 那 21 个没有任何执行覆盖的浏览器脚本，
 *      以及根上的 server.mjs。少了哪个，这条检查的覆盖面就无声地缩了。
 *
 * 另外钉两处「不做会误报」的细节：.js 要按 ESM / sloppy 双模式解析；两个 webpack
 * 裸函数体要走白名单，而且白名单不许留下已经不存在的死条目。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,collectFiles,checkSource,scanSyntax,FRAGMENTS} from '../tools/syntax-baseline.mjs';

test('语法基线：全工程扫描无语法错误',()=>{
 const {files,failures,ms}=scanSyntax(ROOT);
 assert.ok(files.length>200,`只扫到 ${files.length} 个文件 —— 扫描范围是不是被改窄了？`);
 assert.deepEqual(failures.map(f=>`${f.file}:${f.line} ${f.message}`),[]);
 // 退回成「每文件起一个 node 进程」会变成 60 秒级，这里挡一下。
 assert.ok(ms<10000,`耗时 ${ms}ms 太慢，是不是又退回 node --check 那种一文件一进程的写法了？`);
});

test('语法基线：覆盖 web/ 全部浏览器脚本与根上的 server.mjs',()=>{
 const files=new Set(collectFiles(ROOT));
 const web=fs.readdirSync(path.join(ROOT,'web')).filter(name=>name.endsWith('.js'));
 assert.ok(web.length>=20,`web/ 下只找到 ${web.length} 个脚本，样本太少`);
 for(const name of web)assert.ok(files.has('web/'+name),`web/${name} 没进扫描清单`);
 assert.ok(files.has('server.mjs'),'根上的 server.mjs 也要扫');
});

test('语法基线：能抓到第 37 版真实犯过的错',()=>{
 // 对照：这是当时正确的写法，不能报错。
 assert.equal(checkSource('const o={a,b:b(),c:1};','lib/x.mjs'),null);
 // 事故：简写属性被改成调用。
 assert.match(checkSource('const o={a,b(),c:1};','lib/x.mjs').message,/Unexpected token/);
 assert.ok(checkSource('cosnt x=1;','lib/x.mjs'),'关键字拼错要报');
 // 样本必须是**真正不闭合**的：`export function f(){return 1}` 是合法的，
 // 那一对花括号正好闭合（第一版这里就写错了，写成了合法代码来断言"报错"）。
 assert.ok(checkSource('export function f(){return 1','lib/x.mjs'),'少了闭合花括号要报');
 assert.ok(checkSource('if(a){b=1','lib/x.mjs'),'少括号要报');
});

test('语法基线：.js 按 ESM / sloppy 双模式解析，不是只认一种',()=>{
 // with 在 module 模式下非法，在浏览器脚本里合法 —— 只认 module 就会误报。
 assert.equal(checkSource('with(o){x=1}','web/x.js'),null);
 assert.ok(checkSource('function f( {','web/x.js'),'两种模式都不合法时要报错');
 // .mjs 只有严格模式，.cjs 只有脚本模式。
 assert.ok(checkSource('with(o){x=1}','lib/x.mjs'),'.mjs 里 with 非法');
 assert.equal(checkSource('with(o){x=1}','tools/x.cjs'),null);
});

test('语法基线：两个裸函数体片段靠白名单包括号，白名单不许留死条目',()=>{
 assert.ok(FRAGMENTS.size>=2);
 for(const file of FRAGMENTS){
  const full=path.join(ROOT,file);
  assert.ok(fs.existsSync(full),`白名单里的 ${file} 已经不存在了 —— 删掉这条白名单，别留死条目`);
  const source=fs.readFileSync(full,'utf8');
  // 不包括号必失败（裸函数体），包了才通过 —— 这正是白名单存在的理由。
  assert.ok(checkSource(source,file,{fragment:false}),`${file} 不包括号竟然能解析？白名单可能已经没必要了`);
  assert.equal(checkSource(source,file),null,`${file} 走白名单后应当通过`);
 }
});
