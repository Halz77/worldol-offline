import fs from 'node:fs';
import path from 'node:path';
const capture=process.argv[2];
const rows=fs.readdirSync(path.join(capture,'events')).filter(n=>/^\d+\.ndjson$/.test(n)).sort().flatMap(n=>fs.readFileSync(path.join(capture,'events',n),'utf8').trim().split('\n').map(JSON.parse));
let pending;
for(const row of rows){if(!/^Network.webSocketFrame(Sent|Received)$/.test(row.method))continue;const b=fs.readFileSync(path.join(capture,row.params.response.payload.file)),type=b.readUInt16BE(2);if(type!==12001&&type!==17602)continue;const sent=row.method.endsWith('Sent');
 if(type===12001&&sent)pending={seq:row.seq,wait:b.readInt8(4),action:b.readInt8(5),slot:b.readInt16BE(6),quantity:b.readInt32BE(8),dest:b[12]};
 if(!sent)console.log(JSON.stringify({seq:row.seq,type,bytes:b.length-4,wait:b[4],request:type===12001?pending:undefined,prefix:b.subarray(4,Math.min(9,b.length)).toString('hex')}));
}
