/**
 * 游戏会话 —— 一条 connection 上的完整协议处理（原 server.mjs 的 wss.on('connection') 主体）。
 *
 * 阶段 1 只做「搬家」：下面的 handleFrame 与原版逐行一致，唯一变化是
 * 回包出口从 `ws.send(frame(...))` 换成 `connection.send(frame(...))`，
 * 以及原先的闭包变量改由 deps 注入。传输方式（WS / 内存）在这里完全不可见。
 *
 * ⚠ 分派链的顺序仍由 lib/protocol-dispatch.mjs 唯一确定，本文件不许重排；
 *   登录前的那几条协议必须排在 context.account 检查之前，参见文件内注释。
 */
import {Writer,Reader,frame,unframe} from './codec.mjs';
import {pushCharacterFeatures} from './character-feature-service.mjs';
import {pushLegionMembers} from './legion-service.mjs';
import {pushNewbieMission} from './newbie-service.mjs';
import {flushHomeSession} from './home-feature-service.mjs';
import {handbookGroups,handbookPowerPacket} from './official-service.mjs';
import {unlockOwnedItems,refreshHandbook} from './handbook.mjs';
import {pushPetEquipmentExperience} from './pet-equipment-service.mjs';
import {pushSpiritInfo} from './spirit-seal-service.mjs';
import {enterWorld,worldData} from './world.mjs';
import {rolePayload,roleListPacket} from './role-list.mjs';
import {identificationPreview} from './catalog-packets.mjs';
import {syncCombatRating} from './combat-rating.mjs';
import {syncFormation} from './formation-data.mjs';
import {ensureDaily,taskSnapshot} from './daily-activity.mjs';
import {notifyDaily,encodeDaily} from './daily-service.mjs';

/**
 * @param connection  lib/transport.mjs 的统一连接接口
 * @param deps        {store,log,P,protoName,dispatchInbound,ERROR_NOTIFY_TYPES,port,sessions,resetTasks,unknown}
 */
export function createGameSession(connection,deps){
 const {store,log,P,protoName,dispatchInbound,ERROR_NOTIFY_TYPES,port,sessions,resetTasks,unknown}=deps;
 const context={account:null};
 log('connect',{path:connection.url});
 function send(type,body=new Writer()){connection.send(frame(type,body));log('send',{type,length:body instanceof Writer?body.done().length:body.length});}

 function handleFrame(data){
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
 }

 function handleClose(){
  try{flushHomeSession(context,store);}catch(error){log('home-session-save-error',{role:context.role?.id,error:String(error)});}
 }

 return {context,send,handleFrame,handleClose};
}
