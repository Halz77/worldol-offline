/**
 * 语法基线 —— 把工程里每个源文件过一遍 parser，只问一件事：能不能解析。
 *
 * 为什么不直接用 `node --check`（架构评审第 9 条原文的写法）：它每个文件都要起一个
 * node 进程，270+ 个文件实测 **64.6 秒**，比整个测试套件还慢。换 acorn 进程内 parse
 * 是 **0.4 秒**（快 146 倍），而 acorn 本来就在 dependencies 里（构建期锁客户端
 * module 56 用的），不用多装任何东西。
 *
 * 它补的是**唯一的执行盲区**：web/ 下 21 个文件没有任何测试真正执行过它们
 * （测试是用假模块表模拟客户端环境的），语法敲坏了只有打开浏览器才会发现。
 *
 * 也说清它抓不到什么，免得被当成万能护栏：
 *   · 补丁模块里要注入客户端的片段 —— 它们以独立文件存在，最终是以字符串拼进去的，
 *     语法错误要到浏览器里才暴露；
 *   · 「漏 import」「孤儿断言」这类跨文件问题 —— 那要靠 eslint 的 no-undef。
 */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as acorn from 'acorn';

/** 工程根（tools/ 的上一级）。 */
export const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

/** 扫这些目录（递归）与这些根文件。 */
export const SCAN_DIRS=['lib','web','tools','tests'];
export const SCAN_ROOTS=['server.mjs'];

/** 不进扫描的目录：依赖，以及按定义会放样例数据的地方（里面的文件可能故意是坏的）。 */
const SKIP_DIRS=new Set(['node_modules','fixtures']);

const EXT=/\.(mjs|cjs|js)$/;

/**
 * 不是完整模块的文件：webpack 模块工厂函数的**裸函数体**（`function(e,t,i){…}` 开头），
 * 单独 parse 必然失败，得先包一层括号。lib/client-battle-font-patch.mjs 读它们。
 */
export const FRAGMENTS=new Set([
 'lib/client-battle-font-module180.js',
 'lib/client-battle-font-module180.orig.js',
]);

/** 收集待检查文件，返回相对 ROOT 的 posix 路径，已排序。 */
export function collectFiles(root=ROOT){
 const files=[];
 const walk=rel=>{
  const full=path.join(root,rel);
  if(!fs.existsSync(full))return;
  for(const name of fs.readdirSync(full).sort()){
   const child=rel+'/'+name;
   if(fs.statSync(path.join(root,child)).isDirectory()){
    if(!SKIP_DIRS.has(name))walk(child);
    continue;
   }
   if(EXT.test(name))files.push(child);
  }
 };
 for(const dir of SCAN_DIRS)walk(dir);
 for(const name of SCAN_ROOTS)if(fs.existsSync(path.join(root,name)))files.push(name);
 return files;
}

function attempt(source,sourceType){
 try{
  acorn.parse(source,{ecmaVersion:'latest',sourceType,allowHashBang:true,locations:true});
  return null;
 }catch(error){
  return {message:error.message,line:error.loc?error.loc.line:0,column:error.loc?error.loc.column:0};
 }
}

/**
 * 解析单个文件。通过返回 null；失败返回 `{message,line,column}`。
 *
 * @param {string} source
 * @param {string} file 相对 ROOT 的 posix 路径（据后缀决定按哪种模式解析）
 * @param {{fragment?:boolean}} [options] 供测试强制指定；默认按 FRAGMENTS 名单判定
 */
export function checkSource(source,file,{fragment}={}){
 const isFragment=fragment===undefined?FRAGMENTS.has(file):fragment;
 // 包一层括号，裸函数体就成了表达式。行号不受影响，只有首行第一个字符前面多一个 '('。
 if(isFragment)return attempt('('+source+'\n)','script');
 // .js 两种模式都试：web/ 是浏览器脚本（可能出现 with / 八进制这类只有非严格模式才合法的
 // 写法），lib/ 与 tools/ 里又有 esbuild 产物。先按 ESM 试，再退回 sloppy script。
 const modes=file.endsWith('.cjs')?['script']:file.endsWith('.mjs')?['module']:['module','script'];
 let first=null;
 for(const mode of modes){
  const failure=attempt(source,mode);
  if(!failure)return null;
  if(!first)first=failure;
 }
 // 两种模式都失败时，报第一种（模块模式）的诊断：位置与「漏括号」这类错更贴。
 return first;
}

/**
 * 扫全工程。
 *
 * @returns {{files:string[],failures:Array<{file:string,message:string,line:number,column:number}>,ms:number}}
 */
export function scanSyntax(root=ROOT,{only=''}={}){
 let files=collectFiles(root);
 if(only)files=files.filter(file=>file.includes(only));
 const failures=[];
 const startedAt=Date.now();
 for(const file of files){
  const failure=checkSource(fs.readFileSync(path.join(root,file),'utf8'),file);
  if(failure)failures.push({file,...failure});
 }
 return {files,failures,ms:Date.now()-startedAt};
}
