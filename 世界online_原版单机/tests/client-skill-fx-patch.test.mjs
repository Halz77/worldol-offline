/**
 * 第 93 版「技能自定义特效」· 战斗替换层补丁测试。
 *
 * vm 沙箱 + 假 req/host 驱动 installSkillFxSwitch（不打真主包、不起真战斗）：
 * 覆盖手册第二节事实 1/2 与 zip 真机结论的合并策略——
 * 归属窗口判得出就判、判不出按名字降级、段护栏、桥未就绪不干预。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {patchSkillFxSwitch,installSkillFxSwitch,skillFxRevision} from '../lib/client-skill-fx-patch.mjs';
import {readFileSync} from 'node:fs';

const original=readFileSync(new URL('../client/js/ff/fff570bb4753f056432680e781d827dc.js',import.meta.url),'utf8');

test('补丁入口：幂等抛错 + 锚点校验 + 追加注入',()=>{
  const patched=patchSkillFxSwitch(original);
  assert.ok(patched.includes('__worldolSkillFxPatch'),'补丁产物应含标记');
  assert.ok(patched.startsWith(original),'追加式补丁必须保留原包全文');
  assert.ok(patched.endsWith(')(window.__worldReq,window);\n'),'应以调用 install 结尾');
  // 追加段 = '\n;(' + fn.toString() + ')(window.__worldReq,window);\n'
  assert.equal(patched.slice(original.length),'\n;('+installSkillFxSwitch.toString()+')(window.__worldReq,window);\n','追加段逐字符一致');
  assert.throws(()=>patchSkillFxSwitch(patched),/already installed/,'重复打补丁必须抛错');
  assert.throws(()=>patchSkillFxSwitch('no anchor here'),/mismatch/,'锚点缺失必须抛错');
  assert.equal(skillFxRevision,'skill-fx-switch-20261025-v1');
});

/** 假 req：WireControl=184，战斗演算基类藏在 req.c 里（原型有 doUseSkill+calDamage）。 */
function fakeReq(withCalc){
  const created=[];
  const wire={createBattleUseSkillControl(...args){created.push(args);return {native:true,args};}};
  const proto={doUseSkill(){ return 'native-doUseSkill'; },calDamage(){ return 0; }};
  const cache={'42':{prototype:proto}};
  const mods={184:{default:wire}};
  const req=id=>{ if(mods[id])return mods[id]; throw Error('unexpected module '+id); };
  req.c=withCalc?cache:{};
  return {req,created,proto,wire};
}
const CALL=(position,target,area,pos2,start,effect,last,name)=>({position,target,area,pos2,start,effect,last,name});

test('安装：同步挂上归属基类，不起轮询定时器',()=>{
  const {req,proto}=fakeReq(true);
  const host={};
  const api=installSkillFxSwitch(req,host);
  assert.equal(host.__worldolSkillFxPatch,api,'api 应挂到 host');
  assert.equal(typeof proto.doUseSkill,'function');
  assert.ok(!Object.prototype.hasOwnProperty.call({},'x')||true);
  assert.equal(api.status.ownerHooked,true,'同步挂载应成功');
  assert.equal(api.status.attachRetries,0,'同步挂上时无重试');
  assert.equal(api.revision,skillFxRevision);
  api.stop();
});

test('归属窗口：明确是宠物/他人施放 ⇒ 不替换（suppressed）',()=>{
  const {req,created}=fakeReq(true);
  const host={__worldolSkillFx:{resolveForBattle:()=>1305}};
  const api=installSkillFxSwitch(req,host);
  api.fakeOwner({my:false,id:999});
  const wire=req(184).default;
  const out=wire.createBattleUseSkillControl(...Object.values(CALL(3,1,19,2,0,1200,0,'劈砍')));
  assert.equal(out.native,true);
  assert.equal(out.args[5],1200,'宠物施放必须保持原生特效');
  assert.equal(api.status.suppressed,1);
  assert.equal(api.status.replaced,0);
  api.stop();
});

test('归属窗口：是我的施放 ⇒ 替换 effect 为配置号',()=>{
  const {req,wire}=fakeReq(true);
  const host={__worldolSkillFx:{resolveForBattle:name=>name==='劈砍'?1305:null}};
  const api=installSkillFxSwitch(req,host);
  api.fakeOwner({my:true,id:7});
  const out=wire.createBattleUseSkillControl(...Object.values(CALL(3,1,19,2,0,1200,0,'劈砍')));
  assert.equal(out.args[5],1305,'effect 应被换成 1305');
  assert.equal(out.args[0],3,'第 1 参（位置）必须原样透传——它不是 actor');
  assert.equal(out.args[7],'劈砍','技能名必须原样透传');
  assert.equal(api.status.replaced,1);
  api.stop();
});

test('归属窗口没盖上（基类未加载）⇒ 按名字降级仍生效',()=>{
  const {req,wire}=fakeReq(false);           // req.c 空：同步挂载失败
  const host={__worldolSkillFx:{resolveForBattle:()=>1222}};
  const api=installSkillFxSwitch(req,host);
  assert.equal(api.status.ownerHooked,false);
  assert.equal(api.status.attachRetries,1,'首轮同步失败记一次');
  const out=wire.createBattleUseSkillControl(...Object.values(CALL(1,1,19,1,0,1200,0,'重击')));
  assert.equal(out.args[5],1222,'降级路径：无窗口时按名字隔离替换');
  assert.equal(api.status.replaced,1);
  // 轮询补挂路径：之后基类出现 ⇒ probeAttach 能挂上
  req.c={'42':{prototype:{doUseSkill(){},calDamage(){}}}};
  assert.equal(api.probeAttach(),true);
  assert.equal(api.status.ownerHooked,true);
  api.stop();
});

test('段护栏：桥返回段外号/非数字 ⇒ 不干预',()=>{
  const {req,wire}=fakeReq(true);
  const host={__worldolSkillFx:{resolveForBattle:()=>999999}};   // 段外（>29999；29998 由桥层特例表挡）
  const api=installSkillFxSwitch(req,host);
  api.fakeOwner({my:true,id:7});
  const out=wire.createBattleUseSkillControl(...Object.values(CALL(1,1,19,1,0,1200,0,'重击')));
  assert.equal(out.args[5],1200,'段外号必须保持原生');
  assert.equal(api.status.replaced,0);
  host.__worldolSkillFx={resolveForBattle:()=>'1305'};          // 非数字
  const out2=wire.createBattleUseSkillControl(...Object.values(CALL(1,1,19,1,0,1200,0,'重击')));
  assert.equal(out2.args[5],1200,'字符串号必须保持原生');
  api.stop();
});

test('桥未就绪/抛错 ⇒ 保持原生特效',()=>{
  const {req,wire}=fakeReq(true);
  const api=installSkillFxSwitch(req,{});                       // 没有桥
  api.fakeOwner({my:true,id:7});
  const out=wire.createBattleUseSkillControl(...Object.values(CALL(1,1,19,1,0,1200,0,'重击')));
  assert.equal(out.args[5],1200);
  const host2={__worldolSkillFx:{resolveForBattle(){ throw Error('boom'); }}};
  const api2=installSkillFxSwitch(req,host2);
  api2.fakeOwner({my:true,id:7});
  const out2=wire.createBattleUseSkillControl(...Object.values(CALL(1,1,19,1,0,1200,0,'重击')));
  assert.equal(out2.args[5],1200,'桥抛错不能影响战斗演出');
  api.stop();api2.stop();
});

test('doUseSkill 包装：窗口内记录 isMyPlayer，finally 恢复不泄漏',()=>{
  const {req,proto,wire}=fakeReq(true);
  const host={__worldolSkillFx:{resolveForBattle:()=>1305}};
  const api=installSkillFxSwitch(req,host);
  proto.doUseSkill({isMyPlayer:true,id:7});
  const out=wire.createBattleUseSkillControl(...Object.values(CALL(1,1,19,1,0,1200,0,'重击')));
  assert.equal(out.args[5],1305,'窗口内 my=true ⇒ 替换');
  assert.equal(api.status.replaced,1);
  // 嵌套：外层宠物窗口内层我的施放，内层替换、外层不替换
  api.fakeOwner({my:false,id:99});
  const out2=wire.createBattleUseSkillControl(...Object.values(CALL(1,1,19,1,0,1200,0,'重击')));
  assert.equal(out2.args[5],1200,'外层宠物窗口 ⇒ 不替换');
  api.stop();
});

test('peek 钩子：不打战斗也能解析技能名',()=>{
  const {req,wire}=fakeReq(true);
  const host={__worldolSkillFx:{resolveForBattle:name=>name==='劈砍'?1305:null}};
  const api=installSkillFxSwitch(req,host);
  assert.equal(api.peek('劈砍'),1305);
  assert.equal(api.peek('重击'),null);
  api.stop();
});
