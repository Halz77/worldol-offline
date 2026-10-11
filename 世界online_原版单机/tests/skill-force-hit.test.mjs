import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {careers} from '../lib/career-skills.mjs';
import {skillPacket} from '../lib/restoration-packets.mjs';
import {Writer} from '../lib/codec.mjs';
import {decoders} from '../tools/capture-decoders.mjs';
import {powerFormatter} from '../tools/catalog-format.mjs';
import {normalizeSkillEffectUnits} from '../tools/skill-effect-text.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root),format=powerFormatter(root);
const row=id=>careers.skills.find(s=>s.id===id).levels[21];

test('only attached skill force-hit gains a missing percent unit; original source and base stats remain intact',()=>{
 assert.equal(normalizeSkillEffectUnits('附加强制命中率+36'),'附加强制命中率+36%');
 assert.equal(normalizeSkillEffectUnits('技能附带强制命中率+70'),'技能附带强制命中率+70%');
 for(const text of ['附加强制命中率+36%','基础强制命中率+36','强制命中率+36','强制命中率+36%','附带致命点+240'])assert.equal(normalizeSkillEffectUnits(text),text);
 const guide=JSON.parse(fs.readFileSync(new URL('../data/official-guides.json',import.meta.url),'utf8')).records.find(s=>s.name==='天翔龙闪');
 assert.equal(guide.effects[1].description,'附加强制命中率+36','raw guide remains unchanged');
 const native=careers.skills.find(s=>s.id===456).levels[0];assert.equal(native.reconstructed,false);assert.equal(native.powerValue2,1);
});

test('all six guide omissions compile to the requested level-22 force-hit effect in native skill packets and UI descriptions',()=>{
 const directory=JSON.parse(fs.readFileSync(new URL('../data/career-skill-directory.json',import.meta.url),'utf8'));
 for(const [id,value] of [[454,24],[456,36],[746,70],[629,83],[636,97],[4855,70]]){
  const s=row(id),effects=s.powers.filter(([power])=>power===85);assert.deepEqual(effects,[[85,value]],s.name);
  const reader=new d.Reader(skillPacket(new Writer(),s).done()),native=d.Skill.fromBytes(reader);reader.finish();
  const fields=[1,2,3].filter(n=>native['power'+n]===85);assert.equal(fields.length,1);assert.equal(native['powerValue'+fields[0]],value);
  assert.equal(format(85,value,s),'附加强制命中率+'+value+'%');
  assert.match(s.info,new RegExp('强制命中率\\+'+value+'%'));
  assert.ok(directory.skills.find(s=>s.id===id).levels[21].effects.some(e=>e.endsWith('强制命中率+'+value+'%')));
 }
 const s=row(456);assert.equal(s.powerValue1,240);assert.equal(s.area,18);assert.equal(s.skillWeapon,9);assert.equal(s.useMP,534);assert.equal(s.skillAtkType,0);
 assert.equal(careers.maxLearned,100);
});

test('native combat uses Tianxiang level-22 +36 percentage points rather than the old level-1 fallback',()=>{
 const ModelConst=d.module(12).constants,battle=d.module(61).constants;
 const calc=d.native(251,'calc',{f:{ModelConst},c:{default:d.constants},y:{default:battle},T:{Tool:{debug(){}}}});
 const s=Object.assign({},row(456),{getPowerValue:d.native(57,'getPowerValue')});
 const attacker={get:id=>id===ModelConst.FORCE_HIT?30:id===ModelConst.HIT_RATE?10:0},target={get:()=>100};
 for(const kind of [battle.BATTLE_STR_HITRATE,battle.BATTLE_AGI_HITRATE]){
  assert.equal(calc(kind,attacker,target,s),66);
  assert.equal(calc(kind,attacker,target,{...s,powerValue2:1}),31);
 }
});
