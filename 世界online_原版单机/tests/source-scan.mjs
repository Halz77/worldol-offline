/**
 * 源码扫描辅助 —— 给「按源码做断言」的守卫用例用。
 *
 * 这类用例（client-patch-chain.test.mjs / server-dispatch.test.mjs）会读工程里的
 * .mjs 源码，剥掉注释后断言「某段代码在不在」。剥注释这一步必须可靠，否则
 * **否定式断言会静默空过** —— 断言看着绿，其实那段代码压根没被扫到。
 *
 * 这里踩过两次坑，都是同一个根因（拿正则剥注释）：
 *   1. 行尾用 `$`：文件是 CRLF 时 `$` 匹配不到回车之前，整行注释剥不掉。
 *   2. 先剥块注释：**行注释里出现的“斜杠 + 星号”**会被当成块注释开头，一路吞到
 *      下一个块注释结束符。build.mjs 第 48 行的注释里写了 `web/<星号>.js`，
 *      这一吞正好把 57–62 行的 patchClientBoot() / patchClientMain() 调用整段吃掉，
 *      于是「build.mjs 不该自己打补丁」那种断言永远为真。
 *
 * 所以改成按字符扫，跟踪六种状态。宁可少剥一点（保守），也不能多剥。
 */
const CODE='code',LINE='line',BLOCK='block',SINGLE='single',DOUBLE='double',TEMPLATE='template';

const CLOSER={[SINGLE]:"'",[DOUBLE]:'"',[TEMPLATE]:'`'};

/**
 * 剥掉注释。
 *
 * @param {string} source
 * @param {{strings?:'keep'|'drop'}} [options]
 *   默认 `strings:'keep'`：只剥注释，字符串原样保留（含引号与转义）——
 *   检查 import 路径、锚点文本这类断言需要它。
 *   `strings:'drop'` 连字符串字面量一起丢掉 —— 扫协议号时用，
 *   免得把路径、URL、正则里的数字也算进来。
 */
export function codeOnly(source,{strings='keep'}={}){
 const keep=strings==='keep';
 let out='';
 let state=CODE;
 const n=source.length;
 for(let i=0;i<n;i++){
  const c=source[i],next=source[i+1];
  if(state===CODE){
   if(c==='/'&&next==='/'){state=LINE;i++;continue;}
   if(c==='/'&&next==='*'){state=BLOCK;i++;continue;}
   if(c==="'"){state=SINGLE;if(keep)out+="'";continue;}
   if(c==='"'){state=DOUBLE;if(keep)out+='"';continue;}
   if(c==='`'){state=TEMPLATE;if(keep)out+='`';continue;}
   out+=c;continue;
  }
  if(state===LINE){if(c==='\n'){state=CODE;out+=c;}continue;}
  if(state===BLOCK){if(c==='*'&&next==='/'){state=CODE;i++;}continue;}
  // 字符串内部：转义成对跳过，内容原样保留（'drop' 模式下一律不输出）。
  if(c==='\\'){if(keep)out+=c+(source[i+1]??'');i++;continue;}
  if(keep)out+=c;
  if(CLOSER[state]===c)state=CODE;
 }
 return out;
}
