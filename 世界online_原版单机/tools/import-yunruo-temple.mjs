import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Reader,decoders} from './capture-decoders.mjs';
import {readVerifiedCapturePrefix} from './capture-prefix.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0&&process.argv[i+1],'Required '+name);return path.resolve(process.argv[i+1]);};
const capture=arg('--capture'),analysis=arg('--analysis');
const read=name=>JSON.parse(fs.readFileSync(path.join(analysis,name+'.json'),'utf8'));
const digest=(bytes,algorithm='sha256')=>crypto.createHash(algorithm).update(bytes).digest('hex');
const bare=row=>{const {variants,...rest}=row;return structuredClone(rest);};
const verified=readVerifiedCapturePrefix(capture),audit=read('source-audit');
assert.equal(audit.integrityPassed,true);assert.ok(verified.audit.cutoffSeq>=audit.cutoffSeq);
const events=new Map(verified.rows.map(e=>[e.seq,e])),d=decoders(root);
const validate=(row,parse)=>{
  assert.ok(row.sources.length);
  for(const source of row.sources){
    assert.equal(source.capture,path.basename(capture));assert.ok(source.seq<=audit.cutoffSeq);
    const event=events.get(source.seq),ref=event?.params?.response?.payload;
    assert.ok(ref);assert.equal(ref.file,source.blob);assert.equal(ref.sha256,source.sha256);
    const bytes=fs.readFileSync(path.join(capture,source.blob));assert.equal(digest(bytes),source.sha256);
    assert.ok(bytes.includes(Buffer.from(row.wireBase64,'base64')),'definition missing from source packet');
  }
  const r=new Reader(Buffer.from(row.wireBase64,'base64')),actual=JSON.parse(JSON.stringify(parse(r)));r.finish();
  const {sources,variants,mapId,...expected}=row;
  // Only NPC map metadata is outside its wire record.
  const normalized=Object.hasOwn(row,'npcType')?expected:{...expected,...(mapId!==undefined?{mapId}:{})};
  assert.deepEqual(actual,normalized);
};

const scene=read('scene-packets').find(s=>s.mapId===411&&s.complete&&s.name);
assert.ok(scene);assert.ok(scene.seq<=audit.cutoffSeq);
const npcs=read('npcs').filter(n=>n.mapId===411).map(bare);
assert.equal(npcs.length,36);assert.equal(new Set(npcs.map(n=>n.id)).size,36);
const missions=read('missions').filter(q=>q.sources.some(s=>s.mapId===411)).map(bare);
assert.equal(missions.length,22);
const groupIds=new Set(npcs.flatMap(n=>n.battleID||[]).filter(id=>id>0));
for(const q of missions)for(const id of [q.acceptBattleID,q.submitBattleID])if(id>0)groupIds.add(id);
const groups=read('groups').filter(g=>groupIds.has(g.groupId)).map(bare);assert.equal(groups.length,9);
assert.equal(groups.length,groupIds.size);assert.ok(groups.every(g=>!g.nextBattleGroupID));
const monsterIds=new Set(groups.flatMap(g=>[...g.monsters,...g.npcs]).filter(id=>id>0));
const monsters=read('monsters').filter(m=>monsterIds.has(m.id)).map(bare);
const ai=read('ai').filter(a=>monsterIds.has(a.id)).map(bare);
assert.equal(monsters.length,9);assert.equal(monsters.length,monsterIds.size);assert.equal(ai.length,monsters.length);
const refs=new Set(ai.flatMap(a=>[...a.skill1,...a.skill2]).filter(s=>s.id>0).map(s=>s.id+':'+s.level));
const skills=read('skills').filter(s=>refs.has(s.id+':'+s.level)).map(bare);assert.equal(skills.length,17);assert.equal(skills.length,refs.size);
for(const [rows,parse] of [[npcs,r=>d.Npc.fromBytes(r)],[missions,r=>d.Mission.fromBytes(r)],[groups,r=>d.Group.fromBytes(r)],
  [monsters,r=>d.Monster.fromBytes(r)],[skills,r=>d.Skill.fromBytes(r)],[ai,r=>d.AI.fromBytes(r,skills)]])for(const row of rows)validate(row,parse);
const chain=[],byId=new Map(missions.map(q=>[q.id,q]));let id=3900;
while(id){assert.ok(byId.has(id));assert.ok(!chain.includes(id));chain.push(id);id=byId.get(id).submitNextMissionID;}
assert.equal(chain.length,22);assert.equal(chain.at(-1),3922);
for(const q of missions){
  assert.equal(q.mapId,411);assert.ok(npcs.some(n=>n.id===q.npcId));
  for(const c of [...q.acceptCondition,...q.submitCondition]){
    if([9,10].includes(c.type))assert.ok(byId.has(c.missionId));
    if(c.type===2)assert.ok(monsterIds.has(c.monsterId));
  }
}

const resources=read('resources'),manifestResource=resources.find(r=>r.path==='/resgood/v/gd/305.json'&&r.status===200);
assert.ok(manifestResource);const manifestBytes=fs.readFileSync(path.join(capture,manifestResource.blob));
assert.equal(digest(manifestBytes),manifestResource.sha256);
assert.equal(digest(fs.readFileSync(path.join(root,'client/v/gd/305.json'))),manifestResource.sha256,'client manifest differs');
const manifest=JSON.parse(manifestBytes),flat=new Map();
function flatten(node,prefix=''){for(const [key,value] of Object.entries(node))if(typeof value==='string')flat.set(prefix+key,value);else flatten(value,prefix+key+'/');}
flatten(manifest.url);
const assets=new Map(),copies=new Map();
function asset(logical){
  if(assets.has(logical))return fs.readFileSync(assets.get(logical).source);
  const hash=flat.get(logical);assert.ok(hash,'missing manifest entry: '+logical);
  const prefix=hash.slice(0,2),relative='assets/'+(prefix==='ad'?'dirad':prefix)+'/'+hash+path.extname(logical),target=path.join(root,'client',relative);
  const recorded=resources.find(r=>r.status===200&&r.originalPaths.includes(logical));
  const source=fs.existsSync(target)?target:recorded?path.join(capture,recorded.blob):null;
  assert.ok(source,'missing local asset: '+logical);
  const bytes=fs.readFileSync(source);assert.ok(digest(bytes,'md5').startsWith(hash),'manifest digest mismatch: '+logical);
  if(recorded)assert.equal(digest(bytes),recorded.sha256,'captured asset differs: '+logical);
  assets.set(logical,{logical,path:'client/'+relative,source,sha256:digest(bytes),bytes:bytes.length,capturedSeq:recorded?.seq});
  if(source!==target)copies.set(target,{bytes,sha256:digest(bytes)});
  return bytes;
}
// Config bundles embed geometry and atlases; exact bytes also establish client compatibility.
const config=new Map();
for(const logical of manifest.cfg){
  const entries=JSON.parse(asset(logical));
  for(const raw of entries){const entry=typeof raw==='string'?JSON.parse(raw):raw;if(entry.key)config.set(entry.key,entry.value);}
}
for(const js of manifest.js){const captured=resources.find(r=>r.path==='/resgood/'+js&&r.status===200);assert.ok(captured);assert.equal(digest(fs.readFileSync(path.join(root,'client',js))),captured.sha256);}
const geometry=config.get('assets/map/411.json'),atlas=config.get('assets/map_merged/411.json');assert.ok(geometry&&atlas);
const geo=typeof geometry==='string'?JSON.parse(geometry):geometry,merged=typeof atlas==='string'?JSON.parse(atlas):atlas;
const cols=geo.mW/geo.tW,rows=geo.mH/geo.tH;assert.equal(geo.blocks.length,cols*rows);assert.equal(geo.blocks[scene.y*cols+scene.x]&1,0);
for(const n of npcs)assert.ok(n.x>=0&&n.x<cols&&n.y>=0&&n.y<rows);
const png=asset('assets/map_merged/411.png'),width=png.readUInt32BE(16),height=png.readUInt32BE(20);
for(const f of Object.values(merged.frames))assert.ok(f.x>=0&&f.y>=0&&f.x+f.w<=width&&f.y+f.h<=height);
const tiles=geo.tiles.flatMap(t=>Array(t[2]*t[3]).fill(String(t[0]))),images=new Set(),models=new Set(['4005',...npcs.map(n=>String(n.icon1)),...monsters.map(m=>String(m.icon1))]);
for(const layer of geo.layers){
  for(const index of layer.data||[])if(index>=0){assert.ok(index<tiles.length);images.add(tiles[index]);}
  for(const obj of layer.obj||[])if(obj[0]===2)images.add(String(obj[1]));else if(obj[0]===4)models.add(String(obj[5]));
}
for(const image of images)if(!merged.frames[image])asset('assets/map_slice/'+image+'.png');
for(const s of skills)for(const id of [s.anime2,s.anime3])if(id>0)models.add(String(id));
const fragments=new Set();
for(const modelId of models){
  const model=JSON.parse(asset('assets/sprite/model/'+modelId+'.json'));assert.ok(model.anis.length);
  for(const file of model.files)fragments.add(file);
  for(const frame of Object.values(model.frames))for(const part of frame)assert.ok(part[0]>=0&&part[0]<model.files.length);
}
// Native FrameBmp (module 366) explicitly treats these fragment families as a
// single PNG. They never request an atlas JSON; absence is not missing data.
const frameSource=fs.readFileSync(path.join(root,'analysis/modules/0366.js'),'utf8');
const rawFragmentIds=new Set(JSON.parse(frameSource.match(/var d=(\[[0-9,]+\])/)[1]));
const isRawFragment=id=>{const family=Math.floor(id/1000);return [0,6,7,10].includes(family)||(family===8&&(id<=8500||id>=8830))||(family===9&&id<9080)||rawFragmentIds.has(id);};
const embeddedFragments=[],rawFragments=[];
for(const fragment of fragments){
  const logical='assets/sprite/fragment/'+fragment+'.json';
  if(isRawFragment(fragment))rawFragments.push(fragment);
  else if(config.has(logical))embeddedFragments.push(logical);else asset(logical);
  asset('assets/sprite/fragment/'+fragment+'.png');
}
const geometryBytes=Buffer.from(JSON.stringify(geo)+'\n');
const bundle={schema:1,revision:'yunruo-temple-v1',capture:{id:path.basename(capture),audit},
  map:{id:411,name:'云若寺',recordedName:scene.name,spawn:[scene.x,scene.y],npcs,sourceSeq:scene.seq,sourceCapture:path.basename(capture)},
  geometry:{file:'data/maps/411.json',sha256:digest(geometryBytes)},chain,missions,groups,monsters,skills,ai,
  pendingItems:[{id:5301,name:'试炼的邀请',role:'entry-condition',policy:'Use existing offline policy: unknown item requirements do not block entry.'},
    {id:100669,name:'长老的谢礼',role:'reward',policy:'Record owed reward on completion; item definition and box contents remain pending.'}]};
const report={revision:bundle.revision,capture:bundle.capture,counts:{missions:missions.length,npcs:npcs.length,encounters:npcs.filter(n=>n.npcType===1).length,
  groups:groups.length,monsters:monsters.length,ai:ai.length,skills:skills.length,models:models.size,fragments:fragments.size},
  geometry:bundle.geometry,embeddedFragments,rawFragments,assets:{verified:assets.size,added:copies.size,bytes:[...assets.values()].reduce((sum,a)=>sum+a.bytes,0),
    files:[...assets.values()].map(({source,...row})=>row)},pendingItems:bundle.pendingItems};
if(process.argv.includes('--apply')){
  const write=(relative,bytes)=>{const target=path.join(root,relative);if(fs.existsSync(target)){assert.equal(digest(fs.readFileSync(target)),digest(bytes),'existing file differs: '+relative);return;}
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes,{flag:'wx'});};
  for(const [target,copy] of copies)write(path.relative(root,target),copy.bytes);
  write(bundle.geometry.file,geometryBytes);write('data/yunruo-temple-v1.json',Buffer.from(JSON.stringify(bundle,null,2)+'\n'));
  fs.writeFileSync(path.join(root,'analysis/yunruo-temple-import.json'),JSON.stringify(report,null,2)+'\n');
}
console.log(JSON.stringify({revision:report.revision,counts:report.counts,assets:{verified:assets.size,added:copies.size},pendingItems:report.pendingItems,applied:process.argv.includes('--apply')},null,2));
