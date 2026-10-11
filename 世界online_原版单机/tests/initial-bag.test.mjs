import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {SaveStore} from '../lib/store.mjs';
import {careers} from '../lib/career-skills.mjs';
import {bagCapacity,firstFree,planItemRewards} from '../lib/restoration.mjs';
import {bagPacket} from '../lib/restoration-packets.mjs';
import {playerDetail} from '../lib/world.mjs';
import {Writer} from '../lib/codec.mjs';
import {Reader,decoders} from '../tools/capture-decoders.mjs';
import {skipPlayerDetail,itemInstance} from '../tools/capture-public-blocks.mjs';

const d=decoders(fileURLToPath(new URL('..',import.meta.url)));
function store(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-initial-bag-'));
 t.after(()=>{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-initial-bag-'));fs.rmSync(exact,{recursive:true});});
 return new SaveStore(dir);
}
const input=()=>({name:'背包验收',sex:1,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'});

test('every career starts with 300 usable bag slots and keeps them after reloading',t=>{
 const db=store(t),ids=[];
 for(const race of [0,1])for(const job of new Set(careers.teachers.map(t=>t.job))){
  const p=db.create(db.account(`bag-${race}-${job}`),{...input(),race,job});ids.push(p.id);
  assert.equal(p.bagLimit,300);assert.equal(bagCapacity(p),300);
  const wire=new Reader(playerDetail(new Writer(),p).done());assert.equal(skipPlayerDetail(wire).bagLimit,300);wire.finish();
 }
 assert.ok(new SaveStore(db.dir).data.characters.filter(p=>ids.includes(p.id)).every(p=>p.bagLimit===300));
});

test('loading legacy saves automatically persists 300 slots without changing other data or repeatedly rewriting the file',t=>{
 const db=store(t);
 for(const [i,capacity] of [undefined,24,60,90,300,400].entries()){
  const p=db.create(db.account('legacy-'+i),input());
  if(capacity===undefined)delete p.bagLimit;else p.bagLimit=capacity;
  p.unknownLegacyField={retained:['value',i]};p.quests.completed=[1111];
 }
 db.save();const beforeBytes=fs.readFileSync(db.file),before=JSON.parse(beforeBytes),expected=structuredClone(before);
 for(const p of expected.characters)p.bagLimit=Math.max(300,p.bagLimit||24);
 const loaded=new SaveStore(db.dir),actual=JSON.parse(fs.readFileSync(db.file,'utf8'));
 assert.deepEqual(actual,expected);assert.deepEqual(loaded.data,expected);
 assert.deepEqual(fs.readFileSync(db.file+'.bak'),beforeBytes);
 const migratedBytes=fs.readFileSync(db.file);new SaveStore(db.dir);
 assert.deepEqual(fs.readFileSync(db.file),migratedBytes);assert.deepEqual(fs.readFileSync(db.file+'.bak'),beforeBytes);
});

test('the 300th slot accepts rewards, survives save and native decoding, and a full bag rejects overflow',t=>{
 const db=store(t),p=db.create(db.account('bag-boundary'),input());
 p.inventory=Array.from({length:299},(_,i)=>({itemId:20300,slot:30+i,quantity:1}));
 assert.equal(firstFree(p),329);
 const reward=planItemRewards(p,[{id:25,quantity:1}]);assert.equal(reward.added[0].instance.slot,329);p.inventory=reward.inventory;
 assert.equal(firstFree(p),undefined);assert.equal(p.inventory.length,300);
 const before=structuredClone(p);assert.throws(()=>planItemRewards(p,[{id:20300,quantity:1}]),/背包空间不足/);assert.deepEqual(p,before);
 db.save();const restored=new SaveStore(db.dir).data.characters[0];assert.deepEqual(restored.inventory,p.inventory);
 const wire=new Reader(bagPacket(new Writer(),restored).done()),count=wire.getShort(),items=Array.from({length:count},()=>itemInstance(wire,d));wire.finish();
 assert.equal(count,300);assert.equal(items.at(-1).slot,329);assert.equal(items.at(-1).item.id,25);
 const valid=d.native(33,'isValidBagPos',{e:{BAG_START:30}}),bag={bagEnd:329};
 assert.equal(valid.call(bag,329),true);assert.equal(valid.call(bag,330),false);
});
