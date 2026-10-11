/**
 * 协议号常量表 —— 从原版反编译产物里读出来，唯一来源。
 *
 * 原版把整张协议号表定义在 analysis/modules/0019.js，形式是一长串
 *   (e.LC_CHECKEDITION = 5e3), (e.CG_LOGIN_PLAYERCHECK = 1), ...
 * 以前 server.mjs 用一句内联正则把它扫成对象，却只取了 CG_SYSTEM_TIME /
 * CG_SYSTEM_HEART 两个值，其余 700 多个号在服务端和各个 service 里仍然是裸数字。
 * 后果是两头的：
 *   · 读代码时 12001 是什么意思要去翻 0019.js；
 *   · 想把「谁处理 12001」这类问题写进测试，只能把裸数字抄一遍，抄错了没人发现。
 *
 * 现在做成模块：解析一次、冻结、并提供反查（号 → 名字），日志和测试都能直接用。
 *
 * 解析口径与原实现保持一致：只认 `(e.NAME = 数字)` 这种字面量赋值。
 * 0019.js 里唯一的例外是 `ADD_ITEM_DEF = -1`（负数字面量），原实现同样漏掉它，
 * 这里不改口径 —— 免得某天有人以为常量表"变全了"而依赖上新增的那个键。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 协议号定义文件，相对服务端根目录。 */
export const PROTOCOL_SOURCE='analysis/modules/0019.js';

/**
 * 把 0019.js 的源码扫成 `{常量名: 号}`。
 *
 * 单独抽出来是为了测试能直接喂字符串，不必落盘。
 */
export function parseProtocolConstants(source){
 const entries=[...source.matchAll(/\(e\.(\w+) = ([\de]+)\)/g)].map(m=>[m[1],Number(m[2])]);
 return Object.freeze(Object.fromEntries(entries));
}

let cached=null;

/** 读并缓存常量表。`root` 是服务端根目录（server.mjs 所在目录）。 */
export function loadProtocolConstants(root,{refresh=false}={}){
 if(refresh||!cached)cached=parseProtocolConstants(fs.readFileSync(path.join(root,PROTOCOL_SOURCE),'utf8'));
 return cached;
}

/**
 * 反查辅助：`byName['CG_LOGIN_ACTORLIST'] === 10001`，`name(10001) === 'CG_LOGIN_ACTORLIST'`。
 *
 * 一个号可能有多个名字（别名，例如同号的 CG_/S2C_ 成对定义）。`name()` 取
 * 在 0019.js 里**最先出现**的那个，与原版的书写顺序一致，便于比对。
 */
export function protocolLookup(constants){
 const byValue=new Map();
 for(const [name,value] of Object.entries(constants))if(!byValue.has(value))byValue.set(value,name);
 return Object.freeze({
  byName:constants,
  byValue,
  names(value){return Object.entries(constants).filter(([,v])=>v===value).map(([n])=>n);},
  name(value){return byValue.get(value);},
 });
}
