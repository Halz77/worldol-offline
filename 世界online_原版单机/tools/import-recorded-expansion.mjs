import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Reader,decoders} from './capture-decoders.mjs';
import {readVerifiedCapturePrefix} from './capture-prefix.mjs';
import {applyBossChallenges} from '../lib/boss-challenges.mjs';
import {applyYunruoTemple} from '../lib/yunruo-temple.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
// Compare every import to the same pre-expansion baseline, including the
// separately verified Yunruo bundle. A rerun must not erase addition counts.
const official=JSON.parse(fs.readFileSync(path.join(root,'data/official-v305.json'),'utf8'));
applyBossChallenges(official);applyYunruoTemple(official);
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0&&process.argv[i+1],'Required '+name);return path.resolve(process.argv[i+1]);};
const analysis=arg('--analysis'),captureRoot=arg('--captures'),d=decoders(root);
const digest=(b,kind='sha256')=>crypto.createHash(kind).update(b).digest('hex');
const read=(folder,name)=>JSON.parse(fs.readFileSync(path.join(folder,name+'.json'),'utf8'));
const keyOf={items:r=>r.id,missions:r=>r.id,monsters:r=>r.id,ai:r=>r.id,skills:r=>r.id+':'+r.level,groups:r=>r.groupId,npcs:r=>r.mapId+':'+r.id,areas:r=>r.id,mapList:r=>r.id};
const tables=Object.fromEntries(Object.keys(keyOf).map(k=>[k,new Map()]));
const mergeSources=(a=[],b=[])=>[...new Map([...a,...b].map(s=>[[s.capture,s.seq,s.origin,s.mapId,s.npcId,s.sha256].join(':'),s])).values()];
const captures=[],scenes=new Map(),sceneSpawns=new Map(),resources=[],events={questEvents:[],battleEvents:[]},conflicts=[],variants=[];
function canonicalItem(row){
  const r=new Reader(Buffer.from(row.wireBase64,'base64')),type=r.getByte();
  if(r.getBoolean()){r.getBoolean();for(let n=r.getByte();n>0;n--)r.take(9);const illusion=r.getInt();r.getLong();if(illusion)d.Item.fromBytesAtts2(new d.Item(),r);}
  const bytes=Buffer.concat([Buffer.from([type,0]),r.b.subarray(r.pos)]),check=new Reader(bytes),item=new d.Item();
  d.Item.fromBytesAtts2(item,check);check.finish();assert.equal(item.id,row.id);assert.equal(item.name,row.name);
  return {...JSON.parse(JSON.stringify(item)),definitionBase64:bytes.toString('base64'),sources:row.sources};
}
for(const captureId of fs.readdirSync(analysis).filter(n=>/^2026-09-22T/.test(n)).sort()){
  const folder=path.join(analysis,captureId),capture=path.join(captureRoot,captureId),audit=read(folder,'source-audit');
  assert.equal(audit.integrityPassed,true);assert.equal(read(folder,'summary').decoding.partialOrFailed.length,0);
  const verified=readVerifiedCapturePrefix(capture);assert.ok(verified.audit.cutoffSeq>=audit.cutoffSeq);
  const bySeq=new Map(verified.rows.map(e=>[e.seq,e])),checks=new Set(read(folder,'decode-checks').filter(c=>c.complete).map(c=>c.seq));
  const payloads=new Map();
  const bytesOf=source=>{
    assert.equal(source.capture,captureId);assert.ok(source.seq<=audit.cutoffSeq&&checks.has(source.seq));
    const ref=bySeq.get(source.seq)?.params?.response?.payload;assert.equal(ref?.file,source.blob);assert.equal(ref?.sha256,source.sha256);
    if(!payloads.has(source.blob)){const bytes=fs.readFileSync(path.join(capture,source.blob));assert.equal(digest(bytes),source.sha256);payloads.set(source.blob,bytes);}return payloads.get(source.blob);
  };
  const allSkills=read(folder,'skills');
  for(const table of Object.keys(tables))for(const raw of read(folder,table)){
    const {variants:other,...row}=structuredClone(raw);
    if(row.wireBase64){
      const wire=Buffer.from(row.wireBase64,'base64');row.sources=row.sources.filter(s=>bytesOf(s).includes(wire));assert.ok(row.sources.length,'no source for '+table+':'+keyOf[table](row));
      const parse={missions:r=>d.Mission.fromBytes(r),monsters:r=>d.Monster.fromBytes(r),groups:r=>d.Group.fromBytes(r),ai:r=>d.AI.fromBytes(r,allSkills),skills:r=>d.Skill.fromBytes(r),npcs:r=>d.Npc.fromBytes(r)}[table];
      if(parse){const r=new Reader(wire),actual=JSON.parse(JSON.stringify(parse(r)));r.finish();for(const [key,value] of Object.entries(actual))assert.deepEqual(row[key],value,table+':'+keyOf[table](row)+':'+key);}
    }else for(const source of row.sources)bytesOf(source);
    const value=table==='items'?canonicalItem(row):row,key=keyOf[table](value),old=tables[table].get(key);
    if(old){
      const a=old.definitionBase64||old.wireBase64,b=value.definitionBase64||value.wireBase64;
      if(a!==b)variants.push({table,key,capture:captureId,decision:'first captured definition retained',value});
      else old.sources=mergeSources(old.sources,value.sources);
    }else tables[table].set(key,value);
    for(const variant of other||[])variants.push({table,key,capture:captureId,decision:'source variant retained for inspection',value:variant});
  }
  for(const scene of read(folder,'scene-packets'))if(scene.complete&&checks.has(scene.seq)){
    if(!sceneSpawns.has(scene.mapId))sceneSpawns.set(scene.mapId,[]);
    sceneSpawns.get(scene.mapId).push({...scene,capture:captureId});
    if(scene.name||scene.cityOwnerOmitted)scenes.set(scene.mapId,{...scene,capture:captureId});
    else if(scene.npcCount>0&&!scenes.has(scene.mapId))scenes.set(scene.mapId,{...scene,capture:captureId});
  }
  for(const [table,file] of [['questEvents','quest-events'],['battleEvents','battle-events']])for(const event of read(folder,file)){
    assert.ok(checks.has(event.seq));events[table].push(event);
  }
  for(const asset of read(folder,'resources'))if(asset.status===200){
    assert.ok(asset.seq<=audit.cutoffSeq);const ref=bySeq.get(asset.seq)?.params?.body;assert.equal(ref?.sha256,asset.sha256);assert.equal(ref?.file,asset.blob);
    resources.push({...asset,capture:captureId});
  }
  captures.push({id:captureId,audit});
}
const additions={};
for(const [table,rows] of Object.entries(tables))if(table!=='npcs'){
  const existing=new Map((official[table]||[]).map(r=>[keyOf[table](r),r]));let count=0;
  for(const [key,row] of rows){const old=existing.get(key);if(!old){count++;continue;}
    const a=old.definitionBase64||old.monsterWireBase64||old.wireBase64,b=row.definitionBase64||row.wireBase64;
    if(a&&b&&a!==b)conflicts.push({table,key,decision:'existing game definition retained; captured variant archived'});
  }additions[table]=count;
}
assert.equal(conflicts.filter(c=>c.table!=='items').length,0,'unexpected non-item definition conflict');
const manifestBytes=fs.readFileSync(path.join(root,'client/v/gd/305.json')),manifest=JSON.parse(manifestBytes),flat=new Map();
for(const captured of resources.filter(r=>r.path==='/resgood/v/gd/305.json'))assert.equal(digest(manifestBytes),captured.sha256);
assert.ok(resources.some(r=>r.path==='/resgood/v/gd/305.json'));
function flatten(node,prefix=''){for(const [key,v] of Object.entries(node))if(typeof v==='string')flat.set(prefix+key,v);else flatten(v,prefix+key+'/');}flatten(manifest.url);
const assets=new Map(),copies=new Map(),config=new Map();
function asset(logical){
  if(assets.has(logical))return fs.readFileSync(assets.get(logical).source);
  const hash=flat.get(logical);assert.ok(hash,'missing manifest '+logical);
  const prefix=hash.slice(0,2),relative='assets/'+(prefix==='ad'?'dirad':prefix)+'/'+hash+path.extname(logical),target=path.join(root,'client',relative);
  const captured=resources.find(r=>r.originalPaths.includes(logical)),source=fs.existsSync(target)?target:captured?path.join(captureRoot,captured.capture,captured.blob):null;
  assert.ok(source,'missing asset '+logical);const bytes=fs.readFileSync(source);assert.ok(digest(bytes,'md5').startsWith(hash),'manifest digest '+logical);
  if(captured)assert.equal(digest(bytes),captured.sha256);assets.set(logical,{logical,path:'client/'+relative,source,sha256:digest(bytes),bytes:bytes.length});
  if(source!==target)copies.set(target,bytes);return bytes;
}
for(const logical of manifest.cfg)for(const raw of JSON.parse(asset(logical))){const entry=typeof raw==='string'?JSON.parse(raw):raw;if(entry.key)config.set(entry.key,entry.value);}
for(const captured of resources.filter(r=>r.path.startsWith('/resgood/js/')))assert.equal(digest(fs.readFileSync(path.join(root,'client',captured.path.slice('/resgood/'.length)))),captured.sha256);
const maps=[],geometryFiles=[],models=new Set(),sceneModels=new Map(),imageIds=new Set(),embeddedFrames=[],pendingStaticImages=[],pendingStaticAnimations=[];
const dailyData=JSON.parse(fs.readFileSync(path.join(root,'data/daily-activity-v1.json')));
for(const scene of scenes.values()){
  const source=config.get('assets/map/'+scene.mapId+'.json');assert.ok(source,'missing map geometry '+scene.mapId);
  const geo=typeof source==='string'?JSON.parse(source):source,bytes=Buffer.from(JSON.stringify(geo)+'\n');
  const relative='data/maps/'+scene.mapId+'.json',target=path.join(root,relative);
  if(fs.existsSync(target))assert.deepEqual(JSON.parse(fs.readFileSync(target)),geo);else geometryFiles.push({relative,bytes});
  const npcs=[...tables.npcs.values()].filter(n=>n.mapId===scene.mapId),cols=geo.mW/geo.tW,rows=geo.mH/geo.tH;
  assert.equal(geo.blocks.length,cols*rows);
  const validSpawn=([x,y])=>Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&x<cols&&y>=0&&y<rows&&!(geo.blocks[y*cols+x]&1);
  let spawn=[scene.x,scene.y],spawnSource={capture:scene.capture,seq:scene.seq};
  if(!validSpawn(spawn)){
    // A login/portal response may place the official actor inside a blocked
    // tile. Keep the original geometry and reuse only a verified prior entry.
    const existing=official.maps.find(m=>m.id===scene.mapId);
    const prior=sceneSpawns.get(scene.mapId).find(s=>validSpawn([s.x,s.y]));
    if(existing?.spawn&&validSpawn(existing.spawn)){spawn=[...existing.spawn];spawnSource={baselineMapId:scene.mapId};}
    else if(prior){spawn=[prior.x,prior.y];spawnSource={capture:prior.capture,seq:prior.seq};}
    else assert.fail('no recorded walkable spawn '+scene.mapId);
  }
  for(const n of npcs){assert.ok(n.x>=0&&n.x<cols&&n.y>=0&&n.y<rows);if(BigInt(n.icon1)>0)models.add(String(n.icon1));}
  const atlasValue=config.get('assets/map_merged/'+scene.mapId+'.json');assert.ok(atlasValue,'missing atlas '+scene.mapId);
  const atlas=typeof atlasValue==='string'?JSON.parse(atlasValue):atlasValue,png=asset('assets/map_merged/'+scene.mapId+'.png');
  for(const frame of Object.values(atlas.frames))assert.ok(frame.x>=0&&frame.y>=0&&frame.x+frame.w<=png.readUInt32BE(16)&&frame.y+frame.h<=png.readUInt32BE(20));
  const tiles=geo.tiles.flatMap(t=>Array(t[2]*t[3]).fill(String(t[0]))),images=new Set();
  for(const layer of geo.layers){for(const index of layer.data||[])if(index>=0){assert.ok(index<tiles.length);images.add(tiles[index]);}for(const obj of layer.obj||[])if(obj[0]===2)images.add(String(obj[1]));else if(obj[0]===4){const id=String(obj[5]);if(!sceneModels.has(id))sceneModels.set(id,[]);sceneModels.get(id).push(scene.mapId);}}
  for(const id of images)if(!atlas.frames[id]){
    if(flat.has('assets/map_slice/'+id+'.png'))imageIds.add(id);
    else pendingStaticImages.push({mapId:scene.mapId,logical:'assets/map_slice/'+id+'.png',reason:'absent-from-official-atlas-and-manifest',existingMap:official.maps.some(m=>m.id===scene.mapId)});
  }
  const translated=dailyData.tasks.find(t=>t.mapId===scene.mapId&&t.type===3)?.name;
  const portalNames=[...new Set([...tables.npcs.values()].filter(n=>n.jumpMapID?.includes(scene.mapId)&&n.name).map(n=>n.name))];
  const inferredName=portalNames.length===1?portalNames[0]:translated||'场景 '+scene.mapId;
  const name=scene.name?.startsWith('_0#map_')?(translated||inferredName):scene.name||(scene.cityOwnerOmitted?'个人城市':inferredName);
  maps.push({id:scene.mapId,name,recordedName:scene.name,nameSource:scene.name?'scene':scene.cityOwnerOmitted?'city-template':portalNames.length===1?'recorded-entrance-name':'daily-title-or-map-id',spawn,spawnSource,recordedSpawn:[scene.x,scene.y],npcs,sourceCapture:scene.capture,sourceSeq:scene.seq,...(scene.cityOwnerOmitted?{cityTemplate:true}:{}),geometrySHA256:digest(bytes)});
}
for(const id of imageIds)asset('assets/map_slice/'+id+'.png');
for(const m of tables.monsters.values())models.add(String(m.icon1));
for(const s of tables.skills.values())for(const id of [s.anime2,s.anime3])if(id>0)models.add(String(id));
for(const [id,mapIds] of sceneModels){
  const logical='assets/sprite/model/'+id+'.json';
  if(flat.has(logical))models.add(id);
  else pendingStaticAnimations.push({mapIds:[...new Set(mapIds)],logical,reason:'decorative-animation-absent-from-official-manifest'});
}
const fragments=new Set(),rawIds=new Set(JSON.parse(fs.readFileSync(path.join(root,'analysis/modules/0366.js'),'utf8').match(/var d=(\[[0-9,]+\])/)[1]));
const isRaw=id=>{const f=Math.floor(id/1000);return [0,6,7,10].includes(f)||(f===8&&(id<=8500||id>=8830))||(f===9&&id<9080)||rawIds.has(id);};
for(const id of models){const model=JSON.parse(asset('assets/sprite/model/'+id+'.json'));assert.ok(model.anis.length);for(const file of model.files)fragments.add(file);for(const frame of Object.values(model.frames))for(const part of frame)assert.ok(part[0]>=0&&part[0]<model.files.length);}
for(const id of fragments){const logical='assets/sprite/fragment/'+id+'.json';if(!isRaw(id)){if(config.has(logical))embeddedFrames.push(logical);else asset(logical);}asset('assets/sprite/fragment/'+id+'.png');}
const bundle={schema:1,revision:'recorded-expansion-20260922-v1',captures,maps,...Object.fromEntries(Object.entries(tables).filter(([t])=>t!=='npcs').map(([t,v])=>[t,[...v.values()]])),...events};
const newMaps=maps.filter(m=>!official.maps.some(o=>o.id===m.id));
const report={revision:bundle.revision,captures:captures.map(c=>({id:c.id,cutoffAt:c.audit.cutoffAt,cleanEnd:c.audit.cleanEnd,gaps:c.audit.captureGaps.length,networkFailures:c.audit.networkFailures})),
  additions:{...additions,maps:newMaps.length,npcs:maps.reduce((sum,m)=>sum+m.npcs.filter(n=>!official.maps.find(o=>o.id===m.id)?.npcs.some(o=>o.id===n.id)).length,0)},
  newMaps:newMaps.map(m=>({id:m.id,name:m.name,npcs:m.npcs.length})),counts:{maps:maps.length,missions:bundle.missions.length,monsters:bundle.monsters.length,groups:bundle.groups.length,skills:bundle.skills.length,ai:bundle.ai.length,models:models.size,fragments:fragments.size},
  conflicts,variantCount:variants.length,pendingStaticImages,pendingStaticAnimations,assets:{verified:assets.size,added:copies.size,embeddedFrames,files:[...assets.values()].map(({source,...a})=>a)}};
if(process.argv.includes('--apply')){
  const write=(relative,bytes)=>{
    const target=path.join(root,relative);
    if(fs.existsSync(target)){
      const before=fs.readFileSync(target);if(digest(before)===digest(bytes))return;
      const option=process.argv.indexOf('--expected-bundle-sha');
      assert.ok(relative==='data/recorded-expansion-20260922.json'&&option>=0,'file differs '+relative);
      assert.equal(digest(before),process.argv[option+1],'previous bundle changed');
      const backup=path.join(root,'backups','recorded-expansion-'+Date.now());fs.mkdirSync(backup,{recursive:true});
      fs.writeFileSync(path.join(backup,path.basename(target)),before,{flag:'wx'});
      fs.writeFileSync(target+'.next',bytes,{flag:'wx'});fs.renameSync(target+'.next',target);return;
    }
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});
  };
  for(const [target,bytes] of copies)write(path.relative(root,target),bytes);
  for(const file of geometryFiles)write(file.relative,file.bytes);
  write('data/recorded-expansion-20260922.json',Buffer.from(JSON.stringify(bundle,null,2)+'\n'));
  fs.writeFileSync(path.join(root,'analysis/recorded-expansion-import.json'),JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(path.join(root,'analysis/recorded-expansion-variants.json'),JSON.stringify(variants,null,2)+'\n');
}
console.log(JSON.stringify({...report,assets:{verified:assets.size,added:copies.size},applied:process.argv.includes('--apply')},null,2));
