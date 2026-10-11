// MOD(legion-pet-guard) —— 「军团队友的宠物不能替人物挡伤害」修复
//
// 「宠物为主人承受伤害」的唯一入口是 Battle.getGrardPet(受击者, 攻击类型, 是否技能)，
// 它开头要求受击者是 TYPE_PLAYER；内部再调 getPlayerPet(position)，同样要求 TYPE_PLAYER。
// 军团成员是 TYPE_LEGION(10)，两道门都过不去 → 护主永远不触发（只有主控能享受）。
// 这里两道门都放行 TYPE_LEGION，其余类型一律不变。
export const legionPetGuardRevision='legion-pet-guard-v1';

export function patchLegionPetGuard(source){
 const rules=[
  ['getGrardPet=function(e,t,i){if(null==e||e.getType()!=l.MODEL_TYPE.TYPE_PLAYER)return null;',
   'getGrardPet=function(e,t,i){if(null==e||e.getType()!=l.MODEL_TYPE.TYPE_PLAYER&&e.getType()!=l.MODEL_TYPE.TYPE_LEGION)return null;'],
  ['getPlayerPet=function(e){var t=this.getPlayerByPos(e);if(null==t||t.getType()!=l.MODEL_TYPE.TYPE_PLAYER)return null;',
   'getPlayerPet=function(e){var t=this.getPlayerByPos(e);if(null==t||t.getType()!=l.MODEL_TYPE.TYPE_PLAYER&&t.getType()!=l.MODEL_TYPE.TYPE_LEGION)return null;']
 ];
 for(const [before,after] of rules){
  const nb=source.split(before).length-1,na=source.split(after).length-1;
  if(na===1&&nb===0)continue;
  if(nb===1&&na===0){source=source.replace(before,after);continue;}
  throw Error('v305 legion pet guard patch mismatch: before='+nb+' after='+na);
 }
 return source;
}
