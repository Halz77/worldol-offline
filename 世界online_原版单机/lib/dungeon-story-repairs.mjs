// 单机副本续篇补完引擎（移植自社区 dungeon-story-repairs.mjs，适配本工程）。
//
// 原客户端里有一批"地图几何在、但剧情/任务链被砍"的单机副本；本模块把它们补成可玩续篇：
//   · 恢复残缺地图几何（data/maps/<id>.json + BFS 算可达点）
//   · 给每张恢复地图加"返回"出口（portal）
//   · 复活/补建 NPC（openNpc / addNpc）
//   · 克隆怪物 + AI（copyMonster / copyGroup）
//   · 生成"【单机续篇】"任务链并接原任务尾（makeQuest / fight / link / register）
//
// 适配改造点（与原社区版的区别）：
//   1) 地图几何读取改用本工程 fs.readFileSync(new URL('../data/maps/...'))（原社区用 worldol shim）。
//   2) 复用本工程 lib/codec.mjs 的 Writer/Reader（与社区同构）。
//   3) 副本构建按"依赖守卫"包裹：引用到的原版怪物/组缺失时整段跳过该副本（不注册、不产生半成品），
//      避免缺数据导致 apply 抛错；地图恢复与出口仍保留（可进可出、不卡死）。
//   4) 编号段：任务沿用社区原值后整体平移到 9139–9175 这一 int16 内的空闲段
//      （社区用 9000+，但本工程的 recorded-expansion 数据已占用 9110–9138 会撞；
//       原生任务包把 mission.id 编码成有符号 short，任务号必须 ≤ 32767，故不能平移到 99xxx）；
//      组用 30050+（官方组最大 12002、录制最大 20369，且组号在战斗组 wire 里是无符号 short，
//        30050–30080 < 65535 安全）；怪用 2400–2402 / 30080–30082（怪物号在 wire 里是 int，安全）。
//   5) 可选补数据接口：data/story-repair-monsters.json 若存在，注入缺失原版怪 + AI，6 个降级副本自动激活。

import fs from 'node:fs';
import {Writer, Reader} from './codec.mjs';

export const STORY_REPAIRS_REVISION = 'complete-local-stories-20261013-v1-ported';
export const repairedStoryDungeons = [];

export function applyDungeonStoryRepairs(official) {
  if (official.storyRepairsRevision === STORY_REPAIRS_REVISION) return official;
  injectSupplementalMonsters(official);

  const o = official;
  const source = (mapId, npcId, extra = {}) => [{origin: 'local-dungeon-story-repair', mapId, npcId, ...extra}];
  const quest = id => o.missions.find(q => q.id === id);
  const map = id => o.maps.find(m => m.id === id);
  const geometries = new Map();
  function geometry(id) {
    if (!geometries.has(id)) geometries.set(id, JSON.parse(fs.readFileSync(new URL('../data/maps/' + id + '.json', import.meta.url), 'utf8')));
    return geometries.get(id);
  }
  function point(id, x, y, occupied = false) {
    const g = geometry(id), cols = g.mW / g.tW, rows = g.mH / g.tH;
    const valid = (a, b) => a >= 0 && b >= 0 && a < cols && b < rows && !(g.blocks[b * cols + a] & 1);
    const candidates = [];
    for (let b = 0; b < rows; b++) for (let a = 0; a < cols; a++) if (valid(a, b)) candidates.push([a, b]);
    candidates.sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y) || a[1] - b[1] || a[0] - b[0]);
    const start = map(id)?.spawn || candidates[0], initial = valid(...start) ? start : candidates[0];
    const queue = [initial], seen = new Set([initial.join(":")]);
    for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[0,1],[1,0],[0,-1],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]]) {
      const a = queue[i][0] + dx, b = queue[i][1] + dy, key = a + ":" + b;
      if (valid(a,b) && !seen.has(key)) { seen.add(key); queue.push([a,b]); }
    }
    const result = candidates.find(p => seen.has(p.join(":")) && (!occupied || !map(id)?.npcs.some(n => n.x === p[0] && n.y === p[1])));
    if (!result) throw Error("No reachable story position: " + id);
    return result;
  }
  const restored = [
    [2,"情人节救援",3,37], [6,"姻缘山",10,25], [255,"英雄枷锁",10,25], [410,"地下城救援营地",2,34],
    [836,"辞灶村",10,24], [841,"遗迹中心·巴勒贝克",7,19], [901,"风之森林",27,3], [904,"邪灵神殿",3,23],
    [948,"英灵迷宫·古树回廊",26,19], [950,"英灵迷宫·出口",25,20], [972,"永冻森林深处",9,9],
    [982,"水底秘洞·幻境核心",6,6], [989,"无极深渊第二层",35,34]
  ];
  for (const [id,name,x,y] of restored) {
    if (map(id)) throw Error("Restored story map collision: " + id);
    o.maps.push({id,name,recordedName:name,nameSource:"recorded-neighbor-portal-and-local-continuation",spawn:[x,y],npcs:[],localStoryRepair:true,geometrySource:"original-client-map-" + id});
    map(id).spawn = point(id,x,y);
  }
  function encodeNpc(n) {
    const w = new Writer().byte(n.sign || 0).byte(n.id).byte(n.missionGroupID || 0).byte(n.npcType).long(n.icon1 || "1338").short(0)
      .utf(n.name || "").utf(n.welcome || "").utf(n.talkDetail || "").byte(n.status).byte(n.direction || 0).byte(n.x).byte(n.y).byte(0).byte(0);
    if (n.status & 8) w.short(n.missionData[0]).byte(n.missionData[1]).short(n.missionData[2]).byte(n.missionData[3]);
    if (n.npcType === 1) w.short(n.battleID[0]).byte(n.comeOutTime || 30);
    else if (n.npcType === 3) w.utf(n.topic).short(n.jumpMapID[0]).byte(n.jumpMapGx[0]).byte(n.jumpMapGy[0]);
    return w.done().toString("base64");
  }
  function addNpc(mapId, id, name, x, y, extra = {}) {
    const m = map(mapId);
    if (!m || m.npcs.some(n => n.id === id) || id > 127) throw Error("Story NPC collision: " + mapId + ":" + id);
    [x,y] = point(mapId,x,y,true);
    const n = {mapId,id,name,x,y,sourceGx:x,sourceGy:y,sign:3,missionGroupID:0,npcType:0,icon1:"15068",businessIcon:0,welcome:"",talkDetail:"这里还有需要你协助的委托。完成后请回来报告。",status:3,direction:1,rangeX:0,rangeY:0,localStoryRepair:true,sources:source(mapId,id),...extra};
    n.wireBase64 = encodeNpc(n); m.npcs.push(n); return n;
  }
  function openNpc(mapId,id) {
    const n = map(mapId)?.npcs.find(n => n.id === id);
    if (!n) throw Error("Story NPC missing: " + mapId + ":" + id);
    const b = Buffer.from(n.wireBase64,"base64"), r = new Reader(b); r.take(14);r.utf();r.utf();r.utf();
    const offset = r.pos, status = r.byte() & 255; r.take(5); b[offset] = status | 3;
    if (status & 8) { b.fill(0,r.pos,r.pos+6); n.recordedStoryMissionData ||= n.missionData; n.missionData=[0,0,0,0]; }
    n.status=status|3; n.wireBase64=b.toString("base64");n.localStoryVisibilityRepair=true;return n;
  }
  function portal(from,id,name,to,x,y,nearX,nearY) {
    const landing = point(to,x,y), origin = map(from).spawn;
    // localStoryReturn 标记：这批「返回/前往」出口是续篇补完框架统一加的，需被
    // tests/open-portals.test.mjs 的传送门计数识别（与 captured81 的 localReturnPortal、
    // 玛雅的 localMayaStory 同类）。
    return addNpc(from,id,name,nearX ?? origin[0]+3,nearY ?? origin[1],{npcType:3,icon1:"1338",topic:name,jumpMapID:[to],jumpMapGx:[landing[0]],jumpMapGy:[landing[1]],talkDetail:"可以随时离开，当前任务进度会保留。",localStoryReturn:true});
  }
  const previous = id => ({type:9,typeName:"CONDITION_MISSION_DONE",not:0,missionId:id,name:quest(id)?.name || String(id),rawHex:new Writer().short(id).utf(quest(id)?.name || String(id)).done().toString("hex")});
  const killed = (id,count=1) => { const m=o.monsters.find(m=>m.id===id); if(!m)throw Error("Missing story objective "+id);return {type:2,typeName:"CONDITION_KILL_MONSTER",not:0,monsterId:id,name:m.name,required:count,current:0,rawHex:new Writer().short(id).utf(m.name).byte(count).byte(0).done().toString("hex")}; };
  const have = (id,name,not=0) => ({type:7,typeName:"CONDITION_HAVE_ITEM",not,itemId:id,name,required:1,rawHex:new Writer().int(id).utf(name).byte(1).done().toString("hex")});
  function reward(id,name,bagIcon=29,grade=2) {return {id,name,quantity:1,bagIcon,grade,illusion:[]};}
  function link(id,next) {const q=quest(id);if(!q)throw Error("Missing story predecessor "+id); q.recordedStoryNext ??= q.submitNextMissionID || 0;q.submitNextMissionID=next;q.setting|=1024;}
  function makeQuest({id,name,mapId,npcId=1,fromMap=mapId,fromNpc=npcId,prev,next=0,group=0,targets=[],desc,finish,rewards=[],submit=[],setting=1026,jump=0}) {
    if(quest(id))throw Error("Story mission collision "+id);
    const npc=map(mapId).npcs.find(n=>n.id===npcId);
    if(!npc)throw Error("Story mission NPC missing: map "+mapId+" npc "+npcId);
    const q={id,name,level:0,simpleDesc:desc,desc:"【单机续篇】"+desc,setting,mapId,npcId,radarMapID:mapId,radarGx:npc.x,radarGy:npc.y,
      dialogNotStartNotReady:"请先完成前面的委托。",dialogStartNotFinish:targets.length?"请击败任务指定目标，再回来报告。":"按任务提示调查后，与指定人物交谈。",dialogStartFinish:finish||"道路已安全，我们继续前进。",
      exp:0,money2:0,money3:0,acceptJumpMapID:0,submitJumpMapID:jump,acceptBattleID:group,submitBattleID:0,submitNextMissionID:next,rewardItems:rewards,selectItems:[],
      acceptCondition:prev?[previous(prev)]:[],submitCondition:[...targets.map(t=>killed(...t)),...submit],type:7,series:"单机副本续篇",acceptMapId:fromMap,acceptNpcId:fromNpc,canAccept:1,_isHelp:!!targets.length,
      localStoryRepair:true,sourceKind:"locally-authored-continuation",sources:source(fromMap,fromNpc)};
    if(jump)[q.submitJumpMapGx,q.submitJumpMapGy]=map(jump).spawn;
    o.missions.push(q); if(prev && quest(prev))link(prev,id);return q;
  }
  let nextGroup=30050;
  function copyMonster(id,referenceId,name) {
    if(o.monsters.some(m=>m.id===id))throw Error("Story monster collision "+id);
    const reference=o.monsters.find(m=>m.id===referenceId);if(!reference)throw Error("Story monster template missing "+referenceId);
    const m={...structuredClone(reference),id,name,sources:source(0,0,{referenceMonsterId:referenceId}),localStoryRepair:true,referenceMonsterId:referenceId};
    const reader=new Reader(Buffer.from(reference.wireBase64,"base64"));reader.int();reader.string();
    m.wireBase64=new Writer().int(id).string(name).raw(reader.b.subarray(reader.pos)).done().toString("base64");o.monsters.push(m);
    const ai=o.ai.find(a=>a.id===referenceId);if(ai){const row={...structuredClone(ai),id,sources:m.sources,localStoryRepair:true};const bytes=Buffer.from(ai.wireBase64,"base64");bytes.writeUInt16BE(id,0);row.wireBase64=bytes.toString("base64");o.ai.push(row);}return m;
  }
  function copyGroup(referenceId,missionId,mapId,replacements={},solo=0,forceId=0) {
    const reference=o.groups.find(g=>g.groupId===referenceId)||o.groups.find(g=>!g.localStoryRepair&&g.monsters.includes(referenceId)),id=forceId||nextGroup++;if(!reference||o.groups.some(g=>g.groupId===id))throw Error("Story formation missing/collision "+id+" template "+referenceId);
    const g={...structuredClone(reference),groupId:id,monsters:reference.monsters.map(m=>solo?(m>0?solo:0):(replacements[m]||m)),nextBattleGroupID:0,sources:source(mapId,0,{referenceGroupId:referenceId}),localStoryRepair:true,localMissionChallengeId:missionId,rewardReferenceGroupId:referenceId};
    if(solo){g.monsters.fill(0);g.monsters[Math.min(5,g.monsters.length-1)]=solo;}
    const b=Buffer.from(reference.wireBase64,"base64");b.writeUInt16BE(id,0);b.writeUInt16BE(0,3);for(let i=0;i<g.monsters.length;i++)b.writeUInt16BE(g.monsters[i],10+2*i);g.wireBase64=b.toString("base64");o.groups.push(g);return id;
  }
  function fight(qid,reference,mapId,npcId,targets,desc,name,prev,extra={}) {
    const group=copyGroup(reference,qid,mapId,extra.replacements||{},extra.solo||0,extra.groupId||0);
    const q=makeQuest({id:qid,name,mapId,npcId,prev,group,targets,desc,...extra});
    const guide=map(q.acceptMapId).npcs.find(n=>n.id===q.acceptNpcId),free=Array.from({length:127},(_,i)=>i+1).find(id=>!map(q.acceptMapId).npcs.some(n=>n.id===id));
    addNpc(q.acceptMapId,free,"再次挑战·"+name,guide.x+2,guide.y,{sign:0,npcType:1,icon1:o.monsters.find(m=>m.id===targets[0][0]).icon1,status:10,missionData:[qid,2,qid,5],battleID:[group],comeOutTime:1,talkDetail:"接取任务后可在这里重试，战胜后交付。"});return q;
  }
  function register(id,name,root,terminal,extras=[],finale) {
    const queue=[root,terminal,...extras];
    const nodes=new Set();
    while(queue.length){const id=queue.shift();if(nodes.has(id)||!quest(id))continue;nodes.add(id);const q=quest(id);if(q.submitNextMissionID)queue.push(q.submitNextMissionID);for(const other of o.missions)if(other.acceptCondition?.some(c=>[9,10].includes(c.type)&&!c.not&&c.missionId===id))queue.push(other.id);}
    repairedStoryDungeons.push({id,name,root,terminal,missionIds:[...nodes].sort((a,b)=>a-b),...(finale?{finale}:{}),localStoryRepair:true});
  }

  // 依赖守卫：原版怪物/组/任务必须存在，否则整段跳过该副本（避免缺数据抛错或产生半成品）。
  function depOk(id){
    const mon=o.monsters.some(m=>m.id===id);
    const grp=o.groups.some(g=>g.groupId===id);
    const mission=o.missions.some(q=>q.id===id);
    return mon || grp || mission;
  }
  function depsMet(ids){ return ids.every(depOk); }
  function repair(name,deps,fn){
    if(depsMet(deps)){ fn(); }
    else { const miss=deps.filter(id=>!depOk(id)); console.warn('[dungeon-story-repairs] 跳过「'+name+'」：缺原版怪物/组数据（'+miss.join(',')+'），待补 data/story-repair-monsters.json 后自动激活'); }
  }

  // 全局出口（无论副本是否激活，地图恢复后都保证可离开）。
  portal(2,100,"返回新月古镇广场",14,25,10);portal(6,100,"返回紫禁城",824,20,12);
  portal(255,100,"返回英灵殿",271,27,3);portal(410,100,"返回起源太阳城",906,15,7);
  portal(906,91,"前往地下城救援营地",410,2,34,17,7);
  portal(836,100,"返回新月繁华之都",19,30,14);portal(841,100,"返回贝鲁特",840,18,25);
  portal(901,100,"返回世界之门",900,1,36);portal(901,101,"前往邪灵神殿",904,3,23,4,29);
  portal(904,100,"返回风之森林",901,4,27);portal(904,101,"前往新生的城市",905,10,16,26,4);
  portal(948,100,"返回英灵殿",271,2,3);portal(948,101,"前往迷宫出口",950,25,20,3,4);
  portal(950,100,"返回古树回廊",948,3,4);portal(950,101,"返回英灵殿",271,6,4);
  portal(972,100,"返回圣诞森林",969,38,16);portal(982,100,"返回水底秘洞",980,12,23);
  portal(989,100,"返回深渊第一层",988,36,28);

  // —— 以下每个副本按依赖守卫包裹；缺数据的 6 个（辞灶/太阳城遗迹/无极深渊/地下城小佣兵/世界之门/元旦年兽）自动跳过 ——

  repair("英灵迷宫",[2258,2211,493],()=>{
    openNpc(271,110);addNpc(950,6,"圣贤-拉娜",25,20);
    const trees=[[2400,2258,"古代的大树",948,8,6],[2401,2211,"变异的大树",948,19,16],[2402,493,"破损的大树",950,13,11]];
    for(const [id,ref,name,scene,x,y] of trees){copyMonster(id,ref,name);const g=copyGroup(ref===2258?11649:ref===2211?2211:493,2813,scene,{},id);addNpc(scene,id===2400?20:id===2401?21:20,name,x,y,{npcType:1,icon1:o.monsters.find(m=>m.id===id).icon1,sign:0,status:10,missionData:[2813,2,2813,5],battleID:[g]});}
    makeQuest({id:2816,name:"走出英灵迷宫",mapId:950,npcId:6,prev:2813,desc:"三棵古树的魔力已经散去，向拉娜确认出口，再返回英灵殿。",finish:"你凭自己的力量走出了迷宫。奖励卷可交给奥哈拉的女仆，继续节日的邀请。",jump:271});
    register(63,"英灵迷宫",2813,2816);
  });

  repair("英雄枷锁",[1712,1713,1715],()=>{
    addNpc(255,1,"枷锁守望者",11,24);
    makeQuest({id:9149,name:"远古枷锁的试炼",mapId:255,prev:0,desc:"英雄枷锁保存着英灵留下的武艺。依次迎战剑、斧与城守的幻影，证明自己。"});
    fight(9150,1712,255,1,[[1712,1]],"击败血剑幻影，解除第一道枷锁。","剑之枷锁",9149);
    fight(9151,1713,255,1,[[1713,1]],"击败大斧幻影，解除第二道枷锁。","斧之枷锁",9150);
    fight(9152,1715,255,1,[[1715,1]],"战胜城守幻影后，向守望者报告。","英雄枷锁的解放",9151,{finish:"三道枷锁已解除。英灵认可了你的勇气，这条试炼已经完成。"});register(64,"英雄枷锁",9149,9152);
  });

  repair("辞灶副本",[597,605],()=>{
    addNpc(836,1,"灶村长老",12,23);
    makeQuest({id:9153,name:"辞灶村的求助",mapId:836,desc:"小灰灰带你来到辞灶村。先和长老商量清理村中妖物、平安送灶的办法。"});
    fight(9154,597,836,1,[[81,9]],"击退村中九只变异蝙蝠，守住送灶队伍。","护送灶火",9153);
    fight(9155,605,836,1,[[90,9]],"驱散九只扰乱祭礼的死灵，让村民完成祭礼。","驱散灶村邪气",9154);
    makeQuest({id:9156,name:"辞灶平安",mapId:836,prev:9155,desc:"向长老报告，确认村民与祭礼平安结束。",finish:"祭礼已经完成，村民都平安。请带着我们的谢意返回小灰灰那里。",jump:19});register(95,"辞灶副本",9153,9156);
  });

  repair("圣诞副本",[2862,1891,2524],()=>{
    addNpc(972,1,"驯鹿小弟",9,9);addNpc(972,2,"被困的圣诞老人",28,28);addNpc(972,3,"冰雪精灵王",35,12);
    copyMonster(3244,1891,"冰风鹰身人");
    const iceGroup=copyGroup(2862,3288,972,{3243:3244});
    for(let i=0;i<4;i++)addNpc(972,20+i,"冰风鹰身人",14+i*4,18,{npcType:1,icon1:o.monsters.find(m=>m.id===3244).icon1,sign:0,status:10,missionData:[3288,2,3288,5],battleID:[iceGroup]});
    makeQuest({id:3289,name:"循着铃声前进",mapId:972,npcId:1,prev:3288,desc:"鹰身人的阻拦已被打退，循着雪地里的铃声寻找圣诞老人。"});
    makeQuest({id:3290,name:"雪中的足迹",mapId:972,npcId:2,fromNpc:1,prev:3289,desc:"沿着散落的礼物和足迹前进，找到困在森林深处的圣诞老人。"});
    fight(3291,2862,972,2,[[3243,5]],"击退围住圣诞老人的雪狼。","解救圣诞老人",3290);
    makeQuest({id:3292,name:"失散的礼物",mapId:972,npcId:2,prev:3291,desc:"和圣诞老人清点散落的礼物，确认驯鹿与礼物车的位置。"});
    makeQuest({id:3293,name:"驯鹿的消息",mapId:972,npcId:1,fromNpc:2,prev:3292,desc:"把圣诞老人平安的消息告诉驯鹿小弟。"});
    fight(3294,2862,972,1,[[3243,5]],"清理回程的雪狼，为老人和礼物车开路。","清扫回程道路",3293);
    makeQuest({id:3295,name:"整修礼物车",mapId:972,npcId:2,fromNpc:1,prev:3294,desc:"返回圣诞老人身边，帮忙整修礼物车。"});
    makeQuest({id:3296,name:"重新套好缰绳",mapId:972,npcId:1,fromNpc:2,prev:3295,desc:"通知驯鹿小弟带上礼物车，准备离开永冻森林。"});
    makeQuest({id:3297,name:"离开永冻森林",mapId:969,npcId:5,fromMap:972,fromNpc:1,prev:3296,desc:"从回程入口离开森林，在圣诞老人身边集合。"});openNpc(969,5);openNpc(969,6);
    makeQuest({id:3298,name:"圣诞的约定",mapId:969,npcId:5,prev:3297,desc:"听圣诞老人讲述礼物的约定，确认所有人已安全返回。"});
    makeQuest({id:3299,name:"圣诞礼物",mapId:969,npcId:5,prev:3298,desc:"接受圣诞老人的谢意和大型鞍具，完成救援。",finish:"谢谢你救出了我们。大型鞍具交给驯鹿后，可以继续拜访冰雪精灵王。",rewards:[reward(753,"大型鞍具",29,2)]});
    copyMonster(30080,2524,"冰雪精灵王");
    fight(9157,2524,972,3,[[30080,1]],"驯鹿已经把你送到这里。接受冰雪精灵王的试炼，完成后向她报告。","冰雪精灵王的试炼",3300,{solo:30080});
    makeQuest({id:9158,name:"再次整备大型鞍具",mapId:969,npcId:6,prev:3299,desc:"大型鞍具已用于一次飞行时，可以请驯鹿重新整备一副。背包已有鞍具时无需领取。",setting:1034,submit:[have(753,"大型鞍具",1)],rewards:[reward(753,"大型鞍具") ]});
    link(3299,3300);register(76,"圣诞副本",3284,3299,[3300,9157,9158],[3299,9157]);
  });

  repair("九歌端午与水底秘洞",[2804],()=>{
    addNpc(982,0,"蜀山师傅",6,6);addNpc(982,1,"幻境石碑",25,18);
    quest(1210).recordedStoryDescription=quest(1210).desc;
    quest(1210).desc+="\n三处分支的施法蛟龙需要分别击败。蛟龙各有不同的免疫状态：物理免疫的目标请用魔法，魔法免疫的目标请用物理攻击。最后进入幻境核心寻找师傅。";
    makeQuest({id:1211,name:"破解水底幻境",mapId:982,npcId:0,prev:1210,desc:"三只施法蛟龙已经被击败，向师傅学习如何破除最后的幻境结界。"});
    makeQuest({id:9159,name:"幻境的阵眼",mapId:982,npcId:1,fromNpc:0,prev:1211,desc:"查看幻境深处石碑上的阵纹，找到蛟龙留下的邪气。"});
    fight(9160,2804,982,1,[[3320,1]],"守住阵眼的蛟龙幻影具有物理免疫，请用魔法击败它，让幻境停止变化。","斩断蛟龙幻术",9159);
    makeQuest({id:9161,name:"幻境散去",mapId:982,npcId:0,fromNpc:1,prev:9160,desc:"向蜀山师傅报告，确认水底秘洞的幻觉已经解除。"});
    makeQuest({id:9162,name:"九歌镇的平安",mapId:954,npcId:1,fromMap:982,fromNpc:0,prev:9161,desc:"返回九歌镇告诉镇长，水底蛟龙与幻境的威胁已经解除。",finish:"镇上的水患终于能够平息了。谢谢你和蜀山师傅守住九歌镇。"});openNpc(954,1);register(77,"九歌端午与水底秘洞",886,9162,[1200,1201,1202,1203,1204,1205,1218,1206,1207,1208,1209,1210,1211,9159,9160,9161,9162]);
  });

  repair("太阳城遗迹·考古救援",[4055],()=>{
    addNpc(841,2,"旧城主-奥古斯",8,21);addNpc(841,3,"考古学者-雅克尔",24,9);
    makeQuest({id:1325,name:"失踪者的线索",mapId:841,npcId:2,prev:1324,desc:"调查遗迹中心的石像与营地，寻找考古学者雅克尔。"});
    fight(9163,4055,841,2,[[3358,1]],"击败活动的诅咒魔像，打开进入旧营地的道路。","诅咒的阻拦",1325);
    makeQuest({id:9164,name:"找到雅克尔",mapId:841,npcId:3,fromNpc:2,prev:9163,desc:"前往遗迹中心的旧营地，确认雅克尔仍然平安。"});
    fight(9165,4055,841,3,[[3358,1]],"击退追来的诅咒魔像，护送雅克尔离开遗迹中心。","守护考古队",9164);
    makeQuest({id:9166,name:"遗迹救援完成",mapId:260,npcId:11,fromMap:841,fromNpc:3,prev:9165,desc:"回太阳城向遗迹负责人报告，确认雅克尔和队员都已安全撤离。",finish:"救援已经完成，遗迹中的危险也已查明。谢谢你没有放弃失踪的伙伴。"});openNpc(260,11);register(88,"太阳城遗迹·考古救援",1318,9166);
  });

  repair("无极深渊",[4019,4020,4022],()=>{
    addNpc(989,1,"深渊守卫队长",35,34);
    makeQuest({id:9167,name:"深渊第二层的接应",mapId:989,prev:1407,desc:"与深渊第二层的守卫队长汇合，确认幸存守卫的位置。"});
    fight(9168,4019,989,1,[[4062,1]],"击退第二层入口的重零，为守卫建立撤退路线。","建立深渊据点",9167);
    fight(9169,4020,989,1,[[4063,1]],"击败占据通道的霸零，救出被围困的守卫。","救出深渊守卫",9168);
    fight(9170,4022,989,1,[[4066,5]],"战胜第二层的邪恶五败部队，解除它们对通道的封锁。","深渊封锁的终结",9169);
    makeQuest({id:9171,name:"守卫者归来",mapId:989,prev:9170,desc:"向队长报告并确认所有幸存守卫撤离，完成这次深渊远征。",finish:"两层通道都已安全，幸存守卫已撤离。本次深渊远征完成。",jump:988});register(87,"无极深渊",1401,9171);
  });

  repair("地下城·小佣兵团的求救",[2694],()=>{
    addNpc(410,80,"小佣兵团团长",2,34);addNpc(410,81,"失散的佣兵队员",27,10);
    makeQuest({id:3311,name:"失散队员的踪迹",mapId:410,npcId:80,prev:3310,desc:"向小佣兵团团长询问队员最后出现的位置。"});
    fight(9172,2694,410,80,[[3269,1]],"打退堵住地下城通道的生化魔人。","地下城的阻击",3311);
    makeQuest({id:9173,name:"找到失散队员",mapId:410,npcId:81,fromNpc:80,prev:9172,desc:"进入地下城营地找到队员，确认他们可以随队撤离。"});
    fight(9174,2694,410,81,[[3269,1]],"击退追兵，守住失散队员撤离的通道。","佣兵团的归途",9173);
    makeQuest({id:9175,name:"小佣兵团获救",mapId:906,npcId:5,fromMap:410,fromNpc:81,prev:9174,desc:"返回太阳城向鲁加报告，确认小佣兵团全员获救。",finish:"所有队员都已平安回来了。这次地下城救援完成。"});register(97,"地下城·小佣兵团的求救",3310,9175);
  });

  repair("情人节副本",[1713,3355],()=>{
    addNpc(2,6,"婚礼使者",3,37);addNpc(2,7,"被困的新娘",25,8);
    makeQuest({id:2792,name:"新娘的线索",mapId:2,npcId:6,prev:2791,desc:"向婚礼使者询问绑匪去向，追踪被带走的新娘。"});
    fight(2793,1713,2,6,[[1713,1]],"战胜挡路的绑匪，找到被困的新娘。","突破婚礼劫匪",2792);
    makeQuest({id:2794,name:"守住幸福",mapId:2,npcId:7,fromNpc:6,prev:2793,desc:"找到新娘，告诉她杰克正在等待。保护她面对劫匪首领。"});
    copyMonster(30081,3355,"情侣去死去死女王");
    fight(2795,4051,2,7,[[30081,1]],"击败绑架新娘的女王，带新娘走出包围。","情侣去死去死女王",2794,{solo:30081});
    makeQuest({id:2796,name:"迟来的婚礼",mapId:14,npcId:121,fromMap:2,fromNpc:7,prev:2795,desc:"返回杰克身边，告诉他新娘已经平安，婚礼可以继续。",finish:"谢谢你让我们重新团聚。新月广场的朋友也准备了一份祝福。"});openNpc(14,50);register(96,"情人节副本",2791,2796,[2797],[2796]);
  });

  repair("世界之门与邪灵神殿",[1501,1502,1503],()=>{
    addNpc(900,90,"世界之门援军向导",22,8);addNpc(901,1,"丛林守卫-水雅",27,4);addNpc(904,1,"神殿前哨",3,23);
    fight(2502,1501,900,90,[[1500,3]],"击退世界之门附近的邪灵教徒，保护撤离的人群。","世界之门的警报",0);
    fight(2503,1502,900,90,[[1501,3]],"清理小恶魔，阻止它们追击人群。","清除小恶魔",2502);
    fight(2504,1503,900,90,[[1501,3]],"击败小恶魔的增援，稳住世界之门的防线。","坚守世界之门",2503);
    makeQuest({id:2505,name:"风之森林的援军",mapId:901,fromMap:900,fromNpc:90,prev:2504,desc:"前往风之森林，与丛林守卫水雅汇合。"});
    fight(2506,1501,901,1,[[1500,3]],"清理森林里的邪灵教徒，找到神殿方向。","森林中的邪灵教徒",2505);
    makeQuest({id:2507,name:"通向邪灵神殿",mapId:904,fromMap:901,fromNpc:1,prev:2506,desc:"沿森林出口进入邪灵神殿，与前哨汇合。"});
    fight(2508,1503,904,1,[[1501,3]],"击退神殿门口的恶魔守卫。","神殿前哨的战斗",2507);
    copyMonster(30082,1501,"邪灵屠夫");
    fight(2509,1503,904,1,[[30082,1]],"击败邪灵屠夫，解除神殿的威胁。","击败邪灵屠夫",2508,{solo:30082,groupId:1507});
    openNpc(905,0);makeQuest({id:2542,name:"新生城市的曙光",mapId:905,npcId:0,fromMap:904,fromNpc:1,prev:2509,desc:"穿过神殿出口，向特攻队长报告世界之门与森林已经安全。",finish:"你守住了通向新生城市的道路。这段旅程已经完成。"});
    register(98,"世界之门与邪灵神殿",2502,2542);
  });

  repair("周年狂欢",[2862,11798,2860,2850,2863,2841],()=>{
    openNpc(457,1);openNpc(457,8);const morning=structuredClone(quest(2862));morning.id=2861;morning.name="晨曦时分的轩姐";morning.desc="【单机续篇】完成不一样的我后，挑战晨曦时分的轩姐。两个时段的挑战在单机中可分别选择。";
    morning.simpleDesc="击败晨曦轩姐，取得晨曦凭证，再向雷斯林接受邀请。";morning.acceptBattleID=11798;morning.submitCondition=[killed(2065,1)];morning.rewardItems=[reward(41145,"十四周年礼品兑换券"),reward(16010,"晨曦",37)];morning.sources=source(457,8);morning.localStoryRepair=true;delete morning.wireBase64;delete morning.deferredRewardItems;o.missions.push(morning);
    addNpc(457,90,"晨曦轩姐·再次挑战",8,8,{npcType:1,sign:0,icon1:o.monsters.find(m=>m.id===2065).icon1,status:10,missionData:[2861,2,2861,5],battleID:[11798]});link(2860,2861);
    quest(2850).desc+="\n在交付本环提示之前，可先去新月古镇找周年祝贺使者（NPC3），完成‘周年祝贺’取得一张BOSS跳过券；交付提示后，这次领取窗口会结束。";
    register(73,"周年狂欢",2841,2863,[2851,2861,2862,2863,2864,2865],[2863,2864]);
  });

  repair("碧莲山·鹊桥",[1900,1924,1917,1918],()=>{
    link(1917,1918);register(78,"碧莲山·鹊桥",1900,1924);
  });

  repair("奥哈拉·彩蛋森林",[1450,1477,1478],()=>{
    register(86,"奥哈拉·彩蛋森林",1450,1477,[1478]);
  });

  repair("元旦年兽副本",[1102,1103],()=>{
    openNpc(98,1);openNpc(98,34);fight(216,1103,98,34,[[3302,5]],"年糕兽兄弟一起出招了。再击退一次，结束孩子们的节日游戏。","年糕兽兄弟的联手",215);
    const nianGroup=copyGroup(1102,212,98);
    for(let i=0;i<2;i++)addNpc(98,90+i,"庆典小年兽",12+i*5,20,{npcType:1,sign:0,icon1:o.monsters.find(m=>m.id===3300).icon1,status:10,missionData:[212,2,212,5],battleID:[nianGroup]});
    makeQuest({id:217,name:"年兽庆典落幕",mapId:98,npcId:2,fromNpc:34,prev:216,desc:"回到老爷爷身边，确认孩子们平安，结束年兽庆典。",finish:"孩子们都平安回来了，年兽庆典圆满结束。"});register(90,"元旦年兽副本",204,217,[218]);
  });

  repair("失魂沙漠·黑鬼盟军",[12,13,164,165,183,25,27,28],()=>{
    const black=quest(28);black.recordedStoryAcceptCondition=structuredClone(black.acceptCondition);black.acceptCondition=[previous(25),{...previous(27),not:1}];delete black.localDesertUnavailableBranch;black.localStoryRepair=true;
    for(const [id,opposite] of [[27,28],[28,27]])quest(id).acceptCondition.push({...previous(opposite),type:10,typeName:"CONDITION_MISSION_DOING",not:1});
    openNpc(823,3);makeQuest({id:33,name:"黑鬼盟军·黑白无常",mapId:823,npcId:3,prev:28,desc:"帮助黑鬼天王击退小阎王麾下的黑白无常。",targets:[[12,1],[13,1]]});
    makeQuest({id:34,name:"黑鬼盟军·夺回兵力",mapId:823,npcId:3,prev:33,desc:"击退小阎王召来的火元素和鹰身人，为黑鬼天王夺回战场。",targets:[[164,5],[165,5]]});
    makeQuest({id:35,name:"黑鬼盟军·挑战小阎王",mapId:823,npcId:3,prev:34,desc:"击败小阎王的部队，结束两位地狱首领之间的争斗。",targets:[[183,1]]});
    makeQuest({id:36,name:"黑鬼天王的承诺",mapId:823,npcId:0,fromNpc:3,prev:35,desc:"向牛鬼报告这次地狱之战已结束，完成黑鬼天王盟军分支。",finish:"这场争斗已经结束，你的选择和战绩会留在地狱的记忆中。"});
    const blackEnding=quest(36),advancedDesertReward=quest(41);
    for(const key of ["exp","money2","money3","rewardItems","selectItems"])blackEnding[key]=structuredClone(advancedDesertReward[key]);
    blackEnding.setting=(blackEnding.setting&~(2|8))|(advancedDesertReward.setting&(2|8));
    blackEnding.advancedRewardReferenceMissionId=41;
    blackEnding.simpleDesc="向牛鬼交付黑鬼阵营高级阶段委托，领取失魂沙漠高级奖励。";
    blackEnding.desc="【单机续篇】黑鬼天王已经履行承诺。向牛鬼报告地狱之战结束，领取本阵营的失魂沙漠高级阶段奖励。两条阵营路线每天共计一次高级领奖。";
    blackEnding.dialogStartFinish="这场争斗已经结束，这是黑鬼阵营的高级阶段奖励。你的选择和战绩会留在地狱的记忆中。";
    register(99,"失魂沙漠·黑鬼盟军",28,36);
  });

  repair("机械城副本",[11740,3457,3458],()=>{
    openNpc(979,16);openNpc(979,18);
    fight(9139,11740,979,18,[[3275,1]],"面对实验室的撼地者，击败它后向利维坦报告。敌军混有物理免疫和魔法免疫的守卫，请准备两种伤害方式。","机械城·撼地者的阻拦",3457,{finish:"撼地者已停止攻击，离开实验室的道路终于打开。"});
    makeQuest({id:9140,name:"机械城·重获自由",mapId:979,npcId:16,fromNpc:18,prev:9139,desc:"与利维坦和同伴汇合，确认大家已能安全离开实验室。",finish:"实验室的两位守护者都已被击败。利维坦重获自由，你们的机械城冒险完成。",jump:960});
    link(3457,9139);link(3458,9139);register(36,"机械城副本",2051,9140,[3458,9139,9140]);
  });

  repair("精灵森林续篇",[747],()=>{
    if(quest(747)&&!quest(969)){const target=map(251).npcs.find(n=>n.npcType===0)||map(251).npcs[0];makeQuest({id:969,name:"精灵森林的祝福",mapId:251,npcId:target.id,fromMap:quest(747).mapId,fromNpc:quest(747).npcId,prev:747,desc:"完成初阶森林委托后，确认精灵森林的道路已经恢复平静。",finish:"初阶森林的冒险已经完成。需要更深入的挑战时，可以前往古树林继续探索。"});openNpc(251,target.id);}
  });

  o.storyRepairsRevision = STORY_REPAIRS_REVISION;
  official.repairedStoryDungeons = repairedStoryDungeons;
  return o;
}

// 可选补数据：data/story-repair-monsters.json 若存在，注入缺失的原版怪 + AI（让 6 个降级副本自动激活）。
function injectSupplementalMonsters(official){
  let data;
  try{ data=JSON.parse(fs.readFileSync(new URL('../data/story-repair-monsters.json',import.meta.url),'utf8')); }catch{ return; }
  const mon=Array.isArray(data.monsters)?data.monsters:[];
  const ai=Array.isArray(data.ai)?data.ai:[];
  for(const m of mon){ if(!official.monsters.some(x=>x.id===m.id)) official.monsters.push(m); }
  for(const a of ai){ if(!official.ai.some(x=>x.id===a.id)) official.ai.push(a); }
  console.log('[dungeon-story-repairs] 已从 data/story-repair-monsters.json 注入 '+mon.length+' 怪物 / '+ai.length+' AI');
}
