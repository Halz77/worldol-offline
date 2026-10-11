import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Writer,Reader} from '../lib/codec.mjs';
import {handleRecorded} from '../lib/recorded-service.mjs';
import {nativeResourceManifest} from '../lib/native-ui-restoration.mjs';

test('all native social tabs receive complete empty-list replies without changing the save',()=>{
 const role={id:1001},before=JSON.stringify(role),replies=[];
 const env={send:(type,w)=>replies.push({type,body:w.done()}),store:{save(){assert.fail('read-only relation list saved data');}},log(){}};
 for(const kind of [0,1,2,3,4,7,9]){
  assert.ok(handleRecorded(13529,new Reader(new Writer().byte(kind).byte(20).short(0).done()),{role},env));
  const reply=replies.pop();assert.equal(reply.type,13529);assert.deepEqual(reply.body,new Writer().short(0).done());
 }
 assert.ok(handleRecorded(11163,new Reader(Buffer.alloc(0)),{role},env));
 assert.deepEqual(replies.pop().body,new Writer().int(0).byte(0).done());assert.equal(JSON.stringify(role),before);
});

test('missing map slices use verified original atlas frames and leave the archived manifest intact',()=>{
 const root=fileURLToPath(new URL('..',import.meta.url)),raw=path.join(root,'client'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const original=fs.readFileSync(path.join(raw,'v/gd/305.json')),audit=JSON.parse(fs.readFileSync(path.join(root,'data/native-map-slices.json'))),manifest=nativeResourceManifest(root,raw);
 assert.equal(hash(original),audit.officialManifestSHA256);
 for(const id of ['1147','1151','1154','1153'])assert.ok(audit.restored.some(x=>x.logical==='assets/map_slice/'+id+'.png'));
 for(const entry of audit.restored){
  assert.equal(hash(fs.readFileSync(path.join(root,entry.source))),entry.sourceSHA256);
  assert.equal(hash(fs.readFileSync(path.join(root,entry.path))),entry.sha256);
  assert.equal(manifest.url.assets.map_slice[path.basename(entry.logical)],entry.md5);
  assert.ok(entry.matchingOriginalAtlases>=1);
 }
 assert.deepEqual(fs.readFileSync(path.join(raw,'v/gd/305.json')),original);
});
