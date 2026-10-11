import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {request,decode,initialState,tasks,applyResult,coverage,root} from '../tools/catalog-core.mjs';
import {identificationPreview} from '../lib/catalog-packets.mjs';
import {powerFormatter} from '../tools/catalog-format.mjs';
import {Reader,decoders} from '../tools/capture-decoders.mjs';
const official=JSON.parse(fs.readFileSync(path.join(root,'data/official-v305.json')));
const capture=path.join(root,'../正式服录制数据/2026-09-19T23-46-03-133Z_d6e6ad');
const rows=fs.readdirSync(path.join(capture,'events')).filter(x=>/^\d+\.ndjson$/.test(x)).flatMap(f=>fs.readFileSync(path.join(capture,'events',f),'utf8').trim().split('\n').map(JSON.parse));
const packet=seq=>fs.readFileSync(path.join(capture,rows.find(r=>r.seq===seq).params.response.payload.file));
test('real recorded item, identification, skill and handbook packets decode to EOF',()=>{
  const item=decode({kind:'item',id:28003},packet(1735));assert.equal(item.item.name,'雌雄双股剑【真】');
  const range=decode({kind:'identify',id:28003},packet(1864));assert.equal(range.slots.length,5);assert.equal(range.slots.reduce((n,s)=>n+s.options.length,0),19);assert.deepEqual(range.slots[0].options[0],{power:53,min:572,max:1572});
  const fashion=decode({kind:'identify',id:15209},packet(3228));assert.equal(fashion.slots.length,3);
  assert.deepEqual(identificationPreview(28003),packet(1864).subarray(4));
  assert.deepEqual(identificationPreview(15209),packet(3228).subarray(4));
  assert.deepEqual(identificationPreview(2147483647),Buffer.from([0,0]));
  const sword=official.identification.find(i=>i.itemId===2056);assert.deepEqual(sword.slots.map(s=>s.options),[[{power:53,min:75,max:99}],[{power:55,min:11,max:16}],[{power:1,min:3,max:7}],[{power:3,min:3,max:7}]]);
  const skills=decode({kind:'skills',id:305},packet(8329));assert.ok(skills.skills.length>10);assert.ok(skills.skills.every(s=>s.wireBase64&&s.sources[0].origin==='shop'));
  const pageRow=rows.find(e=>e.method==='Network.webSocketFrameReceived'&&e.params.response.payload?.file&&fs.readFileSync(path.join(capture,e.params.response.payload.file)).readUInt16BE(2)===32102);
  const index=rows.indexOf(pageRow),req=rows.slice(0,index).findLast(e=>e.method==='Network.webSocketFrameSent'&&e.params.response.payload?.file&&fs.readFileSync(path.join(capture,e.params.response.payload.file)).readUInt16BE(2)===32101);
  const b=packet(req.seq);const page=decode({kind:'catalog',group:b[5],type:b[7]},packet(pageRow.seq));assert.ok(page.items.length);
  assert.throws(()=>decode({kind:'item',id:2056},packet(1735)),/ID mismatch/);
  assert.throws(()=>decode({kind:'identify',id:28003},packet(1864).subarray(0,-1)),/envelope/);
});
test('query whitelist excludes game-state mutations; queue deduplicates and resumes',()=>{
  for(const kind of ['buy','learn','identifyExecute','bind','login'])assert.throws(()=>request({kind,id:1}));
  assert.equal(request({kind:'item',id:2056}).hex,'00083eb300000808');
  const state=initialState(official),before=tasks(state,official);assert.ok(before.some(q=>q.kind==='skills'&&q.id===307));
  assert.equal(new Set(before.map(q=>JSON.stringify(q))).size,before.length);
  const q={kind:'identify',id:28003};applyResult(state,q,decode(q,packet(1864)));
  assert.ok(!tasks(state,official).some(x=>x.kind===q.kind&&x.id===q.id));
  state.failed['skills:307']={message:'requires access'};assert.ok(!tasks(state,official).some(q=>q.kind==='skills'&&q.id===307));
  assert.equal(coverage(state,official).allSkillLevelsKnown,false);
});
test('eight-slot upgrade gear preserves binding and all four upgrade groups',()=>{
  const file=path.join(root,'../正式服录制数据/2026-09-20T03-42-11-539Z_d8c050/blobs/12/122eaea6323ef94a970abf77f5f4bf02a0997abda5043492842c143af34b16db.bin');
  const range=decode({kind:'identify',id:9081},fs.readFileSync(file));
  assert.deepEqual(range.slots.map(s=>s.field),['power1','power2','bindPower1','bindPower2','power4','power5','power6','power7']);
  assert.equal(range.slots.reduce((n,s)=>n+s.options.length,0),23);
});
test('native effect text preserves armor penetration, percentages and status removal',()=>{
 const format=powerFormatter(root);
 assert.equal(format(87,50),'无视目标+50点物理防御');
 assert.equal(format(1,-7),'力量-7');
 assert.equal(format(2,7),'力量+7%');
 assert.equal(format(79,1),'清除目标中毒状态');
});
test('pet equipment preview trailer stays outside the native bag item definition',()=>{
 const file=path.join(root,'../正式服录制数据/2026-09-20T03-42-11-539Z_d8c050/blobs/7c/7cb8a544ae22a920d6a32962339036faca6566f6031940aaeca7a10443a98d1b.bin');
 const bytes=fs.readFileSync(file),result=decode({kind:'item',id:6144},bytes);
 assert.equal(result.item.name,'魔女条件');assert.equal(result.item.type,41);
 assert.equal(Buffer.from(result.item.previewTrailerBase64,'base64').toString('hex'),'000000000001');
 const d=decoders(root),r=new Reader(Buffer.from(result.item.definitionBase64,'base64'));
 const item=new d.Item();d.Item.fromBytesAtts2(item,r);r.finish();assert.equal(item.id,6144);
 const truncated=bytes.subarray(0,-1);truncated.writeUInt16BE(truncated.length);assert.throws(()=>decode({kind:'item',id:6144},truncated),/Unconsumed/);
});
test('pet identification retains its scale prefix and both binding groups',()=>{
 const file=path.join(root,'../正式服录制数据/2026-09-20T04-31-01-488Z_7cfec3/blobs/f7/f77f00fef999c3621e95a621ee42f29145b5a11f21be28802e53802a83bec4f6.bin');
 const bytes=fs.readFileSync(file),result=decode({kind:'identify',id:6144,pet:true},bytes);
 assert.equal(result.petScale,'20.0');assert.equal(result.petLevel,100);
 assert.deepEqual(result.slots.map(s=>s.field),['bindPower1','bindPower2']);
 assert.deepEqual(result.slots[0].options[0],{power:67,min:2,max:13});
 assert.deepEqual(Buffer.from(result.wireBase64,'base64'),bytes.subarray(4));
});
