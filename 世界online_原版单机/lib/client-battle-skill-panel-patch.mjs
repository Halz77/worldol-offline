export const battleSkillPanelRevision='battle-skill-panel-selfheal-v5';

// 战斗中点「技能」偶尔列表整块空白、只剩描述区一行技能说明，无法选择要释放的技能；有时又正常。
//
// 已按主包逐处核对的事实：
//   * 基类 show(args) 写 this._showArgs=args；doHide() 里置回 null。
//     而 doShow() 只被 show() 调用 → onShow 必定伴随一次 show(args)。
//   * BattleSkill 弹窗的 onShow 只做两件事：把 this._showArgs 逐项 addItem 进 _dataList、
//     selectedIndex=0、tapItem()（无参 → 只 updateInfo）。它自己不清 txtDesc。
//     → 所以列表空白而描述有字，只有两种可能：
//        A. _showArgs 为空：列表被清空却不重建，txtDesc 保留上一轮文字；
//        B. _showArgs 正常：selectedIndex=0 的 updateInfo 正常写出第 1 个技能的说明，
//           但 eui 虚拟列表的渲染器没被建出来（数据在、行不渲染）——
//           而截图里那句说明正是主动技能列表的第 1 个（543 女妖之嚎），与此完全吻合。
//   * 该弹窗实例 keepMdr=!0（Battle 模块 initView），全程复用，_view / _dataList 都长期存活，
//     所以上面两种状态都会跨回合残留。
//
// 修法（自愈，不赌单一触发路径）：
//   1. 战斗面板作用域挂一个全局解析器 __worldBattleSkillHelper(unit)，
//      内容就是原本真正生效的 a.getSkillListByType(unit.skillList, l.SKILL_TYPE_ACTIVE)。
//      —— 这两个模块变量只在战斗面板模块里是技能助手/技能类型常量；弹窗模块里同名的
//         a 是 UI 基类、l 是皮肤类，模块 54 才是战斗控制器，所以弹窗里不能直接引用 a/l。
//   2. onShow 发现 _showArgs 为空 → 用控制器取当前出手单位，经解析器重取主动技能；
//      解析器不可用时退回 initSkillListPanel 缓存的列表。
//   3. 填充后强制重建虚拟列表渲染器（ArrayCollection.refresh，失败则 dataProvider 换手），
//      再 validateNow()，覆盖"数据在但行不渲染"导致的空白。
//      这一步放在下一帧异步执行，只在「数据有但一个渲染器都没建出来」时才动手，
//      不阻塞本次面板显示。
//      —— 演进记录（都是为了让「释放技能」这一步不卡）：
//        v3：每次打开面板无条件 refresh + validateNow + 下一帧再来一次（同步布局，必卡）。
//        v4：改成同步判断 numElements 后决定是否重建；但 eui 的 numElements 只是
//            dataProvider 的条数、不是渲染器数，判断本身保不了"行没渲染"这种情况。
//        v5：改成下一帧异步检查 numChildren（真实渲染器数），同步路径零开销。
//   3b. 列表内容与上次逐项相同时，跳过 removeAll/addItem —— 这一步会让整个 eui 列表
//       失效并在下一帧重建全部渲染器，而同一角色连续回合的主动技能列表根本没变。
//   3c. updateInfo 缓存技能描述：原实现每次都 getDesc() -> parseHtml() -> textFlow 富文本
//       重排，而技能说明在战斗中是静态文本。这是「点技能卡一下」的主要开销。
//   4. 确实没有任何技能时清掉残留描述，不留半截界面。
//   5. initSkillListPanel 侧：主动技能为空时除提示外回退到默认攻击，别让玩家卡住。
export function patchBattleSkillPanel(source){
  // --- 1. 弹窗 onShow：自愈参数 + 强制重建渲染器 -----------------------------
  const oldOnShow='onShow=function(){if(this._isSelected=!1,this._dataList.length&&this._dataList.removeAll(),this._showArgs&&this._showArgs.length){for(var e=0,t=this._showArgs;e<t.length;e++){var i=t[e];this._dataList.addItem(i)}this._view.list.selectedIndex=0,this.tapItem()}}';
  // v5：列表内容与上次完全相同时跳过 removeAll/addItem —— 这一步会让 eui 列表整体失效
  // 并在下一帧重建全部渲染器，而同一角色连续回合的技能列表根本没变，纯属浪费。
  // 强制重建改成下一帧异步检测（数据有但一个渲染器都没建出来才动手），不再阻塞本次显示。
  const newOnShow='onShow=function(){if(this._isSelected=!1,!this._showArgs||!this._showArgs.length){try{var _ins=o["default"].ins,_bp=_ins&&_ins.battlePanel,_op=_bp&&_bp.getOrderPlayer(),_ls=window.__worldBattleSkillHelper?window.__worldBattleSkillHelper(_op):null;if(!_ls||!_ls.length){var _ck=window.__worldBattleSkillCache;_ck&&(!_op||_ck.player===_op)&&(_ls=_ck.list)}_ls&&_ls.length&&(this._showArgs=_ls,_ins.skillPlayer=_op)}catch(_e){}}if(this._showArgs&&this._showArgs.length){var _same=this._dataList.length===this._showArgs.length;if(_same)for(var _k=0;_k<this._showArgs.length;_k++){if(this._dataList.getItemAt(_k)!==this._showArgs[_k]){_same=!1;break}}if(!_same){this._dataList.length&&this._dataList.removeAll();for(var e=0,t=this._showArgs;e<t.length;e++){var i=t[e];this._dataList.addItem(i)}}this._view.list.selectedIndex=0,this.tapItem();var _self=this;setTimeout(function(){if(!_self.isOpen||!_self._showArgs||!_self._showArgs.length)return;try{var _l=_self._view.list;if(_l.numChildren&&_l.numChildren>0)return;try{_self._dataList.refresh()}catch(_e){try{_l.dataProvider=null,_l.dataProvider=_self._dataList}catch(_e2){}}try{_l.selectedIndex=0,_l.validateNow(),_self.updateInfo()}catch(_e){}}catch(_e){}},0)}else try{this._view.txtDesc.text="",this._lastDescKey=null}catch(_e){}}';
  if(source.split(oldOnShow).length!==2)throw Error('v305 battle skill panel onShow patch mismatch');
  source=source.replace(oldOnShow,newOnShow);

  // --- 1b. 弹窗 updateInfo：技能描述缓存 --------------------------------------
  // 原实现每次都 getDesc() 生成描述 -> parseHtml() -> textFlow 富文本重排。
  // 技能说明在战斗中是静态文本，每回合重来一遍只是把同一段富文本反复排版，
  // 手机上这一步就是「点技能卡一下」的主要来源。同技能同宽度时直接跳过。
  const oldUpdateInfo='updateInfo=function(){var e=this._view.list.selectedItem;if(e&&e.id){var t=e.getDesc(!1,this._view.txtDesc.width,this._view.txtDesc.size);this._view.txtDesc.textFlow=n["default"].parseHtml(t)}}';
  const newUpdateInfo='updateInfo=function(){var e=this._view.list.selectedItem;if(e&&e.id){var _w=this._view.txtDesc.width,_s=this._view.txtDesc.size,_k=e.id+"|"+(void 0===e.level?0:e.level)+"|"+_w+"|"+_s;if(this._lastDescKey===_k)return;this._lastDescKey=_k;var t=e.getDesc(!1,_w,_s);this._view.txtDesc.textFlow=n["default"].parseHtml(t)}}';
  if(source.split(oldUpdateInfo).length!==2)throw Error('v305 battle skill panel updateInfo patch mismatch');
  source=source.replace(oldUpdateInfo,newUpdateInfo);

  // --- 2. 战斗面板 initSkillListPanel：注入解析器 + 缓存 + 兜底 --------------
  const oldInit='initSkillListPanel=function(){var e=this.getOrderPlayer();if(null!=e){var t=a["default"].getSkillListByType(e.skillList,l["default"].SKILL_TYPE_ACTIVE);if(null==t||0==t.length)return void p["default"].alertMessage(u.GameText.getText(u.GameText.TI_BATTLE_NO_SKILL));E["default"].ins.skillPlayer=e,E["default"].ins.showSkill(t)}}';
  const newInit='initSkillListPanel=function(){var e=this.getOrderPlayer();if(null==e)return;try{window.__worldBattleSkillHelper=function(_p){try{return a["default"].getSkillListByType(_p&&_p.skillList,l["default"].SKILL_TYPE_ACTIVE)}catch(_x){return null}}}catch(_x){}var t=a["default"].getSkillListByType(e.skillList,l["default"].SKILL_TYPE_ACTIVE);if(null==t||0==t.length){p["default"].alertMessage(u.GameText.getText(u.GameText.TI_BATTLE_NO_SKILL));try{this.initAttackOrder()}catch(_x){}return}try{window.__worldBattleSkillCache={list:t,player:e}}catch(_x){}E["default"].ins.skillPlayer=e,E["default"].ins.showSkill(t)}';
  if(source.split(oldInit).length!==2)throw Error('v305 battle skill panel init patch mismatch');
  source=source.replace(oldInit,newInit);

  return source;
}
