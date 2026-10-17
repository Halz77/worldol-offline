#!/usr/bin/env node
/**
 * 从社区版（第三方）APK 里提取服务端模块源码。
 *
 * 背景：社区单机版的服务端 bundle（assets/www/client/worldol-standalone.js）没有混淆，
 * 而且 esbuild 会给每个源文件留一行 `// lib/xxx.mjs` 注释 —— 按这行切分就能拿到接近
 * 原样的模块代码，再改写成本工程的 ESM 模块即可。
 *
 * 用法：
 *   node tools/extract-community-modules.mjs <apk路径> [输出目录]
 *   默认输出到 os.tmpdir()/community-modules
 *
 * 注意：产物是 esbuild 展开后的代码（var 代替 const、变量名可能被重命名、依赖靠闭包），
 * 不能直接当 ESM 用，需要按引用关系改写 import。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

const apk=process.argv[2];
if(!apk||!fs.existsSync(apk)){
 console.error('用法: node tools/extract-community-modules.mjs <apk路径> [输出目录]');
 process.exit(1);
}
const outDir=process.argv[3]||path.join(os.tmpdir(),'community-modules');

/**
 * 从 zip 里取一个条目（走**中央目录**：本地文件头的大小字段在 data descriptor 模式下会是 0，
 * 只有中央目录里的才是准的）。
 */
function readZipEntry(buf,name){
 const eocd=buf.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
 if(eocd<0)return null;
 const count=buf.readUInt16LE(eocd+10);
 let p=buf.readUInt32LE(eocd+16);
 for(let i=0;i<count;i++){
  if(buf.readUInt32LE(p)!==0x02014b50)break;
  const method=buf.readUInt16LE(p+10);
  const csize=buf.readUInt32LE(p+20);
  const nlen=buf.readUInt16LE(p+28),elen=buf.readUInt16LE(p+30),clen=buf.readUInt16LE(p+32);
  const localOff=buf.readUInt32LE(p+42);
  const entryName=buf.subarray(p+46,p+46+nlen).toString('utf8');
  if(entryName===name){
   // 本地头：30 字节 + 文件名 + 扩展区
   if(buf.readUInt32LE(localOff)!==0x04034b50)return null;
   const lnlen=buf.readUInt16LE(localOff+26),lelen=buf.readUInt16LE(localOff+28);
   const start=localOff+30+lnlen+lelen;
   const raw=buf.subarray(start,start+csize);
   return method===8?zlib.inflateRawSync(raw):raw;
  }
  p+=46+nlen+elen+clen;
 }
 return null;
}

const buf=fs.readFileSync(apk);
// 社区版把服务端 bundle 放在 client/ 下；找不到就报错，避免静默产出空文件
const candidates=['assets/www/client/worldol-standalone.js','assets/public/worldol-standalone.js'];
let src=null,used=null;
for(const name of candidates){
 const bytes=readZipEntry(buf,`/${name}`.slice(1))||readZipEntry(buf,name);
 if(bytes){src=bytes.toString('utf8');used=name;break;}
}
if(!src){
 console.error('没在 APK 里找到 worldol-standalone.js（试过 '+candidates.join(' / ')+'）');
 process.exit(1);
}
console.log('服务端 bundle:',used,src.length,'字符');

fs.mkdirSync(outDir,{recursive:true});
const re=/^[ \t]*\/\/[ \t]*(?:\.\.\/)?(?:世界online_原版单机\/)?(?:lib|web|standalone)\/([\w.-]+\.(?:mjs|js))[ \t]*$/gm;
const marks=[];
let m;
while((m=re.exec(src)))marks.push({name:m[1],start:m.index,end:re.lastIndex});

const best=new Map();
for(let i=0;i<marks.length;i++){
 const body=src.slice(marks[i].end,i+1<marks.length?marks[i+1].start:src.length).trim();
 const prev=best.get(marks[i].name);
 if(!prev||prev.body.length<body.length)best.set(marks[i].name,{body,len:body.length});
}
for(const [name,{body}] of best){
 fs.writeFileSync(path.join(outDir,name.replace(/[\\/:*?"<>|]/g,'_')),body,'utf8');
}
console.log('导出模块:',best.size,'→',outDir);
const top=[...best.entries()].sort((a,b)=>b[1].len-a[1].len).slice(0,10);
for(const [n,v] of top)console.log('  '+String(v.len).padStart(7)+'  '+n);
