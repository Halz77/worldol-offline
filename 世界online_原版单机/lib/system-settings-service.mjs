import {Writer} from './codec.mjs';

export const systemSettingsRevision='music-settings-20260924-v1';
export const actorSettings=p=>Number.isInteger(p.settings)&&p.settings>=0&&p.settings<=0x7fffffff?p.settings:0;

export function handleSystemSettings(type,r,context,{store,send,log}){
 if(type!==11006)return false;
 const p=context.role,hadSetting=p&&Object.hasOwn(p,'settings'),before=p?.settings;
 let committed=false;
 try{
  if(!p)throw Error('请先进入角色再修改设置。');
  const value=r.int();
  if(r.pos!==r.b.length||value<0)throw Error('无效的游戏设置。');
  p.settings=value;store.save();committed=true;
  send(type,new Writer().byte(0));
  log('system-settings-saved',{role:p.id,settings:value});
 }catch(error){
  if(p&&!committed){if(hadSetting)p.settings=before;else delete p.settings;}
  send(type,new Writer().byte(-1).string(error.message));
  log('system-settings-rejected',{role:p?.id,error:error.message,committed});
 }
 return true;
}
