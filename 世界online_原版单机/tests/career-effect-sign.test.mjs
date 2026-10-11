import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {careers} from '../lib/career-skills.mjs';
import {decoders} from '../tools/capture-decoders.mjs';
import {powerFormatter} from '../tools/catalog-format.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root),format=powerFormatter(root);
const projection=JSON.parse(fs.readFileSync(new URL('../data/skill-progression.json',import.meta.url),'utf8'));
const monsoon=careers.skills.find(s=>s.name==='季风狂乱').levels[21];

test('Monsoon level 22 preserves official damage, confusion, resistance debuff and positive ignore magnitude',()=>{
 assert.deepEqual(monsoon.powers,[[49,-4300],[64,-320],[156,420]]);
 assert.equal(monsoon.statusBit1,9);assert.equal(monsoon.round,3);assert.equal(monsoon.useMP,1000);assert.equal(monsoon.area,11);
 assert.equal(format(monsoon.power3,monsoon.powerValue3,monsoon),'目标伤害减免值-420');
});

test('every reconstructed explicit skill ignore effect lowers the target stat, while captured definitions remain intact',()=>{
 let checked=0;
 const sourceByKey=new Map(projection.skills.map(s=>[s.key,s]));
 for(const s of careers.skills)for(const l of s.levels)if(l.reconstructed){
  const effects=sourceByKey.get(s.key).levels[l.level-1].effects;
  for(let i=1;i<=3;i++){
   const id=l['power'+i],value=l['powerValue'+i],text=effects.find(e=>e.index===i)?.text||'';
   if(id<151||id>156||!/^技能附带无视/.test(text))continue;
   assert.ok(value>=0,`${s.name} ${l.level} ${text}: ${id}=${value}`);
   assert.ok(!/值\+|率\+/.test(format(id,value,l)),`${s.name} must not increase the target stat`);checked++;
  }
 }
 assert.ok(checked>=100,`checked ${checked} explicit ignores`);
 const catalog=JSON.parse(fs.readFileSync(new URL('../data/catalog-skills.json',import.meta.url),'utf8'));
 for(const s of careers.skills)for(const l of s.levels)if(!l.reconstructed){
  const native=catalog.find(n=>n.id===s.sourceId&&n.level===l.level);assert.ok(native);
  for(const field of ['power1','powerValue1','power2','powerValue2','power3','powerValue3'])assert.equal(l[field],native[field]);
 }
});

test('the original v305 damage reduction calculation applies the ignore as penetration, not extra protection',()=>{
 const ModelConst=d.module(12).constants,constants={...d.constants};
 constants.getBufferBitValue=d.native(4,'getBufferBitValue',{e:constants});
 const calTouch=d.native(75,'calTouch',{a:{ModelConst},o:{default:constants}});
 const calTouchDmg=d.native(251,'calTouchDmg',{E:{default:{calTouch}},c:{default:constants},f:{ModelConst},y:{default:d.module(61).constants},g:{GUtil:{intNum:Math.trunc}}});
 const skill=Object.assign({},monsoon,{getPowerValue:d.native(57,'getPowerValue')});
 const target={get:id=>id===ModelConst.TOUGH?500:0,isBattleStatus:()=>false};
 assert.equal(calTouchDmg(target,null,null,4300),2150);
 assert.equal(calTouchDmg(target,null,skill,4300),3956);
 const old=Object.assign({},skill,{powerValue3:-420});
 assert.equal(calTouchDmg(target,null,old,4300),1290);
});
