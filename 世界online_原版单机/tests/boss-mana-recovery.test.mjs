import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {decoders} from '../tools/capture-decoders.mjs';
import {officialMonsters} from '../lib/official-data.mjs';
import {balancedMonster} from '../lib/monster-balance.mjs';
import {patchGardenerManaRecovery} from '../lib/client-monster-recovery-patch.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root);
const raw=process.env.WORLDOL_RESOURCES || (fs.existsSync(path.join(root,'client/v/gd/305.json'))?path.join(root,'client'):path.resolve(root,'../H5客户端_v305_20260920/files/resgood'));
const source=fs.readFileSync(path.join(raw,'js/ff/fff570bb4753f056432680e781d827dc.js'),'utf8');
let roundSource;
simple(parse(source,{ecmaVersion:'latest'}),{AssignmentExpression(node){
  if(node.left.type==='MemberExpression'&&node.left.property.name==='doRoundHpMp'&&node.right.type==='FunctionExpression'){
    assert.equal(roundSource,undefined,'one native round recovery method');roundSource=source.slice(node.right.start,node.right.end);
  }
}});
assert.ok(roundSource);
const C=d.constants,M=d.module(12).constants,B=d.module(61).constants,types=d.module(31).constants;
assert.equal(types.TYPE_MONSTER,2);
C.getBufferBitValue=d.native(4,'getBufferBitValue',{e:C});
const intNum=d.native(13,'intNum'),sumValue=(v,add,min,max)=>Math.max(min,Math.min(max,v+add));
class Effects{constructor(){this.items=[];}get length(){return this.items.length;}addElement(v){this.items.push(v);}elementAt(i){return this.items[i];}}
const effectFactory={createBattleTargetEffect:(position,value,effect)=>({position,value,effect})};
const processBattleHpMpPower=d.native(75,'processBattleHpMpPower',{a:{ModelConst:M},d:{default:B},C:{default:effectFactory}});
const baseAddValue=d.native(31,'addValue',{_:{ModelConst:M},l:{Tool:{sumValue}}});
const addValue=d.native(56,'addValue',{_:{ModelConst:M},a:{Tool:{sumValue}},g:{GUtil:{intNum}},e:{prototype:{addValue:baseAddValue}}});
const scope={f:{ModelConst:M},c:{default:C},g:{GUtil:{intNum}},v:{default:Effects},E:{default:{processBattleHpMpPower}},T:{Tool:{debug(){}}}};
const original=new vm.Script('('+roundSource+')').runInNewContext(scope);
const patched=new vm.Script('('+patchGardenerManaRecovery(roundSource)+')').runInNewContext(scope);
const template=balancedMonster(officialMonsters.get(1985));

function run(fn,mp,{id=1985,type=types.TYPE_MONSTER,poison=false,regen=true,dead=false,flatMana=0,mpMax=template.mpMax,healthMissing=0}={}){
  let born=BigInt(template.bornStatus);if(!regen)born&=~BigInt(C.getBufferBitValue(C.BUFFER_ADD_MP));
  const startHp=dead?0:template.hpMax-healthMissing;
  const actor={...template,id,mp,mpMax,hp:startHp,position:4,getType:()=>type,addValue,onAttrUpdate(){},
    get(k){if(k===M.HP)return this.hp;if(k===M.MP)return this.mp;if(k===M.HPMAX)return this.hpMax;if(k===M.MPMAX)return this.mpMax;if(k===M.HEAL_RECOVERY)return 0;if(k===M.MANA_RECOVERY)return flatMana;throw Error('Unexpected stat '+k);},
    isBattleStatus(mask){return (born&BigInt(mask))!==0n||(poison&&mask===C.getBufferBitValue(C.BUFFER_POISON));},
    isDead(){return this.hp<=0;},isDeadNoWithDelay(){return this.hp<=0;}};
  const controls=[];fn.call({round:2,addAniControl:x=>controls.push(x)},actor);
  return {mp:actor.mp,restored:actor.mp-mp,hp:actor.hp,healed:actor.hp-startHp,controls};
}

test('gardener innate regeneration uses 5 percent of current MP at the round tick',()=>{
  for(const mp of [0,1,19,20,21,99,100,100000,300000,571428,580000,599999,600000]){
    const actual=run(patched,mp),expected=Math.min(600000,mp+Math.floor(mp/20));
    assert.equal(actual.mp,expected,'starting MP '+mp);
  }
  assert.equal(run(original,300000).restored,3000);
  assert.equal(run(patched,300000).restored,15000);
  assert.equal(run(patched,100000).restored,5000);
  assert.equal(run(patched,100000,{mpMax:900000}).restored,5000,'current MP, not max MP');
});

test('successive turns use the newly recovered MP; empty MP stays empty',()=>{
  let mp=100000;for(const expected of [105000,110250,115762]){mp=run(patched,mp).mp;assert.equal(mp,expected);}
  for(let turn=0;turn<3;turn++)assert.equal(run(patched,0).mp,0);
});

test('poison, dead actors and missing innate buff prevent the same recovery paths as before',()=>{
  assert.equal(run(patched,300000,{poison:true}).restored,0);
  assert.equal(run(patched,300000,{dead:true}).restored,0);
  assert.equal(run(patched,300000,{regen:false}).restored,0);
  assert.equal(run(patched,300000,{flatMana:100}).restored,15100,'independent recovery bonuses still stack');
  assert.equal(run(patched,300000,{flatMana:100,poison:true}).restored,0);
});

test('other monsters and same-ID players or pets keep native max-MP recovery and HP recovery is unchanged',()=>{
  for(const options of [{id:1984},{id:1986},{type:types.TYPE_PLAYER},{type:types.TYPE_PET}]){
    for(const mp of [0,100000,300000,599999])assert.deepEqual(run(patched,mp,options),run(original,mp,options));
  }
  const opts={healthMissing:1000000};
  assert.equal(run(patched,300000,opts).healed,run(original,300000,opts).healed);
  assert.equal(run(patched,300000,opts).healed,300000);
});

test('the exact v305 bundle is patched once and mismatched bundles fail explicitly',()=>{
  const changed=patchGardenerManaRecovery(source);
  assert.throws(()=>patchGardenerManaRecovery(changed),/patch mismatch/);
  assert.throws(()=>patchGardenerManaRecovery(source.replace('s=g.GUtil.intNum(.005*a)','s=0')),/patch mismatch/);
});
