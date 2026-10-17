// 「技能编辑器.html」的浏览器冒烟测试（可选运行，不进 npm test：它需要一个本机 Chrome/Edge）。
//
// 它做的事：把编辑器 HTML 复制一份到临时目录，在页面尾部注入一段自测脚本（造两个技能的
// 假数据 → 走「载入 → 选中 → 改数值/状态 → 逐级编辑 → 导出」全流程），再用无头浏览器
// 打开并读回结果。用来防止编辑器 UI 逻辑（而不是编码器）回归。
//
// 用法：node tools/skill-editor-selftest.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compileOverrideRule,applyRuleToLevels} from '../lib/local-skill-overrides.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const EDITOR=path.join(root,'技能编辑器.html');
const CANDIDATES=[
 process.env.CHROME||'',
 'C:/Program Files/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
 '/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);

const PROBE=`
<pre id="selftest"></pre>
<script>
(async()=>{
 const log=[];
 const ok=(cond,msg)=>log.push((cond?"PASS  ":"FAIL  ")+msg);
 const mk=(name,obj)=>new File([JSON.stringify(obj)],name,{type:"application/json"});
 const lv=(o)=>Object.assign({id:437,level:1,name:"飘雪穿云掌",type:3,info:"",skillWeapon:18,
   power1:61,powerValue1:-100,statusBit1:1,power2:62,powerValue2:-100,statusBit2:3,power3:87,powerValue3:100,statusBit3:0,
   skillAtkType:2,area:10,round:4,atk_time:1,useMP:10,useHP:0,anime1:0,anime2:1312,anime3:0,position:1,isLearnByBook:false},o);
 try{
  const career={skills:[
   {id:401,name:"基础掌法",profession:"侠客",category:"被动",type:1,levels:[lv({id:401,level:1,name:"基础掌法",type:1,power1:138,powerValue1:2,power2:54,powerValue2:2,power3:2,powerValue3:1,statusBit1:0,statusBit2:0,statusBit3:0})]},
   {id:437,name:"飘雪穿云掌",profession:"侠客",category:"主动",type:3,levels:[lv({level:1}),lv({level:2,powerValue1:-660,powerValue2:-660,useMP:20})]}
  ]};
  const equipment={skills:[{id:6518,levels:[lv({id:6518,level:22,name:"星流冰寒",type:2,power1:69,powerValue1:300,statusBit1:0,power2:0,powerValue2:0,power3:0,powerValue3:0})]}]};
  await loadFromFiles([mk("career-skills.json",career),mk("equipment-skill-levels.json",equipment)]);
  ok(state.skills.size>3,"载入后合并出 "+state.skills.size+" 个技能 id（含内置怪物技能）");
  for(const id of [401,437,6518])ok(state.skills.has(id),"合并后应当保留技能 "+id);
  ok(state.skills.get(437).sources.has("career"),"437 标为人物技能");
  ok(state.skills.get(6518).sources.has("equipment"),"6518 标为装备技能");

  // --- 怪物技能 ---
  const monsterIds=[...state.skills.values()].filter(r=>r.sources.has("monster"));
  ok(monsterIds.length>=200,"内置怪物技能 "+monsterIds.length+" 个");
  ok(state.skills.has(550)&&state.skills.get(550).sources.has("monster"),"550 反魔力场标为怪物技能");
  ok(!state.skills.get(550).sources.has("career"),"550 是怪物专属（人物表里没有）");
  const tagOf=id=>{const li=[...document.querySelectorAll("#skill-list li")].find(x=>x.firstChild.textContent===String(id));return li&&li.lastChild.textContent;};
  ok(tagOf(401)==="人物","列表标签：401 → 人物（实际 "+tagOf(401)+"）");
  ok(tagOf(6518)==="装备/怪物","列表标签：6518 → 装备/怪物（同一 id 被装备和怪物共用，实际 "+tagOf(6518)+"）");
  ok(tagOf(550)==="怪物","列表标签：550 → 怪物（实际 "+tagOf(550)+"）");
  state.filter="monster";renderList();
  const monsterRows=[...document.querySelectorAll("#skill-list li")];
  ok(monsterRows.length===monsterIds.length,"筛选「怪物技能」只列怪物技能（"+monsterRows.length+" vs "+monsterIds.length+"）");
  ok(monsterRows.every(li=>li.textContent.includes("怪物")),"筛选结果都带「怪物」标记");
  state.filter="all";renderList();
  selectSkill(550);
  ok(document.getElementById("edit-pane").textContent.includes("怪物技能"),"选中怪物技能时头部显示「怪物技能」标记");
  setField(550,null,"powerValue1",999);
  const monsterOut=JSON.parse(buildOverrideText());
  ok(monsterOut.skills["550"]&&monsterOut.skills["550"].set.powerValue1===999,"怪物技能的改动能写进覆盖");
  state.rules.delete(550);renderList();renderEditor();

  selectSkill(437);
  ok(document.querySelector("#edit-pane h2").textContent==="飘雪穿云掌","选中后右侧标题正确");
  ok(document.querySelectorAll("#skill-list li").length>3,"左侧列表渲染出技能行");
  ok(document.querySelectorAll("#skill-list li.active").length===1,"选中行高亮");

  // 统一模式改数值 → 写进 set
  setField(437,null,"powerValue1",-5000);
  let out=JSON.parse(buildOverrideText());
  ok(out.skills["437"].levels==="all","默认作用范围是全部等级");
  ok(out.skills["437"].set.powerValue1===-5000,"数值改动写进 set");

  // 状态清零
  setField(437,null,"statusBit1",0);
  setField(437,null,"statusBit2",0);
  out=JSON.parse(buildOverrideText());
  ok(out.skills["437"].set.statusBit1===0&&out.skills["437"].set.statusBit2===0,"状态清零写进 set");

  // 改回原始值 → 自动从覆盖里移除
  setField(437,null,"statusBit1",1);
  out=JSON.parse(buildOverrideText());
  ok(!("statusBit1" in out.skills["437"].set),"改回原值后自动移除该字段（覆盖文件保持干净）");

  // 逐级编辑
  state.perLevel=true;
  applyPerEdit(state.skills.get(437),2,"powerValue1",-9999);
  out=JSON.parse(buildOverrideText());
  ok(out.skills["437"].perLevel["2"].powerValue1===-9999,"逐级值写进 perLevel");
  ok(out.skills["437"].set.powerValue1===-5000,"统一值仍在 set 里（两者可共存）");

  // 指定等级范围
  state.perLevel=false;state.rangeMode="custom";state.picked=new Set([1]);
  setField(437,null,"round",8);
  out=JSON.parse(buildOverrideText());
  ok(Array.isArray(out.skills["437"].levels)&&out.skills["437"].levels[0]===1,"指定等级时 levels 写成数组");

  // 预览与 wire
  renderEditor();
  const paneText=()=>document.getElementById("edit-pane").textContent;
  ok(paneText().includes("wire："),"渲染了 wire 字节预览");
  ok(document.querySelector(".preview").textContent.includes("劈砍防御力"),"预览用游戏文案渲染效果名");

  // 清除覆盖
  state.rules.delete(437);renderList();
  ok(!isEdited(437),"清除后不再标记为已改");
  ok(!JSON.parse(buildOverrideText()).skills["437"],"清除后导出里没有该技能");

  // 被动技能不写主动参数
  selectSkill(401);
  ok(!paneText().includes("武器限制"),"被动技能不显示攻击参数（武器限制/攻击方式…）");
  ok(paneText().includes("技能类型"),"被动技能仍然能改「技能类型」");
  selectSkill(437);
  ok(paneText().includes("武器限制"),"主动技能显示攻击参数");

  // 攻击参数必须是中文下拉，而不是看不懂的编号输入框
  const sel=f=>document.querySelector('.params .pcell[data-field="'+f+'"] select');
  const shown=f=>sel(f)&&sel(f).selectedOptions[0].textContent;
  ok(sel("skillAtkType")&&sel("skillAtkType").value==="2","攻击方式用下拉且带回当前值");
  ok(shown("skillAtkType")==="近身穿刺","攻击方式显示中文名："+shown("skillAtkType"));
  ok(shown("skillWeapon")==="空手","武器限制显示中文名："+shown("skillWeapon"));
  ok(shown("area")==="敌单体","作用范围显示中文名："+shown("area"));
  ok(shown("position")==="目标身前","站位/目标显示中文名："+shown("position"));
  ok(shown("type")==="主动","技能类型显示中文名："+shown("type"));
  for(const f of ["skillWeapon","skillAtkType","area","position"]){
   const node=document.querySelector('.params .pcell[data-field="'+f+'"]');
   ok(node&&!node.querySelector("input[type=number]"),"「"+f+"」不再用数字输入框");
  }
  ok(document.querySelector('.params .pcell[data-field="round"] input[type=number]'),"持续回合仍是数字输入");

  // 改下拉要真的写进覆盖
  sel("skillAtkType").value="4";
  sel("skillAtkType").dispatchEvent(new Event("change"));
  out=JSON.parse(buildOverrideText());
  ok(out.skills["437"].set.skillAtkType===4,"下拉改动写进覆盖（魔法攻击=4）");
  sel("skillWeapon").value="29";
  sel("skillWeapon").dispatchEvent(new Event("change"));
  out=JSON.parse(buildOverrideText());
  ok(out.skills["437"].set.skillWeapon===29,"武器限制改动写进覆盖（扇=29）");

  // 造一份最终覆盖，交给 Node 侧用真实运行时校验（端到端）
  setField(437,null,"powerValue1",-4321);
  setField(437,null,"statusBit1",0);
  setField(437,null,"statusBit2",0);
  state.perLevel=true;
  applyPerEdit(state.skills.get(437),2,"powerValue1",-9999);
  const b64=s=>btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  log.push("EXPORT "+b64(buildOverrideText()));

  const errs=[];
  window.onerror=(m,s,l)=>errs.push(m+"@"+l);
  await new Promise(r=>setTimeout(r,60));
  ok(errs.length===0,"全过程无 JS 异常"+(errs.length?"："+errs.join("|"):""));
 }catch(err){
  ok(false,"抛出异常："+err.message+" ｜ "+(err.stack||"").split("\\n")[1]);
 }
 document.getElementById("selftest").textContent=log.join("\\n");
})();
</script>
`;

const html=fs.readFileSync(EDITOR,'utf8');
const tmp=path.join(os.tmpdir(),'skill-editor-selftest-'+process.pid+'.html');
fs.writeFileSync(tmp,html.replace('</body>',PROBE+'</body>'),'utf8');

const browser=CANDIDATES.find(p=>p&&fs.existsSync(p));
if(!browser){
 console.log('没找到 Chrome/Edge，跳过浏览器冒烟（可用 CHROME 环境变量指定路径）。');
 process.exit(0);
}
let dom='';
try{
 dom=execFileSync(browser,['--headless=new','--disable-gpu','--no-sandbox','--no-first-run',
  '--virtual-time-budget=8000','--dump-dom','file:///'+tmp.replace(/\\/g,'/')],
  {encoding:'utf8',maxBuffer:128*1024*1024,stdio:['ignore','pipe','ignore']});
}catch(err){
 console.log('浏览器执行失败：'+err.message);
 process.exitCode=1;
}
fs.rmSync(tmp,{force:true});

const hit=dom.match(/<pre id="selftest">([\s\S]*?)<\/pre>/);
if(!hit){console.log('没拿到自测输出（浏览器可能不支持 --dump-dom）。');process.exit(1);}
const text=hit[1].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').trim();
const lines=text.split('\n').filter(l=>!l.startsWith('EXPORT '));
const exportLine=text.split('\n').find(l=>l.startsWith('EXPORT '));
console.log(lines.join('\n'));

/* 端到端：把浏览器导出的覆盖文件交给服务端运行时，套到**真实**技能定义上验证生效。 */
let e2e=[];
if(exportLine){
 const overrides=JSON.parse(Buffer.from(exportLine.slice(7).trim(),'base64').toString('utf8'));
 const career=JSON.parse(fs.readFileSync(path.join(root,'data','career-skills.json'),'utf8'));
 const skill437=career.skills.find(s=>s.id===437);
 const entries=overrides.skills||{};
 if(!entries['437'])e2e.push('FAIL  导出的覆盖里没有 437');
 else{
  let rule;
  try{rule=compileOverrideRule(entries['437'],'437');}
  catch(err){e2e.push('FAIL  导出的规则没通过服务端校验：'+err.message);}
  if(rule&&skill437){
   const [lv1]=applyRuleToLevels([skill437.levels[0]],rule);
   const [lv2]=applyRuleToLevels([skill437.levels[1]],rule);
   const check=(cond,msg)=>e2e.push((cond?'PASS  ':'FAIL  ')+msg);
   check(lv1.powerValue1===-4321,'统一值套到真实 1 级定义上');
   check(lv1.statusBit1===0&&lv1.statusBit2===0,'状态清零套到真实定义上');
   check(JSON.stringify(lv1.powers)===JSON.stringify([[61,-4321],[62,-100],[87,100]]),'powers 跟着重算：'+JSON.stringify(lv1.powers));
   check(lv1.wireBase64&&lv1.wireBase64!==skill437.levels[0].wireBase64,'wireBase64 已重算');
   check(lv2.powerValue1===-9999,'perLevel 只改第 2 级');
   check(skill437.levels[0].powerValue1===-100,'真实数据没被就地修改');
  }
 }
}else e2e.push('FAIL  浏览器没有导出覆盖文件');
console.log(e2e.join('\n'));
const all=lines.concat(e2e);
const fails=all.filter(l=>l.startsWith('FAIL'));
console.log('\n'+all.filter(l=>l.startsWith('PASS')).length+' 项通过，'+fails.length+' 项失败');
if(fails.length||!text)process.exitCode=1;
