import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Reader} from './capture-decoders.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),analysis=JSON.parse(fs.readFileSync(path.join(root,'analysis/recordings-latest.json'),'utf8')).output;
const reports=JSON.parse(fs.readFileSync(path.join(analysis,'captures.json'),'utf8')),samples=[];
for(const report of reports.filter(x=>x.public&&x.integrityPassed&&x.cleanEnd)){
 const protocols=JSON.parse(fs.readFileSync(path.join(analysis,report.id,'public/protocols.json'),'utf8'));
 if(!protocols.some(p=>p.id===14551&&p.received))continue;
 const folder=path.resolve(root,'../正式服录制数据',report.id);
 for(const name of fs.readdirSync(path.join(folder,'events')).filter(n=>/^\d+\.ndjson$/.test(n)).sort())for(const line of fs.readFileSync(path.join(folder,'events',name),'utf8').split('\n'))if(line){
  const e=JSON.parse(line);if(e.method!=='Network.webSocketFrameReceived'||e.params.response.opcode!==2)continue;
  const ref=e.params.response.payload,b=fs.readFileSync(path.join(folder,ref.file));if(b.length<5||b.readUInt16BE(2)!==14551)continue;
  const r=new Reader(b.subarray(4));if(!r.getBoolean()){r.finish();continue;}
  r.getShort();r.getShort();const thresholds=[],conditions=[];
  for(let n=r.getShort();n>0;n--){thresholds.push(r.getShort());r.getByte();}
  for(let n=r.getShort();n>0;n--){const row={id:r.getByte(),content:r.getString()};r.getInt();row.count=r.getInt();row.value=r.getShort();row.pathFinding=r.getBoolean();if(row.pathFinding)Object.assign(row,{direction:r.getByte(),mapId:r.getShort(),npcId:r.getShort(),npcName:r.getString()});conditions.push(row);}
  r.finish();samples.push({thresholds,conditions,source:{capture:report.id,seq:e.seq,sha256:ref.sha256}});
 }
}
const file=path.join(root,'data/recorded-content.json'),data=JSON.parse(fs.readFileSync(file,'utf8'));
if(samples.length)data.vitality={...samples.at(-1),variants:samples.slice(0,-1),mode:'recorded-definitions-only'};
fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
const result={samples:samples.length,thresholds:data.vitality?.thresholds,conditions:data.vitality?.conditions.length,mode:data.vitality?.mode};
fs.writeFileSync(path.join(root,'analysis/recorded-vitality-import.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
