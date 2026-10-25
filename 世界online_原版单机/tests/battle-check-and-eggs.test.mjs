import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {ancestor} from 'acorn-walk';
import {skillBytes} from '../lib/character-import-codec.mjs';
import {patchBattleCheckFields} from '../lib/client-battle-check-patch.mjs';
import {patchBattleMonsterBars} from '../lib/client-battle-bars-patch.mjs';
import {patchBattleMonsterManaRecovery} from '../lib/client-battle-mana-recovery-patch.mjs';
import {CLIENT_MAIN_PATH} from '../lib/client-patch-chain.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const MAIN=path.join(root,'client',CLIENT_MAIN_PATH);
const hasBundle=fs.existsSync(MAIN);

const skipNoBundle={skip:hasBundle?false:'没有 client/，跳过原版文件相关断言'};

test('技能覆盖：飘雪穿云掌(437)去掉中毒/流血，只留劈砍与穿刺防御削减',async()=>{
 const {skills}=await import('../lib/restoration.mjs');
 const s=skills.get(437);
 assert.ok(s&&Array.isArray(s.levels)&&s.levels.length,'运行时技能表里要有 437 的全部等级');
 for(const lv of s.levels){
  assert.equal(lv.statusBit1,0,'中毒状态要清零（lv'+lv.level+'）');
  assert.equal(lv.statusBit2,0,'流血状态要清零（lv'+lv.level+'）');
  assert.equal(lv.power3,0,'状态载体的 power3 也要清零（lv'+lv.level+'）');
  assert.deepEqual(lv.powers,[[61,lv.powerValue1],[62,lv.powerValue2]],
   'powers 只剩劈砍/穿刺防御削减（lv'+lv.level+'）');
  // wire 与字段必须一致：重算一遍应当逐字节相同
  assert.equal(lv.wireBase64,skillBytes(lv).toString('base64'),'wireBase64 要跟着重算（lv'+lv.level+'）');
 }
 // 覆盖不能污染上游契约对象：data/career-skills.json 原样
 const raw=JSON.parse(fs.readFileSync(path.join(root,'data','career-skills.json'),'utf8'));
 const upstream=raw.skills.find(x=>x.id===437).levels.find(l=>l.level===1);
 assert.equal(upstream.power3,87,'上游数据文件必须保持原样（power3=87）');
 assert.equal(upstream.statusBit1,1,'上游数据文件必须保持原样（statusBit1=1）');
});

test('宠物蛋图标：每个 selectable 蛋的 bagIcon 都是那只宠物的头像编号',async()=>{
 const {selectablePetEggs}=await import('../lib/pet-catalog.mjs');
 const eggs=selectablePetEggs();
 assert.ok(eggs.length>0);
 for(const egg of eggs){
  assert.equal(egg.item.bagIcon,Number(egg.profile.baseline.headIcon),
   egg.item.name+' 的图标应为宠物头像 '+egg.profile.baseline.headIcon);
 }
 // 头像编号全部落在 bb_head 图集的子键范围（500..548）里，客户端才解析得出图
 for(const egg of eggs){
  const icon=egg.item.bagIcon;
  assert.ok(icon>=500&&icon<=548,egg.item.name+' 图标 '+icon+' 不在 bb_head 子键范围');
 }
});

test('战斗查看面板补丁：去掉 isCheckAll 门并补 12 个防御字段 + 10 个攻击字段 + 生命百分比伤害减免（锚点在主包中恰好一次）',skipNoBundle,()=>{
 if(!hasBundle)return skip('没有 client/，跳过');
 const source=fs.readFileSync(MAIN,'utf8');
 // 原始锚点必须恰好出现一次（补丁过期时这里先炸，给出明确信号）
 const gate=',e.isCheckAll&&(t.append(n.GameText.STR_ATTR_SPEED+":"+e.speed+"\\n"),';
 const tail='t.append(n.GameText.STR_ATTR_INSIGHT+":"+e.insight+"\\n")),null!=e.formationSkill&&';
 assert.equal(source.split(gate).length-1,1,'面板门控锚点必须唯一');
 assert.equal(source.split(tail).length-1,1,'面板结尾锚点必须唯一');
 const patched=patchBattleCheckFields(source);
 assert.ok(!patched.includes(',e.isCheckAll&&(t.append(n.GameText.STR_ATTR_SPEED'),'isCheckAll 门要被摘掉');
 // 文案命名空间必须取对（第 52 版踩的坑）：面板模块只 import 了模块 10（GameText），
 // 「反击 / 魔法反馈 / 攻击次数 / 法力护盾 / 近身远程防御」在那儿；
 // 「无视洞察 / 无视格挡 / 无视状态抵抗 / 无视伤害减免」在模块 23（GameText2）里，
 // 写成 n.GameText.STR_ATTR_IGNORE_* 恒为 undefined → 面板显示 `undefined:0`。
 for(const key of ['STR_ATTR_INSIGHT','STR_ATTR_DEF_FIELD','STR_ATTR_ATK_TIME','STR_ATTR_BACK','STR_ATTR_MAGIC_BACK']){
  assert.ok(patched.includes('n.GameText.'+key),'面板要用 GameText.'+key);
 }
 // 第 99 版：近身/远程四列不再显示（玩家要求），原来的「劈砍防御力/穿刺防御力」改成
 // 先读 DEF_STR/DEF_AGI、为 0 时退回近身那一列。
 assert.ok(!patched.includes('STR_CHANGE_ATT_DESC_NEARBY_DEF_STR+'),
  '近身/远程四列要整段去掉，不能留在面板上');
 for(const key of ['SPEED','DODGE','DEF_STR','DEF_STR_NEARBY','DEF_AGI','DEF_AGI_NEARBY','DEF_MAGIC','WIL','TOUGH','BLOCK','INSIGHT']){
  assert.ok(patched.includes('a.ModelConst.'+key),'这 9 个基础字段要按属性计算取值（ModelConst.'+key+'）');
 }
 // 反例守卫：不能再退回读 VO 上的原始字段（那几个字段玩家单位上永远是 0）
 for(const raw of ['+e.speed+"','+e.dodge+"','+e.def_str+"','+e.def_agi+"','+e.def_magic+"','+e.wil+"','+e.tough+"','+e.block+"','+e.insight+"']){
  assert.ok(!patched.includes(raw),'不能再用原始字段取值：'+raw);
 }
 for(const key of ['BACK','MAGIC_BACK','ATK_TIME','DEF_FIELD',
  'IGNORE_INSIGHT','IGNORE_BLOCK','IGNORE_WIL','IGNORE_TOUCH']){
  assert.ok(patched.includes('a.ModelConst.'+key),'要读 ModelConst.'+key);
 }
 for(const key of ['STR_ATTR_IGNORE_INSIGHT','STR_ATTR_IGNORE_BLOCK','STR_ATTR_IGNORE_WIL','STR_ATTR_IGNORE_TOUCH']){
  assert.ok(patched.includes('window.__worldReq(23).GameText2.'+key),'「无视*」在 GameText2（模块 23），要按命名空间取：'+key);
 }
 // 第 89 版：攻击侧字段（玩家自制技能要测打出去的数值）。面板原来只有防御侧。
 for(const key of ['ATK_MIN','ATK_MAX','BRK_ARMOR','ATK_STR','ATK_AGI','ATK_MAGIC',
  'MAGIC_PENETRATION','CRITICAL','HIT_RATE','HIT_MAGIC','FORCE_HIT']){
  assert.ok(patched.includes('a.ModelConst.'+key),'攻击侧字段要读 ModelConst.'+key);
 }
 for(const key of ['STR_ATTR_ATK','STR_ATTR_BRK','STR_CHANGE_ATT_DESC_ATK_STR',
  'STR_CHANGE_ATT_DESC_ATK_AGI','STR_CHANGE_ATT_DESC_ATK_MAGIC','STR_ATTR_MAGIC_PEN',
  'STR_ATTR_CRITICAL','STR_ATTR_HIT_RATE','STR_ATTR_HIT_MAGIC','STR_ATTR_FORCE_HIT']){
  assert.ok(patched.includes('n.GameText.'+key),'攻击侧文案要用 GameText.'+key);
 }
  // 生命百分比伤害减免：派生字段（不是 wire 字段）。算式**照抄参考实现**「幻想世界OL」：
  // min(TOUGH/100, 80)% —— 注意引擎自己算减伤时 TOUGH 是千分比（calTouchDmg，700→70%），
  // 参考实现是 /100（显示小 10 倍）；玩家要求与其面板一致，故照抄。
  assert.ok(patched.includes('t.append("生命百分比伤害减免："+Math.min(0|(e.get(a.ModelConst.TOUGH)/100),80)+"%\\n")'),
   '面板要显示「生命百分比伤害减免」，算式与参考实现一致（TOUGH/100、上限 80%）');
 // 端到端守卫：上面用到的键必须真的在对应模块里声明着（模块缺失时跳过）
 const moduleText=id=>{
  const file=path.join(root,'analysis','modules',String(id).padStart(4,'0')+'.js');
  return fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
 };
 const declares=(text,key,label)=>text!==null&&new RegExp('e\\.'+key+'\\s*=\\s*"'+label+'"').test(text);
 const gameText=moduleText(10),gameText2=moduleText(23);
 for(const [key,label] of [['STR_ATTR_INSIGHT','洞察'],['STR_ATTR_BLOCK','格挡'],['STR_ATTR_TOUGH','伤害减免'],
  ['STR_ATTR_DEF_FIELD','法力护盾'],['STR_ATTR_ATK_TIME','攻击次数'],['STR_ATTR_BACK','反击'],['STR_ATTR_MAGIC_BACK','魔法反馈'],
  ['STR_ATTR_ATK','攻击力'],['STR_ATTR_BRK','破甲'],['STR_CHANGE_ATT_DESC_ATK_STR','劈砍攻击力'],
  ['STR_CHANGE_ATT_DESC_ATK_AGI','穿刺攻击力'],['STR_CHANGE_ATT_DESC_ATK_MAGIC','魔法攻击力'],
  ['STR_ATTR_MAGIC_PEN','魔法穿透'],['STR_ATTR_CRITICAL','致命点'],['STR_ATTR_HIT_RATE','物理命中'],
  ['STR_ATTR_HIT_MAGIC','魔法命中'],['STR_ATTR_FORCE_HIT','强制命中率']]){
  if(gameText!==null)assert.ok(declares(gameText,key,label),'GameText(模块 10) 里 '+key+' 应当是「'+label+'」');
 }
 for(const [key,label] of [['STR_ATTR_IGNORE_INSIGHT','无视洞察'],['STR_ATTR_IGNORE_BLOCK','无视格挡'],
  ['STR_ATTR_IGNORE_WIL','无视状态抵抗'],['STR_ATTR_IGNORE_TOUCH','无视伤害减免']]){
  if(gameText2!==null)assert.ok(declares(gameText2,key,label),'GameText2(模块 23) 里 '+key+' 应当是「'+label+'」');
  assert.ok(!/GameText\.STR_ATTR_IGNORE/.test(patched),'GameText 里没有 '+key+'，用了会显示 undefined');
 }
 // 括号必须配平（在同一模块内对比补丁前后即可）
 const balance=text=>{let d=0;for(const c of text){if(c==='(')d++;if(c===')')d--;}return d;};
 assert.equal(balance(patched),balance(source),'补丁不能改变整个文件的括号配平');
 // 幂等保护：锚点已被吃掉后再跑要抛错（防止误伤二次打补丁）
 assert.throws(()=>patchBattleCheckFields(patched),/mismatch/);
});

test('怪物血蓝条补丁：改用游戏自带的 _hpBar/_mpBar（hideMsg 里按怪物保留两条）',skipNoBundle,()=>{
 if(!hasBundle)return skip('没有 client/，跳过');
 const source=fs.readFileSync(MAIN,'utf8');
 const anchor='e.prototype.hideMsg=function(){this.updateBuff(!1),this.updateHpBar(!1),this.updateMpBar(!1),this.updateName(!1)}';
 assert.equal(source.split(anchor).length-1,1,'hideMsg 锚点必须唯一');
 // 原生两条本来就在，且蓝条的位置就是血条下面（y = 2*height + 5）
 assert.equal(source.split('e.prototype.updateMpBar=function(e){').length-1,1,'原生 updateMpBar 必须存在');
 assert.ok(source.includes('this._mpBar.y=this.y+2*this._mpBar.height+5'),'原生蓝条画在血条正下方');
 const patched=patchBattleMonsterBars(source);
 assert.ok(patched.includes('this.updateHpBar(!0);this.updateMpBar(!0)'),'怪物要同时开血条与蓝条');
 assert.ok(patched.includes('this.vo.isMonster'),'按 isMonster 区分怪物');
 assert.ok(patched.includes('this.updateName(!1)'),'名字/状态图标维持原样');
 assert.ok(!patched.includes('__wmbState'),'不再自己画条（第 50~52 版那套已删）');
 const balance=text=>{let d=0;for(const c of text){if(c==='(')d++;if(c===')')d--;}return d;};
 assert.equal(balance(patched),balance(source),'补丁不能改变整个文件的括号配平');
 assert.throws(()=>patchBattleMonsterBars(patched),/mismatch/);
});

test('怪物法力归零后不再每回合回蓝（只补条件，不碰逗号链）',skipNoBundle,()=>{
 if(!hasBundle)return skip('没有 client/，跳过');
 const source=fs.readFileSync(MAIN,'utf8');
 const anchor='if(i>0){var l=!0;e.isBattleStatus(c["default"].getBufferBitValue(c["default"].BUFFER_POISON))&&(l=!1),';
 assert.equal(source.split(anchor).length-1,1,'每回合回蓝分支的锚点必须唯一');
 const patched=patchBattleMonsterManaRecovery(source);
 assert.ok(patched.includes('if(i>0&&!(e.isMonster&&0>=e.get(f.ModelConst.MP)))'),'怪物 0 蓝要跳过每回合回蓝');
 const balance=text=>{let d=0;for(const c of text){if(c==='(')d++;if(c===')')d--;}return d;};
 assert.equal(balance(patched),balance(source),'补丁不能改变整个文件的括号配平');
 assert.throws(()=>patchBattleMonsterManaRecovery(patched),/mismatch/);
});

// 回归守卫（第 51 版踩过的坑）：主包里那些 `X.prototype.Y = function(){}` 都是
// 类 IIFE 里 `return ..., X.prototype.Y=..., X` 逗号链的一部分。
// 补丁若在链中插入分号，return 会提前结束，IIFE 返回的就不是视图类 ——
// 注册给 Battle 视图的类没有 show()，进战斗直接抛「r.show is not a function」。
// 判据：补丁前后「不在 return 里的 prototype 赋值」数量必须一致。
test('所有客户端补丁都不得把 prototype 成员赋值挤到 return 之外',skipNoBundle,()=>{
 if(!hasBundle)return skip('没有 client/，跳过');
 const strays=text=>{
  let count=0;
  ancestor(parse(text,{ecmaVersion:'latest'}),{AssignmentExpression(node,_state,ancestors){
   const left=node.left;
   if(!left||left.type!=='MemberExpression'||!left.property||left.property.name===undefined)return;
   const object=left.object;
   if(!object||object.type!=='MemberExpression'||!object.property||object.property.name!=='prototype')return;
   if(!ancestors.some(a=>a.type==='ReturnStatement'))count++;
  }});
  return count;
 };
 const source=fs.readFileSync(MAIN,'utf8');
 const before=strays(source);
 const after=strays(patchBattleCheckFields(patchBattleMonsterBars(source)));
 assert.equal(after,before,'prototype 成员链被截断了（注入点落到了表达式上下文还带了分号）');
});
