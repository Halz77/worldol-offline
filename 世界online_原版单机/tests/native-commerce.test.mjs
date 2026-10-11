import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {nativeCommerce as data} from '../lib/native-commerce-data.mjs';
import {planCommerceAction,handleNativeCommerce} from '../lib/native-commerce.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {equipment} from '../lib/restoration.mjs';
import {handleHomeFeatures} from '../lib/home-feature-service.mjs';
import {SaveStore} from '../lib/store.mjs';
import {Reader,Writer} from '../lib/codec.mjs';
import {decoders,Reader as OriginalReader,protobuf} from '../tools/capture-decoders.mjs';
import {fileURLToPath} from 'node:url';
const now=Date.parse('2026-09-22T10:00:00Z'),day=86400000;
function role(){const p=normalizeRole({id:1001,name:'充值测试',level:97,job:1,race:0,sex:1,mapId:1,vipLevel2:9});p.inventory=[];p.bagLimit=90;p.gold=p.silver=p.coins=0;return p;}
const claim=(p,kind,id,time=now)=>planCommerceAction(p,{kind,id},time).next;
test('normal tiers award first purchase 1.5 once and first-day rewards use local totals',()=>{
 const original=role(),p=claim(original,'normal','3');assert.equal(p.gold,2250);assert.equal(original.gold,0);assert.equal(original.nativeCommerce,undefined);assert.equal(p.nativeCommerce.total,30);assert.deepEqual(p.nativeCommerce.firstDays,[1]);
 const q=claim(p,'normal','3');assert.equal(q.gold,3750);assert.equal(q.inventory.find(x=>x.itemId===40001).quantity,5);
 const second=claim(q,'first-rewards','',now+day);assert.deepEqual(second.nativeCommerce.firstDays,[1,2]);
 const third=claim(second,'first-rewards','',now+2*day);assert.deepEqual(third.nativeCommerce.firstDays,[1,2,3]);assert.equal(third.inventory.find(x=>x.itemId===40048).quantity,2);
 assert.deepEqual(claim(third,'first-rewards','',now+3*day).inventory,third.inventory);
});
test('every recorded tier and gift can deliver, with day week month limits resetting at their boundary',()=>{
 for(const x of data.normal)assert.ok(claim(role(),'normal',x.defineId).nativeCommerce.purchases['normal:'+x.defineId]);
 for(const x of data.daily){let p=role();for(let n=0;n<x.purchaseLimit;n++)p=claim(p,'daily',x.defineId);assert.throws(()=>claim(p,'daily',x.defineId),/上限/);assert.doesNotThrow(()=>claim(p,'daily',x.defineId,now+day));}
 for(const g of data.gifts){let p=role();for(let n=0;n<g.sumTimes;n++)p=claim(p,'gift',g.id);assert.throws(()=>claim(p,'gift',g.id),/上限/);const reset=g.type===0?now+day:g.type===1?Date.parse('2026-09-28T00:00:00+08:00'):Date.parse('2026-10-01T00:00:00+08:00');assert.doesNotThrow(()=>claim(p,'gift',g.id,reset));}
 const decoder=decoders(fileURLToPath(new URL('..',import.meta.url)));
 for(const gift of data.gifts)for(const preview of gift.items){const item=equipment.get(preview.itemId);assert.ok(item,preview.name);const r=new OriginalReader(Buffer.from(item.definitionBase64,'base64')),parsed=new decoder.Item();decoder.Item.fromBytesAtts2(parsed,r);r.finish();assert.equal(parsed.id,preview.itemId);}
 assert.equal(data.items.filter(x=>x.previewOnly).length,5);
});
test('failed storage, full inventory, stale role and overflow leave all balances and claim flags unchanged',()=>{
 const p=role(),before=structuredClone(p),context={role:p,homeOnlineStart:now},sent=[];
 handleHomeFeatures(90020,new Reader(new Writer().string(JSON.stringify({role:1001,action:'commerce',kind:'normal',id:'3'})).done()),context,{now,store:{save(){throw Error('disk full');}},send(t,w){sent.push({t,b:w.done()});},log(){}});
 assert.equal(new Reader(sent.find(x=>x.t===90020).b).byte(),-1);assert.deepEqual(p,before);
 p.bagLimit=1;p.inventory=[{itemId:40003,quantity:99,slot:30}];const full=structuredClone(p);assert.throws(()=>claim(p,'normal','3'),/空间/);assert.deepEqual(p,full);
 p.gold=2147483647;assert.throws(()=>claim(p,'normal','1'),/货币/);
 const stale=role();handleHomeFeatures(90020,new Reader(new Writer().string(JSON.stringify({role:1002,action:'commerce',kind:'normal',id:'1'})).done()),{role:stale},{now,store:{save(){assert.fail('stale save');}},send(){},log(){}});assert.equal(stale.nativeCommerce,undefined);
});
test('native commerce claims persist through the actual home controller and store reload',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-commerce-'));
 try{const db=new SaveStore(dir),p=role();db.data.characters=[p];db.save();const sent=[];handleHomeFeatures(90020,new Reader(new Writer().string(JSON.stringify({role:1001,action:'commerce',kind:'normal',id:'3'})).done()),{role:p,homeOnlineStart:now},{now,store:db,send(t,w){sent.push({t,b:w instanceof Writer?w.done():w});},log(){}});assert.equal(new Reader(sent.find(x=>x.t===90020).b).byte(),0);const restored=new SaveStore(dir).data.characters[0];assert.deepEqual(restored.nativeCommerce,p.nativeCommerce);assert.deepEqual(restored.inventory,p.inventory);assert.equal(restored.gold,2250);}
 finally{const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-commerce-'));fs.rmSync(exact,{recursive:true});}
});
test('recharge achievements check local total and level and cannot be claimed twice',()=>{
 for(const row of data.achievements){const p=role();assert.throws(()=>claim(p,'achievement',row.id),/领取条件/);p.nativeCommerce={total:row.threshold,purchases:{},firstDays:[],achievements:[]};const q=claim(p,'achievement',row.id);assert.ok(q.nativeCommerce.achievements.includes(row.id));assert.throws(()=>claim(q,'achievement',row.id),/领取条件/);}
});
test('native recharge responses use local counts rather than captured account purchases',()=>{
 let p=claim(role(),'normal','1');const send=(t,w)=>replies.push({type:t,body:w instanceof Writer?w.done():w}),replies=[];
 for(const type of [17001,17101,17017,11172,24204,11078,11083])assert.ok(handleNativeCommerce(type,new Reader(Buffer.alloc(0)),{role:p},{send,now}));
 const count=new Reader(replies.find(x=>x.type===17017).body);assert.equal(count.byte(),9);assert.equal(count.byte(),1);assert.equal(count.int(),1);assert.equal(count.pos,count.b.length);
 assert.equal(new Reader(replies.find(x=>x.type===11172).body).int(),1);
 const gifts=protobuf(replies.find(x=>x.type===24205).body,'s2c_DailyGIftPack',data.schemas);assert.equal(gifts.info.length,18);assert.ok(gifts.info.every(x=>!x.buyTimes));
 assert.equal(replies.find(x=>x.type===11078).body.readInt32BE(2),1);assert.equal(new Reader(replies.find(x=>x.type===11083).body).int(),0);
});
