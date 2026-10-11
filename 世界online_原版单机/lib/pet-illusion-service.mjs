import {Writer} from './codec.mjs';
import {petCatalog,petProfiles} from './pet-catalog.mjs';

// MOD(pet-illusion)：宠物幻化 —— 参照装备幻化（lib/illusion-service.mjs）。
// 与装备幻化保持同一套规则：
//   · 只换外观，不动面板数值：名字、等级、品质、属性、技能一律保留；
//   · 永久生效、随时可取消（对应装备幻化的 time<=0 永久档）；
//   · 候选外观按用户要求限定为「传说级别」（pet-catalog 里 grade 4，即 legendaryPool 的 146 只）。
//
// 宠物的外观由三个字段共同决定（见 lib/pet-packets.mjs 的下发顺序）：
//   icon     —— 场景/战斗里那只宠物的精灵（客户端 fromBytesDetail 读成 icon1）
//   headIcon —— 界面里的宠物头像（客户端读成 PetHeadIcon）
//   model    —— 宠物模型编号（客户端读成 modelForPet）
// 所以幻化 = 把这三项替换成目标宠物的取值。
//
// 关键设计：外观替换放在「下发时」而不是「写回存档时」——
// 存档里始终保留宠物自己的 icon/headIcon/model，pet.illusion 只是外观快照。
// 这样取消幻化、存档迁移、以及任何一条宠物下发路径（详情/背包/场景/宠物装备）
// 都只需要看 pet-packets.mjs 里那三行，不需要在客户端做任何渲染改动。
export const PET_ILLUSION_LIST=90023,PET_ILLUSION_APPLY=90024;
export const petIllusionTypes=[PET_ILLUSION_LIST,PET_ILLUSION_APPLY];

const legendary=petCatalog.legendaryPool.map(key=>petProfiles.get(key)).filter(Boolean);
const candidates=legendary.map(profile=>({
 key:profile.key,name:profile.name,grade:profile.grade,
 icon:Number(profile.baseline.icon)||0,
 headIcon:profile.baseline.headIcon??0,
 model:profile.baseline.model??-1,
}));
const appearancesByKey=new Map(candidates.map(item=>[item.key,item]));

// 幻化外观：优先取 pet.illusion，缺字段回落到宠物自身的外观。null/undefined 都不算数。
export const petAppearance=(pet,key,fallback)=>{
 const appearance=pet?.illusion,v=appearance&&appearance[key]!==undefined&&appearance[key]!==null?appearance[key]:pet?.[key];
 return v===undefined||v===null?fallback:v;
};
export function petIllusionCandidates(){return candidates;}

function petAt(p,slot){
 const item=p.inventory.find(entry=>entry.slot===slot&&entry.pet);
 if(!item)throw Error('请先选择一只自己的宠物。');
 return item;
}

export function handlePetIllusion(type,r,context,{store,send,log}){
 if(!petIllusionTypes.includes(type))return false;
 const p=context.role;
 try{
  if(!p)throw Error('请先进入角色再使用宠物幻化。');
  if(context.battle)throw Error('战斗中不能幻化宠物。');
  const json=r.string();if(json.length>2048||r.pos!==r.b.length)throw Error('宠物幻化请求格式不正确。');
  const request=JSON.parse(json);if(request.role!==p.id)throw Error('角色已切换，请重新打开宠物幻化。');
  const pet=petAt(p,request.slot).pet;

  if(type===PET_ILLUSION_LIST){
   send(type,new Writer().byte(0).string(JSON.stringify({
    slot:request.slot,name:pet.name,
    current:pet.illusion?{key:pet.illusion.key,name:pet.illusion.name}:null,
    candidates,
   })));
   log('pet-illusion-list',{role:p.id,slot:request.slot,candidates:candidates.length});
   return true;
  }

  const previous=pet.illusion?{...pet.illusion}:null;
  let current=null;
  if(request.key){
   const appearance=appearancesByKey.get(String(request.key));
   if(!appearance)throw Error('只能幻化成传说级别的宠物外观。');
   pet.illusion={key:appearance.key,name:appearance.name,grade:appearance.grade,
    icon:appearance.icon,headIcon:appearance.headIcon,model:appearance.model};
   current={key:appearance.key,name:appearance.name};
  }else{
   delete pet.illusion;
  }
  // 存档失败就整条回滚，别让内存里的外观和盘上的存档对不上。
  try{store.save();}
  catch(error){if(previous)pet.illusion=previous;else delete pet.illusion;throw error;}
  send(type,new Writer().byte(0).string(JSON.stringify({ok:true,slot:request.slot,current})));
  log('pet-illusion-changed',{role:p.id,slot:request.slot,appearance:current?current.key:null});
 }catch(error){
  send(type,new Writer().byte(-1).string(error.message));
  log('pet-illusion-rejected',{role:p?.id,type,error:error.message});
 }
 return true;
}
