import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Reader} from './capture-decoders.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const captures=path.resolve(root,'../正式服录制数据'),sets=new Map(),errors=[];
let packets=0;
for(const capture of fs.readdirSync(captures).sort()){
 const directory=path.join(captures,capture),events=path.join(directory,'events');if(!fs.existsSync(events))continue;
 for(const file of fs.readdirSync(events).filter(f=>/^\d+\.ndjson$/.test(f)).sort())for(const line of fs.readFileSync(path.join(events,file),'utf8').split('\n')){
   if(!line||!line.includes('Network.webSocketFrameReceived'))continue;
   const row=JSON.parse(line),ref=row.params?.response?.payload;if(!ref?.file||row.params.response.opcode!==2)continue;
   const blob=path.join(directory,ref.file),b=fs.readFileSync(blob);if(b.length<4||b.readUInt16BE(2)!==11501)continue;
   try{
     if(b.readUInt16BE(0)!==b.length||crypto.createHash('sha256').update(b).digest('hex')!==ref.sha256)throw Error('Capture checksum mismatch');
     const r=new Reader(b.subarray(4)),count=r.getByte(),decoded=[];if(count<0)throw Error('Invalid set count');
     for(let i=0;i<count;i++){
       const id=r.getByte()&255,n=r.getByte(),bonuses=[];if(!id||n<0)throw Error('Invalid set ID or bonus count');
       for(let j=0;j<n;j++){const pieces=r.getByte(),power=r.getShort(),value=r.getShort(),vipLevel=r.getByte();r.getByte();bonuses.push({pieces,power,value,vipLevel});}
       decoded.push({id,bonuses});
     }r.finish();packets++;
     for(const set of decoded){const old=sets.get(set.id);if(old&&JSON.stringify(old.bonuses)!==JSON.stringify(set.bonuses))throw Error('Conflicting set '+set.id);
       if(!old)sets.set(set.id,{...set,sources:[]});sets.get(set.id).sources.push({capture,seq:row.seq,sha256:ref.sha256,blob:ref.file});
     }
   }catch(error){errors.push({capture,seq:row.seq,error:error.message});}
 }
}
if(errors.length)throw Error(JSON.stringify(errors));
const output={schema:1,clientVersion:305,generatedAt:new Date().toISOString(),responsePackets:packets,sets:[...sets.values()].sort((a,b)=>a.id-b.id)};
fs.writeFileSync(path.join(root,'data/equipment-sets.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({packets,sets:sets.size,bonuses:output.sets.reduce((n,s)=>n+s.bonuses.length,0),vipLevels:[...new Set(output.sets.flatMap(s=>s.bonuses.map(b=>b.vipLevel)))].sort((a,b)=>a-b)}));
