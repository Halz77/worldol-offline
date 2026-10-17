/**
 * 可重复任务链（链式副本）。
 *
 * ## 为什么需要它
 * 本工程的任务完成判定是「`quests.completed` 里有这个 id」，而 `ensureDaily` 跨天会把
 * **非新手任务**从 `completed` 里清掉。也就是说：跨天之后，链上的前置条件（acceptCondition
 * type 9）全都不再满足，整条链自然回到「从未打过」。**跨天重开天然成立**。
 *
 * 缺的是「同一天内再打一遍」：打完最后一环后，`completed` 里留着全部节点，前置条件一直成立，
 * 玩家再也接不到第一环。
 *
 * 所以这里的做法是：**交付任务时检测它是否让某条链通关；一旦通关，就把整条链的节点
 * 从完成记录里抹掉**，玩家可以立刻从第一环重接（不用等到明天）。
 *
 * ## 节点集合怎么来
 * 不写死任务列表，从链根的 `submitNextMissionID` 加上「其它任务的 acceptCondition type 9
 * 指向它」做后继闭包（BFS）。这样抓包数据补了新任务时不用改代码。
 *
 * ⚠️ 本工程的任务表并不完整：玛雅链根 3200 的后继在 3219（巨石神兵）之后指向 3220，
 * 而 3220 / 8700–8709 / 1823 在我们这份 official-v305 里**都没有**，所以实际推导出来
 * 是 3200–3219 共 22 个节点，finale（1846/1863）不在集合内。判定「通关」因此要能
 * 同时接受「全部节点完成」和「finale 命中」两种口径。
 */
import fs from 'node:fs';
import {officialMissions} from './official-data.mjs';
import {lazyJson} from './lazy-data.mjs';

/** 链注册表：只登记链根与收尾环，节点集合由数据推导。 */
const chainData=lazyJson(new URL('../data/replayable-chains.json',import.meta.url),'replayableChains');

export const replayableChainsRevision=()=>chainData.revision;

/** 一个任务的后继：submitNextMissionID + 所有把 type 9 前置指向它的任务。 */
export function successors(id){
 const out=[];
 const mission=officialMissions.get(Number(id));
 const next=Number(mission?.submitNextMissionID)||0;
 if(next>0)out.push(next);
 for(const other of officialMissions.values()){
  if((other.acceptCondition||[]).some(c=>c.type===9&&!c.not&&Number(c.missionId)===Number(id)))out.push(other.id);
 }
 return out;
}

/** 从链根沿后继做闭包，得到整条链的任务 id（升序）。 */
export function chainNodes(root){
 const nodes=new Set(),queue=[Number(root)];
 while(queue.length){
  const id=queue.shift();
  if(!id||nodes.has(id)||!officialMissions.has(id))continue;
  nodes.add(id);
  for(const next of successors(id))if(!nodes.has(next))queue.push(next);
 }
 return [...nodes].sort((a,b)=>a-b);
}

let cache=null;
/** 全部链（数据里的 + 副本扩展补充的），带推导出的 nodes，按节点集合去重。 */
export function replayableChains(){
 if(cache)return cache;
 const rows=(chainData.chains||[]).map(chain=>({...chain,root:Number(chain.root),nodes:chainNodes(chain.root),finale:(chain.finale||[]).map(Number)}));
 const seen=new Set();
 cache=rows.filter(chain=>{
  const key=[...chain.nodes].sort((a,b)=>a-b).join(',');
  if(seen.has(key))return false;
  seen.add(key);return true;
 });
 return cache;
}

/** 某个任务属于哪些链。 */
export function chainsContaining(missionId){
 return replayableChains().filter(chain=>chain.nodes.includes(Number(missionId)));
}

function questHistoryHas(p,id){
 const n=Number(id);
 return (p.quests?.completed||[]).includes(n)||!!p.dailyActivity?.completed?.[n];
}

/** 这条链已经完成了几个节点。 */
export function chainCompletedCount(p,chain){
 return (chain.nodes||[]).filter(id=>questHistoryHas(p,id)).length;
}

/** 链是否已通关：收尾环任一完成，或全部节点都完成。 */
export function chainCleared(p,chain){
 if((chain.finale||[]).some(id=>chain.nodes.includes(Number(id))&&questHistoryHas(p,id)))return true;
 return chainCompletedCount(p,chain)>=chain.nodes.length;
}

/**
 * 把整条链复位成「从未打过」：从 `quests.completed`、`dailyActivity.completed` 里删掉所有节点。
 * 进行中的任务不动（由调用方决定要不要清）。
 * @returns {{id:string,name:string,nodes:number,removed:number}}
 */
export function revertReplayableChain(p,chain){
 const ids=new Set(chain.nodes);
 let removed=0;
 const strip=list=>{
  const out=(list||[]).filter(id=>!ids.has(Number(id)));
  removed+=Math.max(0,(list||[]).length-out.length);
  return out;
 };
 if(!p.quests)p.quests={active:{},completed:[]};
 p.quests.completed=strip(p.quests.completed);
 if(p.dailyActivity?.completed){
  const kept={};
  for(const [id,value] of Object.entries(p.dailyActivity.completed))if(!ids.has(Number(id)))kept[id]=value;
  p.dailyActivity.completed=kept;
 }
 return {id:chain.id,name:chain.name,nodes:chain.nodes.length,removed};
}

/**
 * 交付任务之后的钩子：如果这个任务让某条链通关了，就把整条链复位。
 * @returns {null | {id:string,name:string,nodes:number,removed:number,missionId:number}}
 */
export function replayChainAfterSettlement(p,missionId){
 const chains=chainsContaining(missionId).filter(chain=>chainCleared(p,chain));
 if(!chains.length)return null;
 // 同一任务可能落在多条链里（节点重叠），复位一条就够 —— 复位后其它链的完成度也会重算。
 const chain=chains[0];
 const result=revertReplayableChain(p,chain);
 return {...result,missionId:Number(missionId)};
}

/** 供测试与日志用：直接读数据文件里的原始链定义。 */
export function rawReplayableChains(){
 const raw=JSON.parse(fs.readFileSync(new URL('../data/replayable-chains.json',import.meta.url),'utf8'));
 return raw.chains||[];
}
