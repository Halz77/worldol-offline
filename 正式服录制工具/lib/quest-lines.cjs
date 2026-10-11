const fs=require('node:fs');
const path=require('node:path');
const {atomicJson}=require('./archive.cjs');
const positive=id=>Number.isInteger(id)&&id>0;
const cell=value=>String(value??'').replaceAll('|','/').replace(/[\r\n]+/g,' ');
const taskLabel=node=>`${node.name} (${node.id})`;

// Relationships come only from received mission fields and NPC visibility
// references. Numeric proximity and shared series names do not prove order.
function buildQuestLines(state){
  const nodes=new Map(),edges=[],battles=[],objectives=[];
  const groups=new Map((state.monsterGroups||[]).map(row=>[row.data.groupId,row]));
  const monsters=new Map((state.monsterDefinitions||[]).map(row=>[row.data.id,row]));
  const ensure=(id,name)=>{
    if(!positive(id))return null;
    let node=nodes.get(id);
    if(!node){node={id,name:name||'任务 '+id,definitionReceived:false,npcReferences:[],sources:[]};nodes.set(id,node);}
    else if(name&&!node.definitionReceived&&node.name==='任务 '+id)node.name=name;
    return node;
  };
  for(const row of state.missions||[]){
    const m=row.data,node=ensure(m.id,m.name);if(!node)continue;
    Object.assign(node,{name:m.name||node.name,definitionReceived:true,definition:m,sources:row.sources||[],variantCount:row.variants?.length||0});
  }
  for(const row of state.missions||[]){
    const m=row.data;if(!positive(m.id))continue;
    if(positive(m.submitNextMissionID)){
      ensure(m.submitNextMissionID);
      edges.push({from:m.id,to:m.submitNextMissionID,kind:'next',phase:'submit',negated:false,missionId:m.id,sources:row.sources||[]});
    }
    for(const phase of ['accept','submit']){
      for(const [index,c] of (m[phase+'Condition']||[]).entries()){
        if(['CONDITION_MISSION_DONE','CONDITION_MISSION_DOING'].includes(c.typeName)&&positive(c.missionId)){
          ensure(c.missionId,c.name);
          edges.push({from:c.missionId,to:m.id,kind:c.typeName==='CONDITION_MISSION_DONE'?'completed':'active',phase,negated:!!c.not,missionId:m.id,conditionIndex:index,sources:row.sources||[]});
        }
        if(c.typeName==='CONDITION_KILL_MONSTER'&&positive(c.monsterId))objectives.push({missionId:m.id,phase,monsterId:c.monsterId,name:c.name||monsters.get(c.monsterId)?.data.name||'怪物 '+c.monsterId,required:c.required,current:c.current,negated:!!c.not,definitionReceived:monsters.has(c.monsterId),sources:row.sources||[]});
      }
      const groupId=m[phase+'BattleID'];
      if(positive(groupId)){
        const group=groups.get(groupId);
        battles.push({missionId:m.id,phase,groupId,definitionReceived:!!group,monsterIds:group?.data.monsters||[],sources:row.sources||[],groupSources:group?.sources||[]});
      }
    }
  }
  for(const row of state.monsterNpcs||[]){
    const npc=row.data,refs=npc.missionData;
    if(!refs)continue;
    for(const [offset,condition] of [[0,'show'],[2,'hide']]){
      const node=ensure(refs[offset]);if(!node)continue;
      node.npcReferences.push({mapId:npc.mapId,npcId:npc.id,npcName:npc.name||'NPC '+npc.id,condition,stateMask:refs[offset+1],sources:row.sources||[]});
    }
  }
  const sorted=[...nodes.values()].sort((a,b)=>a.id-b.id);
  const missingMissions=sorted.filter(node=>!node.definitionReceived).map(({id,name,npcReferences})=>({id,name,npcReferences}));
  const missingGroups=[...new Set(battles.filter(b=>!b.definitionReceived).map(b=>b.groupId))].sort((a,b)=>a-b);
  const requiredMonsters=new Set(objectives.map(o=>o.monsterId));
  for(const battle of battles)for(const id of battle.monsterIds)if(positive(id))requiredMonsters.add(id);
  const missingMonsters=[...requiredMonsters].filter(id=>!monsters.has(id)).sort((a,b)=>a-b);
  return {schema:'worldol.quest-lines.v1',clientVersion:305,capture:state.capture,
    scope:'Only received mission definitions and explicit references. Unknown nodes stay pending; these relationships do not prove a whole server quest line is complete.',
    coverage:{definitions:sorted.length-missingMissions.length,known:sorted.length,pendingDefinitions:missingMissions.length,relations:edges.length,explicitNext:edges.filter(e=>e.kind==='next').length,battleGroups:new Set(battles.map(b=>b.groupId)).size,missingGroups:missingGroups.length,missingMonsterAttributes:missingMonsters.length},
    nodes:sorted,edges,battles,objectives,missing:{missions:missingMissions,groups:missingGroups,monsterAttributes:missingMonsters}};
}

function renderQuestLines(graph){
  const byId=new Map(graph.nodes.map(node=>[node.id,node])),label=id=>taskLabel(byId.get(id));
  const relation=edge=>edge.kind==='next'?'交付后指定下一任务':`${edge.phase==='accept'?'接取':'交付'}条件：${edge.negated?'不满足“':''}${edge.kind==='completed'?'已完成':'正在进行'}${edge.negated?'”':''}`;
  const c=graph.coverage;
  const lines=['# 本次任务线资料','',`任务定义 ${c.definitions}；已知任务编号 ${c.known}；缺少定义 ${c.pendingDefinitions}；明确关系 ${c.relations}；缺少战斗怪物组 ${c.missingGroups}。`,
    '', '以下只使用原包明确的关系。接取条件、交付条件、正在进行条件和否定条件分别保留；NPC 显隐条件不等于剧情前置，任务编号或同系列名称也不代表先后顺序。',
    '', '## 已收到的任务','', '| ID | 名称 | 接取等级条件 | 系列 | 接取地图/NPC | 交付地图/NPC | 战斗怪物组 |','| --- | --- | --- | --- | --- | --- | --- |'];
  for(const node of graph.nodes.filter(n=>n.definitionReceived)){
    const m=node.definition,encounters=graph.battles.filter(b=>b.missionId===node.id).map(b=>`${b.phase==='accept'?'接取':'交付'} ${b.groupId}${b.definitionReceived?'':'（待补）'}`).join('；');
    const levels=(m.acceptCondition||[]).filter(c=>c.typeName==='CONDITION_LEVEL').map(c=>c.minimum===undefined?'待解析':`${c.not?'低于':'至少'} ${c.minimum} 级`).join('；');
    lines.push(`| ${node.id} | ${cell(node.name)} | ${levels||'未列出'} | ${cell(m.series)} | ${m.acceptMapId??'待补'}/${m.acceptNpcId??'待补'} | ${m.mapId??'待补'}/${m.npcId??'待补'} | ${encounters||'未指定'} |`);
  }
  lines.push('','## 明确的任务关系','','| 来源任务 | 关系 | 目标任务 |','| --- | --- | --- |');
  for(const edge of graph.edges)lines.push(`| ${cell(label(edge.from))} | ${relation(edge)} | ${cell(label(edge.to))} |`);
  if(!graph.edges.length)lines.push('| — | 本次尚未下发任务之间的明确关系 | — |');
  lines.push('','## 待补定义','','| ID | 任务 | NPC 引用地点 |','| --- | --- | --- |');
  for(const node of graph.missing.missions)lines.push(`| ${node.id} | ${cell(node.name)} | ${cell(node.npcReferences.map(n=>`地图 ${n.mapId} / ${n.npcName} (${n.npcId})：${n.condition==='show'?'显示':'隐藏'}条件`).join('；'))||'由任务关系引用，接取地点待补'} |`);
  if(!graph.missing.missions.length)lines.push('| — | 当前已知任务引用均有定义；不能据此确认整条剧情已齐 | — |');
  lines.push('',`缺少怪物组：${graph.missing.groups.join('、')||'当前引用没有缺项'}。`,
    `缺少任务相关怪物基础属性：${graph.missing.monsterAttributes.join('、')||'当前引用没有缺项'}。AI 与技能是否已齐另见 [怪物资料.md](怪物资料.md)。`,
    '', '任务全文、全部条件、奖励预览、怪物目标、触发战斗及每条记录的原包序号/哈希保存在 quest-lines.json。奖励实际结算仍以正常游玩录制的奖励事件为依据。',
    '', '补齐会读取当前地图已经下发的任务 NPC，包含未显示项。当前地图未下发的 NPC、未返回的后续任务继续待补；前往相关地图后可再次补齐。','');
  return lines.join('\n');
}
function saveQuestLines(recorder){
  const graph=buildQuestLines(recorder.state);
  atomicJson(path.join(recorder.folder,'quest-lines.json'),graph);
  fs.writeFileSync(path.join(recorder.folder,'任务线资料.md'),renderQuestLines(graph));
}
module.exports={buildQuestLines,renderQuestLines,saveQuestLines};
