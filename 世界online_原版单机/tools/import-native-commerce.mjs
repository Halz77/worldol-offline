import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Reader,decoders,protobuf,protobufSchemas} from './capture-decoders.mjs';
import {readVerifiedCapturePrefix} from './capture-prefix.mjs';
import {readPetSummary} from '../../正式服录制工具/lib/pets.cjs';
import {Writer} from '../lib/codec.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),capture=path.resolve(process.argv[2]);
const verified=readVerifiedCapturePrefix(capture),d=decoders(root),packets=new Map(),requests=new Map();
for(const e of verified.rows){
 if(!/^Network.webSocketFrame(Sent|Received)$/.test(e.method)||e.params.response.opcode!==2)continue;
 const ref=e.params.response.payload,b=fs.readFileSync(path.join(capture,ref.file));if(b.length<4)continue;const type=b.readUInt16BE(2);
 if(e.method.endsWith('Sent')){requests.set(type,b.subarray(4));continue;}
 if(![17001,17101,24205,11078,11083,12004].includes(type))continue;
 packets.set(type,{body:b.subarray(4),request:requests.get(type),source:{capture:path.basename(capture),seq:e.seq,protocol:type,sha256:ref.sha256,blob:ref.file}});
}
const items=new Map();let currentSource;
function item(r){const start=r.pos,value=new d.Item();d.Item.fromBytesAtts2(value,r);const result={...JSON.parse(JSON.stringify(value)),definitionBase64:r.b.subarray(start,r.pos).toString('base64'),sources:[currentSource]};if(!items.has(result.id))items.set(result.id,result);return result;}
function rewards(r){const result=[];for(let n=r.getShort();n>0;n--){const quantity=r.getInt(),i=item(r);result.push({id:i.id,quantity});}for(let n=r.getShort();n>0;n--)result.push({id:r.getInt(),quantity:r.getInt()});return result;}
function products(r,daily=false){const rows=[];for(let n=r.getInt();n>0;n--){
 const row={defineId:r.getString(),info:r.getString(),money:r.getInt(),gold:r.getInt(),silver:r.getInt(),items:[]},count=r.getByte();
 for(let i=0;i<(daily?count:count?1:0);i++){const value=item(r);row.items.push({id:value.id,quantity:daily?r.getByte():count});}
 if(daily){row.purchaseLimit=r.getShort();r.getShort();r.getLong();r.getLong();}else row.purchaseLimit=-1;
 rows.push(row);
}return rows;}
const data={revision:'native-commerce-20260922-v1',sourceAudit:verified.audit,sources:{},normal:[],daily:[],firstRewards:[],gifts:[],vipShops:[],publicPackets:{}};
for(const[type,p]of packets){
 const r=new Reader(p.body);currentSource=p.source;data.sources[type]=p.source;
 if(type===17001){data.normal=products(r);for(let n=r.getShort();n>0;n--){const day=r.getInt();data.firstRewards.push({day,items:rewards(r)});}r.getInt();r.getBoolean();r.getInt();r.finish();}
 if(type===17101){data.daily=products(r,true);r.finish();}
 if(type===24205){const schemas=protobufSchemas(fs.readFileSync(path.join(root,'analysis/protobuf.decoded.js'),'utf8'));schemas.s2c_DailyGIftPack={1:{name:'info',type:'DailyGIftInfo',message:true,repeated:true}};const value=protobuf(p.body,'s2c_DailyGIftPack',schemas);data.gifts=(value.info||[]).map(({buyTimes,...x})=>x);const used=new Set(['s2c_DailyGIftPack']);for(const name of used)for(const f of Object.values(schemas[name]||{}))if(f.message)used.add(f.type);data.schemas=Object.fromEntries([...used].map(k=>[k,schemas[k]]));}
 if(type===12004){assert.equal(r.getByte(),0);const shop={id:new Reader(p.request).getShort(),items:[]};for(let n=r.getShort();n>0;n--){const value=item(r);const row={id:value.id,viewOrder:r.getByte(),originalGold:r.getInt(),originalSilver:r.getInt(),originalCoins:r.getInt(),discount:r.getByte(),gold:r.getInt(),silver:r.getInt(),coins:r.getInt(),status:r.getByte(),maxBuy:r.getShort(),allCount:r.getShort(),hotType:r.getByte(),shopType:r.getByte()};if(r.getBoolean()){r.getString();r.getString();}shop.items.push(row);}r.finish();data.vipShops.push(shop);}
 // These are public reward preview packets. Reset the one character-specific
 // total here; the local service supplies its own accumulated amount.
 if(type===11078){assert.equal(r.getByte(),0);assert.equal(r.getBoolean(),true);const offset=r.pos;r.getInt();r.getString();r.getString();if(r.getBoolean())readPetSummary(r,d);if(r.getBoolean())item(r);if(r.getBoolean())item(r);for(let n=r.getByte();n>0;n--){r.getInt();r.getByte();r.getInt();}const unusedTrailerHex=r.b.subarray(r.pos).toString('hex');const body=Buffer.from(p.body.subarray(0,r.pos));body.writeInt32BE(0,offset);data.publicPackets[type]={bodyBase64:body.toString('base64'),totalOffset:offset,unusedTrailerHex};}
 if(type===11083){
  assert.equal(r.getInt(),0);data.achievements=[];
  for(let n=r.getShort();n>0;n--){const start=r.pos,row={};if(r.getBoolean()){row.power=r.getShort();const value=item(r);row.item={id:value.id,quantity:r.getShort()};if(row.power===109&&r.getBoolean())readPetSummary(r,d);}
   row.prefixBase64=r.b.subarray(start,r.pos).toString('base64');row.strGet=r.getString();row.id=r.getShort();row.bigType=r.getByte();row.name=r.getString();row.point=r.getInt();row.title=r.getString();row.desc=r.getString();row.exp=r.getInt();row.gold=r.getInt();row.silver=r.getInt();row.coins=r.getInt();r.getBoolean();row.threshold=r.getInt();data.achievements.push(row);
  }
  r.getInt();r.getInt();data.achievementNextExp=r.getInt();data.achievementPreviews=[];
  for(let n=r.getInt();n>0;n--){r.getByte();const row={id:r.getShort(),category:r.getByte()};if(r.getBoolean()){const quantity=r.getShort(),value=item(r);row.item={id:value.id,quantity};}data.achievementPreviews.push(row);}r.finish();
 }
}
// Five gift eggs were recorded as protobuf previews, without their use rules.
// Preserve their actual name/icon in the bag; do not invent hatching outcomes.
const officialIds=new Set(JSON.parse(fs.readFileSync(path.join(root,'data/official-v305.json'))).items.map(x=>x.id));
for(const gift of data.gifts)for(const preview of gift.items||[])if(!items.has(preview.itemId)&&!officialIds.has(preview.itemId)){
 assert.equal(preview.type,28);
 const info=preview.info+'\n单机：已还原领取与保存，开蛋规则待补。';
 const bytes=new Writer().byte(28).bool(false).int(preview.itemId).string(preview.name).int(Number(preview.bagIcon)).string(info).byte(preview.grade).byte(0).byte(1).bool(false).byte(0).short(0).int(0).int(0).byte(0).byte(-1).short(0).short(0).short(0).short(0).byte(0).bool(false).done();
 const reader=new Reader(bytes),value=new d.Item();d.Item.fromBytesAtts2(value,reader);reader.finish();
 items.set(value.id,{...JSON.parse(JSON.stringify(value)),previewOnly:true,definitionBase64:bytes.toString('base64'),sources:[{...data.sources[24205],projection:'protobuf preview; local stack 1; no use effect'}]});
}
data.items=[...items.values()];
fs.writeFileSync(path.join(root,'data/native-commerce.json'),JSON.stringify(data,null,2)+'\n');
console.log(JSON.stringify({revision:data.revision,normal:data.normal.map(x=>({id:x.defineId,money:x.money,gold:x.gold,silver:x.silver,items:x.items})),daily:data.daily.length,firstRewards:data.firstRewards,gifts:data.gifts.length,vipShops:data.vipShops.map(x=>({id:x.id,items:x.items.length})),items:data.items.length,publicPackets:Object.keys(data.publicPackets)},null,2));
