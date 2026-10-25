export const battleCheckRevision='battle-check-full-fields-v7';

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
// 第 89 版：攻击侧字段（原面板只有防御侧）。玩家自制技能要测「打出去多少」，
//   「查看」面板却只显示防御/抗性。这里补 10 个读 ModelConst 的字段：
//     攻击力（ATK_MIN~ATK_MAX）、破甲（BRK_ARMOR）、
//     劈砍攻击力（ATK_STR）、穿刺攻击力（ATK_AGI）、魔法攻击力（ATK_MAGIC）、
//     魔法穿透（MAGIC_PENETRATION）、致命点（CRITICAL）、
//     物理命中（HIT_RATE）、魔法命中（HIT_MAGIC）、强制命中率（FORCE_HIT）。
//   全是 wire 上的真字段；文案全部取自 GameText（模块 10），不新增字面量。
//   逐手武伤/攻次（LEFT_/RIGHT_ATK_*）不塞进「查看」面板，避免把面板撑得过长；
//   需要看逐手数据时用网页版伤害计算器（web/damage-calculator.html）。
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

  // --- 1.5 原来那 9 个字段读的是 VO 上的**原始字段**（e.speed/e.dodge/e.def_str…） ------
  // 第 99 版：这些字段在玩家单位上根本没被填过，面板上永远是 0（玩家反馈「劈砍防御力/闪避/
  // 出手速度/状态抵抗/伤害减免/格挡/洞察全是 0」）。改成和其它字段同一口径：
  //   e.get(ModelConst.X) —— 走引擎的属性计算（含装备/技能/被动/阵法/称号/buffer）。
  // 劈砍/穿刺防御优先取 DEF_STR/DEF_AGI，为 0 时退回「近身」那一列（这游戏实际用的是近身/远程两列）。
  const attrFixes=[
   ['t.append(n.GameText.STR_ATTR_SPEED+":"+e.speed+"\\n")',
    't.append(n.GameText.STR_ATTR_SPEED+":"+(e.get(a.ModelConst.SPEED)||0)+"\\n")'],
   ['t.append(n.GameText.STR_CHANGE_ATT_DESC_DODGE+":"+e.dodge+"  ")',
    't.append(n.GameText.STR_CHANGE_ATT_DESC_DODGE+":"+(e.get(a.ModelConst.DODGE)||0)+"  ")'],
   ['t.append(n.GameText.STR_MONSTER_DEF_STR+e.def_str+"\\n")',
    't.append(n.GameText.STR_MONSTER_DEF_STR+((e.get(a.ModelConst.DEF_STR)||0)||(e.get(a.ModelConst.DEF_STR_NEARBY)||0))+"\\n")'],
   ['t.append(n.GameText.STR_MONSTER_DEF_AGI+e.def_agi+"  ")',
    't.append(n.GameText.STR_MONSTER_DEF_AGI+((e.get(a.ModelConst.DEF_AGI)||0)||(e.get(a.ModelConst.DEF_AGI_NEARBY)||0))+"  ")'],
   ['t.append(n.GameText.STR_MONSTER_DEF_MAGIC+e.def_magic+"\\n")',
    't.append(n.GameText.STR_MONSTER_DEF_MAGIC+(e.get(a.ModelConst.DEF_MAGIC)||0)+"\\n")'],
   ['t.append(n.GameText.STR_ATTR_WIL+":"+e.wil+"  ")',
    't.append(n.GameText.STR_ATTR_WIL+":"+(e.get(a.ModelConst.WIL)||0)+"  ")'],
   ['t.append(n.GameText.STR_ATTR_TOUGH+":"+e.tough+"\\n")',
    't.append(n.GameText.STR_ATTR_TOUGH+":"+(e.get(a.ModelConst.TOUGH)||0)+"\\n")'],
   ['t.append(n.GameText.STR_ATTR_BLOCK+":"+e.block+"  ")',
    't.append(n.GameText.STR_ATTR_BLOCK+":"+(e.get(a.ModelConst.BLOCK)||0)+"  ")'],
   ['t.append(n.GameText.STR_ATTR_INSIGHT+":"+e.insight+"\\n")',
    't.append(n.GameText.STR_ATTR_INSIGHT+":"+(e.get(a.ModelConst.INSIGHT)||0)+"\\n")']
  ];
  for(const [from,to] of attrFixes){
    if(source.split(from).length!==2)throw Error('v305 battle check attr patch mismatch: '+from.slice(0,60));
    source=source.replace(from,to);
  }

  // --- 2. 洞察之后补 12 个字段（每行两个）---------------------------------
  // 文案命名空间（这就是上一版把标签渲染成 undefined 的真正原因）：
  //   · GameText（模块 10）：STR_ATTR_INSIGHT/BLOCK/BACK/MAGIC_BACK/DEF_FIELD/ATK_TIME 等
  //   · GameText2（模块 23）：STR_ATTR_IGNORE_BACK/MAGIC_BACK/BLOCK/INSIGHT/WIL/TOUCH
  //     —— 面板模块只 import 了模块 10，所以「无视*」必须经 window.__worldReq(23).GameText2 取；
  //        写成 n.GameText.STR_ATTR_IGNORE_BLOCK 恒为 undefined（面板上就是 `undefined:0`）。
  // 注意：上面 attrFixes 已经把 insight 那句改写成 e.get(...)，这里的锚点要用**改写后**的文本
  const tail='t.append(n.GameText.STR_ATTR_INSIGHT+":"+(e.get(a.ModelConst.INSIGHT)||0)+"\\n")),null!=e.formationSkill&&';
  const tailNew='t.append(n.GameText.STR_ATTR_INSIGHT+":"+(e.get(a.ModelConst.INSIGHT)||0)+"\\n"),'
   // 第 99 版：近身/远程四列不再显示（玩家要求；劈砍/穿刺防御力已经在上面按 DEF_STR→近身 兜底显示）
   +'t.append(n.GameText.STR_ATTR_DEF_FIELD+":"+(e.get(a.ModelConst.DEF_FIELD)||0)+"  "),'
   +'t.append(n.GameText.STR_ATTR_ATK_TIME+":"+(e.get(a.ModelConst.ATK_TIME)||0)+"\\n"),'
   +'t.append(n.GameText.STR_ATTR_BACK+":"+(e.get(a.ModelConst.BACK)||0)+"  "),'
   +'t.append(n.GameText.STR_ATTR_MAGIC_BACK+":"+(e.get(a.ModelConst.MAGIC_BACK)||0)+"\\n"),'
   +'t.append(window.__worldReq(23).GameText2.STR_ATTR_IGNORE_INSIGHT+":"+(e.get(a.ModelConst.IGNORE_INSIGHT)||0)+"  "),'
   +'t.append(window.__worldReq(23).GameText2.STR_ATTR_IGNORE_BLOCK+":"+(e.get(a.ModelConst.IGNORE_BLOCK)||0)+"\\n"),'
   +'t.append(window.__worldReq(23).GameText2.STR_ATTR_IGNORE_WIL+":"+(e.get(a.ModelConst.IGNORE_WIL)||0)+"  "),'
   +'t.append(window.__worldReq(23).GameText2.STR_ATTR_IGNORE_TOUCH+":"+(e.get(a.ModelConst.IGNORE_TOUCH)||0)+"\\n"),'
   // —— 第 89 版：攻击侧字段（上面是防御侧）——
   +'t.append(n.GameText.STR_ATTR_ATK+":"+(e.get(a.ModelConst.ATK_MIN)||0)+"~"+(e.get(a.ModelConst.ATK_MAX)||0)+"  "),'
   +'t.append(n.GameText.STR_ATTR_BRK+":"+(e.get(a.ModelConst.BRK_ARMOR)||0)+"\\n"),'
   +'t.append(n.GameText.STR_CHANGE_ATT_DESC_ATK_STR+":"+(e.get(a.ModelConst.ATK_STR)||0)+"  "),'
   +'t.append(n.GameText.STR_CHANGE_ATT_DESC_ATK_AGI+":"+(e.get(a.ModelConst.ATK_AGI)||0)+"\\n"),'
   +'t.append(n.GameText.STR_CHANGE_ATT_DESC_ATK_MAGIC+":"+(e.get(a.ModelConst.ATK_MAGIC)||0)+"  "),'
   +'t.append(n.GameText.STR_ATTR_MAGIC_PEN+":"+(e.get(a.ModelConst.MAGIC_PENETRATION)||0)+"\\n"),'
   +'t.append(n.GameText.STR_ATTR_CRITICAL+":"+(e.get(a.ModelConst.CRITICAL)||0)+"  "),'
   +'t.append(n.GameText.STR_ATTR_HIT_RATE+":"+(e.get(a.ModelConst.HIT_RATE)||0)+"\\n"),'
   +'t.append(n.GameText.STR_ATTR_HIT_MAGIC+":"+(e.get(a.ModelConst.HIT_MAGIC)||0)+"  "),'
   +'t.append(n.GameText.STR_ATTR_FORCE_HIT+":"+(e.get(a.ModelConst.FORCE_HIT)||0)+"\\n"),'
   +'t.append("生命百分比伤害减免："+Math.min(0|(e.get(a.ModelConst.TOUGH)/100),80)+"%\\n"),'
   // 阵位标注（第 99 版）：只给「真的吃到阵位加成」的单位标一行，多人同屏时好分辨谁在第几位。
   // 军团/队友自己没有 formationSkill 也照样能标（补丁里会用玩家当前阵型 + 阵位序号算）。
   // 第 102 版临时诊断：把面板 e 的运行时结构打出来，用于定位「战斗前后数值不变」的根因。
   +'t.append((function(){var L=window.__worldolFormationSlotPatch,s=L&&L.slotLabel?L.slotLabel(e):null;var D=L&&L.diag?L.diag(e):"";return (s?"【阵位："+s+"】\\n":"")+D;})())),null!=e.formationSkill&&';
  if(source.split(tail).length!==2)throw Error('v305 battle check tail patch mismatch');
  source=source.replace(tail,tailNew);
  return source;
}
