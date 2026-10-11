import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Read an immutable prefix without stopping or modifying the recorder. A live
// prefix is explicitly not a completed capture, even when all its blobs verify.
export function readVerifiedCapturePrefix(folder){
  const rows=[],files=fs.readdirSync(path.join(folder,'events')).filter(n=>/^\d+\.ndjson$/.test(n)).sort();
  let truncatedTail=false;
  for(const name of files){
    const value=fs.readFileSync(path.join(folder,'events',name),'utf8');
    const end=value.lastIndexOf('\n');
    for(const line of value.slice(0,end+1).split('\n').filter(Boolean)){
      const row=JSON.parse(line);
      if(row.seq!==rows.length+1)throw Error('Capture prefix sequence gap: '+row.seq);
      rows.push(row);
    }
    if(end!==value.length-1){truncatedTail=true;break;}
  }
  const refs=new Map();
  for(const row of rows)for(const ref of [row.params?.body,row.params?.response?.payload,row.params?.screenshot])if(ref?.file)refs.set(ref.file,ref);
  let verifiedBytes=0;
  for(const ref of refs.values()){
    if(!/^(blobs\/[a-f0-9]{2}\/[a-f0-9]{64}\.bin|details\/screenshots\/\d+-[a-f0-9]{6}\.png)$/.test(ref.file))throw Error('Invalid capture reference path');
    const bytes=fs.readFileSync(path.join(folder,ref.file));
    if(bytes.length!==ref.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==ref.sha256)throw Error('Capture blob verification failed: '+ref.file);
    verifiedBytes+=bytes.length;
  }
  return {rows,audit:{schema:'worldol.capture.prefix-audit.v1',snapshot:true,checkedAt:new Date().toISOString(),cutoffSeq:rows.at(-1)?.seq||0,cutoffAt:rows.at(-1)?.receivedAt,events:rows.length,wsSent:rows.filter(r=>r.method==='Network.webSocketFrameSent').length,wsReceived:rows.filter(r=>r.method==='Network.webSocketFrameReceived').length,cleanEnd:rows.some(r=>r.method==='recorder.sessionEnded'),integrityPassed:true,errors:[],truncatedTail,uniqueBlobs:refs.size,verifiedBytes,captureGaps:rows.filter(r=>r.method==='recorder.gap').map(r=>({seq:r.seq,reason:r.params.reason})),networkFailures:rows.filter(r=>['Network.loadingFailed','Network.webSocketFrameError'].includes(r.method)).map(r=>({seq:r.seq,error:r.params.errorText||r.params.errorMessage}))}};
}
