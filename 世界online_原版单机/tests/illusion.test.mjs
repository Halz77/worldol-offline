import test from 'node:test';
import assert from 'node:assert/strict';
import {Reader,Writer} from '../lib/codec.mjs';
import {handleIllusion} from '../lib/illusion-service.mjs';
import {equipment} from '../lib/restoration.mjs';

test('mount illusion response count fits the client list parser',()=>{
 const role={id:1,inventory:[{itemId:31157,slot:15,quantity:1}]},packets=[];
 const handled=handleIllusion(11530,new Reader(new Writer().short(15).done()),{role,battle:false},{
  store:{save(){}},
  send(type,body){packets.push({type,body:body.done()});},
  log(){}
 });
 assert.equal(handled,true);
 const reply=packets.find(packet=>packet.type===11530);
 assert.ok(reply);
 // 数量头是 2 字节无符号（放开武器后候选数会超过单字节上限 127）。
 const count=reply.body.readUInt16BE(0);
 assert.ok(count>1,`client must see a positive candidate count, got ${count}`);
});

test('a weapon source lists every weapon type as an illusion candidate',()=>{
 const weapon=[...equipment.values()].find(item=>item.native&&item.definitionBase64&&item.type>=13&&item.type<=24);
 assert.ok(weapon,'expected a native weapon in the equipment catalog');
 const role={id:1,inventory:[{itemId:weapon.id,slot:8,quantity:1}]},packets=[];
 const handled=handleIllusion(11530,new Reader(new Writer().short(8).done()),{role,battle:false},{
  store:{save(){}},
  send(type,body){packets.push({type,body:body.done()});},
  log(){}
 });
 assert.equal(handled,true);
 const reply=packets.find(packet=>packet.type===11530);
 assert.ok(reply);
 const count=reply.body.readUInt16BE(0);
 assert.ok(count>127,`weapon candidates should exceed the old 127 cap, got ${count}`);
});
