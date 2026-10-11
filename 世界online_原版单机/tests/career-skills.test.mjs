import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {decoders} from '../tools/capture-decoders.mjs';
import {careers,careerSkills,migrateCareerSkills,canonicalLegacySkill} from '../lib/career-skills.mjs';
import {skills,availableSkills,learn,activeSkills,attributes,restored} from '../lib/restoration.mjs';
import {skillPacket,skillList} from '../lib/restoration-packets.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {normalizeRole} from '../lib/content.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
const role=()=>normalizeRole({id:77,name:'导师独立验收',level:97,skillPoints:1060,coins:39602,gold:27,silver:63});

test('all 470 career skills and 10340 levels decode in the actual v305 client including item-only definitions',()=>{
 assert.equal(careers.skills.length,470);assert.equal(new Set(careers.skills.map(s=>s.id)).size,470);
 for(const s of careers.skills){
  assert.ok(s.id>0&&s.id<5000,'player skill ID '+s.id);assert.deepEqual(s.levels.map(l=>l.level),Array.from({length:22},(_,i)=>i+1));
  for(const l of s.levels){
   const r=new d.Reader(skillPacket(new Writer(),{...s,...l},true).done()),decoded=d.Skill.fromShopBytes(r);r.finish();
   for(const key of ['id','name','type','level','power1','powerValue1','power2','powerValue2','power3','powerValue3'])assert.equal(decoded[key]||0,l[key]||0,`${s.name} ${l.level} ${key}`);
   assert.equal(decoded.reqJob,s.job);assert.equal(decoded.reqLevel,1);assert.equal(decoded.sp+decoded.money1+decoded.money2+decoded.money3,0);
   if(l.type!==1)for(const key of ['skillAtkType','area','round','atk_time','useMP','useHP','anime1','anime2','anime3','position','statusBit1','statusBit2','statusBit3'])assert.equal(decoded[key]||0,l[key]||0,`${s.name} ${l.level} ${key}`);
  }
 }
});

test('every original and added career teacher exposes all its career skills with max level 22 and pet teachers stay separate',()=>{
 const p=role();assert.deepEqual(careers.teachers.map(t=>t.job),[1,2,3,4,5,10,6,11,12]);
 for(const t of careers.teachers)for(const shop of [t.shop,...t.shops]){
  assert.equal(d.native(4,'isCountrySkillShop',{e:d.constants})(shop),false,'must use ordinary player shop protocol');
  const list=availableSkills(p,shop);assert.equal(list.filter(s=>s.career&&s.profession===t.name).length,t.count,t.name+' '+shop);assert.ok(list.length<=127);
  for(const s of list.filter(s=>s.career)){assert.equal(s.level,1);assert.equal(s.levels.at(-1).level,22);}
 }
 for(const s of availableSkills(p,2001)){assert.ok(!s.career);assert.throws(()=>learn(p,2001,s.id,1),/不能给人物学习/);}
});

test('every career skill can be learned sequentially from 1 to 22, retained after reload, and cannot skip or exceed the cap',()=>{
 for(const s of careers.skills){
  const p=role(),balances=[p.skillPoints,p.coins,p.gold,p.silver];
  assert.throws(()=>learn(p,s.shop,s.id,2));
  for(let level=1;level<=22;level++){const learned=learn(p,s.shop,s.id,level);assert.equal(learned.level,level);assert.equal(p.skills[s.id],level);}
  assert.throws(()=>learn(p,s.shop,s.id,23));assert.deepEqual([p.skillPoints,p.coins,p.gold,p.silver],balances);
  assert.equal(normalizeRole(JSON.parse(JSON.stringify(p))).skills[s.id],22);
 }
});

test('old save migration preserves learned progress, resolves ID collisions once, and does not remap an equipment-only skill',()=>{
 const source=JSON.parse(fs.readFileSync(new URL('../qa-v05-saves/world.json',import.meta.url),'utf8')).characters.find(p=>p.id===1001);
 const p=structuredClone(source),before=structuredClone(p);normalizeRole(p);
 assert.equal(p.level,before.level);assert.deepEqual(p.inventory,before.inventory);assert.equal(p.skillPoints,before.skillPoints);
 if(!before.restoration?.careerSkills)for(const [id,level] of Object.entries(before.skills))assert.equal(p.skills[canonicalLegacySkill(Number(id))],level);
 const snapshot=JSON.stringify(p);normalizeRole(p);assert.equal(JSON.stringify(p),snapshot);
 const old={skills:{3100:20,3104:17},autoSkillIds:[0,0],initiativeSkillId:4007,restoration:{}};migrateCareerSkills(old);assert.equal(old.initiativeSkillId,4007);assert.equal(old.skills[406],20);
 const northern=restored.skills.find(s=>s.name==='北冥神功');if(northern)assert.equal(careerSkills.get(canonicalLegacySkill(northern.id)).type,1);
});

test('100-skill limit permits the 21st through 100th skills, upgrades and replacement after forgetting',()=>{
 const p=role(),s=careers.skills.find(s=>s.name==='巨人之力'),messages=[];
 const call=(type,body)=>handleRestoration(type,new Reader(body.done()),{role:p},{store:{save(){}},send(type,w){messages.push(new Reader(w.done()));},log(){}});
 for(const level of [1,2]){call(14002,new Writer().short(s.shop).int(s.id).byte(level).bool(false));const r=messages.at(-1);assert.equal(r.byte(),0);assert.equal(r.int(),s.id);assert.deepEqual([r.int(),r.int(),r.int(),r.int()],[1060,27,63,39602]);}
 const low=attributes(p);for(let level=3;level<=22;level++)learn(p,s.shop,s.id,level);assert.equal(p.skills[s.id],22);
 const generated=skills.get(s.id).levels[21];assert.deepEqual(generated.powers,[[39,26],[55,65],[63,5400]]);assert.equal(activeSkills(p)[0].level,22);
 call(14003,new Writer().int(s.id).byte(0));const r=messages.at(-1);assert.equal(r.byte(),0);r.int();assert.deepEqual([r.int(),r.int(),r.int(),r.int()],[1060,27,63,39602]);
 assert.equal(careers.maxLearned,100);
 for(const item of careers.skills.slice(0,100))learn(p,item.shop,item.id,1);
 assert.equal(Object.keys(p.skills).length,100);
 const first=careers.skills[0];learn(p,first.shop,first.id,2);
 assert.throws(()=>learn(p,careers.skills[100].shop,careers.skills[100].id,1),/已学满 100/);
 const persisted=normalizeRole(JSON.parse(JSON.stringify(p)));assert.deepEqual(persisted.skills,p.skills);
 const native=new d.Reader(skillList(new Writer(),persisted).done());assert.equal(native.getShort(),100);
 for(let n=0;n<100;n++){d.Skill.fromBytes(native);native.getByte();}native.finish();
 call(14001,new Writer().short(first.shop));const shop=messages.at(-1);assert.equal(shop.short(),first.shop);assert.ok(shop.byte()>0);assert.equal(shop.byte(),100);
 call(14003,new Writer().int(first.id).byte(0));assert.equal(messages.at(-1).byte(),0);
 learn(p,careers.skills[100].shop,careers.skills[100].id,1);assert.equal(Object.keys(p.skills).length,100);
 assert.deepEqual([p.skillPoints,p.gold,p.silver,p.coins],[1060,27,63,39602]);
});
