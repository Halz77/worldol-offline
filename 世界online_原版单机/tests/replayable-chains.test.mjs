import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole,maps,hpMax,mpMax} from '../lib/content.mjs';
import {officialMissions} from '../lib/official-data.mjs';
import {cityTarget} from '../lib/city-state.mjs';
import {handleOfficial} from '../lib/official-service.mjs';
import {SaveStore} from '../lib/store.mjs';
import {
 replayableChains,rawReplayableChains,replayableChainsRevision,successors,chainNodes,
 chainCompletedCount,chainCleared,revertReplayableChain,replayChainAfterSettlement,chainsContaining,
} from '../lib/replayable-chains.mjs';

/**
 * 可重复任务链。
 *
 * 本工程的跨天重置已经把「非新手任务」从 `quests.completed` 里清掉了，所以链**跨天**天然重开；
 * 这里补的是「同一天再打一遍」—— 交付最后一环时把整条链复位。
 */

function role(overrides={}){
 const p=normalizeRole({id:1001,name:'链测试',level:97,job:1,race:0,sex:1,mapId:1});
 p.inventory=[];p.quests={active:{},completed:[]};
 Object.assign(p,overrides);
 p.hp=hpMax(p);p.mp=mpMax(p);
 return p;
}
function position(p,mapId,npcId){
 const npc=maps[mapId]?.npcs.find(n=>n.id===npcId);
 assert.ok(npc,`地图 ${mapId} 上必须有 NPC ${npcId}`);
 Object.assign(p,{mapId,mapName:maps[mapId].name,x:npc.x,y:npc.y});
}
function harness(p=role(),save=()=>{}){
 const context={role:p},sent=[];
 const env={store:{save},send(type,w){sent.push({type,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(){}};
 const call=(type,w)=>{const r=new Reader(w instanceof Writer?w.done():w);
  assert.ok(handleOfficial(type,r,context,env),`协议 ${type} 必须被接管`);
  return {sent,last:()=>sent.findLast(x=>x.type===type)};};
 return {p,context,sent,env,call};
}

test('链数据与节点推导：玛雅·太阳神副本从根 3200 推出一条 22 环的链',()=>{
 assert.equal(typeof replayableChainsRevision(),'string');
 const raw=rawReplayableChains();
 assert.ok(raw.length>=1,'data/replayable-chains.json 至少要有一条链');
 const chains=replayableChains();
 const maya=chains.find(c=>c.id==='maya-sun-god');
 assert.ok(maya,'必须有玛雅链');
 assert.equal(maya.root,3200);
 assert.ok(maya.nodes.includes(3200),'根必须在节点集合里');
 assert.ok(maya.nodes.length>=10,`推导出的节点数太少了：${maya.nodes.length}`);
 // 节点必须都在任务表里
 for(const id of maya.nodes)assert.ok(officialMissions.has(id),`节点 ${id} 必须是真实任务`);
 // 每个节点（除最后一个）都至少有一个后继在链里 —— 否则推导就断了
 let dangling=0;
 for(const id of maya.nodes){
  const next=successors(id).filter(x=>maya.nodes.includes(x));
  if(!next.length)dangling++;
 }
 assert.ok(dangling<=3,`断点太多（${dangling} 个），链推导可能出错`);
});

test('chainCleared：空/部分/全节点/收尾环四种口径',()=>{
 const chain=replayableChains().find(c=>c.id==='maya-sun-god');
 const p=role();
 assert.equal(chainCompletedCount(p,chain),0);
 assert.equal(chainCleared(p,chain),false,'一条都没打不算通关');

 p.quests.completed=chain.nodes.slice(0,Math.floor(chain.nodes.length/2));
 assert.equal(chainCleared(p,chain),false,'打一半不算通关');

 p.quests.completed=[...chain.nodes];
 assert.equal(chainCompletedCount(p,chain),chain.nodes.length);
 assert.equal(chainCleared(p,chain),true,'全部节点完成即通关');

 // 收尾环口径：节点没全完成，但 finale 命中
 const p2=role();
 const finale=chain.finale.find(id=>chain.nodes.includes(id));
 if(finale){
  p2.quests.completed=[finale];
  assert.equal(chainCleared(p2,chain),true,'finale 命中即通关');
 }
});

test('复位：把整条链从 quests.completed 与 dailyActivity.completed 里删干净',()=>{
 const chain=replayableChains().find(c=>c.id==='maya-sun-god');
 const p=role();
 p.dailyActivity={day:'x',completed:{}};
 p.quests.completed=[...chain.nodes,9001];
 p.dailyActivity.completed={[chain.nodes[0]]:1,9002:1};
 const result=revertReplayableChain(p,chain);
 assert.equal(result.removed,chain.nodes.length,'removed 只统计 quests.completed 的移除数');
 assert.deepEqual(p.quests.completed,[9001],'链节点全清，其他人任务保留');
 assert.deepEqual(Object.keys(p.dailyActivity.completed),['9002']);
});

test('只有交付最后一环才触发复位，中间环节不动',()=>{
 const chain=replayableChains().find(c=>c.id==='maya-sun-god');
 const p=role();
 // MOD(maya-continuation)：链节点从 61 增到 71（地下宫殿 8700—8709 已并入，
 // 由 type9 后继闭包自动推导，编号排在 1863 之后）。原来的 nodes.slice(0,-1)
 // 现在去掉的是 8709，交付 1824 恰好补齐最后一环 → 会合法复位，测不出「中间环节」。
 // 改成：只完成前一半节点，然后交付一个**没做过**的中段环 —— 它既不是收尾环，
 // 补上也不该让整条链判定通关。
 const last=chain.nodes.at(-1);
 const half=chain.nodes.slice(0,Math.floor(chain.nodes.length/2));
 const secondLast=chain.nodes[Math.floor(chain.nodes.length/2)+2];
 assert.ok(chain.nodes.includes(secondLast),'中段环必须在链里');
 p.quests.completed=half;
 assert.equal(replayChainAfterSettlement(p,secondLast),null,'还差一环，不该复位');
 assert.equal(p.quests.completed.length,half.length,'中间环交付不该动已有完成记录');

 p.quests.completed=[...chain.nodes];
 const hit=replayChainAfterSettlement(p,last);
 assert.ok(hit,'全部完成时交付应当复位');
 assert.equal(hit.id,'maya-sun-god');
 assert.equal(hit.nodes,chain.nodes.length);
 assert.deepEqual(p.quests.completed,[],'复位后完成记录清空 → 第一环可以重接');
});

test('端到端：交付链尾任务后，14503 自动复位整条链并发提示',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-replay-chain-'));
 t.after(()=>{const exact=fs.realpathSync(dir);
  assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-replay-chain-'));
  fs.rmSync(exact,{recursive:true,force:true});});
 const store=new SaveStore(dir),account=store.account('链验收');
 const p=store.create(account,{name:'链验收',sex:1,race:0,job:1});
 p.level=97;p.hp=hpMax(p);p.mp=mpMax(p);p.inventory=[];
 const chain=replayableChains().find(c=>c.id==='maya-sun-god');
 const last=chain.nodes.at(-1);
 const q=officialMissions.get(last);
 // 只差最后一环：其余节点都在完成记录里，最后一环已接取且条件已满足。
 p.quests={active:{[last]:{official:true,counts:{},origin:{mapId:q.mapId,npcId:20}}},completed:chain.nodes.slice(0,-1)};
 store.save();
 const h=harness(p,()=>store.save());
 // 交付 NPC 用 cityTarget 算（任务自带的 q.npcId 与抓包 origins 不一定同一个）
 const target=cityTarget(q,p),npcId=target.npcId;
 position(p,target.mapId,npcId);
 // 这个 NPC 在抓包里是「按任务阶段出现」的（status 位不满 3），先把它打开，
 // 否则 14503 会以「请走到任务 NPC 身边」被拒 —— 那是 NPC 状态，不是角色数据。
 const npc=maps[target.mapId].npcs.find(n=>n.id===npcId);
 assert.ok(npc,`地图 ${target.mapId} 上要有 NPC ${npcId}`);
 npc.status=3;npc.missionData=undefined;

 const {sent}=h.call(14503,new Writer().short(npcId).short(last).int(0));
 assert.equal(p.quests.completed.length,0,'整条链的完成记录都被抹掉');
 assert.ok(!p.quests.active[last],'交付后任务从进行中移除');
 // 提示条：byte(类型) + string（3 字节长度 + UTF-16BE），用 Reader 解
 const notices=sent.filter(x=>x.type===10509).map(x=>{const r=new Reader(x.bytes);r.byte();return r.string();});
 assert.ok(notices.some(text=>text.includes('任务链')&&text.includes('重新接取')),
  `必须给一条「可以重打」的提示，实际：${JSON.stringify(notices)}`);
 // 落盘：重新读存档，链仍是复位后的状态
 const loaded=new SaveStore(dir).data.characters.find(r=>r.id===p.id);
 assert.equal(loaded.quests.completed.length,0);
});

test('跨天天然重开：非新手任务从 completed 清掉后，链的第一环重新可接',async()=>{
 const {ensureDaily}=await import('../lib/daily-activity.mjs');
 const chain=replayableChains().find(c=>c.id==='maya-sun-god');
 const p=role();
 p.quests.completed=[...chain.nodes];
 p.dailyActivity={day:'2000-01-01',version:2,progress:{},completed:{},credited:[],taskTimes:{},claimedVitality:[],claimedActive:[]};
 ensureDaily(p,Date.now());
 assert.deepEqual(p.quests.completed,[],'跨天把非新手任务清空（这就是链能重打的前提）');
 assert.equal(chainCompletedCount(p,chain),0);
});

test('chainsContaining：链上任务能反查到所属链',()=>{
 const chain=replayableChains().find(c=>c.id==='maya-sun-god');
 for(const id of [chain.nodes[0],chain.nodes.at(-1)]){
  assert.ok(chainsContaining(id).some(c=>c.id==='maya-sun-god'),`任务 ${id} 应属于玛雅链`);
 }
 assert.deepEqual(chainsContaining(999999),[]);
});
