import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Reader,decoders} from './capture-decoders.mjs';
import {readVerifiedCapturePrefix} from './capture-prefix.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const arg=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error('Required: '+name);return path.resolve(process.argv[i+1]);};
const folders=[arg('--batianhu'),arg('--dongge')],captureRoot=arg('--captures'),geometryFile=arg('--geometry');
const read=(folder,name)=>JSON.parse(fs.readFileSync(path.join(folder,name+'.json'),'utf8'));
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const d=decoders(root),captures=[],copies=new Map(),conflicts=[];
const collections={monsters:new Map(),skills:new Map(),groups:new Map(),ai:new Map(),missions:new Map()};
const bare=row=>{const {variants,...rest}=row;return structuredClone(rest);};
for(const [index,folder] of folders.entries()){
 const questId=index===0?1317:3459,groupId=index===0?11778:11740;
 const quest=read(folder,'missions').find(q=>q.id===questId),group=read(folder,'groups').find(g=>g.groupId===groupId);
 assert.ok(quest&&group);assert.equal(quest.acceptBattleID,groupId);
 const captureId=quest.sources[0].capture,capture=path.join(captureRoot,captureId);
 const verified=readVerifiedCapturePrefix(capture);assert.equal(verified.audit.integrityPassed,true);
 const evidence=new Map(verified.rows.map(e=>[e.seq,e]));
 const validate=row=>{for(const s of row.sources){
  const event=evidence.get(s.seq);assert.ok(event,'missing source event');
  const bytes=fs.readFileSync(path.join(capture,s.blob));assert.equal(digest(bytes),s.sha256);
  assert.equal(event.params.response.payload.sha256,s.sha256);
  assert.ok(bytes.includes(Buffer.from(row.wireBase64,'base64')),'definition absent from attributed packet');
 }};
 const ids=new Set(group.monsters.filter(id=>id>0));
 const monsters=read(folder,'monsters').filter(m=>ids.has(m.id)),ai=read(folder,'ai').filter(a=>ids.has(a.id));
 assert.equal(monsters.length,ids.size);
 const refs=new Set(ai.flatMap(a=>[...a.skill1,...a.skill2]).filter(s=>s.id>0).map(s=>`${s.id}:${s.level}`));
 const skills=read(folder,'skills').filter(s=>refs.has(`${s.id}:${s.level}`));assert.equal(skills.length,refs.size);
 for(const [table,rows,parse] of [
  ['monsters',monsters,r=>d.Monster.fromBytes(r)],['skills',skills,r=>d.Skill.fromBytes(r)],
  ['groups',[group],r=>d.Group.fromBytes(r)],['ai',ai,r=>d.AI.fromBytes(r,skills)],['missions',[quest],r=>d.Mission.fromBytes(r)]
 ])for(const row of rows){
  validate(row);const r=new Reader(Buffer.from(row.wireBase64,'base64')),actual=JSON.parse(JSON.stringify(parse(r)));r.finish();
  const {sources,variants,...expected}=row;assert.deepEqual(actual,expected);
  const key=table==='skills'?`${row.id}:${row.level}`:table==='groups'?row.groupId:row.id,old=collections[table].get(key);
  if(old){assert.equal(old.wireBase64,row.wireBase64,'conflicting captured '+table+' '+key);old.sources.push(...row.sources);}
  else collections[table].set(key,bare(row));
 }
 // Import public static files only, after checking every already-present file.
 // The recorded authentication/session payloads never enter the game project.
 let clientMatches=0;
 for(const asset of read(folder,'resources')){
  if(asset.status!==200)continue; // 206 audio bodies may be partial ranges.
  const relative=asset.path.replace(/^\/resgood\//,'');
  if(relative===asset.path||(!asset.originalPaths.length&&!/^(js|v)\//.test(relative)))continue;
  const target=path.resolve(root,'client',relative);assert.ok(target.startsWith(path.resolve(root,'client')+path.sep));
  if(fs.existsSync(target)){
   if(digest(fs.readFileSync(target))!==asset.sha256)conflicts.push({path:relative,capture:captureId});
   else if(relative.startsWith('js/'))clientMatches++;
  }else{
   const previous=copies.get(target);if(previous)assert.equal(previous.sha256,asset.sha256);
   copies.set(target,{target,source:path.join(capture,asset.blob),sha256:asset.sha256,bytes:asset.bytes,originalPaths:asset.originalPaths});
  }
 }
 assert.ok(clientMatches>0,'no matching native client code');
 captures.push({id:captureId,audit:verified.audit,clientCodeMatches:clientMatches});
}
assert.deepEqual(conflicts,[],'existing static resource mismatch');
const scene=read(folders[0],'scene-packets').find(s=>s.mapId===945&&s.complete&&s.name);
assert.ok(scene);const npcs=read(folders[0],'npcs').filter(n=>n.mapId===945).map(bare);
const dongNpc=read(folders[1],'npcs').find(n=>n.mapId===979&&n.id===18);assert.ok(dongNpc);
const geometry=fs.readFileSync(geometryFile),geo=JSON.parse(geometry),cols=geo.mW/geo.tW;
for(const [x,y] of [[scene.x,scene.y],[20,11],[25,12]])assert.equal(geo.blocks[y*cols+x]&1,0);
const geometryTarget=path.join(root,'data/maps/945.json');
if(fs.existsSync(geometryTarget))assert.equal(digest(fs.readFileSync(geometryTarget)),digest(geometry));
const bundle={schema:1,revision:'batianhu-dongge-quests-v1',captures,
 map:{id:945,name:scene.name,spawn:[scene.x,scene.y],npcs,sourceCapture:captures[0].id,sourceSeq:scene.seq},
 geometry:{file:'data/maps/945.json',sha256:digest(geometry)},dongNpc:bare(dongNpc),
 placement:{mapId:945,npcId:4,x:25,y:12,missionId:3459},
 ...Object.fromEntries(Object.entries(collections).map(([k,v])=>[k,[...v.values()]])),
 notes:['Original quest/NPC bytes retained here. Local challenge placement and repeatability are applied in lib/boss-challenges.mjs.',
  'Bio demon 3269 has no AI record in this capture; no synthetic skill list has been supplied.']};
const report={revision:bundle.revision,map:bundle.map.id,counts:Object.fromEntries(Object.entries(collections).map(([k,v])=>[k,v.size])),
 assets:{added:copies.size,bytes:[...copies.values()].reduce((n,c)=>n+c.bytes,0),conflicts},captures:captures.map(c=>({id:c.id,integrityPassed:c.audit.integrityPassed,cleanEnd:c.audit.cleanEnd})),applied:process.argv.includes('--apply')};
if(report.applied){
 for(const c of copies.values()){const bytes=fs.readFileSync(c.source);assert.equal(digest(bytes),c.sha256);fs.mkdirSync(path.dirname(c.target),{recursive:true});fs.writeFileSync(c.target,bytes,{flag:'wx'});}
 if(!fs.existsSync(geometryTarget))fs.writeFileSync(geometryTarget,geometry,{flag:'wx'});
 const file=path.join(root,'data/boss-challenges-v1.json');assert.equal(fs.existsSync(file),false,'boss bundle already exists');
 fs.writeFileSync(file,JSON.stringify(bundle,null,2)+'\n',{flag:'wx'});
 fs.writeFileSync(path.join(root,'analysis/boss-challenges-import-20260922.json'),JSON.stringify({...report,assets:{...report.assets,files:[...copies.values()].map(({target,sha256,bytes,originalPaths})=>({path:path.relative(root,target),sha256,bytes,originalPaths}))}},null,2)+'\n');
}
console.log(JSON.stringify(report,null,2));
