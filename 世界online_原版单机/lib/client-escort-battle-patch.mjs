/**
 * 棋盘/护送类玩法进战斗要走**本地战斗 12501**，别改发远程战斗 12503。
 *
 * ## 坑（第 66 版，玩家实测「点开始挑战没反应」）
 * 客户端 `World.toBattle(group)` 里有一个「要不要走远程战斗」的开关 s：
 *   s=!1,
 *   this.myPlayer.isLeader()&&this.myPlayer.isHasPlayerMember()&&(s=!0),
 *   1==f["default"].isNetBattleID(t)&&(s=!0),
 *   e.isEscortStatus()&&(s=!0),                 ← 就是这条
 *   !s&&this.myPlayer.checkIsHasLegionTem()&&(s=!0),
 *   ...
 *   s ? createEnterRemoteBattle(t)              ← 12503
 *     : createEnterLocalBattle(groupId)         ← 12501
 * `isEscortStatus()` 判的是 `null!=this.escort`，而 `escort` 在服务端推来
 * 14508（开棋盘）时就被 `createEscort()` 设上了 → **棋盘只要开着，这里恒为真**。
 * 于是点「开始挑战」必然走 12503；而服务端只接 12501，12503 没人回，
 * 客户端 `getReceiveMsg()` 拿到 null 就默默 return —— 表现就是「点了没反应」。
 *
 * ## 修法（与社区版一致）
 * 社区版把这三个触发条件都补上了 `&&null==e.getMonsterGroup(t)`：
 * 只有**本地世界数据里没有这一组**时才走远程。棋盘编队本来就在地图 262 的
 * 10503 世界数据里（lib/official-packets.mjs 的 mapBattleData 按
 * `sources.mapId` 收集），所以补完之后走回本地战斗 12501。
 *
 * ## 为什么以前没炸（第 66 版才炸）
 * 这三条里**本来就已经打了两条**，都是早期移植同一处社区改动时留下的：
 *   · client-mission-patch.mjs → isNetBattleID 那条
 *   · client-legion-patch.mjs  → checkIsHasLegionTem 那条
 * 唯独漏了 `e.isEscortStatus()` 这条。而它恰恰是**棋盘玩法唯一会踩的**：
 * 另外两条要「跨服组 id」或「带了军团队友」才成立，普通单机玩家根本碰不到；
 * isEscortStatus 只看 `null!=this.escort`，棋盘一开就恒真。
 * 所以本补丁把三条都写上（前两条通常已被前面两个补丁打过，走幂等分支跳过），
 * 一是补上漏掉的那条，二是以后若前两个补丁被调整，这里还能兜住。
 */
export const escortBattleRevision='escort-battle-v1';

export function patchEscortBattle(source){
 const fixes=[
  ['1==f["default"].isNetBattleID(t)&&(s=!0)',
   '1==f["default"].isNetBattleID(t)&&null==e.getMonsterGroup(t)&&(s=!0)'],
  ['e.isEscortStatus()&&(s=!0)',
   'e.isEscortStatus()&&null==e.getMonsterGroup(t)&&(s=!0)'],
  ['!s&&this.myPlayer.checkIsHasLegionTem()&&(s=!0)',
   '!s&&this.myPlayer.checkIsHasLegionTem()&&null==e.getMonsterGroup(t)&&(s=!0)'],
 ];
 let out=source;
 for(const [from,to] of fixes){
  const hits=out.split(from).length-1;
  if(hits===1){out=out.replace(from,to);continue;}
  if(hits===0&&out.includes(to))continue; // 已打过：幂等
  throw Error('v305 escort battle patch mismatch ('+hits+'): '+from);
 }
 return out;
}
