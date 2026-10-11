import {Writer} from './codec.mjs';
// v305 选角列表：一个账号下每个角色的精简档案 + 上次进入的角色号。
// 字段顺序必须与客户端 0360.js 的 getMessagePlayer 完全一致，否则职业等信息会错位。
export function rolePayload(w,r){
 return w.int(r.id).string(r.name).byte(r.sex).byte(r.race).byte(r.job).byte(r.level).byte(r.vipLevel2)
  .string(r.mapName).long(r.icon1).long(r.icon2).long(r.icon3).int(r.status);
}
export function roleListPacket(store,account){
 const roles=store.roles(account),w=new Writer().string('').short(roles.length);
 for(const role of roles)rolePayload(w,role);
 return w.int(account.lastRoleId);
}
