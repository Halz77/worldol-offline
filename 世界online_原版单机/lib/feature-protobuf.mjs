import {protobuf} from '../tools/capture-decoders.mjs';
import {featureData} from './character-feature-data.mjs';
export {featureData};
const schemas=featureData.schemas;
function vi(value){let n=BigInt.asUintN(64,BigInt(value)),out=[];do{let b=Number(n&127n);n>>=7n;if(n)b|=128;out.push(b);}while(n);return Buffer.from(out);}
export function encodeWithSchema(type,data,schemas){
 const schema=schemas[type];if(!schema)throw Error('Unknown feature message '+type);const parts=[];
 for(const [id,f] of Object.entries(schema)){
  if(data[f.name]===undefined||data[f.name]===null)continue;
  for(const value of f.repeated?data[f.name]:[data[f.name]]){
   const nested=f.message||['string','bytes'].includes(f.type);
   parts.push(vi(Number(id)*8+(nested?2:0)));
   if(nested){const b=f.message?encodeWithSchema(f.type,value,schemas):Buffer.from(value,f.type==='bytes'?'base64':'utf8');parts.push(vi(b.length),b);}
   else parts.push(vi(f.type==='bool'?(value?1:0):value));
  }
 }
 return Buffer.concat(parts);
}
export const encodeFeature=(type,data)=>encodeWithSchema(type,data,schemas);
export const decodeFeature=(type,bytes)=>protobuf(bytes,type,schemas);
