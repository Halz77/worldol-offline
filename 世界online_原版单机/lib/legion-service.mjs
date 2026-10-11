import {Writer} from './codec.mjs';
import {encodeWithSchema} from './feature-protobuf.mjs';
import {protobuf} from '../tools/capture-decoders.mjs';
import {legionData,legionInfo,legionState,legionRoster,activeLegionMembers,changeLegionFormation,selectLegion} from './legion-state.mjs';
import {legionAppearance} from './legion-packets.mjs';
import {playerDetail} from './world.mjs';
import {bagPacket,skillList} from './restoration-packets.mjs';
import {activePet,petAttributes} from './pet-state.mjs';
import {hpMax,mpMax} from './content.mjs';
import {pushCharacterFeatures} from './character-feature-service.mjs';
export const LEGION_TRAILER=0x4c454731;
export const encodeLegion=(type,data)=>encodeWithSchema(type,data,legionData.schemas);
export const decodeLegion=(type,bytes)=>protobuf(bytes,type,legionData.schemas);
export function legionVitals(p){return {infos:activeLegionMembers(p).map(({role:r})=>{const pet=activePet(r),max=pet?petAttributes(r,pet):null;return {actorId:r.id,hp:r.hp,maxHp:hpMax(r),mp:r.mp,maxMp:mpMax(r),petHp:pet?.hp||0,petMaxHp:max?.hp||0,petMp:pet?.mp||0,petMaxMp:max?.mp||0};})};}
export function pushLegionMembers(p,send,{appearance=true}={}){
 const members=activeLegionMembers(p),w=new Writer().byte(members.length);
 for(const {role} of members){pushCharacterFeatures(role,send);w.int(role.id);playerDetail(w,role,{includeLegion:false});bagPacket(w,role);skillList(w,role);}
 send(10030,w);send(31058,encodeLegion('s2c_LegionActorHp',legionVitals(p)));
 if(appearance)send(15601,legionAppearance(new Writer().int(p.id),p));
}
export function legionSnapshot(p){return {role:p.id,revision:legionData.revision,...legionInfo(p),state:legionState(p),pending:legionData.pending};}
export function handleLegion(type,r,context,{store,send,log}){
 const p=context.role;if(!p||![31051,31053,31055,90017].includes(type))return false;
 if(type===31051){send(31052,encodeLegion('s2c_LegionInfo',legionInfo(p)));if(!context.battle)pushLegionMembers(p,send);return true;}
 if(type===90017){
  // The client awaits this acknowledgement before constructing battle actors.
  // Send complete current records first, in the same ordered connection.
  if(!context.battle)pushLegionMembers(p,send);
  send(type,new Writer().string(JSON.stringify({...legionSnapshot(p),ready:!context.battle})));return true;
 }
 const previous=structuredClone(p.legion);let response;
 try{
  if(context.battle)throw Error('请先结束战斗，再调整军团。');
  const value=decodeLegion(type===31053?'c2s_LegionFormation':'c2s_LegionBattle',r.b.subarray(r.pos));
  response=type===31053?changeLegionFormation(p,value):selectLegion(p,value.legionId);
  store.save();
 }catch(error){
  if(previous===undefined)delete p.legion;else p.legion=previous;
  send(10509,new Writer().byte(2).string(error.message));send(31052,encodeLegion('s2c_LegionInfo',legionInfo(p)));log('legion-rejected',{role:p.id,type,error:error.message});return true;
 }
 send(type+1,encodeLegion(type===31053?'s2c_LegionFormation':'s2c_LegionBattle',response));pushLegionMembers(p,send);
 log('legion-updated',{role:p.id,type,legionId:response.legionId,index:response.index,actorId:response.actorId});
 return true;
}
export function legionBattleMembers(p){return activeLegionMembers(p).map(({role:r})=>{const pet=activePet(r),max=pet?petAttributes(r,pet):null;return {id:r.id,hp:r.hp,mp:r.mp,hpMax:hpMax(r),mpMax:mpMax(r),petUid:pet&&pet.hp>0?pet.uid:null,petHpMax:max?.hp||0,petMpMax:max?.mp||0};});}
export function readLegionResult(r,p,battle){
 const expected=battle.legion||[];
 if(!expected.length)return [];
 if(r.int()!==LEGION_TRAILER||r.byte()!==expected.length)throw Error('军团战斗结果不完整。');
 const seen=new Set(),rows=[];
 for(let i=0;i<expected.length;i++){
  const id=r.int(),hp=r.int(),mp=r.int(),hasPet=r.bool(),member=expected.find(m=>m.id===id),role=legionRoster(p).find(m=>m.id===id);
  if(!member||!role||seen.has(id)||hasPet!==!!member.petUid||role.hp!==member.hp||role.mp!==member.mp||hp<0||hp>member.hpMax||mp<0||mp>member.mpMax)throw Error('军团成员或血蓝状态与开战时不一致。');
  seen.add(id);const row={role,hp,mp};
//   if(hasPet){const pet=activePet(role),petHP=r.int(),petMP=r.int();if(!pet||pet.uid!==member.petUid||petHP<0||petHP>member.petHpMax||petMP<0||petMP>member.petMpMax)throw Error('军团宠物状态不完整。');Object.assign(row,{pet,petHP,petMP});}
  if(hasPet){const pet=activePet(role),wirePetHP=r.int(),wirePetMP=r.int();if(!pet)throw Error('军团宠物状态不完整。');const petHP=Math.max(0,Math.min(member.petHpMax,wirePetHP));const petMP=Math.max(0,Math.min(member.petMpMax,wirePetMP));Object.assign(row,{pet,petHP,petMP});}
  rows.push(row);
 }
 return rows;
}
