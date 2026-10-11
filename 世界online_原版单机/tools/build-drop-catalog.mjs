import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mapBattleData} from '../lib/official-packets.mjs';
import {official} from '../lib/official-data.mjs';
import {recordedExpansion} from '../lib/recorded-expansion.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const read=p=>JSON.parse(fs.readFileSync(path.resolve(root,p),'utf8'));
const latest=read('analysis/recordings-latest.json');
const audits=read(path.join(latest.output,'captures.json'));
const itemMap=new Map(official.items.map(i=>[i.id,i])),monsterMap=new Map(official.monsters.map(m=>[m.id,m])),mapMap=new Map(official.maps.map(m=>[m.id,m]));
const groups=new Map(official.groups.map(g=>[g.groupId,g]));
const clean=s=>String(s||'').replace(/\/c[\da-fA-F]{6}|\/p/g,'').replace(/[\r\n|]+/g,' ');
const equipment=i=>i&&((i.type>=0&&i.type<=10)||(i.type>=13&&i.type<=24)||(i.type>=34&&i.type<=39));
const materialIds=[1010,1021,1031,1000,1001,1012,1033,1013,1024,1034];
const tasksByItem=new Map();
for(const q of official.missions)for(const c of q.submitCondition||[])if(c.type===7&&!c.not&&c.required>0){const rows=tasksByItem.get(c.itemId)||[];rows.push({missionId:q.id,required:c.required});tasksByItem.set(c.itemId,rows);}
const questOnly=id=>tasksByItem.has(id)&&itemMap.get(id)?.type===25;
const battleEvents=[],questEvents=[],captureList=[];
function ingest(folder,id,audit,snapshot=false){
 const get=name=>read(path.join(folder,name+'.json'));
 const battles=get('battle-events'),quests=get('quest-events');
 battleEvents.push(...battles.map(x=>({...x,capture:id})));questEvents.push(...quests.map(x=>({...x,capture:id})));
 captureList.push({id,snapshot,integrityPassed:audit.integrityPassed,cutoffSeq:audit.cutoffSeq,cutoffAt:audit.cutoffAt,battles:battles.length,questEvents:quests.length});
}
for(const a of audits){if(!a.integrityPassed)throw Error('Capture integrity failed: '+a.id);if(a.skipped)continue;ingest(path.join(latest.output,a.id,'public'),a.id,a);}
const extraIndex=process.argv.indexOf('--additional-analysis');
if(extraIndex>=0){
 const additional=path.resolve(process.argv[extraIndex+1]);
 for(const capture of recordedExpansion.captures){
  const folder=path.join(additional,capture.id),audit=read(path.join(folder,'source-audit.json')),summary=read(path.join(folder,'summary.json'));
  if(!audit.integrityPassed||summary.decoding.partialOrFailed.length)throw Error('Unverified expansion capture '+capture.id);
  ingest(folder,capture.id,audit,!audit.cleanEnd);
 }
}
const prefix='analysis/loot-live-prefix-20260921',prefixAudit=read(prefix+'/source-audit.json');
if(!prefixAudit.integrityPassed)throw Error('Snapshot integrity failed');
ingest(prefix,'2026-09-21T03-25-20-121Z_8d8469',prefixAudit,true);
// Each capture/sequence is one response; identical payloads in distinct battles are valid samples.
const unique=rows=>[...new Map(rows.map(r=>[`${r.capture}:${r.seq}`,r])).values()];
const battles=unique(battleEvents),questReceipts=unique(questEvents),wins=battles.filter(e=>e.result===2);
const observed=new Map();
for(const e of wins){const key=`${e.mapId}:${e.groupId}`;let row=observed.get(key);if(!row){row={key,mapId:e.mapId,groupId:e.groupId,wins:0,itemBattles:0,items:new Map()};observed.set(key,row);}row.wins++;if(e.items?.length)row.itemBattles++;
 const inBattle=new Map();for(const i of e.items||[])inBattle.set(i.itemId,(inBattle.get(i.itemId)||0)+i.quantity);
 for(const [id,quantity] of inBattle){let i=row.items.get(id);if(!i){i={id,name:itemMap.get(id)?.name||`未知道具 ${id}`,battles:0,quantity:0,quantities:[],evidence:[]};row.items.set(id,i);}i.battles++;i.quantity+=quantity;i.quantities.push(quantity);if(i.evidence.length<2)i.evidence.push({capture:e.capture,seq:e.seq,sha256:e.sha256});}
}
const observedRows=[...observed.values()].map(r=>({...r,items:[...r.items.values()].map(i=>({...i,quantityPerDrop:i.quantities.sort((a,b)=>a-b)[Math.floor(i.quantities.length/2)]}))}));
const allGear=official.items.filter(i=>equipment(i)&&i.reqLv>=1&&i.reqLv<=97&&i.grade<=4).map(i=>({id:i.id,name:i.name,level:i.reqLv,grade:i.grade,type:i.type}));
const materialPools=[{min:1,max:29,ids:[1010,1021,1031]},{min:30,max:49,ids:[1012,1033,1000,1001]},{min:50,max:150,ids:[1013,1024,1034,1000,1001]}];
const policy={revision:'level-drops-20260921-1',basis:'单机设定，非官方爆率',rateMultiplier:0.5,rates:{normal:{equipment:0.15,material:0.30,extra:0.10,maxGrade:2},elite:{equipment:0.30,material:0.60,extra:0.10,maxGrade:3},boss:{equipment:0.50,material:1,extra:0.10,maxGrade:4}},taskChance:1,taskQuantity:'录到的单次中位数量；没有数量样本时为1；不超过当前任务缺口',gearLookback:20,materialPools,note:'装备、材料和额外掉落概率统一乘以0.5；任务物品保底不受影响。按怪物等级；不按角色等级。等级缺档时取不高于怪物等级的最近已录装备。各项独立判定；每项最多1件。录制频次只作证据，不能解释为官方概率。'};
const dropGroups=[];
const sceneGroups=new Map(official.maps.map(m=>[m.id,new Set(mapBattleData(m.id).groups.map(g=>g.groupId))]));
for(const g of official.groups){const ms=g.monsters.filter(Boolean).map(id=>monsterMap.get(id)).filter(Boolean);if(!ms.length)continue;
 const maps=[...new Set([...(g.sources||[]).map(s=>s.mapId),...observedRows.filter(r=>r.groupId===g.groupId).map(r=>r.mapId),...official.maps.filter(m=>sceneGroups.get(m.id).has(g.groupId)).map(m=>m.id)].filter(id=>mapMap.has(id)))];
 for(const mapId of maps){const level=Math.max(...ms.map(m=>m.level)),tier=ms.some(m=>m.monstertype>=2)?'boss':ms.some(m=>m.monstertype===1)?'elite':'normal',sample=observedRows.find(r=>r.mapId===mapId&&r.groupId===g.groupId);
  const drops=sample?.items||[];
  const pool=kind=>drops.filter(i=>kind==='equipment'?equipment(itemMap.get(i.id)):kind==='material'?materialIds.includes(i.id):itemMap.get(i.id)?.type===28).map(i=>i.id);
  const taskDrops=drops.filter(i=>questOnly(i.id)).map(i=>({id:i.id,name:i.name,quantity:Math.max(1,i.quantityPerDrop),missions:tasksByItem.get(i.id),basis:'战斗录制',evidence:i.evidence}));
  dropGroups.push({key:`${mapId}:${g.groupId}`,groupId:g.groupId,mapId,map:mapMap.get(mapId).name,name:[...new Set(ms.map(m=>m.name))].join(' / '),level,tier,monsterIds:[...new Set(ms.map(m=>m.id))],observedWins:sample?.wins||0,observedItemBattles:sample?.itemBattles||0,equipment:pool('equipment'),materials:pool('material'),extras:pool('extra'),taskDrops});
 }
}
// An explicit exact monster name in a quest description supplies a source hint,
// not an official drop rate. Restrict this to required quest items, never exchange currencies.
for(const q of official.missions){const description=clean(q.desc);for(const c of q.submitCondition||[]){if(c.type!==7||c.not||!questOnly(c.itemId))continue;if(dropGroups.some(g=>g.taskDrops.some(d=>d.id===c.itemId&&d.missions.some(m=>m.missionId===q.id))))continue;
 const explicit=official.monsters.filter(m=>m.name.length>=2&&description.includes(m.name));
 // Avoid partial-name collisions such as a generic wolf name inside another monster name.
 const matched=explicit.filter(m=>!explicit.some(other=>other.name!==m.name&&other.name.includes(m.name)));
 const radar=q.radarMapID||q.radarMapId;
 for(const g of dropGroups.filter(g=>(!radar||g.mapId===radar)&&g.monsterIds.some(id=>matched.some(m=>m.id===id)))){let d=g.taskDrops.find(d=>d.id===c.itemId);if(!d){d={id:c.itemId,name:itemMap.get(c.itemId).name,quantity:1,missions:[],basis:'任务描述中的怪物全名推定',evidence:[]};g.taskDrops.push(d);}if(!d.missions.some(m=>m.missionId===q.id))d.missions.push({missionId:q.id,required:c.required});}
}}
const questReceiptsById=new Map();for(const e of questReceipts){const rows=questReceiptsById.get(e.missionId)||[];rows.push(e);questReceiptsById.set(e.missionId,rows);}
const tasks=official.missions.map(q=>{
 const explicit=Math.max(q.level||0,...(q.acceptCondition||[]).filter(c=>c.type===1&&!c.not).map(c=>c.minimum||0));
 const targetLevels=(q.submitCondition||[]).filter(c=>c.type===2).map(c=>monsterMap.get(c.monsterId)?.level||0);
 const sources=dropGroups.filter(g=>g.taskDrops.some(d=>d.missions.some(m=>m.missionId===q.id)));
 const inferred=Math.max(0,...targetLevels,...sources.map(g=>g.level));
 const reward=rows=>(rows||[]).map(i=>({id:i.id,name:i.name||itemMap.get(i.id)?.name||String(i.id),quantity:i.quantity,available:itemMap.has(i.id)}));
 return {id:q.id,name:q.name,level:explicit||inferred||null,levelBasis:explicit?'录制任务等级/原接取等级':inferred?'目标怪物等级推定':'未录到等级',map:mapMap.get(q.mapId)?.name||mapMap.get(q.acceptMapId)?.name||'',exp:q.exp||0,silver:q.money2||0,coins:q.money3||0,rewardItems:reward(q.rewardItems),selectItems:reward(q.selectItems),requirements:(q.submitCondition||[]).filter(c=>c.type===7&&!c.not).map(c=>({id:c.itemId,name:c.name,quantity:c.required,available:itemMap.has(c.itemId),sources:sources.filter(g=>g.taskDrops.some(d=>d.id===c.itemId&&d.missions.some(m=>m.missionId===q.id))).map(g=>({key:g.key,name:g.name,map:g.map,level:g.level,basis:g.taskDrops.find(d=>d.id===c.itemId).basis}))})),receiptCount:questReceiptsById.get(q.id)?.length||0};
}).sort((a,b)=>(a.level??999)-(b.level??999)||a.id-b.id);
const bands=[[1,14],[15,29],[30,49],[50,69],[70,89],[90,97]].map(([min,max])=>({min,max,name:`${min}–${max}级`,tasks:tasks.filter(q=>q.level>=min&&q.level<=max).length,groups:dropGroups.filter(g=>g.level>=min&&g.level<=max).length,equipment:allGear.filter(i=>i.level>=min&&i.level<=max).map(i=>i.id),materials:materialPools.filter(p=>min<=p.max&&max>=p.min).flatMap(p=>p.ids)}));
const missingRewardIds=[...new Set(tasks.flatMap(q=>[...q.rewardItems,...q.selectItems]).filter(r=>!r.available).map(r=>r.id))];
const knownTaskReqs=tasks.flatMap(q=>q.requirements.filter(r=>questOnly(r.id)).map(r=>({...r,missionId:q.id})));
const summary={savedCaptures:new Set([...audits.map(a=>a.id),...(extraIndex>=0?recordedExpansion.captures.map(c=>c.id):[])]).size,validSavedCaptures:new Set(captureList.filter(c=>!c.snapshot).map(c=>c.id)).size,snapshots:captureList.filter(c=>c.snapshot).length,battleEvents:battles.length,wins:wins.length,itemBattles:wins.filter(e=>e.items?.length).length,uniqueObservedItems:new Set(wins.flatMap(e=>(e.items||[]).map(i=>i.itemId))).size,questEvents:questReceipts.length,questItemReceipts:questReceipts.filter(e=>e.items?.length).length,tasks:tasks.length,rankedTasks:tasks.filter(q=>q.level).length,dropGroups:dropGroups.length,observedGroups:observedRows.length,taskItemRequirements:knownTaskReqs.length,resolvedTaskItemRequirements:knownTaskReqs.filter(r=>r.sources.length).length,missingRewardIds};
const web=read('data/drop-web-references.json');
const catalog={revision:policy.revision,generatedAt:new Date().toISOString(),summary,captures:captureList,policy,bands,gear:allGear,materials:materialIds.map(id=>({id,name:itemMap.get(id).name})),groups:dropGroups.sort((a,b)=>a.level-b.level||a.groupId-b.groupId||a.mapId-b.mapId),observed:observedRows,tasks,web};
fs.writeFileSync(path.join(root,'data/drop-catalog.json'),JSON.stringify(catalog,null,2)+'\n');
const itemText=rows=>rows.map(i=>`${clean(i.name)} [${i.id}] ×${i.quantity}${i.available===false?'（缺定义，不发放）':''}`).join('、')||'无';
const lines=['# 世界OL：任务、装备与材料掉落（按等级）','',`生成时间：${catalog.generatedAt}。分析全部 ${summary.savedCaptures} 份保存记录（${summary.validSavedCaptures} 份有游戏数据），以及最新录制的完整校验片段。最新片段截止 ${prefixAudit.cutoffAt}，序号 ${prefixAudit.cutoffSeq}；未结束录制不宣称完整。`,'',`战斗 ${summary.battleEvents} 次，胜利 ${summary.wins} 次，其中 ${summary.itemBattles} 次返回物品，涉及 ${summary.uniqueObservedItems} 种道具；任务交付响应 ${summary.questEvents} 条，其中 ${summary.questItemReceipts} 条有物品。以上为样本，不是官方概率。`,'','## 单机实现与证据边界','', '- 任务固定奖励、选一奖励、经验及货币保留原录制定义；缺少详情的奖励仍跳过。', '- 战斗物品奖励写入背包与原版结算包；背包满时持久保存待领取，整理背包时自动补发。', '- 收集任务道具只在接取对应任务、且背包和待领取数量仍不足时掉落，按任务缺口截断。', '- 已录物品来源优先；其余来源只按任务描述的怪物全名推定，表中分开标注。兑换货币不伪装成普通怪掉落。', '- 装备按怪物等级选取已存在的道具；坐骑、时装、宠物、充值材料和限时活动奖励不进入通用池。', '- 魔力结晶保留为分解材料，不纳入普通怪掉落。未录到二级碎料和铁块定义，不编造道具。','', '| 怪物类型 | 装备 | 常规材料 | 已录其他掉落 | 装备品质上限 |','|---|---:|---:|---:|---|','| 普通 | 15% | 30% | 10% | 精良 |','| 精英 | 30% | 60% | 10% | 史诗 |','| Boss | 50% | 100% | 10% | 传说 |','','上述概率均为单机设定，各项独立判断，装备/材料每次各最多1件；“其他”仅在该组录到过道具箱等物品时启用。任务收集道具在存在来源时100%推进，使用录制单次中位数量或推定1件，不冒充官方爆率。','', '装备池优先使用该组实际录到的装备；没有样本则在不高于怪物等级的20级范围内选择，若该范围无相应品质装备，则回退到最近已录等级。高等级普通怪可能掉落较低等级装备，这是数据缺档的回退规则。','', '## 等级覆盖','', '| 等级 | 任务 | 地图/怪物组 | 已录装备种类（含传说） | 通用材料 |','|---|---:|---:|---:|---|'];
for(const b of bands)lines.push(`| ${b.name} | ${b.tasks} | ${b.groups} | ${b.equipment.length} | ${[...new Set(b.materials)].map(id=>itemMap.get(id).name).join('、')} |`);
lines.push('',`另有 ${tasks.filter(q=>q.level===null).length} 条任务未确定等级；${tasks.filter(q=>q.level>97).length} 条任务高于97级。收集类任务物品需求 ${knownTaskReqs.length} 条，已关联怪物来源 ${summary.resolvedTaskItemRequirements} 条，其余在下表标为待录；不把全部兑换任务都当作打怪任务。`,'','## 网络资料核对','');
for(const s of web.sources)lines.push(`- [${s.title}](${s.url})（${s.publishedAt}，${s.kind}）：${s.notes.join('')} ${s.application}`);
lines.push('','## 全部任务奖励（任务等级为排序用途，不增加准入限制）','','| 等级/依据 | 任务 | 经验/金叶/铜币 | 固定奖励 | 选一奖励 | 收集要求及掉落来源 |','|---|---|---|---|---|---|');
for(const q of tasks)lines.push(`| ${q.level??'未定'} / ${q.levelBasis} | ${clean(q.name)} [${q.id}] · ${clean(q.map)} | ${q.exp}/${q.silver}/${q.coins} | ${itemText(q.rewardItems)} | ${itemText(q.selectItems)} | ${q.requirements.map(r=>`${clean(r.name)} [${r.id}] ×${r.quantity}：${r.sources.map(s=>`${clean(s.map)}/${clean(s.name)} ${s.level}级（${s.basis}）`).join('；')||'怪物来源待录，可能为兑换/其他玩法来源'}`).join('；')||'无收集要求'} |`);
lines.push('','## 实录战斗掉落来源（计数不是官方爆率）','','| 等级 | 地图/怪物 | 战斗组 | 胜利样本 | 物品及出现次数 |','|---|---|---|---:|---|');
for(const row of observedRows.sort((a,b)=>(dropGroups.find(g=>g.key===a.key)?.level||0)-(dropGroups.find(g=>g.key===b.key)?.level||0))){const g=dropGroups.find(g=>g.key===row.key);lines.push(`| ${g?.level??'未定'} | ${clean(g?.map||mapMap.get(row.mapId)?.name)}/${clean(g?.name)} | ${row.groupId} | ${row.wins} | ${row.items.map(i=>`${clean(i.name)} [${i.id}]：${i.battles}次，合计${i.quantity}`).join('；')||'未出现物品'} |`);}
lines.push('','## 已录装备池（等级与品质）','','| 需求等级 | 名称 | ID | 品质 |','|---|---|---:|---|');
for(const i of allGear.sort((a,b)=>a.level-b.level||a.grade-b.grade||a.id-b.id))lines.push(`| ${i.level} | ${clean(i.name)} | ${i.id} | ${['普通','优秀','精良','史诗','传说'][i.grade]} |`);
lines.push('','## 复核与重建','','- `data/drop-catalog.json` 保存完整分级目录、来源序号与SHA256、所有任务及概率设定。','- `data/drop-web-references.json` 保存网络来源与使用边界。','- `tools/build-drop-catalog.mjs` 可从已校验分析结果重建；不连接正式服，不回放账号操作。');
fs.writeFileSync(path.join(root,'analysis/任务装备材料掉落-20260921.md'),lines.join('\n')+'\n');
console.log(JSON.stringify(summary,null,2));
