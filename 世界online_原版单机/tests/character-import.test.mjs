import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import WebSocket from 'ws';
import {buildCharacterImport,sha256} from '../tools/import-character-export.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {activeSkills,unequip,equipment} from '../lib/restoration.mjs';
import {itemWithAffixes} from '../lib/item-affixes.mjs';
import {nativeCharacterStats} from '../lib/native-character-stats.mjs';
import {activePet,petAttributes} from '../lib/pet-state.mjs';
import {petDetail} from '../lib/pet-packets.mjs';
import {Writer,Reader,frame,unframe} from '../lib/codec.mjs';
import {SaveStore} from '../lib/store.mjs';
import {decoders} from '../tools/capture-decoders.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),bytes=fs.readFileSync(new URL('./fixtures/character-export.json',import.meta.url)),document=JSON.parse(bytes),options={accountName:'import-test',sourceSHA256:sha256(bytes),now:'2026-09-22T08:00:00.000Z'};
const original=()=>normalizeRole({id:1001,accountId:1,name:'已有角色',sex:1,race:1,job:3,level:97,icon1:'2240667',icon2:'0',icon3:'0',status:0,vipLevel2:0,skills:{},inventory:[],restoration:{starterIssued:true}});
const world=()=>({schema:1,nextAccount:2,nextRole:1002,accounts:[{id:1,name:'import-test',lastRoleId:1001}],characters:[original()]});
const imported=()=>buildCharacterImport(world(),document,options);
test('character export appends a distinct role, keeps exact equipment/skill levels, and rejects duplicate imports',()=>{
 const before=world(),saved=JSON.stringify(before),catalogue=JSON.stringify([...equipment]),{world:next,role:p,report}=buildCharacterImport(before,document,options);
 assert.equal(JSON.stringify(before),saved);assert.equal(JSON.stringify([...equipment]),catalogue);assert.deepEqual(next.accounts,before.accounts);assert.deepEqual(next.characters[0],before.characters[0]);
 assert.equal(p.name,'万事如意');assert.equal(p.level,97);assert.equal(p.level2,90);assert.equal(p.inventory.length,17);assert.equal(report.skills,68);assert.equal(p.skills[102],9);assert.equal(p.skills[111],undefined);assert.equal(activeSkills(p).find(s=>s.id===111).level,17);
 assert.equal(p.inventory.find(i=>i.slot===11).recordedDefinition.star,25);assert.equal(p.inventory.find(i=>i.slot===5).recordedDefinition.upgradeStar,20);assert.equal(p.inventory.find(i=>i.slot===15).recordedDefinition.illusionItemId,31016);
 assert.deepEqual(p.autoSkillIds,[518,0,0,0,0]);assert.equal(p.initiativeSkillId,456);assert.throws(()=>buildCharacterImport(next,document,options),/重复导入/);
});
test('derived imported stats match all eight exported attack/defense fields and change with equipment',()=>{
 const {role:p}=imported(),stats=nativeCharacterStats(p).stats;
 for(const key of ['ATK_STR_NEARBY','ATK_STR_RANGE','ATK_AGI_NEARBY','ATK_AGI_RANGE','DEF_STR_RANGE','DEF_STR_NEARBY','DEF_AGI_RANGE','DEF_AGI_NEARBY'])assert.equal(stats[key],document.after.stats[key.toLowerCase()]);
 assert.equal(stats.HPMAX,55065);assert.equal(stats.MPMAX,3116);
 // These packet fields are observed metadata, not a frozen replacement for calculations.
 p.importedCombatModifiers={};assert.deepEqual(nativeCharacterStats(p).stats,stats);
 unequip(p,8);assert.ok(nativeCharacterStats(p).stats.ATK_MAX<stats.ATK_MAX);assert.ok(!activeSkills(p).some(s=>s.id===6562));
 unequip(p,16);assert.equal(activeSkills(p).find(s=>s.id===111).level,9);unequip(p,2);assert.ok(!activeSkills(p).some(s=>s.id===111));
});
test('imported workshop edits preserve seal/enchantment/upgrade data and reject invalid affixes',()=>{
 const {role:p}=imported(),item=p.inventory.find(i=>i.slot===0),template=equipment.get(item.itemId),before=itemWithAffixes(template,item);
 const edited={...item,combinedSkill:{id:template.combinUpSkillList[1].id,level:template.combinUpSkillList[1].level}},after=itemWithAffixes(template,edited);
 assert.equal(after.skill.id,edited.combinedSkill.id);for(const key of ['star','def_str','enchantLevel','cssLeftItemPower','cssRightItemPower'])assert.deepEqual(after[key],before[key]);
 assert.throws(()=>itemWithAffixes(template,{...item,affixes:{power1:{power:9999,value:9999}}}));
});
test('pet native parser reads all 28 skills and explicit five-slot settings; unknown limits are not invented',()=>{
 const {role:p}=imported(),pet=activePet(p),d=decoders(root),r=new d.Reader(petDetail(new Writer(),pet).done()),decoded={bag:{store:[]}};
 const parser=d.native(42,'fromBytesDetail',{n:{default:{timer:{serverTime:0}}},a:{default:{processDataPlayerSkillMsg(r){return Array.from({length:r.getShort()},()=>d.Skill.fromBytes(r));}}},E:{default:{PET_BAG_SIZE:8}}});
 assert.equal(parser(r,decoded),0);r.finish();assert.equal(decoded.skillList.length,28);assert.deepEqual(Array.from(decoded.autoSkillID),[6079,0,0,0,0]);assert.equal(decoded.autoSkillID_Initiative,6172);assert.equal(decoded.icon1.toJSON(),'227');
 assert.ok(pet.hp<=petAttributes(p,pet).hp);assert.equal(pet.importedVitals.hp,69089);assert.equal(pet.recordedSnapshotVitals,undefined);
});
test('isolated service lists the imported role, enters it, exposes it to legion, and retains data across relogin',async()=>{
 const dir=fs.mkdtempSync(path.join(root,'test-character-import-')),port=8788,result=imported();fs.writeFileSync(path.join(dir,'world.json'),JSON.stringify(result.world));
 const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,WORLDOL_PORT:String(port),WORLDOL_SAVES:dir,WORLDOL_LOGS:path.join(dir,'logs')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let ws,stderr='';proc.stderr.on('data',b=>stderr+=b);proc.stdout.on('data',()=>{});
 try{
  let status;for(let i=0;i<60;i++){try{status=await(await fetch(`http://127.0.0.1:${port}/api/status`)).json();if(status.pid===proc.pid)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.equal(status?.pid,proc.pid,stderr);
  ws=new WebSocket(`ws://127.0.0.1:${port}/game`);await once(ws,'open');
  const features=[];ws.on('message',data=>{const packet=unframe(data);if(packet.type===90015)features.push(JSON.parse(new Reader(packet.body).string()));});
  async function call(type,w=new Writer()){const waiting=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',receive);reject(Error('Timeout '+type+' '+stderr));},5000);function receive(b){const p=unframe(b);if(p.type!==type)return;clearTimeout(timer);ws.off('message',receive);resolve(new Reader(p.body));}ws.on('message',receive);});ws.send(frame(type,w));return waiting;}
  assert.equal((await call(5000)).byte(),0);const login=await call(5002,new Writer().string('import-test'));assert.equal(login.byte(),0);assert.equal((await call(1,new Writer().long(login.long()).int(login.int()))).byte(),0);
  const listed=await call(10001);listed.string();assert.equal(listed.short(),2);const rows=[];for(let n=0;n<2;n++){const row={id:listed.int(),name:listed.string()};for(let i=0;i<5;i++)listed.byte();listed.string();for(let i=0;i<3;i++)listed.long();listed.int();rows.push(row);}assert.equal(listed.int(),1001);assert.equal(listed.pos,listed.b.length);assert.ok(rows.some(r=>r.name==='万事如意'));
  const legion=await(await fetch(`http://127.0.0.1:${port}/api/legion?role=1001`)).json();assert.ok(legion.actorInfos.some(r=>r.actorId===result.role.id));
  assert.equal((await call(2,new Writer().int(result.role.id))).byte(),0);assert.deepEqual(features.at(-1).powers, Object.entries(result.role.importedRolePowers).map(([id,n])=>[Number(id),n]));
  const rating=await(await fetch(`http://127.0.0.1:${port}/api/combat-rating?role=${result.role.id}`)).json();assert.equal(rating.stats.HPMAX,55065);
  const logout=await call(3,new Writer().byte(1));assert.equal(logout.byte(),1);assert.equal(logout.byte(),0);assert.equal(logout.pos,logout.b.length);assert.equal((await call(2,new Writer().int(result.role.id))).byte(),0);assert.equal((await call(10503)).byte(),0);
  const reloaded=new SaveStore(dir).data.characters.find(p=>p.id===result.role.id);for(const key of ['inventory','skills','importedSkillDefinitions','importedRolePowers','autoSkillIds','initiativeSkillId'])assert.deepEqual(reloaded[key],result.role[key]);
  const final=await(await fetch(`http://127.0.0.1:${port}/api/status`)).json();assert.equal(final.unknown.length,0);assert.equal(stderr,'');
 }finally{
  ws?.terminate();if(proc.exitCode===null){const c=JSON.parse(fs.readFileSync(path.join(dir,'logs/control.json'))),exited=once(proc,'exit');await fetch(`http://127.0.0.1:${port}/api/shutdown`,{method:'POST',headers:{'X-Worldol-Control':c.token}});await exited;}
  const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(root)+path.sep+'test-character-import-'));fs.rmSync(exact,{recursive:true});
 }
});
