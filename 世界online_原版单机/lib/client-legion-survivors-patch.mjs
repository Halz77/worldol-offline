// MOD(legion-survivors) —— 「队长阵亡即判负」修复
//
// 军团成员是 MODEL_TYPE.TYPE_LEGION(10)，不是 TYPE_PLAYER(3)。而
// Battle.getActivePlayerNum(pos0, pos1, onlyPlayer) 在 onlyPlayer 为真时**只数**
// TYPE_PLAYER，右侧（我方，主控站 LOCAL_BATTLE_MY_POS=25）因此只统计主控一人：
// 主控一死存活数即为 0 → updateBattleResult 判 RESULT_LEFT_WIN，队友活着也没用。
//
// 这里把军团成员一并放行，判负条件变成「主控 + 全部出阵军团成员都阵亡」。
// 只改 onlyPlayer 为真时的判断，所以：
//   * 怪物侧（isLeftHavePlayer=false，走 onlyPlayer 为假的分支）完全不受影响；
//   * 怪物 AI 的 CONDITION_PLAYER_COUNT / CONDITION_MONSTER_COUNT 传的是 !1，不受影响；
//   * 单人战斗右侧没有 TYPE_LEGION，计数结果与改前逐位相同；
//   * 宠物 / 佣兵 / 伙伴仍不计入存活。
//
// 宽容版：客户端主包本身也可能已被直改，所以「已是改后形态」也算成功，
// 只有两种形态都对不上才报错。
export const legionSurvivorsRevision='legion-survivors-v1';

export function patchLegionSurvivors(source){
 const before='i&&a.getType()!=l.MODEL_TYPE.TYPE_PLAYER||1==this.isValidBattlePlayer(a)&&o++';
 const after='i&&a.getType()!=l.MODEL_TYPE.TYPE_PLAYER&&a.getType()!=l.MODEL_TYPE.TYPE_LEGION||1==this.isValidBattlePlayer(a)&&o++';
 const nb=source.split(before).length-1,na=source.split(after).length-1;
 if(na===1&&nb===0)return source;
 if(nb===1&&na===0)return source.replace(before,after);
 throw Error('v305 legion survivors patch mismatch: before='+nb+' after='+na);
}
