/**
 * 棋盘（英雄挑战赛 / 团队副本）打完一场战斗后，**必须把棋盘自己弹回来**。
 *
 * ## 坑（第 70 版，玩家实测「打赢之后棋盘直接消失、人物卡住不能走」）
 * 客户端一行棋就进战斗，进战斗/退出战斗各藏一次棋盘：
 *
 *   World.toBattle → BattleProxy.enterBattle → showView(Battle, Battle)
 *     → BattleProxy.doBattleStart → sendNt(ON_BATTLE_START)
 *     → StartBattleCmd.exec → World.closeAllUI()      ← 棋盘（Layer.window）被藏掉
 *   打完点「确定」→ BattleWin.onHide → exitBattle(!0)
 *     → sendNt(ON_BATTLE_END) → EndBattleCmd.exec → World.showMain()
 *     → showMain() 里 this.hideTop() + stack.clearStack()  ← 又藏一次
 *
 * 而 `closeAllUI` / `showMain` **只藏窗口，不动 `World.escort`**；另一边
 * `MyPlayer.isCanMove()`（0031）是 `… : !World.isEscortStatus()`，
 * `isEscortStatus()` = `null!=this.escort` → 于是「棋盘没了 + 人物不能走」。
 * 背包/人物/宠物还能点，是因为那些是 Main 自己的按钮（Main 在 showMain 里被重新
 * showView 了）。
 *
 * ## 为什么服务端补发 14508 不够（第 67 版的做法）
 * 第 67 版把 14508 改成「12502 回包发完再补发」，但那时玩家还没点「确定」，
 * 棋盘被 showWin 弹出来之后又被 `EndBattleCmd.exec` 的 `showMain()` 藏掉。
 * 而且棋盘一藏起来客户端就不发 14511 轮询了（轮询挂在棋盘视图的 update 上），
 * 服务端**没有别的时机**能知道「战斗界面已经收尾」——只能客户端补。
 *
 * ## 修法（与「幻想世界OL 2.0 新版」同一处、同一手法）
 * `BattleProxy.exitBattle(t)` 本来就带一个「战后恢复界面」的开关：`if(t)` 块里
 * 只要 `this.viewData` 有值，就把它 showView（或 showWin）回来——原版只用于
 * 「战斗期间自己弹出来的界面」，不含护送棋盘。所以在 `if(t)` 块之前补一句：
 * **escort 还在、且是 0183 新版棋盘（有 pointList）就把棋盘塞进 viewData**。
 * 此时还没走到 `sendNt(ON_BATTLE_END)`，showMain 藏完棋盘后正好由 viewData 恢复。
 *
 * ### 与对方写法的唯一差别：多加了 `isWin:!0`
 * 对方写 `{modName:"Escort",viewType:"EscortNewMain"}`，走的是 `showView`
 * （**不压 UISTACK**）。我们补 `isWin:!0` 让它走 `showWin`，理由：
 *   ① 原版开棋盘（14508 → processEscortStartMsg）用的就是 showWin，棋盘在栈上；
 *   ② 棋盘自己的工具栏（1185 btnSwitch）会 openBag/openRole/openPet… 那些走 showWin，
 *      `hideTop()` 先把棋盘藏起来、关掉之后 `showTop()` 再弹回来；不压栈就没这套行为；
 *   ③ 离开棋盘（14509 → doEscortPostQuitMsg → showMain → hideTop）也靠栈把棋盘关掉。
 *
 * ## 认新版棋盘的判据
 * 用 `.pointList`（0183 的 Escort183 才有；旧版护送 0088 是 moveList/eventList），
 * 不然会把旧版护送也弹成新版棋盘。
 *
 * ## 已知没覆盖的一条（先记着，真遇到再补）
 * `exitBattle()` **不带参数**（t 为假）的路径（客户端 12502 回包 i<0 报错那条：
 * `worldReflashType=ALL` + `exitBattle()`）只会把棋盘塞进 viewData 而不恢复，
 * 要等到下一场战斗结束才弹回来。正常胜负都是 `exitBattle(!0)`，不在这一条上。
 */
export const escortBoardRevision='escort-board-viewdata-v1';

// exitBattle 里 `if(t){ … viewData … }` 之前的原文，全包恰好一处。
const FROM=',o.isChangeMap=!1}var S=s["default"].myPlayer;';
const TO=',o.isChangeMap=!1}o.viewData||null==s["default"].getEscort()||null==s["default"].getEscort().pointList||(o.viewData={modName:"Escort",viewType:"EscortNewMain",isWin:!0});var S=s["default"].myPlayer;';

export function patchEscortBoard(source){
 const hits=source.split(FROM).length-1;
 if(hits===1)return source.replace(FROM,TO);
 if(hits===0&&source.includes(TO))return source; // 已打过：幂等（standalone 靠这条跳过重打）
 throw Error('v305 escort board patch mismatch ('+hits+'): exitBattle viewData');
}
