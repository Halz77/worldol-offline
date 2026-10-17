export const battleManaRecoveryRevision='battle-monster-mana-no-regen-at-zero-v1';

// 「怪物法力为 0 时，下回合不再持续回蓝」。
//
// 每回合的血/蓝回复在模块 251 的 `doRoundHpMp(vo)` 里：
//     var t = vo.get(ModelConst.HEAL_RECOVERY),     // 每回合自动恢复生命（属性 60）
//         i = vo.get(ModelConst.MANA_RECOVERY),     // 每回合自动恢复法力（属性 61）
//         n = vo.hpMax, a = vo.mpMax, r = 0, s = 0;
//     if (vo.isBattleStatus(BUFFER_ADD_HP) && (r = intNum(0.005 * n)),   // 天生状态「持续回血」
//         vo.isBattleStatus(BUFFER_ADD_MP) && (s = intNum(0.005 * a)),   // 天生状态「持续回魔」
//         r > 0 && (t += r), s > 0 && (i += s), t > 0) { …回血… }
//     if (i > 0) {                                  // ← 蓝量回复
//        var l = !0; vo.isBattleStatus(BUFFER_POISON) && (l = !1);
//        1 == l && processBattleHpMpPower(vo, ModelConst.MP, i, 0, o)
//     }
//
// 也就是说：只要怪身上挂着「持续回魔」（BUFFER_ADD_MP，每回合 0.5% 法力上限）或者
// MANA_RECOVERY > 0，**哪怕当前法力是 0，下回合照样回**（回 0.5% 上限，再下回合继续涨）。
// 这里按需求改掉：怪物（isMonster）法力已经 ≤ 0 时，跳过这一段的每回合回蓝。
//   · 天生状态（BUFFER_ADD_MP）不动，属性也不动 —— 只是不再往 0 蓝的怪身上灌法力；
//   · 只影响「每回合自动回复」这一条路；技能/道具给怪加蓝（走 processBattlePower 的
//     POWER_MP / POWER_MANA_ABSORPTION 等）照旧生效，玩家的单位也完全不受影响。
//
// 注入点在**语句上下文**的函数体内（`if(i>0){…}` 这条），只把条件补一段，
// 不碰任何逗号链 —— 这是第 51 版翻过车的地方。
export function patchBattleMonsterManaRecovery(source){
  const from='if(i>0){var l=!0;e.isBattleStatus(c["default"].getBufferBitValue(c["default"].BUFFER_POISON))&&(l=!1),';
  const to='if(i>0&&!(e.isMonster&&0>=e.get(f.ModelConst.MP))){var l=!0;e.isBattleStatus(c["default"].getBufferBitValue(c["default"].BUFFER_POISON))&&(l=!1),';
  if(source.split(from).length!==2)throw Error('v305 monster mana recovery patch mismatch');
  return source.replace(from,to);
}
