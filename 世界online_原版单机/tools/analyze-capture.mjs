import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {Reader,decoders,protobufSchemas,protobuf,skipPlayerList} from './capture-decoders.mjs';
import {skipPlayerDetail,itemInstance,readQuestReward,readBattleReward} from './capture-public-blocks.mjs';
import {readVerifiedCapturePrefix} from './capture-prefix.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const capture=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Usage: node tools/analyze-capture.mjs <saved-capture-folder>');
const require=createRequire(import.meta.url);
const {verify}=require(path.join(root,'../正式服录制工具/lib/verify.cjs'));
const snapshot=process.argv.includes('--snapshot')?readVerifiedCapturePrefix(capture):null;
const audit=snapshot?.audit||verify(capture);if(!audit.integrityPassed||!snapshot&&!audit.cleanEnd)throw Error('Capture must be complete and pass integrity verification');
const outArg=process.argv.indexOf('--out');
const out=outArg>=0?path.resolve(process.argv[outArg+1]):path.join(capture,'analysis');fs.mkdirSync(out,{recursive:true});
const json=(name,data)=>fs.writeFileSync(path.join(out,name),JSON.stringify(data,null,2)+'\n');
const rows=snapshot?.rows||fs.readdirSync(path.join(capture,'events')).filter(n=>/^\d+\.ndjson$/.test(n)).sort().flatMap(n=>fs.readFileSync(path.join(capture,'events',n),'utf8').trim().split('\n').map(JSON.parse));
json('source-audit.json',audit);
const session=JSON.parse(fs.readFileSync(path.join(capture,'session.json')));
const read=ref=>fs.readFileSync(path.join(capture,ref.file));
const d=decoders(root);
const pbSource=fs.readFileSync(path.join(root,'analysis/protobuf.decoded.js'),'utf8');
const schemas=protobufSchemas(pbSource),protocols={};
for(const [name,id] of Object.entries(d.module(19).constants))if(/^(CG_|LC_)/.test(name))(protocols[id]??=[]).push(name);
for(const m of pbSource.matchAll(/\(e\[\(n\[([^\]]+)\] = "([A-Z_0-9]+)"\)\] = ([\d.eE+-]+)\)/g))(protocols[Number(m[3])]??=[]).push(m[2]);
const pbProtocol={};
const pbIds=Object.fromEntries(Object.entries(protocols).flatMap(([id,names])=>names.map(n=>[n,Number(id)])));
for(const m of fs.readFileSync(path.join(root,'analysis/modules/0227.js'),'utf8').matchAll(/e\[pb\.EUserProtocol\.([A-Z_0-9]+)\]\s*=\s*pb\.([A-Za-z_0-9]+)/g))pbProtocol[pbIds[m[1]]]=m[2];
const http=rows.filter(r=>r.method==='recorder.httpBody');
const manifestRow=http.find(r=>/\/v\/gd\/\d+\.json(?:\?|$)/.test(r.params.url));
const manifest=manifestRow?JSON.parse(read(manifestRow.params.body)):null;
const reverse={};
function manifestPaths(obj,prefix=''){for(const [key,value] of Object.entries(obj||{})){const original=prefix+key;if(typeof value==='string')(reverse[value]??=[]).push(original);else manifestPaths(value,original+'/');}}
manifestPaths(manifest?.url);
const assets=http.map(row=>{const u=new URL(row.params.url);const m=u.pathname.match(/\/([a-f0-9]{16,32})\.[^/]+$/);return {seq:row.seq,path:u.pathname,originalPaths:m?(reverse[m[1]]||[]):[],mime:row.params.mimeType,status:row.params.status,bytes:row.params.body.bytes,sha256:row.params.body.sha256,blob:row.params.body.file};});
const packets=rows.filter(r=>/^Network.webSocketFrame(Sent|Received)$/.test(r.method)).map(row=>{const ref=row.params.response.payload,b=read(ref);return {seq:row.seq,at:row.receivedAt,connection:`${row.target}:${row.params.requestId}`,direction:row.method.endsWith('Sent')?'sent':'received',opcode:row.params.response.opcode,type:b.readUInt16BE(2),length:b.length,declaredLength:b.readUInt16BE(0),ref,b};});
const histogram={};for(const p of packets){if(p.declaredLength!==p.length)throw Error('Bad frame length '+p.seq);const h=histogram[p.type]??={id:p.type,names:protocols[p.type]||[],sent:0,received:0,bytes:0};h[p.direction]++;h.bytes+=p.length;}
const tables={items:new Map(),catalog:new Map(),skills:new Map(),missions:new Map(),npcs:new Map(),monsters:new Map(),groups:new Map(),ai:new Map(),areas:new Map(),mapList:new Map()};
const checks=[],scenePackets=[],books=[],questEvents=[],battleEvents=[],pending=new Map(),mapContexts=new Map();let currentMap=null;
function publicValue(v){return JSON.parse(JSON.stringify(v));}
function evidence(p){return {capture:path.basename(capture),seq:p.seq,protocol:p.type,sha256:p.ref.sha256,blob:p.ref.file};}
function put(table,key,value,p,extra={}){const data=publicValue(value);const map=tables[table],old=map.get(String(key)),source={...evidence(p),...extra};
  if(!old){map.set(String(key),{...data,sources:[source]});return;}
  old.sources.push(source);const {sources,variants,...prior}=old;if(JSON.stringify(prior)!==JSON.stringify(data)){
    const encoded=JSON.stringify(data);if(!old.variants?.some(v=>JSON.stringify(v.data)===encoded))(old.variants??=[]).push({data,source});
  }
}
function addMonsters(m,p){for(const x of m.groups)put('groups',x.groupId,x,p);for(const x of m.monsters)if(x)put('monsters',x.id,x,p);for(const x of m.skills)put('skills',`${x.id}:${x.level}`,x,p,{origin:'monsterAI'});for(const x of m.ai)put('ai',x.id,x,p);}
function readScene(r,p){const instanceId=r.getInt(),mapId=d.isAllocated(instanceId)?r.getShort():instanceId,x=r.getByte(),y=r.getByte(),flags=r.getInt();currentMap=mapId;mapContexts.set(p.connection,mapId);
  const record={...evidence(p),instanceId,mapId,x,y,flags,blocks:[]};scenePackets.push(record);
  for(let bit=0;bit<32;bit++){const flag=1<<bit;if(!(flags&flag))continue;
    record.blocks.push(flag);
    if(flag===2){record.archetype=skipPlayerDetail(r,d);record.playerDetailOmitted=true;}
    else if(flag===4){r.getBytes();record.questStateOmitted=true;}
    else if(flag===8){for(let n=r.getByte();n>0;n--){const b=r.getByteArray(),q=d.Mission.fromBytes(b);b.finish();put('missions',q.id,q,p,{mapId:q.acceptMapId,npcId:q.acceptNpcId,origin:'active-mission'});}}
    else if(flag===16){record.inventoryDefinitions=[];for(let n=r.getShort();n>0;n--){const row=itemInstance(r,d);if(row.item){put('items',row.item.id,row.item,p,{origin:'bag-definition'});record.inventoryDefinitions.push({itemId:row.item.id,slot:row.slot,quantity:row.quantity});}}}
    else if(flag===32){for(let n=r.getShort();n>0;n--){const s=d.Skill.fromBytes(r);r.getByte();put('skills',`${s.id}:${s.level}`,s,p,{origin:'learned-definition'});}}
    else if(flag===64){record.omittedPlayerCount=skipPlayerList(r);}
    else if(flag===256||flag===512){record.name=r.getString();record.mapInfo=r.getString();record.mapByte=r.getByte();}
    else if(flag===1024){record.npcPrefix=[r.getByte(),r.getByte(),r.getByte()];const count=r.getByte();record.npcCount=count;for(let i=0;i<count;i++){const npc=d.Npc.fromBytes(r);put('npcs',`${mapId}:${npc.id}`,{mapId,...npc},p);}}
    else if(flag===2048){for(let n=r.getByte();n>0;n--){const g=d.Group.fromBytes(r);put('groups',g.groupId,g,p,{mapId});}}
    else if(flag===4096){const count=r.getByte(),m={groups:[],monsters:[],skills:[],ai:[]};for(let n=count;n>0;n--)m.monsters.push(d.Monster.fromBytes(r));if(count>0){for(let n=r.getByte();n>0;n--)m.skills.push(d.Skill.fromBytes(r));for(let n=r.getByte();n>0;n--)m.ai.push(d.AI.fromBytes(r,m.skills));}addMonsters(m,p);}
    else if(flag===16384){r.getString();r.take(8);record.name='公会地图';record.guildStateOmitted=true;}
    else if(flag===32768){r.getInt();r.getString();r.take(4+4+1+1);record.cityOwnerOmitted=true;}
    else if(flag===65536){r.getString();record.noticeOmitted=true;}
    else if(flag===1048576){const formation=()=>{r.take(7);r.getString();r.take(15);};for(let n=r.getByte();n>0;n--)formation();if(r.getBoolean())formation();}
    else if(flag===4194304){if(r.getBoolean())throw Error('Unparsed transformation block');}
    else{record.stoppedAtBlock=flag;record.remaining=r.b.length-r.pos;throw Error(`Scene block ${flag} not yet decoded`);}
  }record.complete=true;
}
const publicCatalogFields=['itemId','name','icon','bagIcon','info','type','grade','fashIcons','effectId','price'];
for(const p of packets){
  currentMap=mapContexts.get(p.connection)??null;
  const r=new Reader(p.b.subarray(4)),queueKey=p.connection+':'+p.type;
  if(p.direction==='sent'){
    if([16051,10522,14001,14502,14503,12501,12502].includes(p.type)){
      let value,extra={};
      if([14502,14503].includes(p.type)){extra.npcId=r.getShort();value=r.getShort();if(p.type===14503)extra.selectedItem=r.getInt();}
      else if(p.type===12502){r.take(18);value=r.getShort()&65535;}
      else value=[14001,12501].includes(p.type)?r.getShort()&65535:r.getInt();
      (pending.get(queueKey)||pending.set(queueKey,[]).get(queueKey)).push({value,seq:p.seq,...extra});
    }continue;
  }
  const check={...evidence(p),payloadBytes:r.b.length};
  try{
    if(p.type===16051){const requested=pending.get(queueKey)?.shift();const item=new d.Item();d.Item.fromBytesAtts2(item,r);const end=r.pos;if(item.type===41&&r.b.length-r.pos===6)r.take(6);r.finish();if(requested&&item.id!==requested.value)throw Error('Item request/response ID mismatch');item.wireBase64=r.b.subarray(0,end).toString('base64');put('items',item.id,item,p,{requestSeq:requested?.seq});}
    else if(p.type===14501){const npcId=r.getShort(),count=r.getByte();if(count<0){check.serverError=r.getString();}else{for(let n=0;n<count;n++){const body=r.getByteArray(),mission=d.Mission.fromBytes(body);body.finish();put('missions',mission.id,mission,p,{npcId,mapId:currentMap});}addMonsters(d.monsters(r),p);}r.finish();check.npcId=npcId;check.missionCount=count;}
    else if(p.type===14001){const shopId=r.getShort(),count=r.getByte();if(count<0)check.serverError=r.getString();else if(count>0){check.skillMax=r.getByte();for(let n=0;n<count;n++){const skill=d.Skill.fromShopBytes(r);skill.maxLevel=r.getByte();put('skills',`${skill.id}:${skill.level}`,skill,p,{shopId,origin:'shop'});}}r.finish();check.shopId=shopId;check.skillCount=count;}
    else if(p.type===32102){const book=protobuf(r.b,pbProtocol[p.type],schemas);for(const entry of book.itemInfos||[]){const item=Object.fromEntries(publicCatalogFields.filter(k=>entry.info?.[k]!==undefined).map(k=>[k,entry.info[k]]));put('catalog',item.itemId,item,p,{group:book.group,type:book.type,sort:entry.sort});}books.push({group:book.group,type:book.type,count:book.itemInfos?.length||0,source:evidence(p)});r.take(r.b.length);}
    else if(p.type===32107){const v=protobuf(r.b,pbProtocol[p.type],schemas);json('handbook-groups.json',v);r.take(r.b.length);}
    else if(p.type===10521){for(let n=r.getByte();n>0;n--){const area={id:r.getByte()&255,name:r.getString(),x:r.getShort(),y:r.getShort(),state:r.getByte()};put('areas',area.id,area,p);}r.finish();}
    else if(p.type===10522){const req=pending.get(queueKey)?.shift(),status=r.getByte();if(status<0)check.serverError=r.getString();else{for(let n=r.getByte();n>0;n--){const map={id:r.getShort(),name:r.getString(),info:r.getString(),state:r.getByte(),isNeedItem:r.getByte()};put('mapList',map.id,map,p,{areaId:req?.value,requestSeq:req?.seq});}}r.finish();}
    else if([2,10503,10506,10510,10523].includes(p.type)){const status=r.getByte();if(status<0)check.serverError=r.getString();else{if(p.type===2)r.take(4+5+9+5+3+5);if(p.type===10523&&r.getByte()===1){r.getShort();r.getInt();}readScene(r,p);}r.finish();}
    else if(p.type===14591){const b=r.getByteArray(),q=d.Mission.fromBytes(b);b.finish();put('missions',q.id,q,p,{mapId:q.acceptMapId,npcId:q.acceptNpcId,origin:'main-mission'});r.finish();}
    else if(p.type===14503){const req=pending.get(queueKey)?.shift(),status=r.getByte();if(status<0)check.serverError=r.getString();else{const reward=readQuestReward(r,d,item=>put('items',item.id,item,p,{origin:'quest-reward'}));r.finish();questEvents.push({...evidence(p),missionId:req?.value,npcId:req?.npcId,selectedItem:req?.selectedItem,mapId:currentMap,...reward});}r.finish();}
    else if(p.type===12502){const req=pending.get(queueKey)?.shift(),reward=readBattleReward(r,d,item=>put('items',item.id,item,p,{origin:'battle-reward'}));r.finish();battleEvents.push({...evidence(p),groupId:req?.value,mapId:currentMap,...reward});}
    else continue;
    check.complete=true;check.consumed=r.pos;
  }catch(e){check.complete=false;check.error=e.message;check.consumed=r.pos;check.remaining=r.b.length-r.pos;}
  checks.push(check);
}
for(const [name,values] of Object.entries(tables))json(name+'.json',[...values.values()]);
json('resources.json',assets);json('protocols.json',Object.values(histogram).sort((a,b)=>a.id-b.id));json('decode-checks.json',checks);json('scene-packets.json',scenePackets);json('handbook-pages.json',books);
json('quest-events.json',questEvents);json('battle-events.json',battleEvents);
const counts=Object.fromEntries(Object.entries(tables).map(([k,v])=>[k,v.size]));
const summary={schema:'worldol.capture.analysis.v1',generatedAt:new Date().toISOString(),captureFolder:capture,sessionStarted:session.startedAt,integrity:{passed:audit.integrityPassed,cleanEnd:audit.cleanEnd,events:audit.events,gaps:audit.captureGaps.length,networkFailures:audit.networkFailures.length,uniqueBytes:audit.verifiedBytes},http:{responses:http.length,bodyBytes:http.reduce((s,r)=>s+r.params.body.bytes,0),uniqueContents:new Set(http.map(r=>r.params.body.sha256)).size,mime:Object.fromEntries([...new Set(http.map(r=>r.params.mimeType))].map(m=>[m,http.filter(r=>r.params.mimeType===m).length])),mappedResponses:assets.filter(a=>a.originalPaths.length).length},websocket:{received:audit.wsReceived,sent:audit.wsSent,headerValid:packets.length,protocolTypes:Object.keys(histogram).length},counts,decoding:{attempted:checks.length,complete:checks.filter(c=>c.complete).length,partialOrFailed:checks.filter(c=>!c.complete)},bookCategories:[...new Set(books.map(b=>`${b.group}:${b.type}`))],sceneMapIds:[...new Set(scenePackets.map(m=>m.mapId))],notes:['Counts refer to data delivered in this session, not the entire server database.','Catalog summaries and detailed item attributes have different coverage.','Authentication, player lists, chat and account-state protobuf messages are excluded from public exports.','Raw journals and blobs are unchanged. Source sequence/hash references are retained.']};
json('summary.json',summary);
console.log(JSON.stringify({out,counts,checks:summary.decoding,bookCategories:summary.bookCategories,sceneMapIds:summary.sceneMapIds,examples:{items:[...tables.items.values()].slice(0,8).map(x=>({id:x.id,name:x.name,level:x.reqLv,atkMin:x.atkMin,atkMax:x.atkMax})),missions:[...tables.missions.values()].slice(0,8).map(x=>({id:x.id,name:x.name})),monsters:[...tables.monsters.values()].slice(0,8).map(x=>({id:x.id,name:x.name,hp:x.hpMax})),skills:[...tables.skills.values()].slice(0,8).map(x=>({id:x.id,name:x.name,level:x.level}))}},null,2));
