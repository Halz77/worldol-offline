// MOD(battle-speed) —— 战斗倍速改为「1/3/5」并固定化
//
// 两件事：
//  1. MOD(battle-speed-steps)：原版 onTapSpeedBtn 每次 +1、到 GAME_SPEED_MAX(3) 回 1，
//     只有 1/2/3 三档。这里改成在 [1,3,5] 里循环，并把玩家的选择交给
//     window.__battleSpeedSave（由 web/offline.js 落到 localStorage）。
//  2. MOD(battle-speed-persist)：手动↔自动切换原本会把 gameSpeed 强行设成
//     GAME_SPEED_MAX / 1（bundle 里两处硬编码），导致玩家选的档位被冲掉。
//     这里改成优先取 window.__battleSpeed，没有才用原来的默认值。
//
// 宽容版：主包本身也可能已被直改，已是改后形态也算成功。
export const battleSpeedRevision='battle-speed-135-persist-v1';

export function patchBattleSpeedSteps(source){
 const after='e.onTapSpeedBtn=function(){var S=[1,3,5],i=S.indexOf(_["default"].gameSpeed);_["default"].gameSpeed=S[(i+1)%S.length],window.__battleSpeedSave&&window.__battleSpeedSave(_["default"].gameSpeed)}';
 const befores=[
  'e.onTapSpeedBtn=function(){var e=_["default"].gameSpeed;e>=y["default"].GAME_SPEED_MAX?e=1:e++,_["default"].gameSpeed=e}',
  'e.onTapSpeedBtn=function(){var S=[1,3,5],i=S.indexOf(_["default"].gameSpeed);_["default"].gameSpeed=S[(i+1)%S.length]}'
 ];
 const na=source.split(after).length-1;
 if(na===1)return source;
 if(na>1)throw Error('v306 battle speed patch mismatch: after='+na);
 for(const before of befores){
  const nb=source.split(before).length-1;
  if(nb===1)return source.replace(before,after);
  if(nb>1)throw Error('v306 battle speed patch mismatch: before='+nb);
 }
 throw Error('v306 battle speed patch mismatch: before=0 after=0');
}

export function patchBattleSpeedPersist(source){
 const rules=[
  ['this.gameSpeed=e?f["default"].GAME_SPEED_MAX:1','this.gameSpeed=window.__battleSpeed||(e?f["default"].GAME_SPEED_MAX:1)'],
  ['e&&(p["default"].gameSpeed=A["default"].GAME_SPEED_MAX)','e&&(p["default"].gameSpeed=window.__battleSpeed||A["default"].GAME_SPEED_MAX)']
 ];
 for(const [before,after] of rules){
  const nb=source.split(before).length-1,na=source.split(after).length-1;
  if(na===1&&nb===0)continue;
  if(nb===1&&na===0){source=source.replace(before,after);continue;}
  throw Error('v308 battle speed persist patch mismatch: before='+nb+' after='+na);
 }
 return source;
}
