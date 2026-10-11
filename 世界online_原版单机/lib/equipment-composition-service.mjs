import {Writer} from './codec.mjs';
import {itemPacket,skillUpdate} from './restoration-packets.mjs';
import {healthUpdate} from './game-packets.mjs';
import {setPacket} from './equipment-sets.mjs';
import {COMPOSITION_LIST,COMPOSITION_APPLY,VIP_APPLY,workshopState,planComposition,planVip} from './equipment-composition.mjs';
const complete=r=>{if(r.pos!==r.b.length)throw Error('装备操作请求长度不正确。');};
function commit(role,next,store){const old={...role};for(const key of Object.keys(role))delete role[key];Object.assign(role,next);try{store.save();}catch(error){for(const key of Object.keys(role))delete role[key];Object.assign(role,old);throw error;}}
export function handleEquipmentComposition(type,r,context,{store,send,log}){
 if(!context.role||![COMPOSITION_LIST,COMPOSITION_APPLY,VIP_APPLY,11501].includes(type))return false;
 const p=context.role;
 try{
   if(type===11501){const count=r.byte()&255,ids=[];for(let i=0;i<count;i++)ids.push(r.byte()&255);complete(r);send(type,setPacket(new Writer(),p,ids));return true;}
   if(type===COMPOSITION_LIST){complete(r);send(type,new Writer().byte(0).string(JSON.stringify(workshopState(p))));return true;}
   if(context.battle)throw Error('请先结束战斗再合成装备或调整VIP。');
   let plan,request;
   if(type===VIP_APPLY){const level=r.byte();complete(r);plan=planVip(p,level);request={level};}
   else {const json=r.string();complete(r);if(json.length>2048)throw Error('合成参数过长。');request=JSON.parse(json);plan=planComposition(p,request);}
   const w=new Writer().byte(0).string(JSON.stringify(workshopState(plan.next))).bool(!!plan.item);if(plan.item)itemPacket(w,plan.item);
   const skill=skillUpdate(new Writer(),plan.next),health=healthUpdate(plan.next);
   commit(p,plan.next,store);send(type,w);send(14011,skill);send(17601,health);
   log(type===VIP_APPLY?'local-vip-changed':'equipment-composed',{role:p.id,...request,free:true});
 }catch(error){send(type,type===11501?new Writer().byte(0):new Writer().byte(-1).string(error.message));log('equipment-composition-rejected',{role:p.id,type,error:error.message});}
 return true;
}
