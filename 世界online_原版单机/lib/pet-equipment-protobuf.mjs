import {encodeWithSchema} from './feature-protobuf.mjs';
import {protobuf} from '../tools/capture-decoders.mjs';
import {PET_EQUIPMENT_MAX_LEVEL,PET_EQUIPMENT_LEVEL_XP} from './pet-equipment-data.mjs';
const field=(name,type='int32',repeated=false,message=false)=>({name,type,repeated,message});
export const petEquipmentSchemas={
 c2s_petEquip:{1:field('equipId','int64'),2:field('petPos'),3:field('pos')},
 c2s_offPetEquip:{1:field('type'),2:field('equipId','int64'),3:field('petPos')},
 c2s_petEquip_Up:{1:field('equipId','int64'),2:field('cost','costItem',true,true)},
 costItem:{1:field('pos'),2:field('num')},
 petEquipUpExp:{1:field('level'),2:field('needExp')},
 s2c_petEquipUpExp:Object.fromEntries([1,2,3,4,5].map(n=>[n,field('expInfo'+n,'petEquipUpExp',true,true)])),
};
export const encodePetEquipment=(type,data)=>encodeWithSchema(type,data,petEquipmentSchemas);
export const decodePetEquipment=(type,bytes)=>protobuf(bytes,type,petEquipmentSchemas);
export function petEquipmentExperiencePacket(){
 const levels=Array.from({length:PET_EQUIPMENT_MAX_LEVEL-1},(_,i)=>({level:i+1,needExp:PET_EQUIPMENT_LEVEL_XP}));
 return encodePetEquipment('s2c_petEquipUpExp',Object.fromEntries([1,2,3,4,5].map(n=>['expInfo'+n,levels])));
}
