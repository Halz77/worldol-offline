import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import {patchClientMain, CLIENT_MAIN_PATH} from '../lib/client-patch-chain.mjs';

// 战斗效果规则的「真代码」用例。
//
// 这里不重写规则，而是把原版客户端战斗模块（analysis/modules/0075.js）里的
// processBattlePower / calTouch 抽出来，配一层桩对象跑起来 —— 断言的就是线上
// 跑的那段代码。analysis/ 不入版本库，缺失时整文件跳过。

const MODULES=new URL('../analysis/modules/',import.meta.url);
const hasClient=fs.existsSync(new URL('0075.js',MODULES));
const skip={skip:hasClient?false:'没有 analysis/（反编译产物不入库），跳过'};

const BUNDLE=new URL('../client/'+CLIENT_MAIN_PATH,import.meta.url);
const hasBundle=fs.existsSync(BUNDLE);
const skipBundle={skip:hasBundle?false:'没有 client/（原版归档不入库），跳过'};

/** 从（已打过补丁的）主包里按方法名抽出 `X.name = function(){}` 的函数文本。 */
function extractFromBundle(bundle,name){
  let found;
  walk.simple(acorn.parse(bundle,{ecmaVersion:'latest'}),{AssignmentExpression(n){
    if(n.left.type==='MemberExpression'&&n.left.property&&n.left.property.name===name&&n.right.type==='FunctionExpression')found=bundle.slice(n.right.start,n.right.end);
  }});
  return found;
}

function sourceOf(id){
  return fs.readFileSync(new URL(String(id).padStart(4,'0')+'.js',MODULES),'utf8');
}
/** 用桩 require 跑模块工厂，拿模块里那些字面量常量（POWER_* / BUFFER_* / ModelConst）。 */
function loadModule(id){
  const raw=sourceOf(id),exports={};
  vm.runInNewContext(raw.startsWith('(')?raw:'('+raw+')',{})({},exports,()=>({}));
  return exports;
}
/** 从模块源码里抽出某个 `X.name = function(){}` 的函数表达式文本。 */
function extractFunction(id,name){
  const source=sourceOf(id);
  let found;
  walk.simple(acorn.parse(source,{ecmaVersion:'latest'}),{AssignmentExpression(n){
    if(n.left.type==='MemberExpression'&&n.left.property.name===name&&n.right.type==='FunctionExpression')found=source.slice(n.right.start,n.right.end);
  }});
  assert.ok(found,'analysis/modules/'+id+' 里找不到 '+name);
  return found;
}

const Tool=hasClient?loadModule(4).default:null;            // POWER_* / BUFFER_* / getBufferType
const ModelConst=hasClient?loadModule(12).ModelConst:null;  // HP / HPMAX / DEF_STR / TOUGH ...
// 61 模块加载会碰 egret，这里只把它里面的数值常量抠出来。
const MAX_RATE_TOUCH=hasClient?Number(/e\.MAX_RATE_TOUCH\s*=\s*(\d+)/.exec(sourceOf(61))[1]):0;

function makeUnit({hpMax=100000,attrs={},immune=false,buffs=[]}={}){
  // 键会被 Object.entries 转成字符串，ModelConst 的值是数字，这里统一回数字。
  const values=new Map(Object.entries(attrs).map(([k,v])=>[Number(k),v]));
  const unit={
    position:0,keepout_atk_time:0,readAddValue:0,blood:false,
    statusBits:immune?Tool.getBufferBitValue(Tool.BUFFER_RESIST_DEBUFF):0,
    changed:[],added:[],
    getName(){return '测试目标';},
    isTabStatus(){return false;},
    setTabStatus(){},
    doKeepAtkTime(){},
    removeBufferByStatus(){},
    addBuffer(buffer){this.added.push(buffer);},
    getEquipWeaponType(){return -1;},
    isBattleStatus(bit){return (this.statusBits&bit)!==0;},
    getValue(attr){return values.get(attr)||0;},
    addValue(attr,value){this.changed.push([attr,value]);values.set(attr,(values.get(attr)||0)+value);},
    get(attr){return attr===ModelConst.HPMAX?hpMax:this.getValue(attr);},
  };
  for(const name of buffs)unit.statusBits|=Tool.getBufferBitValue(Tool[name]);
  return unit;
}

/** 把 processBattlePower / calTouch 装进同一套桩作用域。 */
function rules(){
  const seen={prompts:[],hpMp:[],buffs:[]};
  const scope={
    console:{log(){},error(){}},
    o:{default:Tool},
    c:{default:Tool},
    a:{ModelConst},
    d:{default:{MAX_RATE_TOUCH,EFFECT_HIT:1}},
    h:{GUtil:{intNum:(v)=>v|0}},
    l:{Tool:{debug(){}}},
    s:{default:{makeColorString:(v)=>String(v)}},
    r:{default:{addPromptMsg(msg){seen.prompts.push(msg);}}},
    n:{Buffer:{alloc(...args){return {args};}}},
    e:{
      processBattleKeepOutPower(){return false;},                  // 本组用例不测距离豁免
      processBattleHpMpPower(target,attr,value){seen.hpMp.push({attr,value});return 1;},
      addBufferBySpecial(...args){seen.buffs.push(args);},
    },
  };
  scope.e.calTouch=new vm.Script('('+extractFunction(75,'calTouch')+')').runInNewContext(scope);
  const power=new vm.Script('('+extractFunction(75,'processBattlePower')+')').runInNewContext(scope);
  return {seen,power,calTouch:scope.e.calTouch};
}

function battle({wil=false}={}){
  return {round:5,isWilSuccess(){return wil;},checkDie1Hp(){}};
}

/** 按 processBattlePower(battle,target,caster,skill,power,value,statusBit,round,anime,subList) 调用。 */
function cast(engine,{target,caster,skill,powerId,value,statusBit=0,round=0}){
  engine.power(battle(),target,caster,skill,powerId,value,statusBit,round,0,null);
}

const SKILL={name:'飘雪穿云掌',area:10};

test('飘雪穿云掌（覆盖后）对「全减益免疫」的目标依然削劈砍/穿刺防御',skip,async()=>{
  const {skills}=await import('../lib/restoration.mjs');
  const level=skills.get(437).levels.find(l=>l.level===1);
  const engine=rules();
  const caster=makeUnit();
  const target=makeUnit({immune:true});                       // 带全减益免疫

  cast(engine,{target,caster,skill:SKILL,powerId:level.power1,value:level.powerValue1,statusBit:level.statusBit1,round:level.round});
  cast(engine,{target,caster,skill:SKILL,powerId:level.power2,value:level.powerValue2,statusBit:level.statusBit2,round:level.round});

  assert.equal(level.statusBit1,0,'覆盖层要把中毒标签清掉');
  assert.equal(level.statusBit2,0,'覆盖层要把流血标签清掉');
  assert.deepEqual(target.changed.filter(([attr])=>attr===ModelConst.DEF_STR),[[ModelConst.DEF_STR,level.powerValue1]],
   '劈砍防御削减必须落到目标身上');
  assert.deepEqual(target.changed.filter(([attr])=>attr===ModelConst.DEF_AGI),[[ModelConst.DEF_AGI,level.powerValue2]],
   '穿刺防御削减必须落到目标身上');
  assert.equal(engine.seen.prompts.length,0,'不该出现「全减益免疫/状态抵抗」提示');
});

test('对照：原版 437（带中毒/流血标签）打在同类目标上会被全减益免疫吃掉',skip,()=>{
  const upstream=JSON.parse(fs.readFileSync(new URL('../data/career-skills.json',import.meta.url),'utf8'))
   .skills.find(s=>s.id===437).levels.find(l=>l.level===1);
  assert.equal(upstream.statusBit1,Tool.BUFFER_POISON,'上游第一段带中毒标签');
  assert.equal(upstream.statusBit2,Tool.BUFFER_BLOOD,'上游第二段带流血标签');

  const engine=rules();
  const target=makeUnit({immune:true});
  cast(engine,{target,caster:makeUnit(),skill:SKILL,powerId:upstream.power1,value:upstream.powerValue1,statusBit:upstream.statusBit1,round:upstream.round});
  assert.equal(target.changed.length,0,'带减益标签时，削防被全减益免疫挡住 —— 这正是覆盖层要解掉的门槛');
  assert.match(engine.seen.prompts.join(' '),/全减益免疫/);
});

test('状态抵抗（WIL）同样只挡带减益标签的那一版',skip,()=>{
  const engine=rules();
  const target=makeUnit();
  // statusBit=0：不做 WIL 判定
  engine.power({round:5,isWilSuccess(){return true;},checkDie1Hp(){}},target,makeUnit(),SKILL,Tool.POWER_DEF_STR,-100,0,4,0,null);
  assert.deepEqual(target.changed,[[ModelConst.DEF_STR,-100]],'无标签时无视状态抵抗');
  // statusBit=中毒：WIL 判定成功 → 整段被吃掉
  const blocked=makeUnit();
  engine.power({round:5,isWilSuccess(){return true;},checkDie1Hp(){}},blocked,makeUnit(),SKILL,Tool.POWER_DEF_STR,-100,Tool.BUFFER_POISON,4,0,null);
  assert.equal(blocked.changed.length,0,'带标签时 WIL 抵抗成功即整段无效');
});

test('百分比最大生命值伤害（POWER_HP_PERCENT）按目标「伤害减免」千分比削减',skip,()=>{
  assert.equal(Tool.POWER_HP_PERCENT,50,'POWER_HP_PERCENT=50 —— 邪恶飓风/朱雀焚天用的就是这个');
  const engine=rules();

  // 基础伤害 = powerValue × 目标生命上限 / 100 = -10 × 100000/100 = -10000
  const plain=makeUnit({hpMax:100000,attrs:{[ModelConst.TOUGH]:0}});
  cast(engine,{target:plain,caster:makeUnit(),skill:SKILL,powerId:Tool.POWER_HP_PERCENT,value:-10});
  assert.deepEqual(engine.seen.hpMp.at(-1),{attr:ModelConst.HP,value:-10000},'没有伤害减免时全额生效');

  // 伤害减免 300‰ → 扣掉 30%
  const tough=makeUnit({hpMax:100000,attrs:{[ModelConst.TOUGH]:300}});
  cast(engine,{target:tough,caster:makeUnit(),skill:SKILL,powerId:Tool.POWER_HP_PERCENT,value:-10});
  assert.deepEqual(engine.seen.hpMp.at(-1),{attr:ModelConst.HP,value:-7000},'300‰ 伤害减免削掉 30%');

  // 上限 MAX_RATE_TOUCH（700‰），超过按上限算
  const capped=makeUnit({hpMax:100000,attrs:{[ModelConst.TOUGH]:9999}});
  cast(engine,{target:capped,caster:makeUnit(),skill:SKILL,powerId:Tool.POWER_HP_PERCENT,value:-10});
  assert.deepEqual(engine.seen.hpMp.at(-1),{attr:ModelConst.HP,value:-(10000-Math.trunc(10000*MAX_RATE_TOUCH/1000))},
   '伤害减免封顶 '+MAX_RATE_TOUCH+'‰');

  // 攻击者的「无视触碰」会抵扣目标的伤害减免
  const pierce=makeUnit({hpMax:100000,attrs:{[ModelConst.TOUGH]:300}});
  const attacker=makeUnit({attrs:{[ModelConst.IGNORE_TOUCH]:200}});
  cast(engine,{target:pierce,caster:attacker,skill:SKILL,powerId:Tool.POWER_HP_PERCENT,value:-10});
  assert.deepEqual(engine.seen.hpMp.at(-1),{attr:ModelConst.HP,value:-9000},'无视触碰 200‰ 抵掉后只削 10%');

  // 流血/衰弱会让目标的伤害减免减半（calTouch 的行为）
  const bleeding=makeUnit({hpMax:100000,attrs:{[ModelConst.TOUGH]:300},buffs:['BUFFER_BLOOD']});
  assert.equal(engine.calTouch(bleeding),150,'流血时伤害减免减半');
  cast(engine,{target:bleeding,caster:makeUnit(),skill:SKILL,powerId:Tool.POWER_HP_PERCENT,value:-10});
  assert.deepEqual(engine.seen.hpMp.at(-1),{attr:ModelConst.HP,value:-8500},'减半后只削 15%');
});

test('怪物法力归零后不再每回合回蓝（跑补丁后的 doRoundHpMp 真代码）',skipBundle,()=>{
  // 每回合血蓝回复在模块 251 的 doRoundHpMp 里：BUFFER_ADD_MP（天生状态「持续回魔」）
  // = 每回合 +0.5% 法力上限；原版只要该状态在、法力是 0 也照回。
  // 这里从**打过补丁的主包**里抽这个函数，配桩跑，验证新规则。
  const patched=patchClientMain(fs.readFileSync(BUNDLE,'utf8'));
  const code=extractFromBundle(patched,'doRoundHpMp');
  assert.ok(code,'补丁后的主包里要能找到 doRoundHpMp');

  const seen=[];
  const scope={
    console:{log(){},error(){}},
    f:{ModelConst},
    c:{default:Tool},
    g:{GUtil:{intNum:(v)=>v|0}},
    v:{default:class{constructor(){this.length=0;}elementAt(){return null;}}},
    E:{default:{processBattleHpMpPower(unit,attr,value){seen.push([unit.name,attr,value]);return 1;}}},
    T:{Tool:{debug(){}}},
  };
  const run=new vm.Script('('+code+')').runInNewContext(scope);
  const self={round:1,addAniControl(){}};
  const makeUnit=({monster,mp,mpMax=1000,addMp=true})=>({
    name:monster?'怪物':'玩家',isMonster:monster,hpMax:2000,mpMax,mp,position:0,
    get(attr){
      if(attr===ModelConst.MP)return this.mp;
      if(attr===ModelConst.HP)return 0;
      return 0;                                      // HEAL_RECOVERY / MANA_RECOVERY 都为 0
    },
    isBattleStatus(bit){return addMp&&bit===Tool.getBufferBitValue(Tool.BUFFER_ADD_MP);},
  });

  seen.length=0;
  run.call(self,makeUnit({monster:true,mp:0}));
  assert.deepEqual(seen,[],'怪物法力 0 时，下回合不再回蓝');

  seen.length=0;
  run.call(self,makeUnit({monster:true,mp:500}));
  assert.deepEqual(seen,[['怪物',ModelConst.MP,5]],'怪物还有法力时，照常每回合回 0.5% 上限');

  seen.length=0;
  run.call(self,makeUnit({monster:false,mp:0}));
  assert.deepEqual(seen,[['玩家',ModelConst.MP,5]],'玩家单位行为不变（0 蓝也照回）');

  seen.length=0;
  run.call(self,makeUnit({monster:true,mp:0,addMp:false}));
  assert.deepEqual(seen,[],'没有「持续回魔」天生状态时本来也不回蓝');
});
