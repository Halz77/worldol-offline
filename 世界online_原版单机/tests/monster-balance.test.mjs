import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Writer} from '../lib/codec.mjs';
import {officialMonsters,officialGroups} from '../lib/official-data.mjs';
import {officialMonsterGroups,officialMonsterModels} from '../lib/official-packets.mjs';
import {balancedMonster,balancedMonsterPacket} from '../lib/monster-balance.mjs';
import {decoders,Reader} from '../tools/capture-decoders.mjs';
const d=decoders(fileURLToPath(new URL('..',import.meta.url)));

test('Halloween boss native packet keeps 60m health and restores every other recorded combat value',()=>{
 const original=officialMonsters.get(1985),before=JSON.stringify(original),r=new Reader(balancedMonsterPacket(original)),boss=d.Monster.fromBytes(r);r.finish();
 assert.equal(boss.hpMax,60000000);assert.equal(boss.mpMax,600000);assert.equal(boss.speed,40000);assert.equal(boss.atkMin,405);assert.equal(boss.atkMax,3000);assert.equal(boss.atk_time+1,6);assert.equal(boss.back,2000);assert.equal(boss.magic_back,2000);
 const unchanged=new Set(['id','name','icon1','level','monstertype','atkType','bornStatus','sources','wireBase64']);
 for(const [key,value] of Object.entries(original)){
  if(unchanged.has(key))continue;
  assert.equal(boss[key],key==='hpMax'?value*10:value,key);
 }
 for(const key of ['id','name','level','monstertype','atkType'])assert.equal(boss[key],original[key]);
 assert.equal(boss.icon1.toJSON(),original.icon1);assert.equal(boss.bornStatus.toJSON(),original.bornStatus);assert.equal(JSON.stringify(original),before);
});

test('live map packets deliver the adjusted boss while all other recorded monsters remain byte-identical',()=>{
 for(const monster of officialMonsters.values())if(monster.id!==1985)assert.deepEqual(balancedMonsterPacket(monster),Buffer.from(monster.wireBase64,'base64'));
 const p={mapId:259},w=new Writer();officialMonsterGroups(w,p);officialMonsterModels(w,p);const r=new Reader(w.done()),data=d.monsters(r);r.finish();
 const boss=data.monsters.find(m=>m.id===1985);assert.equal(boss.hpMax,60000000);assert.equal(boss.def_str,50000);assert.equal(boss.def_agi,50000);assert.equal(boss.def_magic,50000);
 assert.deepEqual(Array.from(data.groups.find(g=>g.groupId===10007).monsters),officialGroups.get(10007).monsters);
 for(const id of [1982,1983,1984])assert.equal(data.monsters.find(m=>m.id===id).hpMax,officialMonsters.get(id).hpMax);
});

test('boss tuning cannot wrap health or critical values in native integer fields',()=>{
 const original=officialMonsters.get(1985);
 assert.throws(()=>balancedMonster({...original,hpMax:300000000}),/hpMax exceeds/);
 assert.throws(()=>balancedMonster({...original,critical:32768}),/critical exceeds/);
});
