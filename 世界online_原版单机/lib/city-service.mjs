import {Writer} from './codec.mjs';
import {cityState,isPersonalCity,unlockCity} from './city-state.mjs';
import {worldData} from './world.mjs';
export function cityInfo(w,p){
 const s=cityState(p);
 return w.string(s.name).string(`${s.level}级城市`).string('城市状态评定待定').string(s.sign)
  .int(p.id).string(p.name).byte(p.level).long(p.icon1).long(p.icon2).long(p.icon3)
  .int(s.prosperity).int(s.army).string('').string('').int(s.gold).int(s.silver).int(s.coins);
}
export function handleCity(type,r,context,{store,send,log}){
 const p=context.role;if(!p||![10511,10512,10513,10514,10515].includes(type))return false;
 const before=structuredClone(p);
 try{
  const owner=type===10515?p.id:r.int();
  // 原版没拿到城市（漏做新手链 42 号任务）的角色在这里只会吃一句报错；
  // 单机版按需补发，并把等级 1 的城市落盘（见 city-state.mjs 的 unlockCity）。
  if(unlockCity(p)){store.save();log('city-unlocked',{role:p.id,type});}
  if(owner!==p.id&&owner!==1000)throw Error('单机仅开放自己的城市。');
  if(type===10511){send(type,cityInfo(new Writer().byte(0),p));return true;}
  if(context.battle)throw Error('请先结束战斗。');
  const s=cityState(p);
  if(type===10512){
   if(!(s.gold||s.silver||s.coins))throw Error('金库暂无可提取资金；自动收入规则待定。');
   for(const key of ['gold','silver','coins']){const value=(p[key]||0)+s[key];if(!Number.isSafeInteger(value)||value>2147483647||s[key]<0)throw Error('货币余额超出范围。');p[key]=value;}
   p.city={...s,gold:0,silver:0,coins:0};store.save();send(type,new Writer().byte(0).int(s.gold).int(s.silver).int(s.coins));
   send(11004,new Writer().byte(3).short(11).int(s.gold).short(12).int(s.silver).short(13).int(s.coins).short(13).int(0));
  }else if(type===10513||type===10514){
   // Fees and restrictions were not captured. Do not silently make it free.
   throw Error('待定：城市改名、签名的限制与费用尚未核实。');
  }else{if(!isPersonalCity(p.mapId))throw Error('请先进入自己的城市。');send(10503,new Writer().byte(0).raw(worldData(p,true).done()));}
  log('city-operation',{role:p.id,type});
 }catch(error){for(const k of Object.keys(p))if(!(k in before))delete p[k];Object.assign(p,before);send(type,new Writer().byte(-1).string(error.message));}
 return true;
}
