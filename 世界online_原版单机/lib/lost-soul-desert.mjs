/**
 * 迷失之魂 · 沙漠 —— 剧情桥接（单机补写 2 环）。
 *
 * ## 背景
 * 录制包从任务 9「疯狂元素」直接跳到 12，中间 10 / 11 两环没有录到，
 * 于是玩家做完 9 之后整条线就断了（9 的 submitNextMissionID 指向不存在的 10）。
 * 这两环都是纯对话（没有战斗、没有奖励），缺的只是剧情过渡，按上下文补写即可。
 *
 * ## 为什么敢补
 * 9 的收尾已经交代「洞穴那边有陌生身影」，12 的开场需要「地狱使者」这个线索 ——
 * 补写与两头都对得上，不是凭空加环。战斗与数值一律不动（这两环本来就没战斗）。
 *
 * ## 另一个处理
 * 任务 28 那条支线被录制里的 127 级门槛挡住了，但它的后续 33—36 根本没录到，
 * 于是它变成一条走进去就出不来头的死路。这里给它打标记，
 * 由 missionBlockers 报「不可用」，而不是让玩家卡死。
 */
import {Writer} from './codec.mjs';

/** 前置任务条件（type 9 = 完成指定任务）。 */
const previous=(id,name)=>({type:9,not:0,missionId:id,name,rawHex:new Writer().short(id).utf(name).done().toString('hex')});

const STEPS=[
 {id:10,name:'洞穴前的游骑兵',prev:9,from:17,to:18,next:11,
  goal:'前往沙漠营地南部，与洞穴附近的游骑兵交谈。',
  desc:'迷幻之火来自营地南部的炙热洞穴。去找守在洞穴附近的游骑兵，商量如何阻止疯狂继续蔓延。',
  finish:'洞穴里仍有火元素涌出，入口附近还有两个陌生的身影。先弄清他们的来历。'},
 {id:11,name:'地狱的使者',prev:10,from:18,to:52,next:12,
  goal:'与洞穴入口附近的地狱使者交谈。',
  desc:'游骑兵发现入口附近出现了两个地狱使者。前去与他们交谈，查明洞穴与地狱的联系。',
  finish:'你走近地狱使者，试图询问洞穴中的异变。'},
];

export function applyLostSoulDesert(o){
 for(const s of STEPS){
  if(o.missions.some(q=>q.id===s.id))continue;
  const prev=o.missions.find(q=>q.id===s.prev);
  if(!prev)throw Error('Missing desert bridge prerequisite '+s.prev);
  o.missions.push({
   id:s.id,name:s.name,level:0,simpleDesc:s.goal,
   desc:'【单机补写】'+s.desc,setting:1026,
   mapId:819,npcId:s.to,radarMapID:0,
   dialogNotStartNotReady:'请先完成前置任务。',
   dialogStartNotFinish:s.goal,dialogStartFinish:'【单机补写】'+s.finish,
   exp:0,money2:0,money3:0,rewardItems:[],selectItems:[],
   acceptJumpMapID:0,submitJumpMapID:0,acceptBattleID:0,submitBattleID:0,
   submitNextMissionID:s.next,
   acceptCondition:[previous(s.prev,prev.name)],submitCondition:[],
   type:0,series:'',acceptMapId:819,acceptNpcId:s.from,
   canAccept:1,_isHelp:false,localReconstruction:true,
   sources:[{origin:'local-lost-soul-desert-bridge',mapId:819,npcId:s.from}],
  });
 }
 // 28 号支线后续没录到，标成不可用，别让玩家走进去出不来。
 const unsupported=o.missions.find(q=>q.id===28);
 if(unsupported)unsupported.localDesertUnavailableBranch=true;
 return o;
}

/**
 * 日常任务看板里把 10 / 11 插回 9 与 12 之间。
 * 不插的话看板上从「疯狂元素」直接跳到下一环，玩家不知道这两环存在。
 */
export function applyLostSoulDesertDaily(data){
 for(const t of data.tasks||[]){
  const ids=t.linkage?.missionIds;
  if(!ids?.includes(9)||!ids.includes(12))continue;
  for(const id of [10,11])if(!ids.includes(id))ids.splice(ids.indexOf(9)+(id===10?1:2),0,id);
 }
 return data;
}