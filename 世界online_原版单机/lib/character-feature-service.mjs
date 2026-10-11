import {Writer} from './codec.mjs';
import {decodeFeature,encodeFeature} from './feature-protobuf.mjs';
import {talentList,artifactInfo,artifactParts,characterFeatureDirectory,characterFeatureState,learnTalent,upgradeArtifactPart,smeltArtifact} from './character-features.mjs';
import {cityState} from './city-state.mjs';
import {worldData} from './world.mjs';
import {clampVitals} from './restoration.mjs';

export const featureSnapshot=p=>({...characterFeatureDirectory(p),city:{...cityState(p),unlocked:!!p.cityUnlocked}});
export const pushCharacterFeatures=(p,send)=>send(90015,new Writer().string(JSON.stringify(featureSnapshot(p))));
export function handleCharacterFeatures(type,r,context,{store,send,log}){
 const p=context.role;if(!p)return false;
 const reads={27301:[27302,'s2c_Talent_List',()=>talentList(p)],29000:[29001,'s2c_ArtifactInfo',()=>artifactInfo(p)],29002:[29003,'s2c_ArtifactSkill',()=>artifactParts(p,'skills')],29004:[29005,'s2c_ArtifactDecorate',()=>artifactParts(p,'decorations')]};
 if(reads[type]){const [response,schema,value]=reads[type];send(response,encodeFeature(schema,value()));return true;}
 if(type===90015){pushCharacterFeatures(p,send);return true;}
 if(![90016,27303,29006,29008,29010].includes(type))return false;
 const before=structuredClone(p);let committed=false;
 try{
  if(context.battle)throw Error('请先结束战斗。');
  let action;
  if(type===90016)action=JSON.parse(r.string());
  else if(type===27303){const v=decodeFeature('c2s_Talent_Learn',r.b.subarray(r.pos));action={op:'talent',id:v.rankId,level:v.rankLevel};}
  else if(type===29006){decodeFeature('c2s_ArtifactUp',r.b.subarray(r.pos));action={op:'smelt'};}
  else {const v=decodeFeature(type===29008?'c2s_ArtifactSkillUp':'c2s_ArtifactDecorateUp',r.b.subarray(r.pos));action={op:type===29008?'skills':'decorations',id:v.type};}
  if(action.role!==undefined&&action.role!==p.id)throw Error('角色已切换，请重新打开养成界面。');
  const state=characterFeatureState(p);
  if(action.expectedStage!==undefined&&action.expectedStage!==state.artifact.stage)throw Error('神器阶数已变化，请重新打开。');
  if(['skills','decorations'].includes(action.op)&&action.expectedLevel!==undefined&&action.expectedLevel!==(state.artifact[action.op][action.id]||0))throw Error('神器等级已变化，请重新打开。');
  let message;
  if(action.op==='talent')message=learnTalent(p,action.id,action.level);
  else if(action.op==='smelt')message=smeltArtifact(p);
  else if(['skills','decorations'].includes(action.op))message=upgradeArtifactPart(p,action.op,action.id);
  else throw Error('未知养成操作。');
  clampVitals(p);
  const packets=[[90015,new Writer().string(JSON.stringify(featureSnapshot(p)))]];
  if(type===90016)packets.push([type,new Writer().byte(0).string(message)]);
  else if(type===27303)packets.push([27304,encodeFeature('s2c_Talent_Learn',{attrib:talentList(p).talents.find(t=>t.rankId===action.id).attrib,nextTalent:talentList(p).nextTalents.find(t=>t.rankId===action.id)})]);
  else if(type===29006)packets.push([29007,encodeFeature('s2c_ArtifactUp',artifactInfo(p))]);
  else packets.push([type+1,encodeFeature(type===29008?'s2c_ArtifactSkillUp':'s2c_ArtifactDecorateUp',{info:artifactParts(p,action.op).info.find(t=>t.type===action.id),power:0})]);
  packets.push([10503,new Writer().byte(0).raw(worldData(p,true).done())]);
  store.save();committed=true;for(const [id,body] of packets)send(id,body);
  log('character-feature-updated',{role:p.id,...action});
 }catch(error){
  if(!committed){for(const k of Object.keys(p))if(!(k in before))delete p[k];Object.assign(p,before);}
  if(type===90016)send(type,new Writer().byte(-1).string(error.message));else send(10509,new Writer().byte(2).string(error.message));
  log('character-feature-rejected',{role:p.id,type,error:error.message});
 }
 return true;
}
