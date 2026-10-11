import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Reader,decoders,protobufSchemas,protobuf} from './capture-decoders.mjs';
import {readVerifiedCapturePrefix} from './capture-prefix.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),arg=process.argv.indexOf('--capture');
assert.ok(arg>=0&&process.argv[arg+1],'Required --capture');
const capture=path.resolve(process.argv[arg+1]),id=path.basename(capture),d=decoders(root);
const verified=readVerifiedCapturePrefix(capture),events=new Map(verified.rows.map(e=>[e.seq,e]));
const index=JSON.parse(fs.readFileSync(path.join(capture,'details/index.json'),'utf8'));
const schemas=protobufSchemas(fs.readFileSync(path.join(root,'analysis/protobuf.decoded.js'),'utf8'));
schemas.c2s_ClimbTowerInfo={1:{name:'modeType',type:'int32',message:false,repeated:false}};
const sourceBytes=s=>{
  assert.equal(s.capture,id);const ref=events.get(s.seq)?.params?.response?.payload;
  assert.equal(ref?.file,s.blob);assert.equal(ref?.sha256,s.sha256);
  const b=fs.readFileSync(path.join(capture,s.blob));assert.equal(crypto.createHash('sha256').update(b).digest('hex'),s.sha256);
  assert.equal(b.readUInt16BE(2),s.protocol);return b;
};
const source=s=>({capture:id,seq:s.seq,protocol:s.protocol,sha256:s.sha256,blob:s.blob});
const tower=[];
for(const entry of index.remoteDirectories||[]){
  if(entry.data.kind!=='tower-directory')continue;
  const s=entry.sources.at(-1),p=protobuf(sourceBytes(s).subarray(4),'s2c_ClimbTowerInfo',schemas);
  tower.push({mode:entry.data.mode,source:source(s),sweepItem:p.sweepItem,levels:(p.infos||[]).map(x=>({id:x.id,rank:x.rank,level:x.level,type:x.type,info:x.info,openFloor:x.openFloor,first:x.first||[],normal:x.normal||[]}))});
}
const previews=(index.remotePreviews||[]).filter(x=>x.data.kind==='tower-preview').map(entry=>{
  const s=entry.sources.at(-1),b=sourceBytes(s),r=new Reader(b.subarray(4)),n=r.getByte(),monsters=[];
  assert.ok(n>=0&&n<=127);for(let i=0;i<n;i++){const start=r.pos,m=d.Monster.fromBytes(r);monsters.push({...JSON.parse(JSON.stringify(m)),wireBase64:r.b.subarray(start,r.pos).toString('base64')});}r.finish();
  assert.deepEqual(monsters.map(m=>m.id),entry.data.monsterIds);
  return {id:entry.data.id,mode:entry.data.mode,source:source(s),monsters,bodyBase64:b.subarray(4).toString('base64'),skillsPending:true,aiPending:true};
});
const vip=index.vip.find(x=>x.key==='11055');assert.ok(vip);const vs=vip.sources.at(-1),vb=sourceBytes(vs);
for(const item of vip.data.items)assert.ok(vb.includes(Buffer.from(item.definitionBase64,'base64')));
const publicPackets=new Map();
for(const e of verified.rows){
 if(e.method!=='Network.webSocketFrameReceived'||e.params.response.opcode!==2)continue;
 const ref=e.params.response.payload,b=fs.readFileSync(path.join(capture,ref.file));
 if(b.length<4)continue;const type=b.readUInt16BE(2);
 if([11108,20301,27163,30300,31301].includes(type))publicPackets.set(type,{bytes:b,source:{capture:id,seq:e.seq,protocol:type,sha256:ref.sha256,blob:ref.file}});
}
const rewardItems=r=>{
 const items=[];for(let n=r.getShort();n>0;n--){const quantity=r.getInt(),start=r.pos,item=new d.Item();d.Item.fromBytesAtts2(item,r);items.push({...JSON.parse(JSON.stringify(item)),quantity,definitionBase64:r.b.subarray(start,r.pos).toString('base64')});}
 const currencies=[];for(let n=r.getShort();n>0;n--)currencies.push({id:r.getInt(),quantity:r.getInt()});return {items,currencies};
};
let online=null;const op=publicPackets.get(11108);
if(op){const r=new Reader(op.bytes.subarray(4));r.getInt();r.getInt();const levels=[];for(let n=r.getShort();n>0;n--){r.getShort();const minutes=r.getInt(),reward=rewardItems(r);r.getShort();const shareReward=rewardItems(r);levels.push({minutes,...reward,shareReward});}r.finish();online={levels,source:op.source};}
const used=new Set(['s2c_ClimbTowerInfo','c2s_ClimbTowerInfo','s2c_ClimbTowerChallenge','c2s_ClimbTowerChallenge','s2c_ClimbTowerSweep','c2s_ClimbTowerSweep','s2c_errorNotice']);
for(const name of used)for(const f of Object.values(schemas[name]||{}))if(f.message)used.add(f.type);
const data={revision:'home-features-20260922-v1',capture:id,sourceAudit:verified.audit,schemas:Object.fromEntries([...used].map(k=>[k,schemas[k]])),vip:{...vip.data,source:source(vs)},tower,previews,online};
fs.writeFileSync(path.join(root,'data/home-features-v1.json'),JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({capture:id,tower:tower.map(t=>({mode:t.mode,levels:t.levels.length})),previews:previews.length,monsters:new Set(previews.flatMap(p=>p.monsters.map(m=>m.id))).size,vip:vip.data.items.map(i=>({id:i.id,name:i.name})),integrityPassed:verified.audit.integrityPassed}));
