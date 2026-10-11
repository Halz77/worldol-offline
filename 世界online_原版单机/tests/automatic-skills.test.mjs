import test from 'node:test';
import assert from 'node:assert/strict';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {handleRestoration} from '../lib/restoration-service.mjs';
import {activeSkills,reconcileSkillSettings,skills} from '../lib/restoration.mjs';
import {automaticSkillSlots} from '../lib/automatic-skills.mjs';
function role(){const p=normalizeRole({id:1001,level:97,job:1,race:0,sex:1});p.skills={420:22,423:22,422:22,421:22,452:22};p.inventory=[];p.autoSkillIds=[];return p;}
function call(p,id,type=14004,target=0,save=()=>{}){let packet;assert.ok(handleRestoration(type,new Reader(new Writer().byte(target).int(id).done()),{role:p},{store:{save},send(t,w){if(t===type)packet=w.done();},log(){}}));return new Reader(packet);}
function rotation(r){assert.equal(r.byte(),0);return Array.from({length:r.byte()},()=>r.short());}
test('empty legacy arrays and full arrays expand with owned automatic skills at VIP zero',()=>{
 const p=role();p.vipLevel2=0;
 for(const id of [420,423,422,421]){assert.equal(activeSkills(p).find(s=>s.id===id).type,2);assert.deepEqual(rotation(call(p,id)),p.autoSkillIds);}
 assert.deepEqual(p.autoSkillIds,[420,423,422,421]);assert.deepEqual(rotation(call(p,420)),p.autoSkillIds,'repeated activation is idempotent');
 assert.deepEqual(rotation(call(p,423,14005)),[420,422,421,0]);assert.deepEqual(rotation(call(p,423)),[420,422,421,423]);
});
test('equipment auto skills require wearing only; stale and duplicate skills no longer occupy the rotation',()=>{
 const p=role();p.skills={};p.inventory=[{itemId:31157,slot:15,quantity:1,bound:false,combinedSkill:{id:6518,level:22}}];p.autoSkillIds=[9999,9999,452];
 const s=activeSkills(p).find(s=>s.name==='星流冰寒');assert.ok(s);assert.equal(s.type,2);
 assert.deepEqual(rotation(call(p,s.id)),[s.id,0,0]);assert.equal(p.inventory[0].bound,false);
 p.inventory[0].slot=30;reconcileSkillSettings(p);assert.deepEqual(p.autoSkillIds,[0,0,0]);
 assert.deepEqual(automaticSkillSlots([420,0,420,452,9999,423],activeSkills(role())),[420,423,0,0,0,0]);
});
test('pet automatic skills expand and failed settings roll back with no partial changes',()=>{
 const p=role(),pet={autoSkills:[],skills:[{...skills.get(420).levels.at(-1),id:420,type:2}],initiativeSkill:-1};p.inventory=[{itemId:24,slot:1,quantity:1,pet}];
 assert.deepEqual(rotation(call(p,420,14004,1)),[420]);
 const before=structuredClone(p);assert.equal(call(p,420,14005,1,()=>{throw Error('disk full');}).byte(),-1);assert.deepEqual(p,before);
 assert.equal(call(p,452).byte(),-1);assert.deepEqual(p,before);assert.equal(call(p,9999).byte(),-1);assert.deepEqual(p,before);
});
