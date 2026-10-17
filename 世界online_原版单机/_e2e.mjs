import {SaveStore} from './lib/store.mjs';
import {hpMax,mpMax,normalizeRole} from './lib/content.mjs';
import {officialGroups,officialMonsters,officialMissions} from './lib/official-data.mjs';
import {battleSupported} from './lib/official-rules.mjs';
import {handleOfficial} from './lib/official-service.mjs';
import {handleGame} from './lib/game-service.mjs';
import {Writer,Reader} from './lib/codec.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mid-'));
const store=new SaveStore(dir),account=store.account('中秋验收'),p=store.create(account,{name:'中秋',sex:1,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'});
Object.assign(p,{mapId:987,level:95,x:5,y:5});p.quests={active:{},completed:[]};p.hp=hpMax(p);p.mp=mpMax(p);store.save();
const context={role:p,account},sent=[];
const env={store,send(t,w){sent.push({type:t,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(){},draw:()=>0.99};
const call=(t,w=new Writer())=>{handleOfficial(t,new Reader(w.done()),context,env)||handleGame(t,new Reader(w.done()),context,env);return new Reader(sent.findLast(r=>r.type===t).bytes);};
// 先把前置都做掉，接到 1940
for(const id of [1926,1927,1928,1929,1934,1930,1931,1933,1935,1936,1937,1938,1939])p.quests.completed.push(id);
const q=officialMissions.get(1940);
console.log('接取 1940:',call(14502,new Writer().short(q.npcId).short(1940)).byte()===0?'成功':'被拒');
console.log('触发战斗组:',q.acceptBattleID,'=',officialGroups.get(q.acceptBattleID).monsters.filter(x=>x>0).map(i=>officialMonsters.get(i).name).join('+'));
// 战斗包能不能发出
const g=q.acceptBattleID;
Object.assign(p,{mapId:987,x:5,y:5});p.battles.cooldowns[g]=0;
sent.length=0;
const r=call(12501,new Writer().short(g));
console.log('12501 进战斗:',r.byte()===0?'成功':'被拒 '+r.b.toString('hex').slice(0,60));
console.log('战斗组里含真身3297:',officialGroups.get(g).monsters.includes(3297));
console.log('battleSupported:',battleSupported(g));
fs.rmSync(dir,{recursive:true,force:true});
