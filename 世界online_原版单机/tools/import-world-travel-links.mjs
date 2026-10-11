import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {readVerifiedCapturePrefix} from './capture-prefix.mjs';
const [captureArg,analysisArg]=process.argv.slice(2),capture=path.resolve(captureArg),analysis=path.resolve(analysisArg);
const read=name=>JSON.parse(fs.readFileSync(path.join(analysis,name+'.json')));
const audit=read('source-audit'),verified=readVerifiedCapturePrefix(capture);
assert.equal(audit.integrityPassed,true);assert.ok(verified.audit.cutoffSeq>=audit.cutoffSeq);
const scenes=new Map(read('scene-packets').filter(s=>s.complete).map(s=>[s.seq,s]));
const pending=new Map(),links=new Map();
for(const e of verified.rows){
 if(e.seq>audit.cutoffSeq||!/^Network.webSocketFrame(Sent|Received)$/.test(e.method)||e.params.response.opcode!==2)continue;
 const ref=e.params.response.payload,b=fs.readFileSync(path.join(capture,ref.file));if(b.length<4||b.readUInt16BE(2)!==10523)continue;
 const key=e.params.requestId;
 if(e.method.endsWith('Sent')){assert.equal(b.length,12);pending.set(key,{directoryId:b.readInt32BE(4),seq:e.seq,sha256:ref.sha256});continue;}
 const scene=scenes.get(e.seq),request=pending.get(key);if(!scene||!request)continue;
 const old=links.get(request.directoryId);if(old)assert.equal(old.mapId,scene.mapId);
 links.set(request.directoryId,{directoryId:request.directoryId,mapId:scene.mapId,name:scene.name,requestSeq:request.seq,requestSHA256:request.sha256,responseSeq:e.seq,responseSHA256:ref.sha256});pending.delete(key);
}
assert.ok(links.size);
const result={revision:'recorded-world-travel-links-20260922-v1',capture:path.basename(capture),audit,links:[...links.values()]};
fs.writeFileSync(new URL('../data/world-travel-links.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({capture:result.capture,links:result.links},null,2));
