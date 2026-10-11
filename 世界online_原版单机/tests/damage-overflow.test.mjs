import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {decoders} from '../tools/capture-decoders.mjs';
import {patchBattleDamageMath} from '../lib/client-damage-patch.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const raw=process.env.WORLDOL_RESOURCES || (fs.existsSync(path.join(root,'client/v/gd/305.json'))?path.join(root,'client'):path.resolve(root,'../H5客户端_v305_20260920/files/resgood'));
const source=fs.readFileSync(path.join(raw,'js/ff/fff570bb4753f056432680e781d827dc.js'),'utf8');
let modules=[];
simple(parse(source,{ecmaVersion:'latest'}),{ArrayExpression(node){if(node.elements.length>modules.length&&node.elements.every(n=>n?.type==='FunctionExpression'))modules=node.elements;}});
let calcSource;
simple(modules[251],{AssignmentExpression(node){if(node.left.type==='MemberExpression'&&node.left.property.name==='calc'&&node.right.type==='FunctionExpression')calcSource=source.slice(node.right.start,node.right.end);}});
assert.ok(calcSource);
const M=d.module(12).constants,C={...d.constants},B=d.module(61).constants;
const intNum=d.native(13,'intNum'),dummy={getPowerValue:()=>0};
const scope={f:{ModelConst:M},c:{default:C},y:{default:B},S:{default:{isPreviewBeta:true}},g:{GUtil:{intNum}},T:{Tool:{debug(){},MAX_VALUE_int:2147483647}},p:{default:{DUMMY_SKILL:dummy}},l:{MODEL_TYPE:{TYPE_PLAYER:1}}};
const native=code=>new vm.Script('('+code+')').runInNewContext(scope);
const original=native(calcSource),fixed=native(patchBattleDamageMath(calcSource));
const kinds=[['slashing',B.BATTLE_DMG_STR,B.BATTLE_AP_STR,B.BATTLE_RD_STR],['piercing',B.BATTLE_DMG_AGI,B.BATTLE_AP_AGI,B.BATTLE_RD_AGI],['magic',B.BATTLE_DMG_MAGIC,B.BATTLE_AP_MAGIC,B.BATTLE_RD_MAGIC]];
function hit(fn,kind,attack,armor=0,roll=100){
  const [,damageType,attackType,armorType]=kind,calls=[],attacker={},target={};
  const context={calc(type,a,b,skill){assert.equal(skill,dummy);calls.push(type);if(type===armorType){assert.equal(a,target);assert.equal(b,attacker);return armor;}assert.equal(type,attackType);assert.equal(a,attacker);assert.equal(b,target);return attack;},randRange(min,max){assert.equal(min,95);assert.equal(max,105);calls.push('roll');return roll;}};
  const value=fn.call(context,damageType,attacker,target,null);
  assert.deepEqual(calls,[armorType,attackType,'roll']);return value;
}

test('the actual v305 client reproduces 500k damage wrapping to 70,503; all three attack types are repaired',()=>{
  for(const kind of kinds){
    assert.equal(hit(original,kind,300000),214748,kind[0]);
    assert.equal(hit(original,kind,500000),70503,kind[0]);
    for(const attack of [300000,500000,1000000])assert.equal(hit(fixed,kind,attack),attack,kind[0]);
  }
});

test('low damage keeps native rounding, minimum damage, armor and RNG consumption',()=>{
  for(const kind of kinds)for(const attack of [0,1,17,195,10000,100000,204521])for(const armor of [0,1,37,75])for(let roll=95;roll<=105;roll++)assert.equal(hit(fixed,kind,attack,armor,roll),hit(original,kind,attack,armor,roll),`${kind[0]} ${attack}/${armor}/${roll}`);
});

test('damage agrees with independent integer arithmetic at overflow boundaries and the native attack limits',()=>{
  for(const kind of kinds)for(const armor of [0,1,37,75])for(let roll=95;roll<=105;roll++){
    let previous=0;
    for(const attack of [0,1,204522,214748,214749,300000,429496,429497,500000,1000000,99999999,101032766]){
      const expected=Number(BigInt(attack)*BigInt(100-armor)*BigInt(roll)/10000n);
      const actual=hit(fixed,kind,attack,armor,roll);
      assert.equal(actual,Math.max(1,expected),`${kind[0]} ${attack}/${armor}/${roll}`);
      assert.ok(actual>=previous,'increasing attack cannot lower damage');previous=actual;
    }
  }
});

test('native direct-hit flow still splits attacks and applies armor, criticals, reduction and mana shields',()=>{
  C.getBufferBitValue=d.native(4,'getBufferBitValue',{e:C});
  const calTouch=d.native(75,'calTouch',{a:{ModelConst:M},o:{default:C}});
  const fullScope={...scope,E:{default:{calTouch}}};
  const battle={calc:fixed,totalHitTime:1,block:0,round:1,randInt:()=>0,randRange:(min,max)=>Math.trunc((min+max)/2),calBackValue:()=>0,calHPMPGetValue:()=>0};
  for(const name of ['calcWithType','getLevelIncludeLevel2','calcDirectDamage','calTouchDmg','calDefFieldDmg'])battle[name]=d.native(251,name,fullScope);
  const actor=(stats,extra={})=>({get:id=>stats[id]??0,getAttackType:()=>C.ATKTYPE_STR,isBattleStatus:()=>false,addValue(id,value){stats[id]=(stats[id]??0)+value;},ignoreCritical:0,keepout_atk_time:0,...extra});
  const attacker=actor({[M.LEVEL]:97,[M.ATK_STR_NEARBY]:500000,[M.HIT_RATE]:100,[M.CRITICAL]:1000,[M.IGNORE_TOUCH]:200});
  const target=actor({[M.LEVEL]:2,[M.TOUGH]:500,[M.DEF_FIELD]:5000,[M.MP]:1000});
  const result=battle.calcDirectDamage(attacker,target,dummy,1);
  assert.equal(result[B.DMG_VALUE],524000); // 500k * 1.5 * .7 - min(5k shield, 1k MP)
  assert.ok(result[B.DMG_EFFECT]&B.EFFECT_HIT);assert.ok(result[B.DMG_EFFECT]&B.EFFECT_CRITICAL);
  assert.equal(target.get(M.MP),0);assert.equal(target.get(M.DEF_FIELD),4000);
  battle.totalHitTime=5;
  assert.equal(battle.calc(B.BATTLE_DMG_STR,attacker,actor({[M.LEVEL]:2}),dummy),100000,'500k panel attack is divided across five hits');
});

test('an unexpected or already patched client fails explicitly instead of silently skipping damage repair',()=>{
  assert.throws(()=>patchBattleDamageMath(source.replace('h=g.GUtil.intNum((100-u)*_*d)','h=0')),/damage patch mismatch: slashing/);
  assert.throws(()=>patchBattleDamageMath(patchBattleDamageMath(source)),/damage patch mismatch/);
});
