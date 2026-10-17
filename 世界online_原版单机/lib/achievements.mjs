import fs from 'node:fs';
import {Writer} from './codec.mjs';
import {equipment,attributes} from './restoration.mjs';
import {localVipLevel} from './equipment-sets.mjs';
import {selectedTitle,recordedTitles} from './recorded-content.mjs';
import {gain} from './content.mjs';
import {levelReward} from './game-packets.mjs';

/**
 * 成就系统（协议 11023 概览 / 11024 列表 / 11025 领取）。移植自社区单机版。
 *
 * 数据 data/achievements.json：官方 11023/11024 只有空包，这份是单机推算规则
 * （属性 400/1000/2500 档、充值档来自社区攻略；等级/传奇/杀怪/黄金/VIP 为自拟）。
 * 每条的 metric.kind 决定进度怎么算：
 *   level 人物等级 / legend 传奇等级 / stat 最终属性(base 下标) / recharge 累计充值
 *   kills 累计杀怪 / gold 持有黄金 / vip VIP 等级 / illusion 已幻化件数
 *   fashion、mount 时装与坐骑的**不同种类**数 / pet 宠物数 / wins 战斗胜场 / point 成就点
 *
 * ⚠️ 读文件不能用 fs.existsSync 守门：APK 里 node:fs 是 VFS 垫片，existsSync 只查预载表，
 *    data/ 下的资料是运行时按需加载的 → 恒为 false（第 57 版踩过这个坑）。
 */

const FILE=new URL('../data/achievements.json',import.meta.url);
let built=null;

function ensure(){
 if(built)return built;
 let raw;
 try{
  raw=JSON.parse(fs.readFileSync(FILE,'utf8'));
 }catch(error){
  if(error&&error.code==='ENOENT'){
   built={revision:null,rows:[],byId:new Map(),bigOf:new Map()};
   return built;
  }
  throw error;
 }
 const rows=Array.isArray(raw.achievements)?raw.achievements:[];
 built={
  revision:raw.revision||null,
  rows,
  byId:new Map(rows.map(a=>[a.id,a])),
  bigOf:new Map(Object.entries(raw.bigTypes||{}).flatMap(([big,types])=>(types||[]).map(t=>[t,Number(big)]))),
 };
 return built;
}

const claimedSet=p=>new Set(Array.isArray(p.achievementClaims)?p.achievementClaims:[]);
const totalKills=p=>Object.values(p.battles?.kills||{}).reduce((s,n)=>s+(Number(n)||0),0);

/** 背包里某类装备（type=11 坐骑 / 12 时装）的**不同种类**数。 */
function distinctKind(p,type){
 const seen=new Set();
 for(const item of p.inventory||[]){
  if(item.pet)continue;
  const e=equipment.get(item.itemId);
  if(e&&e.type===type)seen.add(e.id);
 }
 return seen.size;
}

function achievementPoint(ids){
 return ensure().rows.filter(a=>ids.has(a.id)).reduce((s,a)=>s+(a.point||0),0);
}

const customMetrics={
 illusion:p=>(p.inventory||[]).filter(i=>i.illusionItemId&&i.illusionItemId!==i.itemId).length,
 fashion:p=>distinctKind(p,12),
 mount:p=>distinctKind(p,11),
 pet:p=>(p.inventory||[]).filter(i=>i.pet).length,
 wins:p=>p.battles?.wins||0,
 point:p=>achievementPoint(claimedSet(p)),
};

function metricCur(p,a){
 const kind=a.metric?.kind;
 if(customMetrics[kind])return customMetrics[kind](p);
 switch(kind){
  case 'level':return p.level||0;
  case 'legend':return p.level2||0;
  case 'stat':return attributes(p).base[a.metric.stat]||0;
  case 'recharge':return p.nativeCommerce?.total||0;
  case 'kills':return totalKills(p);
  case 'gold':return p.gold||0;
  case 'vip':return localVipLevel(p);
  default:return 0;   // 神话武器类 metric（我们没有那几件武器）恒 0，永远不达成
 }
}

const thresholdOf=a=>a.metric?.threshold??0;
const metricMet=(p,a)=>metricCur(p,a)>=thresholdOf(a);
const stateOf=(p,a,claimed)=>claimed.has(a.id)?3:metricMet(p,a)?1:2;

/** 11023 概览：当前称号、成就点、称号数、四个大类各自的「可领取/已完成/总数」。 */
export function achievementInfo(w,p){
 const {rows,bigOf}=ensure();
 const claimed=claimedSet(p);
 w.string(selectedTitle(p)?.name||'').int(achievementPoint(claimed)).short(-1).short(recordedTitles.size);
 for(let big=1;big<=4;big++){
  const list=rows.filter(a=>bigOf.get(a.type)===big);
  const done=list.filter(a=>claimed.has(a.id)).length;
  const ready=list.filter(a=>!claimed.has(a.id)&&metricMet(p,a)).length;
  w.short(ready).short(done).short(list.length);
 }
 return w;
}

/** 11024 列表：按大类(big)或小类型(type)筛选，分页；每行带 当前/目标 与状态(1 可领 2 未达成 3 已领)。 */
export function achievementList(w,p,big,type,pageSize,pageNum){
 const {rows,byId,bigOf}=ensure();
 void byId;
 const claimed=claimedSet(p);
 let list=rows;
 if(type>=1&&type<=14)list=list.filter(a=>a.type===type);
 else if(big>=1&&big<=4)list=list.filter(a=>bigOf.get(a.type)===big);
 const total=list.length,size=Math.max(1,Math.min(200,pageSize||200)),page=pageNum===127?0:Math.max(0,pageNum||0);
 list=list.slice(page*size,page*size+size);
 w.int(total).short(list.length);
 for(const a of list){
  const goal=thresholdOf(a);
  const cur=Math.min(metricCur(p,a),goal);
  w.short(a.id).string(a.name).bool(true).string(cur+'/'+goal).int(a.point||0).string(a.title||'')
   .string(a.desc||'').int(a.exp||0).int(a.gold||0).int(a.silver||0).int(a.coins||0)
   .byte(-1).int(a.type).byte(stateOf(p,a,claimed));
 }
 return w;
}

/**
 * 11025 领取：id=-1 表示「一键领取」（type 为大类或小类型过滤），否则领单条。
 * 返回的包：条数 / 金 / 银 / 铜 / 等级奖励 / 成就点 / 称号名列表。
 */
export function claimAchievementReward(p,id,type){
 const {rows,byId,bigOf}=ensure();
 const claimed=claimedSet(p);
 let targets;
 if(id===-1){
  targets=rows.filter(a=>!claimed.has(a.id)&&metricMet(p,a)&&(type<1||bigOf.get(a.type)===type||a.type===type));
 }else{
  const a=byId.get(id);
  if(!a)throw Error('没有这项成就。');
  if(claimed.has(a.id))return new Writer().byte(-2);
  if(!metricMet(p,a))throw Error('尚未达成这项成就。');
  targets=[a];
 }
 if(!targets.length)return new Writer().byte(-2);
 const sum=field=>targets.reduce((s,a)=>s+(a[field]||0),0);
 const gold=sum('gold'),silver=sum('silver'),coins=sum('coins'),exp=sum('exp'),point=sum('point');
 const titles=targets.map(a=>a.title).filter(Boolean);
 p.gold=(p.gold||0)+gold;
 p.silver=(p.silver||0)+silver;
 const reward=gain(p,exp,coins);
 p.achievementClaims=[...claimed,...targets.map(a=>a.id)];
 const w=new Writer().byte(targets.length).int(gold).int(silver).int(coins);
 levelReward(w,p,reward);
 w.int(point).byte(titles.length);
 for(const name of titles)w.string(name);
 return w.bool(false).byte(0);
}

/** 给测试/诊断用：这份数据读到了没有、一共几条。 */
export function achievementsSummary(){
 const {rows,revision}=ensure();
 return {revision,rows:rows.length};
}
