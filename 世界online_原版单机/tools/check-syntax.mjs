#!/usr/bin/env node
// 语法基线检查（架构评审第 9 条的第 1 件）。逻辑都在 tools/syntax-baseline.mjs，
// 这里只负责命令行输出。
//
//   node tools/check-syntax.mjs               检查全部
//   node tools/check-syntax.mjs --quiet       通过时不出声（给 npm test 挂前置用）
//   node tools/check-syntax.mjs --only lib/   只查路径含 "lib/" 的
//   node tools/check-syntax.mjs --list        列出会被检查的文件
import {ROOT,collectFiles,scanSyntax,FRAGMENTS} from './syntax-baseline.mjs';

const argv=process.argv.slice(2);
const has=name=>argv.includes(name);
const onlyIndex=argv.indexOf('--only');
const only=onlyIndex>=0?String(argv[onlyIndex+1]||''):'';

if(has('--list')){
 const files=collectFiles(ROOT).filter(file=>!only||file.includes(only));
 for(const file of files)console.log(file+(FRAGMENTS.has(file)?'   ← 片段，包括号解析':''));
 console.log(`[check] 共 ${files.length} 个文件`);
 process.exit(0);
}

const {files,failures,ms}=scanSyntax(ROOT,{only});

if(!files.length){
 console.error(`[check] --only "${only}" 没有匹配到任何文件`);
 process.exit(1);
}

if(!failures.length){
 if(!has('--quiet'))console.log(`[check] 语法基线：文件 ${files.length} 个｜错误 0｜耗时 ${ms}ms`);
 process.exit(0);
}

console.log(`[check] 语法基线：文件 ${files.length} 个｜错误 ${failures.length} 个｜耗时 ${ms}ms`);
for(const failure of failures)console.log(`  ✗ ${failure.file}:${failure.line}:${failure.column}  ${failure.message}`);
console.log('  改完再跑一次：node tools/check-syntax.mjs');
process.exit(1);
