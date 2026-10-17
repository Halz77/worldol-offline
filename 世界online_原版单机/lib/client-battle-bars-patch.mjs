export const battleBarsRevision='battle-monster-bars-native-v5';

// 战斗里每只怪物脚下常驻**血条 + 蓝条** —— 直接用它自带的 `_hpBar` / `_mpBar`，
// 不再自己画（第 50~52 版自己画的一条条都白费了，原因见下）。
//
// 游戏本来就有这两条：
//   · 单位类（战斗单位精灵）里 `updateHpBar(e)` / `updateMpBar(e)`：
//       this._hpBar ||= 对象池分配（HP 条），放进 this.battleSprite.parent，
//       x = this.x - width/2，y = this.y + height + 5；
//       value = vo.get(ModelConst.HP_DISPLAY) / vo.get(ModelConst.HPMAX)；
//     `updateMpBar` 同理，但 y = this.y + 2*height + 5 —— **蓝条就画在血条正下方**，
//     缩略图资源是 `fight_panel_mp2`（BattleMpBar 重写了 initThumb）。
//   · 谁在开关它们：`BattlePanel.paint(e)` 每帧先 `hideAllPlayerMsg()`，
//     它对每个位置调 `unit.hideMsg()`；而 `hideMsg()` 里写死了
//     `this.updateHpBar(!1), this.updateMpBar(!1), this.updateName(!1)` —— 三条一起关。
//     真正把它们打开的只有 `drawCurMsg()`（单位出手时瞬现）：
//         s.updateHpBar(!0), go.isRePlayBattle && s.updateMpBar(!0)
//     —— 也就是说**原版只在「战斗录像」里才显示蓝条**，正常打怪时蓝条永远不出现。
//
// 所以修法不是再画一条，而是把 `hideMsg()` 改成：怪物保留血条+蓝条，其它单位维持原样。
// 这样位置、层级、偏移（+5 / +2h+5）、贴图全都是游戏自己的，也不会跟原生条打架。
// 之前自己画的条还有一个隐患：`this.scene` 与单位精灵所在的容器未必是同一层。
//
// 只对怪物开（玩家/宠物/伙伴保持原样），死亡的怪物不显示（血 0 的空条没意义）。
// 外面包 try/catch：`hideMsg` 是每帧每单位都要跑的，绝不能因为我们改坏它而影响战斗渲染。
export function patchBattleMonsterBars(source){
  const anchor='e.prototype.hideMsg=function(){this.updateBuff(!1),this.updateHpBar(!1),this.updateMpBar(!1),this.updateName(!1)}';
  if(source.split(anchor).length!==2)throw Error('v305 battle bars hideMsg patch mismatch');
  const repl='e.prototype.hideMsg=function(){'
   +'this.updateBuff(!1);'
   +'var _mon=!1;'
   +'try{_mon=!!(this.vo&&this.vo.isMonster&&!this.vo.isDead())}catch(_e){}'
   +'if(_mon){this.updateHpBar(!0);this.updateMpBar(!0)}else{this.updateHpBar(!1);this.updateMpBar(!1)}'
   +'this.updateName(!1)}';
  return source.replace(anchor,repl);
}
