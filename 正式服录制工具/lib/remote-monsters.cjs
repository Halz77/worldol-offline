const fs = require('node:fs');
const path = require('node:path');
const {atomicJson} = require('./archive.cjs');

// Audited against v305 BossAttackProxy, TowerProxy and MainProxy. These are
// information/preview messages, not challenge, sweep, reward or map-entry calls.
const REMOTE_PROTOCOLS = [32001,32002,30001,30002,13121,13101];
const replies = {32001:32002,30001:30002,13121:13121,13101:13101};
const roots = [
  {kind:'boss-directory',name:'世界 Boss 目录'},
  {kind:'tower-directory',mode:1,name:'永泽塔普通目录'},
  {kind:'tower-directory',mode:2,name:'永泽塔困难目录'}
];
const remoteKey = q => `${q.kind}:${q.mode||0}:${q.id||0}`;
const validId = id => Number.isInteger(id) && id > 0 && id <= 2147483647;
const modeName = mode => mode === 2 ? '困难' : '普通';
function remoteRequest(q) {
  let type, body;
  if(q.kind==='boss-directory'){type=32001;body=Buffer.alloc(0);}
  else if(q.kind==='tower-directory' && [1,2].includes(q.mode)){type=30001;body=Buffer.from([8,q.mode]);}
  else if(q.kind==='boss-preview' && validId(q.id)){type=13121;body=Buffer.alloc(6);body.writeInt16BE(2);body.writeInt32BE(q.id,2);}
  else if(q.kind==='tower-preview' && validId(q.id) && [1,2].includes(q.mode)){type=13101;body=Buffer.alloc(4);body.writeInt32BE(q.id);}
  else throw Error('Unsupported remote preview');
  const bytes=Buffer.alloc(4+body.length);bytes.writeUInt16BE(bytes.length);bytes.writeUInt16BE(type,2);body.copy(bytes,4);
  return {type,reply:replies[type],hex:bytes.toString('hex')};
}
class RemoteMonsterCollection {
  constructor(recorder){
    this.recorder=recorder;this.done={};this.failed={};this.directories=new Map();this.towerModes=new Map();
    recorder.state.remoteDirectories=[];recorder.state.remotePreviews=[];
  }
  observe(p){
    if(p.target!=='main'||p.method.endsWith('Sent'))return;
    const type=p.bytes.readUInt16BE(2);
    if(type===25003){
      // Retire the same captured business rejection in the passive request
      // index. Never assign an untagged notice when multiple reads are pending.
      try{
        const {protobuf,schemas}=this.recorder.deps,notice=protobuf(p.bytes.subarray(4),'s2c_errorNotice',schemas);
        const prefix=`${p.target}:${p.requestId}:`,pending=[...this.recorder.pending].filter(([key])=>key.startsWith(prefix)&&[32002,30002,13121,13101].includes(Number(key.slice(prefix.length)))).flatMap(([key,rows])=>rows.map(row=>({key,row})));
        if(notice.errCode===-2&&notice.errMsg==='不在活动时间内'&&pending.length===1&&pending[0].key===prefix+'32002')this.recorder.pending.get(pending[0].key).shift();
      }catch{/* Retain unknown notices in the raw recording. */}
      return;
    }
    if(type===5&&p.bytes[4]===253){
      // A failed preview has no normal response. Retire its passive pairing
      // too, otherwise the next tower response would acquire the failed ID.
      try{
        const r=new this.recorder.deps.Reader(p.bytes.subarray(5)),message=r.getString();r.finish();
        const requestType=Number(/消息类型\s*[:：]\s*(\d+)\b/.exec(message)?.[1]);
        if(replies[requestType])this.recorder.pending.get(`${p.target}:${p.requestId}:${replies[requestType]}`)?.shift();
      }catch{/* Unknown errors remain in the raw archive. */}
      return;
    }
    if(type!==2||p.bytes[4]!==0)return;
    for(const key of this.recorder.pending.keys())if(REMOTE_PROTOCOLS.includes(Number(key.split(':').at(-1))))this.recorder.pending.delete(key);
    this.done={};this.failed={};this.directories.clear();this.towerModes.clear();this.recorder.dirty=true;
  }
  decode(type,bytes,source,request={}){
    const {Reader,d,protobuf,schemas}=this.recorder.deps;
    if(type===32002||type===30002){
      const boss=type===32002,page=protobuf(bytes.subarray(4),boss?'s2c_WorldBossInfo':'s2c_ClimbTowerInfo',schemas);
      // The original protobuf default for absent modeType is NORMAL (1).
      const mode=boss?0:(page.modeType??1);
      if(!boss&&(![1,2].includes(mode)||request.mode!==undefined&&request.mode!==mode))throw Error('爬塔目录模式不匹配');
      const rows=boss?(page.bossInfos||[]):(page.infos||[]);
      if(rows.length>4096||rows.some(x=>!validId(x.id))||new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('活动目录编号无效');
      const entries=rows.map(x=>boss?{id:x.id,name:x.name||'Boss '+x.id,reqLevel:x.reqLevel??0,icon:x.icon??0}:
        {id:x.id,name:`永泽塔${modeName(mode)} ${x.rank??x.id} 层`,rank:x.rank??null,level:x.level??null,state:x.state??null,info:x.info||''});
      const q={kind:boss?'boss-directory':'tower-directory',...(boss?{}:{mode})};
      const value={kind:q.kind,mode,entries};
      this.recorder.put('remoteDirectories',remoteKey(q),value,source);this.directories.set(remoteKey(q),value);
      if(!boss&&source.connection)this.towerModes.set(source.connection,mode);
      this.done[remoteKey(q)]={at:new Date().toISOString(),source};delete this.failed[remoteKey(q)];return true;
    }
    if(type!==13121&&type!==13101)return false;
    const r=new Reader(bytes.subarray(4)),activityKind=type===13121?r.getShort():1;
    const id=type===13121?r.getInt():request.id;
    if(type===13121&&request.id!==undefined&&(id!==request.id||activityKind!==(request.activityKind??2)))throw Error('Boss 预览编号不匹配');
    const count=r.getByte();if(count<0||count>127)throw Error('服务器未返回怪物预览');
    const monsters=[];for(let n=0;n<count;n++)monsters.push(d.Monster.fromBytes(r));r.finish();
    const mode=type===13101?(request.mode??this.towerModes.get(source.connection)):undefined;
    const origin=type===13121?'activity-monster-preview':'tower-monster-preview';
    const evidence={...source,origin,activityKind,...(validId(id)?{entryId:id}:{}),...(mode?{mode}:{})};
    this.recorder.monsterCollection.addBundle({monsters},evidence);
    const monsterIds=monsters.filter(Boolean).map(m=>m.id);
    if(type===13121)this.recorder.put('monsterPreviews',`${activityKind}:${id}`,{kind:activityKind,entryId:id,monsterIds},evidence);
    // A tower response does not echo its floor ID. Unpaired passive packets
    // retain their attributes, but cannot be credited to an invented floor.
    const q=type===13121&&activityKind===2?{kind:'boss-preview',id}:
      type===13101&&validId(id)&&[1,2].includes(mode)?{kind:'tower-preview',id,mode}:null;
    if(q){
      this.recorder.put('remotePreviews',remoteKey(q),{...q,monsterIds,empty:!monsterIds.length,previewOnly:true},evidence);
      this.done[remoteKey(q)]={at:new Date().toISOString(),source:evidence,empty:!monsterIds.length};delete this.failed[remoteKey(q)];
    }
    return true;
  }
  tasks(scope='all'){
    if(!['all','tower'].includes(scope))throw Error('Unknown remote collection scope');
    const tasks=[];
    for(const root of roots.filter(root=>scope!=='tower'||root.kind==='tower-directory')){
      const key=remoteKey(root);
      if(!this.done[key]&&!this.failed[key])tasks.push({...root});
      const dir=this.directories.get(key);if(!dir)continue;
      for(const e of dir.entries){
        const q={kind:root.kind==='boss-directory'?'boss-preview':'tower-preview',id:e.id,name:e.name,...(root.mode?{mode:root.mode}:{})};
        if(!this.done[remoteKey(q)]&&!this.failed[remoteKey(q)])tasks.push(q);
      }
    }
    return tasks;
  }
  scope(q){
    const kind=q.kind==='boss-preview'?'boss-directory':'tower-directory',directory=this.directories.get(remoteKey({kind,mode:q.mode}));
    if(!directory)throw Error('活动目录尚未下发');
    return {kind,mode:directory.mode,ids:directory.entries.map(x=>x.id)};
  }
  acceptQuery(q,bytes){
    const req=remoteRequest(q);if(bytes.length<4||bytes.readUInt16BE(0)!==bytes.length||bytes.readUInt16BE(2)!==req.reply)throw Error('Remote reply envelope mismatch');
    this.decode(req.reply,bytes,this.recorder.source(bytes,{origin:'remote-monster-collector'}),q);
    this.recorder.dirty=true;
  }
  failQuery(q,message){this.failed[remoteKey(q)]={request:q,message,at:new Date().toISOString()};this.recorder.dirty=true;}
  retry(){
    this.failed={};for(const [key,value] of Object.entries(this.done))if(value.empty)delete this.done[key];
    for(const [key,dir] of this.directories)if(!dir.entries.length)delete this.done[key];
    this.recorder.dirty=true;
  }
  snapshot(){
    // Login invalidates live query scopes, not the data already saved in this
    // recording. Keep saved coverage visible without reusing old IDs to query.
    const directories=new Map(this.recorder.state.remoteDirectories.map(row=>[row.key,row.data]));
    for(const [key,dir] of this.directories)directories.set(key,dir);
    const previews=new Map(this.recorder.state.remotePreviews.map(row=>[row.key,row.data]));
    const rows=[];
    for(const root of roots){const dir=directories.get(remoteKey(root));for(const e of dir?.entries||[]){
      const q={kind:root.kind==='boss-directory'?'boss-preview':'tower-preview',id:e.id,mode:root.mode};
      const key=remoteKey(q),done=this.done[key]||previews.get(key);rows.push({...q,name:e.name,received:!!done,empty:!!done?.empty,failed:!!this.failed[key]});
    }}
    return {directories:directories.size,liveDirectories:this.directories.size,emptyDirectories:[...directories.values()].filter(d=>!d.entries.length).length,bosses:rows.filter(r=>r.kind==='boss-preview').length,
      normalFloors:rows.filter(r=>r.mode===1).length,hardFloors:rows.filter(r=>r.mode===2).length,
      previews:rows.filter(r=>r.received&&!r.empty).length,known:rows.length,empty:rows.filter(r=>r.empty).length,
      remaining:this.tasks().length,failed:Object.keys(this.failed).length,rows};
  }
  save(){
    const coverage=this.snapshot(),s=this.recorder.state;
    atomicJson(path.join(this.recorder.folder,'remote-monsters.json'),{schema:'worldol.remote-monsters.v1',clientVersion:305,capture:this.recorder.archive.id,
      scope:'Server-returned world Boss and tower directories and base monster previews. No map travel, challenges or rewards. Missing AI and skills remain unknown.',
      coverage,directories:s.remoteDirectories,previews:s.remotePreviews,queryDone:this.done,queryFailed:this.failed});
    const lines=coverage.rows.map(r=>`| ${r.name.replaceAll('|','/').replace(/[\r\n]+/g,' ')} | ${r.id} | ${r.failed?'查询失败，待补':r.empty?'未返回怪物，待补':r.received?'已保存属性预览':'待查询'} |`);
    fs.writeFileSync(path.join(this.recorder.folder,'免跑图怪物资料.md'),`# 免跑图怪物采集\n\n世界 Boss ${coverage.bosses} 个；永泽塔普通 ${coverage.normalFloors} 层、困难 ${coverage.hardFloors} 层。\n\n已有怪物预览 ${coverage.previews}/${coverage.known}；空预览 ${coverage.empty}；查询失败 ${coverage.failed}。\n\n| 活动 | 编号 | 状态 |\n| --- | --- | --- |\n${lines.join('\n')}\n\n目录仅代表当前服务器实际下发范围。预览保存基础属性，不代表完整技能或 AI 已获取；具体缺项见 怪物资料.md，原始属性见 monsters.json。空目录或空预览保留待补，不视为全服已采齐。\n`);
  }
}
module.exports={RemoteMonsterCollection,REMOTE_PROTOCOLS,remoteRequest,remoteKey,replies};
