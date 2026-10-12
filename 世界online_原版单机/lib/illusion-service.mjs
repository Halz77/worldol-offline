import {Writer} from './codec.mjs';
import {encodeWithSchema} from './feature-protobuf.mjs';
import {protobuf} from '../tools/capture-decoders.mjs';
import {equipment} from './restoration.mjs';
import {itemWithAffixes} from './item-affixes.mjs';
import {itemSlots} from './official-data.mjs';
import {exportEquipment} from './character-import-codec.mjs';
import {shareEquipSlot,illusionBlockReason} from './illusion-policy.mjs';

const field=(name,type='int32')=>({name,type});
const schemas={
 c2s_HandBookIllusion:{1:field('type'),2:field('slotPos'),3:field('illusionItemId'),4:field('time')},
 s2c_HandBookIllusion:{1:field('type'),2:field('slotPos'),3:field('illusionItemId'),4:field('time'),5:field('endTime','int64')},
};
const decode=(type,bytes)=>protobuf(bytes,type,schemas);
const encode=(type,message)=>encodeWithSchema(type,message,schemas);

function appearanceDefinition(source){
 return exportEquipment({...source,handBookItem:true,isHandBookActivated:true,illusion:[{currency:0,day:0,price:0}],illusionItemId:0,illusionEndTime:0});
}
// 判定在 lib/illusion-policy.mjs —— 那是唯一来源，下发物品包时用的是同一套
// （以前这里用「同槽位」、下发用「同 type」，跨类型幻化就卡在黑屏，见第 43 版）。
function candidatesFor(source){
 return [...equipment.values()]
    .filter(item=>item.native&&item.definitionBase64&&shareEquipSlot(item.type,source.type))
  .sort((a,b)=>(b.grade||0)-(a.grade||0)||a.id-b.id)
  .map(appearanceDefinition);
}
function itemAt(p,slot){
 const instance=p.inventory.find(item=>item.slot===slot),definition=instance&&!instance.pet?itemWithAffixes(equipment.get(instance.itemId),instance):null;
 if(!instance||!definition||!definition.native||!itemSlots(definition.type).length)throw Error('请选择角色装备栏或背包中可幻化的装备。');
 return {instance,definition};
}
function response(data){return encode('s2c_HandBookIllusion',data);}

export function handleIllusion(type,r,context,{store,send,log}){
 if(![11530,32110].includes(type))return false;
 const p=context.role;
 try{
  if(!p)throw Error('请先进入角色再使用幻化。');
  if(context.battle)throw Error('战斗中不能幻化装备。');
  if(type===11530){
   const slot=r.short();if(r.pos!==r.b.length)throw Error('幻化列表请求格式有误。');
   const {definition}=itemAt(p,slot),list=candidatesFor(definition);
  if(!list.some(item=>item.id===definition.id)){list.pop();list.unshift(appearanceDefinition(definition));}
  log('equipment-illusion-list',{role:p.id,slot,sourceType:definition.type,sourceItemId:definition.id,candidateCount:list.length});
  const w=new Writer().short(Math.min(65535,list.length));for(const item of list)w.raw(Buffer.from(item.definitionBase64,'base64'));
   send(type,w);return true;
  }

  const request=decode('c2s_HandBookIllusion',r.b.subarray(r.pos));
  const {instance,definition}=itemAt(p,request.slotPos);
  if(![1,2].includes(request.type))throw Error('无效的幻化操作。');
  const previous={illusionItemId:instance.illusionItemId,illusionEndTime:instance.illusionEndTime,illusionDefinitionBase64:instance.illusionDefinitionBase64};
  let appearanceId=0,endTime=0;
  if(request.type===1){
   const appearance=equipment.get(request.illusionItemId);
   // 判定与 candidatesFor、以及下发物品包同源（lib/illusion-policy.mjs）。
   const blocked=illusionBlockReason(appearance,definition.type);
   if(blocked)throw Error(`只能幻化成同部位且资料完整的装备外观（${blocked}）。`);
   if(appearance.id===instance.itemId)throw Error('装备本身无需幻化。');
   instance.illusionItemId=appearance.id;instance.illusionEndTime=request.time>0?Date.now()+request.time*86400000:-1;
   instance.illusionDefinitionBase64=appearance.definitionBase64;appearanceId=appearance.id;endTime=instance.illusionEndTime;
  }else{
   appearanceId=instance.illusionItemId||request.illusionItemId||0;
   delete instance.illusionItemId;delete instance.illusionEndTime;delete instance.illusionDefinitionBase64;
  }
  try{store.save();}catch(error){for(const key of Object.keys(instance))if(key.startsWith('illusion'))delete instance[key];for(const [key,value]of Object.entries(previous))if(value!==undefined)instance[key]=value;throw error;}
  send(32111,response({type:request.type,slotPos:request.slotPos,illusionItemId:appearanceId,time:request.time||0,endTime}));
  log('equipment-illusion-changed',{role:p.id,slot:request.slotPos,type:request.type,appearance:request.type===1?appearanceId:0,permanent:request.type===1&&request.time<=0});
  return true;
 }catch(error){
  if(type===11530)send(type,new Writer().byte(0));
  else send(32111,response({type:0,slotPos:0,illusionItemId:0,time:0,endTime:0}));
  log('equipment-illusion-rejected',{role:p?.id,type,error:error.message});return true;
 }
}