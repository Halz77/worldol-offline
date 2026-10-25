import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Writer,Reader,frame,unframe } from './lib/codec.mjs';
import { SaveStore } from './lib/store.mjs';
// 协议号常量：从 analysis/modules/0019.js 解析（以前是这一行末尾的内联正则）。
import { loadProtocolConstants,protocolLookup } from './lib/protocol-constants.mjs';
// 入站分派链：20 个 service 的顺序在那边唯一确定，本文件不再自己排。
import { createInboundDispatcher } from './lib/protocol-dispatch.mjs';
// HTTP 路由表：27 条路由 + 方法门 + 静态兜底都在那边，本文件只负责起服务。
import { createHttpRouter } from './lib/http-routes.mjs';
// 各 service 的 handleX 由 lib/protocol-dispatch.mjs 统一引入；
// 本文件只保留分派链之外还要直接调用的那些 push/工具函数。
import {pushCharacterFeatures} from './lib/character-feature-service.mjs';
import {pushLegionMembers} from './lib/legion-service.mjs';
import {pushNewbieMission} from './lib/newbie-service.mjs';
import {flushHomeSession} from './lib/home-feature-service.mjs';
import {handbookGroups,handbookPowerPacket} from './lib/official-service.mjs';
import {unlockOwnedItems,refreshHandbook} from './lib/handbook.mjs';
import {pushPetEquipmentExperience} from './lib/pet-equipment-service.mjs';
import {pushSpiritInfo} from './lib/spirit-seal-service.mjs';
import { enterWorld,worldData } from './lib/world.mjs';
import {rolePayload,roleListPacket} from './lib/role-list.mjs';
import {identificationPreview} from './lib/catalog-packets.mjs';
import {syncCombatRating} from './lib/combat-rating.mjs';
import {syncFormation} from './lib/formation-data.mjs';
import {ensureDaily,taskSnapshot} from './lib/daily-activity.mjs';
import {notifyDaily,encodeDaily} from './lib/daily-service.mjs';
import {nextTaskResetAt,resetTaskDays} from './lib/task-reset.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const raw=process.env.WORLDOL_RESOURCES || (fs.existsSync(path.join(root,'client/v/gd/305.json'))?path.join(root,'client'):path.resolve(root,'../H5客户端_v305_20260920/files/resgood'));
const port=Number(process.env.WORLDOL_PORT || 8775);
if(!fs.existsSync(path.join(raw,'v/gd/305.json')))throw Error('未找到 v305 原版资源目录：'+raw);
const store=new SaveStore(process.env.WORLDOL_SAVES || path.join(root,'saves'));
const logDir=process.env.WORLDOL_LOGS || path.join(root,'logs');
fs.mkdirSync(logDir,{recursive:true});
const controlToken=randomBytes(24).toString('hex');
let recent=[],requests=0,missing=new Set(),unknown=new Set();
function log(kind,data){const entry={time:new Date().toISOString(),kind,...data};recent.push(entry);if(recent.length>150)recent.shift();const file=path.join(logDir,'session.jsonl');if(fs.existsSync(file)&&fs.statSync(file).size>512*1024)fs.renameSync(file,file+'.previous');fs.appendFileSync(file,JSON.stringify(entry)+'\n');}

// 协议号常量表。定义在 analysis/modules/0019.js，服务端只在这里解析一次。
// 下面所有协议号都用具名常量，日志里的 unsupported 也会带上名字，方便对照原版。
const P=loadProtocolConstants(root);
const protoName=protocolLookup(P);
// 分派链（lib/protocol-dispatch.mjs）里的补推钩子引用的是常量**名字**，
// 建分派器时会校验名字真实存在，缺一个就直接抛错。
const dispatchInbound=createInboundDispatcher(P);
// 这些错误要回一个「状态字节 -1 + 文案」的失败包，客户端才会把提示弹出来。
const ERROR_NOTIFY_TYPES=[P.CG_LOGIN_CREATEACTOR,P.CG_SCENE_GO_MAP,P.CG_SCENE_FINDPATH_MISSION,P.CG_FIGHT_ENTER_LOCALBATTEL,P.CG_FIGHT_RUN_LOCALBATTLE,P.CG_TASK_ACCEPT,P.CG_TASK_DELIVER,P.CG_TASK_ABANDON];

const httpRouter=createHttpRouter({
 root,raw,store,log,controlToken,port,
 stats:()=>({requests,missing:[...missing],unknown:[...unknown],recent}),
 onMissing:pathname=>{missing.add(pathname);log('missing',{path:pathname});},
 onShutdown:()=>{setTimeout(()=>{for(const ws of wss.clients)ws.close(1001,'Local service stopped');server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref();},100);},
});

const taskClients=new Map();let taskResetTimer;
function resetTasks(){
 const changes=resetTaskDays(store);
 for(const change of changes.filter(c=>c.reset)){
  log('daily-tasks-reset',change);
  for(const {context,send}of taskClients.values())if(context.role?.id===change.role){
   context.taskResetPending=change;context.questTeleport=null;context.storyBattle=null;
   try{send(90021,new Writer().string(JSON.stringify(change)));}catch(error){log('daily-reset-notify-error',{role:change.role,error:String(error)});}
  }
 }
 return changes;
}
function scheduleTaskReset(){
 taskResetTimer=setTimeout(()=>{try{resetTasks();}catch(error){log('daily-reset-error',{error:String(error)});}finally{scheduleTaskReset();}},Math.min(60000,Math.max(1,nextTaskResetAt()-Date.now())));
 taskResetTimer.unref();
}
const server=http.createServer(async(req,res)=>{
  requests++;
  res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:${port}; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'`);
  await httpRouter.handle(req,res);
});
const sessions=new Map();
const wss=new WebSocketServer({server,maxPayload:1024*1024,verifyClient:({origin,req})=>!origin || origin===`http://127.0.0.1:${port}` || origin===`http://localhost:${port}`});
wss.on('connection',(ws,request)=>{
  const context={account:null};
  log('connect',{path:request.url});
  function send(type,body=new Writer()){ws.send(frame(type,body));log('send',{type,length:body instanceof Writer?body.done().length:body.length});}
  taskClients.set(ws,{context,send});
  ws.on('message',data=>{
    let type,leaveType=1;
    try{
      const packet=unframe(data);type=packet.type; const r=new Reader(packet.body); const w=new Writer();
      log('receive',{type,length:packet.body.length});
      resetTasks();
      // ── 登录前：这几条不带账号，必须先于 context.account 检查 ──
      if(type===P.LC_CHECKEDITION)return send(type,w.byte(0).byte(0).byte(0).string('').bool(false).long(Date.now()));
      if(type===P.LC_PLAYER_LOGIN){context.account=store.account(r.string());const session=100000+context.account.id;sessions.set(session,context.account.id);return send(type,w.byte(0).long(context.account.id).int(session).string('').int(0));}
      if(type===P.LC_GAME_GET_AREA_AND_LINE || type===P.LC_RE_LOGIN_GET_LINE_LIST)return send(P.LC_GAME_GET_AREA_AND_LINE,w.byte(1).short(1).string('本地世界').byte(context.account?store.roles(context.account).length:0).byte(0).string('单机').string('').bool(false).byte(1).short(1).string('离线存档').string(`ws://127.0.0.1:${port}/game`).string('').string('').byte(0).string('本地'));
      if(type===P.CG_LOGIN_PLAYERCHECK || type===P.CG_LOGIN_ACTORENTER_AGAIN){const id=Number(r.long());const session=r.int();context.account=store.data.accounts.find(a=>a.id===id);if(!context.account || sessions.get(session)!==id)return send(type,w.byte(-1).string('本地会话已失效，请刷新。'));sessions.set(200000+id,id);return send(type,w.byte(0).int(200000+id));}
      if(type===P.CG_SYSTEM_TIME)return send(type,w.long(Date.now()));
      if(type===P.CG_SYSTEM_HEART)return send(type);
      if(!context.account)throw Error('请先进入本地存档。');
      // ── 角色管理 ──
      if(type===P.CG_LOGIN_ACTORLIST)return send(type,roleListPacket(store,context.account));
      if(type===P.CG_LOGIN_DELETEACTOR){
        const id=r.int();if(r.pos!==r.b.length)throw Error('删除角色请求格式有误。');
        const index=store.data.characters.findIndex(role=>role.id===id&&role.accountId===context.account.id);
        if(index<0)throw Error('没有找到这个本地角色。');
        const previousLastRoleId=context.account.lastRoleId,[deleted]=store.data.characters.splice(index,1);
        if(context.account.lastRoleId===id)context.account.lastRoleId=store.roles(context.account)[0]?.id||0;
        try{store.save();}catch(error){store.data.characters.splice(index,0,deleted);context.account.lastRoleId=previousLastRoleId;throw error;}
        send(type,new Writer().short(0));send(P.CG_LOGIN_ACTORLIST,roleListPacket(store,context.account));
        log('role-deleted',{account:context.account.id,role:id,name:deleted.name});return;
      }
      if(type===P.CG_GUIDE_STATUE_RANDOM_NAME){const names=['云间行者','青岚','长风','星河','逐月','远山'];return send(type,w.byte(0).string(names[Math.floor(Math.random()*names.length)]+String(Math.floor(Math.random()*100))));}
      if(type===P.CG_LOGIN_CREATEACTOR){const input={sex:r.byte(),race:r.byte(),job:r.byte(),icon1:r.long().toString(),icon2:r.long().toString(),icon3:r.long().toString(),name:r.string()};const role=store.create(context.account,input);return send(type,rolePayload(w.byte(0),role));}
      if(type===P.CG_LOGIN_ACTORENTER){const id=r.int();const role=store.roles(context.account).find(p=>p.id===id);if(!role)return send(type,w.byte(-1).string('没有找到这个本地角色。'));if(context.role)flushHomeSession(context,store);const previous=structuredClone(role),last=context.account.lastRoleId;try{ensureDaily(role);unlockOwnedItems(role);refreshHandbook(role);context.account.lastRoleId=id;store.save();}catch(error){for(const key of Object.keys(role))if(!(key in previous))delete role[key];Object.assign(role,previous);context.account.lastRoleId=last;throw error;}context.role=role;context.homeOnlineStart=Date.now();context.battle=null;context.rejectedBattle=null;context.taskResetPending=null;pushCharacterFeatures(role,send);pushPetEquipmentExperience(send);pushSpiritInfo(send);send(type,enterWorld(role));pushLegionMembers(role,send,{appearance:false});send(32107,handbookGroups());send(32109,handbookPowerPacket(role));pushNewbieMission(role,send);return;}
      if(type===P.CG_SCENE_WORLDDATA && context.role){pushCharacterFeatures(context.role,send);pushPetEquipmentExperience(send);pushSpiritInfo(send);send(type,w.byte(0).raw(worldData(context.role,true).done()));pushLegionMembers(context.role,send,{appearance:false});if(context.taskResetPending){pushNewbieMission(context.role,send);notifyDaily(context.role,send);send(22106,encodeDaily('s2c_TaskInfo',taskSnapshot(context.role)));context.taskResetPending=null;}return;}
      // Native bag opens its appearance catalogue even for ordinary gear.
      // Native sendProtoAsync consumes the repair status before reading copper.
      if(type===P.CG_BAG_REPAIR&&context.role){r.short();return send(type,w.byte(0).int(context.role.coins));}
      // 修复外观不同步到角色列表（90022 是本地扩展号，原版没有）
      if(type===90022&&context.role){
          const roleId=r.int(),
              icon1=r.long(),
              icon2=r.long(),
              icon3=r.long();

      if(r.pos!==r.b.length || roleId!==context.role.id)
        throw Error('角色外观同步数据无效。');
      context.role.icon1=icon1.toString();
      context.role.icon2=icon2.toString();
      context.role.icon3=icon3.toString();
      store.save();
      send(type,w.byte(0));

      log('appearance-synced',{
        role:roleId,
        icon1:context.role.icon1,
        icon2:context.role.icon2,
        icon3:context.role.icon3
      });return;}

      // Preserve recorded raw range tables; unidentified entries have no guessed stats.
      if(type===P.CG_EQUIP_IDENTIFY_ATTR&&context.role)return send(type,identificationPreview(r.int()));
      // ── 业务分包：顺序由 lib/protocol-dispatch.mjs 唯一确定，见该文件的说明 ──
      if(dispatchInbound(type,r,context,{store,send,log}))return;
      if(type===P.CG_SCENE_GET_OTHER_PLAYER_STATE)return send(type,w.short(0));
      if(type===P.CG_LOGIN_ACTORLEAVE){
        leaveType=r.pos<r.b.length?r.byte():1;
        if(![1,3].includes(leaveType))throw Error('无效的退出类型。');
        flushHomeSession(context,store);
        // Keep the authenticated account while clearing all state belonging to
        // the previous actor. v305 reads logout type first, then result status.
        for(const key of Object.keys(context))if(key!=='account')delete context[key];
        return send(type,w.byte(leaveType).byte(0));
      }
      unknown.add(type);log('unsupported',{type,name:protoName.name(type)});
    }catch(error){log('protocol-error',{type,error:String(error),stack:error.stack});if(type===P.CG_LOGIN_ACTORLEAVE)send(type,new Writer().byte(leaveType).byte(-1).string(error.message));else if(ERROR_NOTIFY_TYPES.includes(type))send(type,new Writer().byte(-1).string(error.message));}
    finally{
      try{syncCombatRating(context,send);}catch(error){log('combat-rating-error',{role:context.role?.id,error:String(error)});}
      // 阵法切换/学习/遗忘后补推 14014，让客户端本地的 formationSkill 跟服务端一致。
      // 客户端的 14012/14013/14015 回调只刷新 formationList，不会自己改 formationSkill；
      // 登录时世界数据也有一份，但这里状态变化时仍要推（重复推同一状态会被 syncFormation 跳过）。
      try{syncFormation(context,send);}catch(error){log('formation-sync-error',{role:context.role?.id,error:String(error)});}
    }
  });
  ws.on('error',e=>log('socket-error',{error:String(e)}));
  ws.on('close',()=>{taskClients.delete(ws);try{flushHomeSession(context,store);}catch(error){log('home-session-save-error',{role:context.role?.id,error:String(error)});}});
});
server.listen(port,'127.0.0.1',()=>{try{resetTasks();fs.writeFileSync(path.join(logDir,'control.json'),JSON.stringify({projectRoot:root,pid:process.pid,port,token:controlToken}));scheduleTaskReset();log('ready',{port,pid:process.pid});console.log(`世界 online 原版单机：http://127.0.0.1:${port}/`);}catch(error){console.error(error);process.exitCode=1;server.close();}});
server.on('close',()=>clearTimeout(taskResetTimer));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
