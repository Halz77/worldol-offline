/**
 * 伤害计算器的守卫：
 *   · 面板属性必须来自 nativeCharacterBattleStats（不是手写近似）；
 *   · 攻击计划照第 76 版补丁（总攻次不变、逐手分配）；
 *   · 同一 seed 结果可复现；目标防御/格挡/强韧确实会降低伤害；
 *   · 诅咒/祝福技能不造成直接伤害（0251 的 calcWithType 返回 0）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as acorn from 'acorn';
import {fileURLToPath} from 'node:url';
import {
 calculatorProfile,profilesFromSave,simulateCalculator,buildAttackPlan,collectAutoBuffs,damageCalculatorRevision
} from '../lib/damage-calculator.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const world=JSON.parse(fs.readFileSync(new URL('../default-save/world.json',import.meta.url),'utf8'));
const loaded=profilesFromSave(world);
const byName=Object.fromEntries(loaded.profiles.map(p=>[p.name,p]));
const mage=byName['魔攻'];
const physical=byName['物理'];
const unarmed=byName['空手'];

function config(profile,overrides={}){
 return {
  activeSkillId:profile.initiativeSkillId||0,
  autoSkillIds:profile.autoSkillIds,
  target:{level:profile.level},
  trials:200,
  rounds:4,
  seed:7,
  ...overrides
 };
}

test('存档解析：world.json / 单角色都能读，且不把技能大字段带进响应',()=>{
 assert.equal(loaded.profiles.length,5);
 assert.ok(loaded.profiles.every(p=>p.id&&p.name&&p.stats&&Array.isArray(p.skills)));
 const single=profilesFromSave(world.characters[0]);
 assert.equal(single.profiles.length,1);
 assert.equal(single.profiles[0].name,world.characters[0].name);
 assert.deepEqual(loaded.warnings,[]);
 for(const profile of loaded.profiles){
  assert.ok(profile.skills.some(skill=>skill.type===2),profile.name+' 应有自动技能');
  assert.ok(profile.skills.some(skill=>skill.type===3),profile.name+' 应有主动技能');
  for(const skill of profile.skills){
   assert.equal('levels' in skill,false,'技能 levels 不该进计算器响应');
   assert.equal('wireBase64' in skill,false,'技能 wireBase64 不该进计算器响应');
   assert.ok(Array.isArray(skill.powers));
  }
 }
});

test('面板属性走真实 native get：关键攻击/命中/攻次字段齐全',()=>{
 for(const profile of loaded.profiles){
  for(const key of ['HPMAX','MPMAX','ATK_MIN','ATK_MAX','ATK_TIME','ATK_STR_NEARBY','ATK_AGI_NEARBY','ATK_MAGIC','HIT_RATE','HIT_MAGIC','CRITICAL','BRK_ARMOR','MAGIC_PENETRATION','TOUGH']){
   assert.equal(typeof profile.stats[key],'number',`${profile.name} 缺少 ${key}`);
  }
  assert.equal(profile.stats.LEVEL,profile.level);
 }
 assert.ok(mage.stats.ATK_MAGIC>0);
 assert.ok(physical.stats.ATK_STR_NEARBY>0);
 assert.equal(damageCalculatorRevision,'damage-calculator-20261020-v1');
});

test('攻击计划照第 76 版：总攻次 = ATK_TIME + skill.atk_time，逐手分配',()=>{
 const skill=physical.skills.find(s=>s.type===3&&s.atk_time>0);
 assert.ok(skill,'测试角色应有带攻次的主动技能');
 const plan=buildAttackPlan(physical.stats,skill);
 const expected=Math.max(1,Math.min(99,physical.stats.ATK_TIME+skill.atk_time));
 assert.equal(plan.length,expected);
 assert.ok(plan.some(item=>item.left),'双持时应有左手攻击');
 assert.ok(plan.some(item=>!item.left),'双持时应有右手攻击');
 assert.equal(plan[0].left,true,'计划从左手开始，与补丁一致');
 const unarmedPlan=buildAttackPlan(unarmed.stats,null);
 assert.equal(unarmedPlan.length,Math.max(1,Math.min(99,unarmed.stats.ATK_TIME)));
 assert.ok(unarmedPlan.every(item=>item.min===item.max||item.max>=item.min));
});

test('自动技能的正向攻击增益可以计入面板，目标减益/未识别项不硬算',()=>{
 const buff=physical.skills.find(s=>s.id===518);
 assert.ok(buff,'测试角色应有魔化武器');
 const collected=collectAutoBuffs([buff]);
 assert.equal(collected.mods.atkTime,6);
 assert.equal(collected.mods.atkStrPercent,24);
 assert.equal(collected.mods.atkAgiPercent,24);
 const base=config(physical,{activeSkillId:4007,autoSkillIds:[518],trials:200});
 const without=simulateCalculator(physical,{...base,applyAutoBuffs:false});
 const withBuffs=simulateCalculator(physical,{...base,applyAutoBuffs:true});
 assert.equal(withBuffs.applyAutoBuffs,true);
 assert.equal(withBuffs.mods.atkTime,6);
 assert.ok(withBuffs.autoBuffs.applied.some(item=>item.code===130));
 assert.ok(withBuffs.skills.find(s=>s.id===4007).damage>without.skills.find(s=>s.id===4007).damage,'自动攻击增益应提高伤害');
});

test('同一 seed 结果完全可复现',()=>{
 const first=simulateCalculator(mage,config(mage));
 const second=simulateCalculator(mage,config(mage));
 assert.deepEqual(first,second);
});

test('目标防御 / 格挡 / 强韧都会降低木桩伤害',()=>{
 const base=config(physical,{activeSkillId:4007,trials:300});
 const zero=simulateCalculator(physical,base);
 const defended=simulateCalculator(physical,{...base,target:{level:physical.level,defStrNearby:10000000,defStrRange:10000000}});
 const blocked=simulateCalculator(physical,{...base,target:{level:physical.level,block:10000000}});
 const tough=simulateCalculator(physical,{...base,target:{level:physical.level,tough:10000000}});
 const zeroDamage=zero.skills.find(s=>s.id===4007).damage;
 assert.ok(defended.skills.find(s=>s.id===4007).damage<zeroDamage,'防御应降低伤害');
 assert.ok(blocked.skills.find(s=>s.id===4007).blockRate>0,'格挡应生效');
 assert.ok(blocked.skills.find(s=>s.id===4007).damage<zeroDamage,'格挡应降低总伤害');
 assert.ok(tough.skills.find(s=>s.id===4007).damage<zeroDamage,'强韧应降低伤害');
});

test('诅咒/祝福不造成直接伤害；普通攻击也能算',()=>{
 const curse=mage.skills.find(s=>s.type===3&&s.skillAtkType===5);
 assert.ok(curse,'测试角色应有诅咒主动技能');
 const curseResult=simulateCalculator(mage,{activeSkillId:curse.id,trials:80,rounds:2,seed:3,target:{level:mage.level}});
 assert.equal(curseResult.skills.find(s=>s.id===curse.id).damage,0);
 const bless=byName['扣蓝'].skills.find(s=>s.skillAtkType===6&&s.type===2);
 assert.ok(bless,'测试角色应有祝福自动技能');
 const blessResult=simulateCalculator(byName['扣蓝'],{activeSkillId:bless.id,trials:80,rounds:2,seed:3,target:{level:97}});
 assert.equal(blessResult.skills.find(s=>s.id===bless.id).damage,0);
 const normal=simulateCalculator(physical,{activeSkillId:0,trials:100,rounds:2,seed:3,target:{level:physical.level}});
 assert.equal(normal.skills.length,1);
 assert.equal(normal.skills[0].id,0);
 assert.ok(normal.skills[0].damage>0,'物理角色普通攻击应有伤害');
});

test('循环会同时统计自动技能与主动技能',()=>{
 const result=simulateCalculator(physical,config(physical,{activeSkillId:4007,autoSkillIds:[518],trials:120,rounds:3}));
 assert.equal(result.rotation.rounds,3);
 assert.equal(result.rotation.trials,120);
 assert.ok(result.rotation.damage>0);
 const ids=new Set(result.rotation.perSkill.map(item=>item.id));
 assert.ok(ids.has(518),'自动技能应出现在循环贡献里');
 assert.ok(ids.has(4007),'主动技能应出现在循环贡献里');
});

test('页面进了电脑版白名单与构建指纹，且不再引用已删除的战报',()=>{
 const routes=fs.readFileSync(new URL('../lib/http-routes.mjs',import.meta.url),'utf8');
 assert.match(routes,/'\/damage-calculator\.html':'damage-calculator\.html'/);
 assert.match(routes,/'\/damage-calculator':'damage-calculator\.html'/);
 assert.match(routes,/'\/damage-calculator\.js':'damage-calculator\.js'/);
 assert.doesNotMatch(routes,/battle-log/);
 const html=fs.readFileSync(new URL('../web/damage-calculator.html',import.meta.url),'utf8');
 for(const id of ['saveFile','characterSelect','autoSlots','activeSkill','run','resultTable','rotation','detail']){
  assert.match(html,new RegExp(`id="${id}"`),`计算器页面缺少 #${id}`);
 }
 assert.match(html,/<script src="damage-calculator\.js"><\/script>/,'脚本必须走同目录外部文件（CSP 禁止内联；file:// 双击也要能加载）');
 assert.doesNotMatch(html,/<script>/,'页面不许再内联脚本');
 assert.doesNotMatch(html,/battle-log/);
 const script=fs.readFileSync(new URL('../web/damage-calculator.js',import.meta.url),'utf8');
 assert.match(script,/api\/damage-calculator\/simulate/);
 assert.match(script,/autoBuff/);
 acorn.parse(script,{ecmaVersion:'latest'});
 const build=fs.readFileSync(new URL('../../安卓打包/standalone/build.mjs',import.meta.url),'utf8');
 assert.match(build,/'damage-calculator\.html'/);
 assert.match(build,/'damage-calculator\.js'/);
 assert.doesNotMatch(build,/battle-log/);
});
