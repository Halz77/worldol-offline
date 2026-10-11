import fs from 'node:fs';
import {officialItems} from './official-data.mjs';
export const setData=JSON.parse(fs.readFileSync(new URL('../data/equipment-sets.json',import.meta.url),'utf8'));
export const equipmentSets=new Map(setData.sets.map(s=>[s.id,s]));
export const VIP_MAX=9;
export const localVipLevel=p=>Math.min(VIP_MAX,Math.max(0,Number(p?.vipLevel2)||0));
export function setState(p){
 const counts=new Map();for(const item of p.inventory||[]){if(item.slot>=30||item.pet)continue;const id=(item.recordedDefinition?.itemSet??officialItems.get(item.itemId)?.itemSet??0)&255;if(id)counts.set(id,(counts.get(id)||0)+1);}
 return [...counts].map(([id,count])=>({id,count,known:equipmentSets.has(id),bonuses:(equipmentSets.get(id)?.bonuses||[]).map(b=>({...b,active:count>=b.pieces&&localVipLevel(p)>=b.vipLevel}))}));
}
export function setPowers(p){return setState(p).flatMap(s=>s.bonuses.filter(b=>b.active).map(b=>[b.power,b.value]));}
export function setAttributeData(p){const rows=setState(p).flatMap(s=>s.bonuses.filter(b=>b.active).flatMap(b=>[(s.id<<4)|b.pieces,b.power,b.value]));if(rows.length>127)throw Error('Equipped set bonuses exceed native byte count');return rows;}
export function setPacket(w,p,ids){
 const state=new Map(setState(p).map(s=>[s.id,s])),rows=[...new Set(ids)].filter(id=>equipmentSets.has(id));w.byte(rows.length);
 for(const id of rows){const set=equipmentSets.get(id);w.byte(id).byte(set.bonuses.length);for(const b of set.bonuses)w.byte(b.pieces).short(b.power).short(b.value).byte(b.vipLevel).byte((state.get(id)?.count||0)>=b.pieces&&localVipLevel(p)>=b.vipLevel?1:0);}
 return w;
}
