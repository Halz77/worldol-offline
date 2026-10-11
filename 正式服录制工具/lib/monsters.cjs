const fs=require('node:fs');
const path=require('node:path');
const {atomicJson}=require('./archive.cjs');
const {sceneHeader,scenes}=require('./catalog-bridge.js');
const count=(n,max=4096)=>{if(n<0||n>max)throw Error('Invalid monster block count '+n);return n;};
const skillKey=s=>`${s.id}:${s.level}`;
const taskKey=q=>`${q.connection}:${q.token}:${q.npcId}`;

class MonsterCollection {
  constructor(recorder){
    this.recorder=recorder;this.current=null;this.connection=null;this.done={};this.failed={};
    this.parseErrors=0;this.lastWarning='';
    this.missionBits=null;this.activeMissionIds=null;this.npcRecords=[];
    for(const table of ['monsterDefinitions','monsterSkills','monsterAI','monsterGroups','monsterNpcs','monsterPreviews'])recorder.state[table]=[];
  }
  warn(error,source){this.parseErrors++;this.lastWarning=error.message;this.recorder.warning('怪物资料待解析：'+error.message,source);}
  observe(p){
    if(this.recorder.version!=='305'||p.target!=='main')return;
    const type=p.bytes.readUInt16BE(2),sent=p.method.endsWith('Sent'),connection=`${p.target}:${p.requestId}`;
    if(type===2&&!sent&&p.bytes[4]===0){this.connection=connection;this.current=null;this.missionBits=null;this.activeMissionIds=null;this.npcRecords=[];}
    if(this.connection&&this.connection!==connection)return;
    if(sent){
      if(this.current&&[12501,12503,12504,12508].includes(type)){this.current.inBattle=true;this.recorder.dirty=true;}
      if([14502,14503,14504].includes(type)){this.missionBits=null;this.activeMissionIds=null;this.refreshNpcScope();this.recorder.dirty=true;}
      return;
    }
    if(scenes.includes(type)){
      const source=this.recorder.source(p.bytes,{seq:p.seq,at:p.at,connection});
      try{
        const header=sceneHeader(p.bytes);if(!header)return;
        this.connection=connection;
        const prior=this.current,same=prior&&prior.mapId===header.mapId&&prior.instanceId===header.instanceId&&prior.connection===connection;
        // Invalidate the old scope before attempting any optional scene blocks.
        this.current={...header,connection,npcs:same?prior.npcs:[],inBattle:false,source};
        if(!same||header.flags&1024){this.current.npcs=[];this.npcRecords=[];}
        this.readScene(p.bytes,header,source);
      }catch(error){if(this.current)this.current.npcs=[];this.warn(error,source);}
    }
    if(this.current&&[12501,12503,12504,12508].includes(type)&&p.bytes[4]===0)this.current.inBattle=true;
    if(this.current&&type===12502)this.current.inBattle=false;
    if(scenes.includes(type)||[12501,12502,12503,12504,12508].includes(type))this.recorder.dirty=true;
  }
  readScene(bytes,header,source){
    const {Reader,d,blocks,skipPlayerList}=this.recorder.deps,r=new Reader(bytes);r.take(header.offset);
    const evidence={...source,mapId:header.mapId,instanceId:header.instanceId,origin:'scene-monsters'};
    let npcs;
    for(let bit=0;bit<32;bit++){
      const flag=1<<bit;if(!(header.flags&flag))continue;
      if(flag===2)blocks.skipPlayerDetail(r,d);
      else if(flag===4)this.missionBits=r.getBytes();
      else if(flag===8){this.activeMissionIds=new Set();for(let n=count(r.getByte(),127);n>0;n--){const body=r.getByteArray(),mission=d.Mission.fromBytes(body);body.finish();this.activeMissionIds.add(mission.id);}}
      else if(flag===16)for(let n=count(r.getShort());n>0;n--)blocks.itemInstance(r,d);
      else if(flag===32)for(let n=count(r.getShort());n>0;n--){d.Skill.fromBytes(r);r.getByte();}
      else if(flag===64)skipPlayerList(r);
      else if(flag===256||flag===512){r.getString();r.getString();r.getByte();}
      else if(flag===1024){r.take(3);npcs=[];for(let n=count(r.getByte(),127);n>0;n--)npcs.push(d.Npc.fromBytes(r));}
      else if(flag===2048){const groups=[];for(let n=count(r.getByte(),127);n>0;n--)groups.push(d.Group.fromBytes(r));this.addBundle({groups},evidence);}
      else if(flag===4096){
        const bundle={monsters:[],skills:[],ai:[]},size=count(r.getByte(),127);
        for(let n=size;n>0;n--)bundle.monsters.push(d.Monster.fromBytes(r));
        if(size){for(let n=count(r.getByte(),127);n>0;n--)bundle.skills.push(d.Skill.fromBytes(r));for(let n=count(r.getByte(),127);n>0;n--)bundle.ai.push(d.AI.fromBytes(r,bundle.skills));}
        this.addBundle(bundle,evidence);
      }
      else if(flag===16384){r.getString();r.take(8);}
      else if(flag===32768){r.getInt();r.getString();r.take(10);}
      else if(flag===65536)r.getString();
      else if(flag===1048576){const formation=()=>{r.take(7);r.getString();r.take(15);};for(let n=count(r.getByte(),127);n>0;n--)formation();if(r.getBoolean())formation();}
      else if(flag===4194304){if(r.getBoolean())throw Error('变身场景块尚未核验');}
      else throw Error('场景块 '+flag+' 尚未核验');
    }
    r.finish();
    // Publish a query scope only after validating the complete scene frame.
    if(npcs){
      for(const npc of npcs)this.recorder.put('monsterNpcs',`${header.mapId}:${npc.id}`,{mapId:header.mapId,...npc},evidence);
      this.npcRecords=npcs;
    }
    this.refreshNpcScope();
  }
  refreshNpcScope(){
    if(!this.current)return;
    const {Npc}=this.recorder.deps.d;
    // Visibility only describes the client UI. Query every task NPC actually
    // supplied by this map, including hidden and prerequisite-gated entries.
    // IDs remain scoped to this validated scene and authenticated connection.
    this.current.npcs=this.npcRecords.filter(n=>[Npc.NPC_MISSION,Npc.NPC_POWER].includes(n.npcType)&&n.id>=0&&n.id<=127)
      .map(n=>({id:n.id,name:n.name,available:this.npcAvailable(n)}));
  }
  missionMatches(id,mask){
    if(id<=0)return true;
    const finished=this.missionBits?!!(this.missionBits[Math.floor(id/8)]&(1<<(id%8))):null;
    if((mask&1)&&finished)return true;
    const active=this.activeMissionIds?.has(id);
    if(active){if((mask&6)===6)return true;if(mask&6)return null;}
    if(active===false&&finished===false&&(mask&8))return true;
    if(finished===null&&(mask&1)||active===undefined&&(mask&14))return null;
    return false;
  }
  npcAvailable(npc){
    // Mirrors native checkRelaMissionVisible. Conditions depending on exact
    // unfinished/complete objectives remain unknown instead of being guessed.
    let available=(npc.status&3)===3;const m=npc.missionData;
    if(m){if(m[0]>0&&this.missionMatches(m[0],m[1])===true)available=true;if(m[2]>0&&this.missionMatches(m[2],m[3])!==false)available=false;}
    return available;
  }
  addBundle(bundle,source){
    for(const x of bundle.groups||[])this.recorder.put('monsterGroups',x.groupId,x,source);
    for(const x of bundle.monsters||[])if(x)this.recorder.put('monsterDefinitions',x.id,x,source);
    for(const x of bundle.skills||[])this.recorder.put('monsterSkills',skillKey(x),x,source);
    for(const x of bundle.ai||[])this.recorder.put('monsterAI',x.id,x,source);
  }
  decodeMission(bytes,source,request={},context={}){
    const {Reader,d}=this.recorder.deps,r=new Reader(bytes.subarray(4));
    const npcId=r.getShort(),size=r.getByte();
    if(request.npcId!==undefined&&npcId!==request.npcId)throw Error('NPC response ID mismatch');
    if(size<0){const message='NPC '+npcId+'：'+r.getString();r.finish();if(request.kind==='monster-npc'){const error=Error(message);error.code='NPC_UNAVAILABLE';throw error;}if(request.token)this.failQuery({...request,npcId},message);this.recorder.warning(message,source);return true;}
    const missions=[];for(let n=count(size,127);n>0;n--){const body=r.getByteArray(),m=d.Mission.fromBytes(body);body.finish();missions.push(m);}
    const bundle=d.monsters(r);r.finish();
    const evidence={...source,npcId,mapId:request.mapId??context.mapId,instanceId:request.instanceId,origin:source.origin||'npc-task-read'};
    for(const m of missions)this.recorder.put('missions',m.id,m,evidence);
    this.addBundle(bundle,evidence);
    if(request.token&&request.connection){const key=taskKey({...request,npcId});this.done[key]={at:new Date().toISOString(),missionCount:missions.length};delete this.failed[key];}
    return true;
  }
  scope(){
    if(!this.current)throw Error('尚未读取当前地图，请进入角色地图后再补齐。');
    if(this.current.inBattle)throw Error('当前正在战斗，请结束战斗后再补齐。');
    const {mapId,instanceId,token,connection,npcs}=this.current;
    return {mapId,instanceId,token,connection,npcIds:npcs.map(n=>n.id)};
  }
  tasks(scope){
    if(!this.current)return [];
    const current=this.scope();
    if(scope&&(scope.connection!==current.connection||scope.token!==current.token))throw Error('场景已变化，请重新补齐当前地图。');
    return this.current.npcs.map(n=>({...current,kind:'monster-npc',npcId:n.id,name:n.name||'NPC '+n.id})).filter(q=>!this.done[taskKey(q)]&&!this.failed[taskKey(q)]);
  }
  acceptQuery(q,bytes){
    const current=this.scope();if(current.connection!==q.connection||current.token!==q.token)throw Error('场景已变化，本次结果仅保留原始记录。');
    if(bytes.length<7||bytes.readUInt16BE(0)!==bytes.length||bytes.readUInt16BE(2)!==14501)throw Error('Monster reply envelope mismatch');
    this.decodeMission(bytes,this.recorder.source(bytes,{origin:'monster-collector'}),q,current);this.recorder.dirty=true;
  }
  failQuery(q,message){this.failed[taskKey(q)]={npcId:q.npcId,mapId:q.mapId,name:q.name,message,at:new Date().toISOString()};this.recorder.dirty=true;}
  retry(){this.failed={};this.recorder.dirty=true;}
  coverage(){
    const s=this.recorder.state,defs=new Map(s.monsterDefinitions.map(x=>[x.data.id,x.data])),ai=new Map(s.monsterAI.map(x=>[x.data.id,x.data]));
    const skills=new Set(s.monsterSkills.map(x=>x.key)),ids=new Set([...defs.keys(),...ai.keys()]),names=new Map();
    for(const row of s.monsterGroups)for(const id of row.data.monsters||[])if(id>0)ids.add(id);
    for(const row of s.missions)for(const c of [...(row.data.acceptCondition||[]),...(row.data.submitCondition||[])]){
      if(c.typeName==='CONDITION_KILL_MONSTER'&&Number.isInteger(c.monsterId)&&c.monsterId>0){ids.add(c.monsterId);if(c.name)names.set(c.monsterId,c.name);}
    }
    const rows=[...ids].sort((a,b)=>a-b).map(id=>{
      const base=defs.get(id),brain=ai.get(id),missing=[];
      if(!base)missing.push('基础属性');if(!brain)missing.push('AI（尚未下发）');
      for(const ref of [...(brain?.skill1||[]),...(brain?.skill2||[])])if(ref&&ref.id>0&&!skills.has(skillKey(ref)))missing.push('技能 '+skillKey(ref));
      return {id,name:base?.name||names.get(id)||'怪物 '+id,level:base?.level??null,attributes:!!base,ai:!!brain,missing:[...new Set(missing)],definitionComplete:missing.length===0};
    });
    return {known:rows.length,attributes:defs.size,skills:skills.size,ai:ai.size,complete:rows.filter(r=>r.definitionComplete).length,pending:rows.filter(r=>!r.definitionComplete).length,rows};
  }
  snapshot(){
    const c=this.coverage(),scope=this.current;let remaining=0;try{remaining=this.tasks().length;}catch{}
    const done=scope?scope.npcs.filter(n=>this.done[taskKey({...scope,npcId:n.id})]).length:0;
    return {...c,mapId:scope?.mapId??null,npcs:scope?.npcs.length||0,hiddenNpcs:scope?.npcs.filter(n=>!n.available).length||0,queried:done,remaining,failed:Object.keys(this.failed).length,inBattle:!!scope?.inBattle,parseErrors:this.parseErrors,lastWarning:this.lastWarning};
  }
  save(){
    const s=this.recorder.state,coverage=this.snapshot();
    atomicJson(path.join(this.recorder.folder,'monsters.json'),{schema:'worldol.monsters.v1',clientVersion:305,capture:this.recorder.archive.id,
      scope:'Only received v305 definitions. Complete means base attributes plus AI and its referenced skill definitions; server-only mechanics are not implied.',
      coverage,definitions:s.monsterDefinitions,skills:s.monsterSkills,ai:s.monsterAI,groups:s.monsterGroups,npcs:s.monsterNpcs,activityPreviews:s.monsterPreviews,queryDone:this.done,queryFailed:this.failed});
    const lines=coverage.rows.map(r=>`| ${r.id} | ${r.name.replaceAll('|','/')} | ${r.attributes?'已下发':'待定'} | ${r.ai?'已下发':'待定'} | ${r.missing.join('、')||'已齐：属性、AI、引用技能'} |`);
    fs.writeFileSync(path.join(this.recorder.folder,'怪物资料.md'),'# 本次怪物资料\n\n当前地图：'+(coverage.mapId??'未进入')+'；任务 NPC '+coverage.queried+'/'+coverage.npcs+'；查询失败 '+coverage.failed+'。\n\n基础属性 '+coverage.attributes+'，技能等级 '+coverage.skills+'，AI '+coverage.ai+'；三部分已齐 '+coverage.complete+'，待补 '+coverage.pending+'。\n\n| ID | 怪物 | 基础属性 | AI | 待补项 |\n| --- | --- | --- | --- | --- |\n'+lines.join('\n')+'\n\n仅统计本次服务器实际下发的定义。AI 缺失不能认定没有技能；伤害减免公式、隐藏属性和未开放任务仍待定。原始字段、技能效果、AI 条件及序号/哈希来源保存在 monsters.json。\n');
  }
}
module.exports={MonsterCollection,monsterTaskKey:taskKey};
