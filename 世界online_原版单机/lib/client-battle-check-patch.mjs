export const battleCheckRevision='battle-check-full-fields-v5';

// 战斗里「查看」弹出的战斗信息面板（BattleCheck）原来只在一处开关后面显示 12 个字段：
//   e.isCheckAll &&（出手速度/闪避/三项防御/状态抵抗/伤害减免/格挡/洞察）
// 普通战斗里走「查看 → 选目标」这条路的单位根本没人设置 isCheckAll，于是
// 面板只有 生命/法力/免伤护盾 三行 —— 玩家以为「点怪物看不到详情」，实际是字段被门挡了。
//
// 本次改动（对齐玩家给的截图 / 参考图）：
//   1. 去掉 isCheckAll 门：任何单位（玩家/宠物/怪物）都显示完整字段。
//   2. 洞察之后补 12 个字段（每行两个）：
//        近身/远程劈砍防御力、近身/远程穿刺防御力
//        法力护盾、攻击次数、反击、魔法反馈
//        无视洞察、无视格挡、无视状态抵抗、无视伤害减免
//      数值一律走 e.get(ModelConst.X)||0，缺属性按 0 显示（怪物大多为 0）。
//   3. 末尾再补一行派生的「生命百分比伤害减免」——**这条不是 wire 上的字段**，
//      而是把强韧（TOUGH）换算成战斗引擎真正用的减伤百分比（见下）。
//
// 生命百分比伤害减免怎么算（第 75 版）：
//   战斗里减免走 BattleCalc.calTouch → calTouchDmg：
//     n = TOUGH（血/弱状态减半）→ 减去攻击方的 IGNORE_TOUCH 与技能 POWER_SKILL_TARGET_TOUCH
//     → 上限 MAX_RATE_TOUCH=700 → 实际减伤 = n/1000
//   面板按玩家要求**照抄参考实现「幻想世界OL」的算式**：min(TOUGH/100, 80)%。
//   ⚠ 注意与引擎自身的换算差 10 倍：引擎里 TOUGH 是千分比（700 → 70% 封顶），
//     参考实现写成 /100（同一条 TOUGH 只显示 7%）。玩家明确要求与其面板一致，故照抄；
//     要改成引擎真值就是把 /100→/10、80→70（一行）。
//   这条对玩家 / 宠物 / 怪物同一段代码生效（面板只有这一条分支）。
//
// 文案必须看清**命名空间**（v2/v3 把标签渲染成 `undefined` 的真正原因）：
//   · GameText （模块 10）：STR_ATTR_INSIGHT / STR_ATTR_DEF_FIELD / STR_ATTR_ATK_TIME /
//     STR_ATTR_BACK / STR_ATTR_MAGIC_BACK / STR_CHANGE_ATT_DESC_* —— 面板模块 n=i(10)，直接用。
//   · GameText2（模块 23）：STR_ATTR_IGNORE_BLOCK / _INSIGHT / _WIL / _TOUCH（+ _BACK/_MAGIC_BACK）。
//     面板模块**没有** import 模块 23，所以 n.GameText.STR_ATTR_IGNORE_* 恒为 undefined
//     → 面板上就是 `undefined:0`。这里经首个补丁暴露的 window.__worldReq(23).GameText2 取，
//     仍然是游戏自己的文案，不新增字面量。
//     措辞与模块 4 的 getPowerDesc 一致：反击 / 魔法反馈 / 无视格挡 / 无视洞察 /
//     无视状态抵抗 / 无视伤害减免 / 法力护盾。
export function patchBattleCheckFields(source){
  // --- 1. 摘掉 isCheckAll 门 ---------------------------------------------
  // 原代码：t.append(免伤护盾),e.isCheckAll&&(t.append(出手速度)...,t.append(洞察)) ,null!=e.formationSkill...
  // 改后：  t.append(免伤护盾),(t.append(出手速度)...,t.append(洞察)),null!=e.formationSkill...
  // 用括号表达式保留原有逗号结构，后面插字段时不用再动这段的括号配对。
  const gate=',e.isCheckAll&&(t.append(n.GameText.STR_ATTR_SPEED+":"+e.speed+"\\n"),';
  const gateNew=',(t.append(n.GameText.STR_ATTR_SPEED+":"+e.speed+"\\n"),';
  if(source.split(gate).length!==2)throw Error('v305 battle check gate patch mismatch');
  source=source.replace(gate,gateNew);

  // --- 2. 洞察之后补 12 个字段（每行两个）---------------------------------
  // 文案命名空间（这就是上一版把标签渲染成 undefined 的真正原因）：
  //   · GameText（模块 10）：STR_ATTR_INSIGHT/BLOCK/BACK/MAGIC_BACK/DEF_FIELD/ATK_TIME 等
  //   · GameText2（模块 23）：STR_ATTR_IGNORE_BACK/MAGIC_BACK/BLOCK/INSIGHT/WIL/TOUCH
  //     —— 面板模块只 import 了模块 10，所以「无视*」必须经 window.__worldReq(23).GameText2 取；
  //        写成 n.GameText.STR_ATTR_IGNORE_BLOCK 恒为 undefined（面板上就是 `undefined:0`）。
  const tail='t.append(n.GameText.STR_ATTR_INSIGHT+":"+e.insight+"\\n")),null!=e.formationSkill&&';
  const tailNew='t.append(n.GameText.STR_ATTR_INSIGHT+":"+e.insight+"\\n"),'
   +'t.append(n.GameText.STR_CHANGE_ATT_DESC_NEARBY_DEF_STR+":"+(e.get(a.ModelConst.DEF_STR_NEARBY)||0)+"  "),'
   +'t.append(n.GameText.STR_CHANGE_ATT_DESC_RANGE_DEF_STR+":"+(e.get(a.ModelConst.DEF_STR_RANGE)||0)+"\\n"),'
   +'t.append(n.GameText.STR_CHANGE_ATT_DESC_NEARBY_DEF_AGI+":"+(e.get(a.ModelConst.DEF_AGI_NEARBY)||0)+"  "),'
   +'t.append(n.GameText.STR_CHANGE_ATT_DESC_RANGE_DEF_AGI+":"+(e.get(a.ModelConst.DEF_AGI_RANGE)||0)+"\\n"),'
   +'t.append(n.GameText.STR_ATTR_DEF_FIELD+":"+(e.get(a.ModelConst.DEF_FIELD)||0)+"  "),'
   +'t.append(n.GameText.STR_ATTR_ATK_TIME+":"+(e.get(a.ModelConst.ATK_TIME)||0)+"\\n"),'
   +'t.append(n.GameText.STR_ATTR_BACK+":"+(e.get(a.ModelConst.BACK)||0)+"  "),'
   +'t.append(n.GameText.STR_ATTR_MAGIC_BACK+":"+(e.get(a.ModelConst.MAGIC_BACK)||0)+"\\n"),'
   +'t.append(window.__worldReq(23).GameText2.STR_ATTR_IGNORE_INSIGHT+":"+(e.get(a.ModelConst.IGNORE_INSIGHT)||0)+"  "),'
   +'t.append(window.__worldReq(23).GameText2.STR_ATTR_IGNORE_BLOCK+":"+(e.get(a.ModelConst.IGNORE_BLOCK)||0)+"\\n"),'
   +'t.append(window.__worldReq(23).GameText2.STR_ATTR_IGNORE_WIL+":"+(e.get(a.ModelConst.IGNORE_WIL)||0)+"  "),'
   +'t.append(window.__worldReq(23).GameText2.STR_ATTR_IGNORE_TOUCH+":"+(e.get(a.ModelConst.IGNORE_TOUCH)||0)+"\\n"),'
   +'t.append("生命百分比伤害减免："+Math.min(0|(e.get(a.ModelConst.TOUGH)/100),80)+"%\\n")),null!=e.formationSkill&&';
  if(source.split(tail).length!==2)throw Error('v305 battle check tail patch mismatch');
  source=source.replace(tail,tailNew);
  return source;
}
