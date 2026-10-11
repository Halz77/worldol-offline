import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import net from 'node:net';
import WebSocket from 'ws';
import {dailyKey,ensureDaily} from '../lib/daily-activity.mjs';
import {resetTaskDays,nextTaskResetAt,taskResetRevision} from '../lib/task-reset.mjs';
import {SaveStore} from '../lib/store.mjs';
import {normalizeRole,hpMax,mpMax} from '../lib/content.mjs';
import {officialMissions} from '../lib/official-data.mjs';
import {missionClosed,officialCanAccept} from '../lib/official-rules.mjs';
import {Writer,Reader,frame,unframe} from '../lib/codec.mjs';
import {BATTLE_TRAILER} from '../lib/game-service.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const before=Date.parse('2026-09-23T15:59:59.800Z'),midnight=Date.parse('2026-09-23T16:00:00Z');
function role(id=1001){
 const p=normalizeRole({id,name:'零点验收'+id,level:97,job:1,race:0,sex:1,mapId:1});
 ensureDaily(p,before);p.quests={completed:[42,1132,9001,3042],active:{1127:{counts:{5:2}},9002:{kills:1}},custom:'retain'};
 p.dailyActivity.completed={42:1,1132:1,3042:1};p.dailyActivity.progress={1:1,3:20};p.dailyActivity.taskTimes={5:1};p.dailyActivity.claimedActive=[1];p.dailyActivity.claimedVitality=[100];
 p.pendingMissionRewards=[{missionId:1,itemId:123,quantity:1}];return p;
}

test('all task types reset only at Shanghai midnight, without changing character assets or pending rewards',()=>{
 const p=role(),unchanged=structuredClone(p);delete unchanged.quests;delete unchanged.dailyActivity;
 let saves=0;const store={data:{characters:[p]},save(){saves++;}};
 assert.equal(nextTaskResetAt(before),midnight);assert.equal(dailyKey(midnight),'2026-09-24');
 assert.deepEqual(resetTaskDays(store,before),[]);assert.equal(saves,0);
 const result=resetTaskDays(store,midnight);assert.deepEqual(result,[{role:1001,day:'2026-09-24',reset:true,completed:4,active:2}]);
 assert.deepEqual(p.quests,{completed:[],active:{},custom:'retain'});assert.deepEqual(p.dailyActivity.completed,{});assert.deepEqual(p.dailyActivity.taskTimes,{});assert.deepEqual(p.dailyActivity.claimedActive,[]);assert.deepEqual(p.dailyActivity.claimedVitality,[]);
 const rest=structuredClone(p);delete rest.quests;delete rest.dailyActivity;assert.deepEqual(rest,unchanged);
 assert.equal(missionClosed(p,officialMissions.get(42)),false);assert.ok([...officialMissions.values()].some(q=>!(q.setting&2)&&officialCanAccept(p,q)));
 p.quests.completed.push(9001);assert.deepEqual(resetTaskDays(store,midnight),[]);assert.deepEqual(resetTaskDays(store,before),[]);assert.equal(saves,1);assert.deepEqual(p.quests.completed,[9001]);
 resetTaskDays(store,midnight+86400000);assert.deepEqual(p.quests.completed,[]);assert.equal(saves,2);
});

test('failed reset saves roll back every character, while undated legacy saves establish a date first',()=>{
 const roles=[role(),role(1002)],original=structuredClone(roles),store={data:{characters:roles},save(){throw Error('disk full');}};
 assert.throws(()=>resetTaskDays(store,midnight),/disk full/);assert.deepEqual(roles,original);
 const old=role(1003);delete old.dailyActivity;const originalQuests=structuredClone(old.quests);
 store.data.characters=[old];store.save=()=>{};assert.equal(resetTaskDays(store,before)[0].reset,false);assert.deepEqual(old.quests,originalQuests);
 resetTaskDays(store,midnight);assert.deepEqual(old.quests.completed,[]);assert.deepEqual(old.quests.active,{});
});

test('native client defers midnight refresh during combat and discards stale notifications after switching roles',()=>{
 let receive,tick,refreshes=0;const world={myPlayer:{id:1001}},battle={isFight:true},tips=[];
 const modules={5:{default:world},18:{default:{createWorldDataReflashMsg(full){assert.equal(full,true);refreshes++;}}},43:{default:{Service:{onNt(type,handler,context){assert.equal(type,90021);assert.ok(context);receive=handler;}}}},54:{default:{ins:battle}},15:{Tips:{show:text=>tips.push(text)}}};
 const scope={window:{},setInterval(fn){tick=fn;}};vm.runInNewContext(fs.readFileSync(new URL('../web/daily-reset.js',import.meta.url),'utf8'),scope);scope.window.installDailyTaskReset(id=>modules[id]);
 const push=(id,day)=>receive({body:{getString:()=>JSON.stringify({role:id,day})}});
 push(1001,'2026-09-24');tick();assert.equal(refreshes,0);battle.isFight=false;tick();assert.equal(refreshes,1);assert.equal(tips.length,1);
 push(1001,'2026-09-24');tick();assert.equal(refreshes,1);push(1001,'2026-09-25');world.myPlayer={id:1002};tick();assert.equal(refreshes,1);
 push(1002,'2026-09-25');tick();assert.equal(refreshes,2);
});

test('idle service resets online and offline roles at midnight, keeps a running battle, and persists the cleared tasks',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-task-reset-')),clockFile=path.join(dir,'clock.txt'),preload=path.join(dir,'clock.mjs');
 const store=new SaveStore(dir),account=store.account('midnight'),icons={icon1:'2240667',icon2:'0',icon3:'0'},p=store.create(account,{name:'在线跨天',sex:1,race:0,job:1,...icons}),offline=store.create(account,{name:'离线跨天',sex:0,race:1,job:3,...icons});
 Object.assign(p,role(p.id),{accountId:account.id,mapId:10,mapName:'村外山道',x:18,y:20});p.hp=hpMax(p);p.mp=mpMax(p);
 Object.assign(offline,role(offline.id),{accountId:account.id});offline.dailyActivity.day='2026-09-22';store.save();
 const inventory=structuredClone(p.inventory),clock=n=>fs.writeFileSync(clockFile,String(n));clock(before);
 fs.writeFileSync(preload,'import fs from "node:fs"; Date.now=()=>Number(fs.readFileSync('+JSON.stringify(clockFile)+',"utf8"));\n');
 const allocator=net.createServer();allocator.listen(0,'127.0.0.1');await once(allocator,'listening');const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
 const proc=spawn(process.execPath,['--import',pathToFileURL(preload).href,path.join(root,'server.mjs')],{cwd:root,env:{...process.env,WORLDOL_PORT:String(port),WORLDOL_SAVES:dir,WORLDOL_LOGS:path.join(dir,'logs')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let ws;const messages=[],pending=new Map();let errors='';proc.stderr.on('data',b=>errors+=b);
 const waitUntil=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Timed out: '+errors);};
 try{
  await Promise.race([once(proc.stdout,'data'),once(proc,'exit').then(()=>{throw Error(errors);}),new Promise((_,reject)=>setTimeout(()=>reject(Error('Startup timed out '+errors)),5000).unref())]);
  const status=await fetch(`http://127.0.0.1:${port}/api/status`).then(r=>r.json());assert.equal(status.taskResetRevision,taskResetRevision);assert.equal(status.nextTaskResetAt,midnight);
  assert.equal(status.characters.find(r=>r.id===p.id).quests.completed.length,4);assert.deepEqual(status.characters.find(r=>r.id===offline.id).quests.completed,[],'offline startup catches up missed days');
  ws=new WebSocket(`ws://127.0.0.1:${port}/game`);await once(ws,'open');
  ws.on('message',b=>{const message=unframe(b);messages.push(message);const resolve=pending.get(message.type);if(resolve){pending.delete(message.type);resolve(new Reader(message.body));}});
  const call=(type,w=new Writer())=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(type);reject(Error('No reply '+type+' '+errors+' '+fs.readFileSync(path.join(dir,'logs/session.jsonl'),'utf8').split('\n').filter(line=>line.includes('protocol-error')).join('\n')));},3000);pending.set(type,r=>{clearTimeout(timer);resolve(r);});ws.send(frame(type,w));});
  await call(5002,new Writer().string('midnight'));await call(2,new Writer().int(p.id));
  const start=await call(12501,new Writer().short(701));assert.equal(start.byte(),0);const token=start.int();
  clock(midnight);
  // No client message triggers this reset: the server's clock must push it.
  await waitUntil(()=>messages.some(m=>m.type===90021));
  const notice=JSON.parse(new Reader(messages.find(m=>m.type===90021).body).string());assert.equal(notice.day,'2026-09-24');assert.equal(notice.role,p.id);
  const saved=JSON.parse(fs.readFileSync(path.join(dir,'world.json'),'utf8'));
  for(const role of saved.characters){assert.equal(role.dailyActivity.day,'2026-09-24');assert.deepEqual(role.quests.completed,[]);assert.deepEqual(role.quests.active,{});}
  assert.deepEqual(saved.characters[0].inventory,inventory);assert.equal(messages.filter(m=>m.type===10503).length,0,'no world reload is pushed into combat');
  const end=new Writer().int(p.hp).int(p.mp).int(p.hp).int(p.mp).short(0).short(701).bool(false).byte(0).byte(1).bytes([0]).int(BATTLE_TRAILER).int(token).byte(2);
  const settled=await call(12502,end);assert.equal(settled.byte(),2,'the existing battle can still settle');
  const refresh=await call(10503);assert.equal(refresh.byte(),0);await waitUntil(()=>messages.some(m=>m.type===22106));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'world.json'),'utf8')).characters[0].quests.active,{});
  await call(16001);assert.equal(messages.filter(m=>m.type===90021).length,1);
  const loaded=new SaveStore(dir);assert.deepEqual(resetTaskDays(loaded,midnight),[]);assert.deepEqual(loaded.data.characters[0].quests.completed,[]);
 }finally{
  ws?.close();
  if(proc.exitCode===null){const ctl=JSON.parse(fs.readFileSync(path.join(dir,'logs/control.json'),'utf8')),exited=once(proc,'exit');await fetch(`http://127.0.0.1:${port}/api/shutdown`,{method:'POST',headers:{'X-Worldol-Control':ctl.token}});await exited;}
  const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-task-reset-'));fs.rmSync(exact,{recursive:true});
 }
});
