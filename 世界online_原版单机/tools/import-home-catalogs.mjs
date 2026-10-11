import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {readVerifiedCapturePrefix} from './capture-prefix.mjs';import {decoders,Reader,protobuf,protobufSchemas} from './capture-decoders.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),arg=process.argv.indexOf('--captures');assert.ok(arg>=0&&process.argv[arg+1],'Required --captures');
const captures=path.resolve(process.argv[arg+1]),d=decoders(root),packets=new Map();
for(const id of ['2026-09-20T23-27-15-970Z_874aae','2026-09-22T08-30-30-051Z_ba112d']){
 const dir=path.join(captures,id),verified=readVerifiedCapturePrefix(dir);assert.ok(verified.audit.integrityPassed);
 for(const event of verified.rows){if(event.method!=='Network.webSocketFrameReceived'||event.params.response.opcode!==2)continue;
  const ref=event.params.response.payload,bytes=fs.readFileSync(path.join(dir,ref.file));if(bytes.length<4)continue;const type=bytes.readUInt16BE(2);if(![11106,11174,31301].includes(type))continue;
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),ref.sha256);packets.set(type,{bytes:bytes.subarray(4),source:{capture:id,seq:event.seq,protocol:type,sha256:ref.sha256,blob:ref.file}});
 }
}
const clean=s=>s.replace(/<[^>]*>/g,'').replace(/\|c[0-9a-fA-F]{6}\|/g,'').replace(/\|r/g,'');
const lotteryPacket=packets.get(11106);let lottery=null;
if(lotteryPacket){const r=new Reader(lotteryPacket.bytes);assert.ok(r.getByte()>=0);const description=clean(r.getString()),vipDescription=clean(r.getString());r.getByte();r.getInt();r.getInt();const moneyType=r.getByte(),price=r.getInt(),discount=Number(r.getString()),messages=Array.from({length:6},()=>clean(r.getString())),rewards=[];
 for(let n=r.getByte();n>0;n--){if(r.getBoolean()){if(r.getBoolean()){const item=new d.Item();d.Item.fromBytesAtts2(item,r);const quantity=r.getShort();rewards.push({id:item.id,name:item.name,quantity});}}else{rewards.push({currency:r.getInt(),quantity:r.getInt(),description:clean(r.getString())});}}
 const hasRoleReward=r.getByte();assert.equal(hasRoleReward,0,'Unexpected role reward tail; do not import account rewards');r.finish();
 lottery={source:lotteryPacket.source,description,vipDescription,moneyType,price,discount,messages,rewards,probabilities:null,drawPending:true};
 const probabilityPacket=packets.get(11174);if(probabilityPacket){const pr=new Reader(probabilityPacket.bytes),count=pr.getByte();lottery.probabilities=Array.from({length:count},()=>clean(pr.getString()));pr.finish();lottery.probabilitySource=probabilityPacket.source;}
}
const schemas=protobufSchemas(fs.readFileSync(path.join(root,'analysis/protobuf.decoded.js'),'utf8'));
// The native generated decoder uses a single conditional, outside the generic switch extractor.
schemas.s2c_MineMainInfo={1:{name:'info',type:'MineMainInfo',message:true}};
const minePacket=packets.get(31301);let mine=null;
if(minePacket){const info=protobuf(minePacket.bytes,'s2c_MineMainInfo',schemas).info||{};
 mine={source:minePacket.source,pointCount:info.pointInfo?.length||0,combatPending:true};
 // Public prices and daily totals only. Discard official ownership, players and remaining attempts.
 for(const key of ['fightBuyPrice','searchBuyPrice','fightSum','searchSum'])if(Object.hasOwn(info,key))mine[key]=info[key];
}
const output=path.join(root,'data/home-feature-catalogs.json');fs.writeFileSync(output,JSON.stringify({revision:'home-catalogs-20260922-v1',lottery,mine},null,2)+'\n');console.log(JSON.stringify({lottery,mine},null,2));
