import fs from 'node:fs';
import {normalizePetEquipment} from './pet-equipment-data.mjs';
import {restoreRecordedPetEquipment} from './recorded-content.mjs';
import {normalizeRestoration,attributes,syncJobIcon,equipment} from './restoration.mjs';
import {official,officialGroups} from './official-data.mjs';
import {officialSign} from './official-rules.mjs';
import {awardExperience} from './progression.mjs';
import {normalizeExperience} from './player-experience.mjs';
import {normalizePetExperience} from './pet-experience.mjs';
import {supplyNpc} from './supply-shops.mjs';
import {memorialNpcs,MEMORIAL_MAP_ID} from './memorial-npcs.mjs';
// Locally authored tutorial. Graphics and blocked tiles come from the v305 client.
export const maps={
  1:{id:1,name:'新手村',spawn:[19,15],npcs:[
    {id:1,type:0,name:'村口守卫',icon:1,x:22,y:14,welcome:'旅人，来接一份委托吧。',talk:'我是村口守卫。村外山道出现了盗匪，请帮忙清理。\n与我交谈可以免费恢复生命和法力。\n右上方的山道引路人可以带你出村。'},
    {id:2,type:3,name:'山道引路人',icon:1,x:25,y:10,talk:'山道就在前方。靠近盗匪会进入回合制战斗，战斗中可攻击、防御或逃跑。',topic:'前往村外山道',target:[10,14,20]},
    {id:3,type:2,name:'装备商人',icon:1,x:24,y:16,talk:'这里提供社区 H5 资料复原的基础剑类装备。售价为本地测试价。青铜剑适合刚出发的旅人。',topic:'查看装备',shop:901},
    {id:4,type:7,name:'技能导师',icon:1,x:24,y:13,talk:'我教授已核验的七职业被动技能。\n本地体验规则：免费学习，最多学习 100 种技能，每个技能最高22级。资料缺失的等级暂不开放。',topic:'学习被动技能',shop:1100}
  ]},
  10:{id:10,name:'村外山道',spawn:[14,20],npcs:[
    {id:1,type:3,name:'回村引路人',icon:1,x:12,y:20,talk:'可以随时回村，找村口守卫休息或交付任务。',topic:'返回新手村',target:[1,24,11]},
    {id:11,type:1,name:'山道盗匪',icon:1,x:18,y:20,group:701,monster:701},
    {id:12,type:1,name:'山道盗匪',icon:1,x:22,y:23,group:702,monster:701},
    {id:13,type:1,name:'盗匪头目',icon:1,x:19,y:28,group:703,monster:702}
  ]}
};
maps[1].npcs.push(
 {id:5,type:3,name:'原版地图入口',icon:1,x:18,y:14,talk:'前方是已恢复的新月古镇。也可以打开世界地图，前往古树林、紫禁城等地图。',topic:'前往新月古镇',target:[5,10,5]},
 {id:6,type:2,name:'装备试用商人',icon:1,x:20,y:16,talk:'这里提供已恢复的 226 件原版道具，免费领取。穿戴仍需达到装备要求。',topic:'领取原版装备',shop:902},
 {id:7,type:7,name:'原版法师导师',icon:1,x:20,y:13,talk:'学习已恢复的法师技能。当前免费学习，尚未采集的后续等级暂不开放。',topic:'学习法师技能',shop:305},
 {id:8,type:7,name:'原版修真导师',icon:1,x:17,y:16,talk:'学习已恢复的修真者技能。当前免费学习，尚未采集的后续等级暂不开放。',topic:'学习修真技能',shop:307}
);
for(const m of official.maps){maps[m.id]={...m,official:true,npcs:m.npcs.map(n=>({...n,type:n.npcType,icon:n.icon1,talk:n.talkDetail,group:n.npcType===1?n.battleID[0]:undefined,monster:n.npcType===1?officialGroups.get(n.battleID[0])?.monsters.find(id=>id>0):undefined,target:n.jumpMapID?.length===1?[n.jumpMapID[0],n.jumpMapGx[0],n.jumpMapGy[0]]:undefined}))};
}
if(maps[19].npcs.some(n=>n.id===supplyNpc.id||(n.x===supplyNpc.x&&n.y===supplyNpc.y)))throw Error('补给商人位置或编号与原版 NPC 冲突。');
maps[19].npcs.push(supplyNpc);
export const monsters={
  701:{id:701,name:'山道盗匪',icon:11,level:1,hp:42,mp:0,speed:20,atkMin:5,atkMax:9,exp:25,coins:30},
  702:{id:702,name:'盗匪头目',icon:11,level:2,hp:50000000,mp:0,speed:28,atkMin:10,atkMax:16,exp:50,coins:60}
};
export const quests={
  9001:{id:9001,name:'初到新手村',desc:'欢迎来到新手村。先和村口守卫熟悉一下这里的情况。\n接下任务后，再次与守卫交谈并交付任务。',waiting:'准备好了就回来找我。',finish:'欢迎加入巡守！接下来请帮我们清理村外山道。',exp:20,coins:50},
  9002:{id:9002,name:'清理山道',previous:9001,monster:701,count:2,desc:'通过山道引路人前往村外山道，击败 2 名山道盗匪。\n靠近怪物会触发战斗。获胜后回村交付任务。',waiting:'请击败 2 名山道盗匪。完成后回到新手村找我。',finish:'山道终于安静了。这是给你的报酬！',exp:60,coins:120},
  9003:{id:9003,name:'山道的头目',previous:9002,monster:702,count:1,desc:'村外山道深处还藏着一名盗匪头目。\n击败他后回来报告。出发前可以找我恢复生命和法力。',waiting:'头目在山道深处，击败他后再回来吧。',finish:'干得漂亮！这条山道的委托已经全部完成。你仍可外出战斗和探索。',exp:100,coins:200}
};
for(const map of Object.values(maps)){
  const data=JSON.parse(fs.readFileSync(new URL(`../data/maps/${map.id}.json`,import.meta.url),'utf8'));
  map.cols=data.mW/data.tW;map.rows=data.mH/data.tH;map.blocks=data.blocks;
}
// 新月繁华之都的纪念 NPC（见 lib/memorial-npcs.mjs）。放在地形加载之后，
// 这样才能真的校验落点可通行，而不是等到玩家走过去才发现站进墙里。
for(const npc of memorialNpcs){
  const scene=maps[MEMORIAL_MAP_ID];
  if(scene.npcs.some(n=>n.id===npc.id))throw Error(`纪念 NPC「${npc.name}」的编号 ${npc.id} 已被占用。`);
  if(scene.npcs.some(n=>n.x===npc.x&&n.y===npc.y))throw Error(`纪念 NPC「${npc.name}」的坐标 (${npc.x},${npc.y}) 已被占用。`);
  if(!walkable(MEMORIAL_MAP_ID,npc.x,npc.y))throw Error(`纪念 NPC「${npc.name}」站在不可通行的格子 (${npc.x},${npc.y}) 上。`);
  scene.npcs.push(npc);
}
export function walkable(mapId,x,y){const m=maps[mapId];return !!m&&Number.isInteger(x)&&Number.isInteger(y)&&x>=0&&y>=0&&x<m.cols&&y<m.rows&&!(m.blocks[y*m.cols+x]&1);}
export function reachable(mapId,fromX,fromY,x,y){
  if(!walkable(mapId,x,y)||!walkable(mapId,fromX,fromY))return false;
  const map=maps[mapId],target=y*map.cols+x,queue=[fromY*map.cols+fromX],seen=new Set(queue);
  for(let i=0;i<queue.length;i++){const p=queue[i];if(p===target)return true;const px=p%map.cols,py=Math.floor(p/map.cols);for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0]]){const nx=px+dx,ny=py+dy,n=ny*map.cols+nx;if(walkable(mapId,nx,ny)&&!seen.has(n)){seen.add(n);queue.push(n);}}}return false;
}
export function npcById(p,id){return maps[p.mapId]?.npcs.find(n=>n.id===id);}
export function battleNpc(p,group,usable){return maps[p.mapId]?.npcs.filter(n=>(n.group===group||n.battleID?.includes(group))&&(!usable||usable(n))).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];}
export function near(p,n,distance=3){return !!n&&Math.hypot(p.x-n.x,p.y-n.y)<=distance;}
export function hpMax(p){return attributes(p).hp;}
export function mpMax(p){return attributes(p).mp;}
// 版本升级改过编号的本地补充道具会在旧存档里留下空壳。典型例子：美容院造型道具在
// 第 26 版用的是 900101+/900201+，那一版它们是可装备的时装；改成原版的「买下即换」
// 号段（40101+/40201+）之后，旧存档里就已经查不到这些定义了。带着它们登录时，
// 背包封包的 itemPacket 会抛「未知道具」直接把进入游戏卡死，所以读档时先清掉。
// 造型本身保存在 role.icon1 的外观位里，丢掉的只是空壳，角色外观不会变。
// 注意两种「不在目录里但合法」的道具不能误删：
//   1. 宠物（走宠物目录，带 pet 字段）；
//   2. 角色导出文件导入的道具（自带 recordedDefinition，发包时不查目录）。
function pruneUnknownItems(p){
  if(!Array.isArray(p.inventory))return;
  const stale=p.inventory.filter(item=>item&&!item.pet&&!item.recordedDefinition&&!equipment.has(item.itemId));
  if(!stale.length)return;
  const staleItems=new Set(stale),staleIds=[...new Set(stale.map(item=>item.itemId))];
  p.inventory=p.inventory.filter(item=>!staleItems.has(item));
  console.warn(`[store] 已清理 ${stale.length} 件当前版本不存在的道具：${staleIds.join('、')}`);
}
export function normalizeRole(p){
  // Legacy and locally generated roles may omit appearance fields. Keep every
  // existing icon (including zero) and fill only absent values with valid models.
  p.icon1??=p.sex===1?'2240667':'2236552';p.icon2??='0';p.icon3??='0';
  // icon1 里也编码着职业位。旧存档或早期转职留下的「job 与 icon1 不一致」在这里一次性修正，
  // 否则选角界面会一直显示转职前的职业。
  syncJobIcon(p);
  normalizeExperience(p);p.hp??=100;p.mp??=100;p.coins??=1000;
  p.quests??={active:{},completed:[]};p.battles??={wins:0,losses:0,kills:{},cooldowns:{}};
  normalizeRestoration(p);pruneUnknownItems(p);for(const item of p.inventory||[])if(item.pet)restoreRecordedPetEquipment(item.pet);normalizePetEquipment(p);
  for(const item of p.inventory||[])if(item.pet)normalizePetExperience(item.pet);
  // v0.1 implicitly used map 1 and some saves do not have a mapId field.
  p.mapId??=1;
  if(!maps[p.mapId]){p.mapId=1;[p.x,p.y]=maps[1].spawn;}
  p.mapName=maps[p.mapId].name;
  p.x??=maps[p.mapId].spawn[0];p.y??=maps[p.mapId].spawn[1];
  if(!walkable(p.mapId,p.x,p.y))[p.x,p.y]=maps[p.mapId].spawn;
  return p;
}
export function availableQuests(p){return Object.values(quests).filter(q=>!p.quests.completed.includes(q.id)&&(!q.previous||p.quests.completed.includes(q.previous)));}
export function questComplete(p,q){const active=p.quests.active[q.id];return !!active&&(!q.monster||(active.kills||0)>=q.count);}
export function npcSign(p,n){
  if(maps[p.mapId]?.official&&!n.local)return officialSign(p,n);
  // 纪念 NPC 之类只聊天的角色不参与任务系统：否则玩家身上只要还挂着可接的任务，
  // 它们头上就会冒出感叹号，点开却是纯文本，很容易被当成坏掉的任务。
  if(n.pureTalk)return 0;
  if(n.type!==0)return 0;
  if(availableQuests(p).some(q=>questComplete(p,q)))return 1;
  if(availableQuests(p).some(q=>!p.quests.active[q.id]))return 3;
  return Object.keys(p.quests.active).length?2:0;
}
export function gain(p,exp,coins){const reward=awardExperience(p,exp,coins);if(reward.levels){p.hp=hpMax(p);p.mp=mpMax(p);}return reward;}
