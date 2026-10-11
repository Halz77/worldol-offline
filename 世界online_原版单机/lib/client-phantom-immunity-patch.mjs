export const phantomImmunityRevision='phantom-immune-except-remove-buff-v2';

// MOD(phantom-immunity)：幻影状态（BUFFER_HIDE=14，出自「幻影法球」）的说明是
// 「幻影状态不受物理范围(群体)攻击伤害」。v305 的 calDamage（module 0251）写成
//
//   1==l && s!=ATKTYPE_MAGIC && s!=ATKTYPE_CURSE && 目标有 BUFFER_HIDE  → 整个技能无效
//
// 其中 l = 「技能范围不是单体」。这条规则本身对（群体祝福会被挡），但漏了一个例外：
// **带「清除增益状态」效果的群体祝福应当照常生效**。
//
// 「解除魔法」(548) 就是这种技能 —— module 0057 的技能对象里：
//   power1=79(POWER_REMOVE_STATUS)/powerValue1=25(BUFFER_TYPE_BUFF)  → 清除目标增益
//   power2=79(POWER_REMOVE_STATUS)/powerValue2=26(BUFFER_TYPE_DEBUFF) → 清除目标减益
//   skillAtkType=6(ATKTYPE_BLESS)
// 它的 1–21 级 area=10(敌单体，范围判定本来就不会命中这条分支)，22 级 area=19(敌全体=群体)
// 并附带 power3=52(POWER_MP_PERCENT)/powerValue3=-8「燃烧最大法力值-8%」。
// 原版里 22 级解除魔法打在幻影怪身上整段被拦掉：calDamage 返回 !1，
// module 0251 的施放流程 `1==calDamage(...)&&processSkillPower(...)` 随之不成立，
// 效果1/2/3（含扣蓝）全部不执行。
//
// 修法：在免疫条件里补上例外 —— 「祝福类型 且 带清除增益状态」的群体技能不免疫。
//   · 普通群体祝福              → 仍被幻影免疫（保持原版行为）；
//   · 单体祝福                  → l=0，本来就不走这条分支，照常生效；
//   · 所有带清除增益的群体祝福  → 豁免生效（不只解除魔法，同类技能都适用）；
//   · 物理群体技能即使在带驱散  → 依然免疫，不会让幻影吃到范围物理伤害。
// 祝福分支本身不产生伤害（calDamage 会把 DMG_DATA 全填 0、只标 EFFECT_HIT），
// 所以放行后幻影怪只会被解掉增益，不会被打掉血。
export function patchPhantomImmunity(source){
  const magic='c["default"].ATKTYPE_MAGIC';
  const curse='c["default"].ATKTYPE_CURSE';
  const bless='c["default"].ATKTYPE_BLESS';
  const hide='c["default"].getBufferBitValue(c["default"].BUFFER_HIDE)';
  const head='1==l&&s!='+magic+'&&s!='+curse+'&&';
  const tail='t.isBattleStatus('+hide+')';

  // 带「清除增益状态」效果：任一 power 位是 POWER_REMOVE_STATUS 且对应值是 BUFFER_TYPE_BUFF。
  // 不能用 getBufferType() 判 —— 25/26 本身是「类型枚举」，getBufferType 只按具体状态编号
  // (1–10/30/31) 判 debuff，会把 26(DEBUFF) 也当成 BUFF。
  const buffStrip='i.power1==c["default"].POWER_REMOVE_STATUS&&i.powerValue1==c["default"].BUFFER_TYPE_BUFF'
    +'||i.power2==c["default"].POWER_REMOVE_STATUS&&i.powerValue2==c["default"].BUFFER_TYPE_BUFF'
    +'||i.power3==c["default"].POWER_REMOVE_STATUS&&i.powerValue3==c["default"].BUFFER_TYPE_BUFF';

  // 豁免 = 祝福类型 且 带清除增益。取「非(祝福 且 带清除增益)」放进免疫条件，
  // 这样非祝福的群体技能（含物理）即使带驱散也仍被免疫。
  const exempt='!(s=='+bless+'&&('+buffStrip+'))';

  const from=head+tail;                    // 原版形态
  const v1=head+'s!='+bless+'&&'+tail;     // 上一版（v1）形态：无条件排除祝福
  const to=head+exempt+'&&'+tail;          // 本版形态：只豁免「祝福 + 带清除增益」

  if(source.includes(to))return source;    // 幂等
  if(source.split(from).length===2)return source.replace(from,to);
  if(source.split(v1).length===2)return source.replace(v1,to);   // 兼容已打过 v1 的产物
  throw Error('v305 phantom immunity patch mismatch');
}
