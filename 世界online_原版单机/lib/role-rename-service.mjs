import {Writer} from './codec.mjs';

const ROLE_RENAME_ITEM=40016;

export function handleRoleRename(type,r,context,{store,send,log}){
 if(type!==11038)return false;
 const p=context.role;
 try{
  if(!p)throw Error('请先进入角色再改名。');
  if(context.battle)throw Error('请先结束战斗再改名。');
  const slot=r.short(),name=r.string().trim(),item=p.inventory.find(i=>i.slot===slot);
  if(r.pos!==r.b.length)throw Error('改名请求格式有误，请重试。');
  if(slot<30||!item||item.itemId!==ROLE_RENAME_ITEM||item.pet)throw Error('请在背包中选择角色改名卷轴。');
  if(!name||name.length>16)throw Error('角色名须为 1–16 字。');
  if(store.data.characters.some(role=>role.id!==p.id&&role.accountId===p.accountId&&role.name===name))throw Error('这个角色名已存在。');

  const before={name:p.name,inventory:structuredClone(p.inventory)};
  try{
   p.name=name;
   item.quantity=(item.quantity||1)-1;
   if(!item.quantity)p.inventory=p.inventory.filter(i=>i!==item);
   store.save();
  }catch(error){p.name=before.name;p.inventory=before.inventory;throw error;}
  send(type,new Writer().byte(0));
  log('role-renamed',{role:p.id,name});
 }catch(error){
  send(type,new Writer().byte(-1).string(error.message));
  log('role-rename-rejected',{role:p?.id,error:error.message});
 }
 return true;
}