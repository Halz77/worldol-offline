/**
 * 惰性数据容器 —— 让 `lib/*.mjs` 顶层不再把大 JSON 解析进堆。
 *
 * 背景（架构评审 P1-1）：单机版启动时会 eager 解析 11 份 `data/*.json`，
 * 合计约 110 MB 原文、GC 后仍常驻 ~70 MB。其中大多数只在特定面板或特定
 * 玩法里用得到（技能图鉴、录制内容、宠物目录、掉落表……），却跟着
 * `server.mjs` 的 import 图一起进了堆。
 *
 * 做法：模块顶层只登记「怎么造」，不真的造。导出项包一层代理，
 * **第一次用到时才执行 init()**。使用方代码一行都不用改：
 *
 *   import {careerDirectory} from './career-skills.mjs';
 *   answer(res,200,mime['.json'],careerDirectory);   // 到这里才读盘
 *
 * 代理把函数属性绑定回真值（Map/Set 的方法依赖 this 的内部槽），
 * 并转发 ownKeys / getOwnPropertyDescriptor / getPrototypeOf，
 * 所以 `for...of`、展开 `{...x}`、`JSON.stringify(x)`、`x instanceof Map`
 * 都按真值的行为走。
 *
 * ⚠️ 不要用它包「每次数据包都要读」的热表（存档、official.items 索引等）：
 * 每次属性访问多一层代理，长期跑不划算。热表保持 eager。
 *
 * 边界（有意保留的限制）：
 *   · `Array.isArray(proxy)` 永远是 false —— 真值是数组时不要用（会静默走错分支）。
 *     `lazyBox` 会在 init 返回数组时**直接抛错**，把这个坑挡在启动期。
 *   · 真值内部的自引用（`a.b=a`）取出来仍是真值对象，不受代理影响。
 */
import fs from 'node:fs';

/** 是否已物化。测试与日志用。 */
export const LAZY_READY=Symbol('worldol.lazy.ready');
/** 无条件物化并返回真值。测试与 `null` 判定用。 */
export const LAZY_FORCE=Symbol('worldol.lazy.force');

const LABELS=new WeakMap();

/** 这个导出项是不是惰性容器？ */
export function isLazy(value){
 // 用属性读取而不是 `in` —— `in` 会被 `has` 陷阱转发到真值上，永远查不到这个私有标记。
 return !!value&&(typeof value==='object'||typeof value==='function')&&value[LAZY_READY]!==undefined;
}

/** 还没物化就是 false —— 用于「启动时不该读盘」这类断言。 */
export function isLazyReady(value){
 return isLazy(value)?value[LAZY_READY]:true;
}

/** 强制物化（返回真值本身），非惰性值原样返回。 */
export function force(value){
 return isLazy(value)?value[LAZY_FORCE]:value;
}

/**
 * 惰性容器。
 *
 * @param {() => any} init   造真值的函数，最多执行一次
 * @param {string} [label]   出错时打日志用
 */
export function lazyBox(init,label){
 if(typeof init!=='function')throw TypeError('lazyBox 需要一个构造函数');
 let value,loaded=false;
 const load=()=>{
  if(!loaded){
   value=init();
   loaded=true;
   if(value===null||typeof value!=='object')throw Error(`惰性数据 ${label||''} 构造出的不是对象：${String(value)}`);
   if(Array.isArray(value))throw Error(`惰性数据 ${label||''} 真值是数组，代理会让 Array.isArray 失效，请直接导出数组或用 {rows:[...]} 包一层`);
  }
  return value;
 };
 // 方法绑定结果缓存：Map/Set/数组方法每次访问都 bind 会产生垃圾。
 const bound=new Map();
 const handler={
  get(_,key){
   if(key===LAZY_READY)return loaded;
   if(key===LAZY_FORCE)return load();
   const target=load();
   const found=Reflect.get(target,key);
   if(typeof found!=='function')return found;
   let fn=bound.get(key);
   if(!fn){fn=found.bind(target);bound.set(key,fn);}
   return fn;
  },
  set(_,key,v){Reflect.set(load(),key,v);return true;},
  has(_,key){return Reflect.has(load(),key);},
  deleteProperty(_,key){return Reflect.deleteProperty(load(),key);},
  defineProperty(_,key,descriptor){Reflect.defineProperty(load(),key,descriptor);return true;},
  ownKeys(){return Reflect.ownKeys(load());},
  getOwnPropertyDescriptor(_,key){
   // target 自身没有属性，所以这里可以自由返回真值的描述符。
   return Reflect.getOwnPropertyDescriptor(load(),key)||{configurable:true,enumerable:true,writable:true,value:undefined};
  },
  getPrototypeOf(){return Reflect.getPrototypeOf(load());},
 };
 const proxy=new Proxy(Object.create(null),handler);
 if(label)LABELS.set(proxy,label);
 return proxy;
}

/** 惰性 JSON 文件：首次访问属性时才读盘 + 解析。 */
export function lazyJson(file,label){
 return lazyBox(()=>JSON.parse(fs.readFileSync(file,'utf8')),label||`lazyJson(${String(file)})`);
}
