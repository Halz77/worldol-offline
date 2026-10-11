import {Writer} from './codec.mjs';
import {encodeWithSchema} from './feature-protobuf.mjs';
import {protobuf} from '../tools/capture-decoders.mjs';
import {homeFeatureData,vipBenefits,towerPreviews} from './home-feature-data.mjs';
import {homeSnapshot,planHomeAction,towerInfo,checkpointOnline} from './home-features.mjs';
import {gainItemsPacket,notifyDaily} from './daily-service.mjs';

const encode=(type,p)=>encodeWithSchema(type,p,homeFeatureData.schemas);
const restore=(p,before)=>{for(const k of Object.keys(p))if(!(k in before))delete p[k];Object.assign(p,before);};
export function flushHomeSession(context,store,now=Date.now()){
 if(!context.role||!Number.isFinite(context.homeOnlineStart))return;
 const before=structuredClone(context.role),start=context.homeOnlineStart;
 try{checkpointOnline(context.role,context,now);store.save();delete context.homeOnlineStart;}catch(e){restore(context.role,before);context.homeOnlineStart=start;throw e;}
}
export function handleHomeFeatures(type,r,context,{store,send,log,now=Date.now()}){
 const p=context.role;if(!p||![90019,90020,30001,30003,30005,13101].includes(type))return false;
 try{
  if(type===90019){if(r.pos!==r.b.length)throw Error('功能查询格式不正确。');send(type,new Writer().byte(0).string(JSON.stringify(homeSnapshot(p,context,now))));return true;}
  if(type===30001){const q=protobuf(r.b.subarray(r.pos),'c2s_ClimbTowerInfo',homeFeatureData.schemas);send(30002,encode('s2c_ClimbTowerInfo',towerInfo(q.modeType||1)));return true;}
  if(type===13101){const id=r.int(),preview=towerPreviews.get(id);if(r.pos!==r.b.length||!preview)throw Error('这层怪物属性尚未采集。');send(type,Buffer.from(preview.bodyBase64,'base64'));return true;}
  if(type===30003||type===30005)throw Error('永泽塔战斗阵容、技能、AI与场景尚未录全，挑战和扫荡待补。已采集的132个关卡可查看怪物属性。');
  if(context.battle)throw Error('请先结束战斗再领取或调整资源。');
  const json=r.string();if(json.length>1024||r.pos!==r.b.length)throw Error('功能操作格式不正确。');
  const request=JSON.parse(json);if(request.role!==p.id)throw Error('角色已切换，请重新打开功能页面。');
  const plan=planHomeAction(p,request,context,now),before=structuredClone(p),oldStart=context.homeOnlineStart;
  try{
   const seconds=homeSnapshot(p,context,now).online.seconds;
   plan.next.homeFeatures.onlineSeconds=seconds;Object.assign(p,plan.next);context.homeOnlineStart=now;store.save();
  }catch(e){restore(p,before);context.homeOnlineStart=oldStart;throw e;}
  if(plan.added.length)send(12100,gainItemsPacket(p,plan.added,plan.currencies));
  const changes=Object.entries(plan.currencies).filter(([,value])=>value);
  if(changes.length&&!plan.added.length){const w=new Writer().byte(changes.length);for(const [key,value] of changes)w.short({gold:11,silver:12,coins:13}[key]).int(value);send(11004,w.short(13).int(0));}
  notifyDaily(p,send);
  // Acknowledge after native inventory and money packets so the UI refreshes
  // the saved values, including its event-driven currency labels.
  send(type,new Writer().byte(0).string(JSON.stringify(homeSnapshot(p,context,now))));
  log('home-feature-action',{role:p.id,action:plan.action,items:plan.items,currencies:plan.currencies});
 }catch(error){
  if(type===90019||type===90020)send(type,new Writer().byte(-1).string(error.message));
  else send(25003,encode('s2c_errorNotice',{errCode:-2,errMsg:error.message}));
  log('home-feature-rejected',{role:p.id,type,error:error.message});
 }
 return true;
}
