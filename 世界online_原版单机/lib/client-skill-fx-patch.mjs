/**
 * 客户端补丁：战斗中按配置替换技能特效（第 93 版「技能自定义特效」）。
 *
 * 移植来源（2026-10-25，用户拍板按《技能自定义特效功能-AI复刻手册-20261014.md》
 * 八步施工，zip 提取包作参照）：
 *   · 手册（猫鼬项目 v1.9.105）：doUseSkill 基类 + e.isMyPlayer 判归属、判不出不替换
 *   · zip 提取包（client-skill-animation-patch.mjs）：createBattleUseSkillControl
 *     第 8 参就是技能名；真机结论「单机无真人队友，宠物同名一跳纯表现层可接受」
 *
 * 两份经验合并后的落地策略（差异点在此，改前必读）：
 *   1. 播放层替换，**不动字节层**——wireBase64/anime2 一概不碰，所以不需要
 *      zip 那套 fxEditableOf 探针（那是改服务端 anime2 的路线才需要的保护）。
 *      被动技能本来就不播技能动画，自然无效果，也不会被改坏。
 *   2. 归属判定「尽力而为」：doUseSkill 窗口能判就判（明确是宠物/他人 ⇒ 不替换），
 *      窗口没盖上（基类未加载/时序不利）⇒ 按名字隔离降级，保证功能可用。
 *      单机场景下最坏情况与 zip 真机结论一致：宠物同名技能被一带一跳。
 *   3. 段护栏 + 号存在性校验在桥（web/skill-fx.js）做；这里再兜一层 1200~1699。
 *
 * 构建接线：本文件只被 lib/client-patch-chain.mjs 的 CLIENT_MAIN_STEPS 引用，
 * server.mjs（电脑版运行时）与 安卓打包/standalone/build.mjs（APK 构建期）自动同步。
 */
export const skillFxRevision = 'skill-fx-switch-20261025-v1';

/** 安装战斗替换层。导出仅供单测（vm 沙箱）驱动；生产走 patchSkillFxSwitch 注入。 */
export function installSkillFxSwitch(req, host) {
  host = host || globalThis;
  if (host.__worldolSkillFxPatch) return host.__worldolSkillFxPatch;
  // 模块号与 zip 来源项目同源（v305 同一主包）。断言缺失即抛错，让补丁链测试暴露。
  const WireControl = req(184).default;
  if (typeof WireControl.createBattleUseSkillControl !== 'function')
    throw Error('skill fx patch: WireControl.createBattleUseSkillControl missing');

  // 归属窗口：战斗演算基类（原型同时具备 doUseSkill + calDamage）的 doUseSkill
  // 包装在调用窗口内记录「这次是不是我」。基类可能晚于本补丁加载 ⇒ 轮询补挂。
  let currentOwner = null;   // {my:bool,id:number} | null
  let ownerHooked = false;
  let attachTimer = null;
  const counters = { replaced: 0, suppressed: 0, byName: 0, attachRetries: 0 };

  function findBattleCalcProto() {
    const cache = req.c;
    if (!cache) return null;
    for (const key in cache) {
      let mod;
      try { mod = cache[key]; } catch (_) { continue; }
      const proto = mod && (mod.prototype || (mod.default && mod.default.prototype));
      if (proto && typeof proto.doUseSkill === 'function' && typeof proto.calDamage === 'function')
        return proto;
    }
    return null;
  }
  function attachCalc() {
    if (ownerHooked) return true;
    const proto = findBattleCalcProto();
    if (!proto) { counters.attachRetries++; return false; }
    // 自属标记判定：先打子类后打基类时，子类继承读到标记会被误跳过（手册陷阱 2 同款）。
    if (Object.prototype.hasOwnProperty.call(proto, '__worldolSkillFxOwner')) { ownerHooked = true; return true; }
    const original = proto.doUseSkill;
    proto.doUseSkill = function (e) {
      const previous = currentOwner;
      currentOwner = { my: !!(e && e.isMyPlayer), id: (e && e.id) || 0 };
      try { return original.apply(this, arguments); }
      finally { currentOwner = previous; }
    };
    proto.__worldolSkillFxOwner = true;
    ownerHooked = true;
    return true;
  }
  // 先同步挂一次：主包已就绪的绝大多数情况这一步就挂上，不起轮询定时器
  // （测试进程不会因 800ms interval 挂住）。只有基类真没加载才轮询补挂。
  if (!attachCalc()) attachTimer = setInterval(() => { if (attachCalc()) clearInterval(attachTimer); }, 800);

  // ── 播放层替换 ─────────────────────────────────────────────
  // 引擎签名（zip 同源取证）：createBattleUseSkillControl(position, target, area,
  // position, start, effect, last, name) —— 第 1 参是战场位置不是 actor，
  // 第 8 参才是技能名。effect 即 anime2。
  const createSkillControl = WireControl.createBattleUseSkillControl;
  WireControl.createBattleUseSkillControl = function (position, target, area, position2, start, effect, last, name) {
    // 窗口明确判出「不是我的角色」（宠物/他人施放）⇒ 保持原生特效，绝不串色。
    if (currentOwner && !currentOwner.my) { counters.suppressed++; return createSkillControl.apply(this, arguments); }
    try {
      const bridge = host.__worldolSkillFx;
      const fx = bridge && bridge.resolveForBattle(name);
      // 双保险：段护栏（桥里也有一道）+ 必须是数字。上限 29999 而非 1699 ——
      // 我们用的 zip 181 池含高段自制号（29990），1699 会误杀。
      if (typeof fx === 'number' && fx >= 1200 && fx <= 29999) {
        effect = fx;
        counters.replaced++;
      }
    } catch (_) { /* 桥未就绪 = 不干预，保持原特效 */ }
    return createSkillControl.call(this, position, target, area, position2, start, effect, last, name);
  };

  // api 字面量必须内联：本函数经 toString() 注入主包，闭包外顶层 const 不可见（手册陷阱 11）。
  const api = {
    revision: 'skill-fx-switch-20261025-v1',
    get status() {
      return { replaced: counters.replaced, suppressed: counters.suppressed, byName: counters.byName, attachRetries: counters.attachRetries, ownerHooked };
    },
    /** 测试钩子：直接查某个技能名当前会解析成什么（不打战斗）。 */
    peek: name => {
      const bridge = host.__worldolSkillFx;
      try { return bridge ? bridge.resolveForBattle(name) : null; } catch (_) { return null; }
    },
    /** 测试钩子：手动触发一次归属基类补挂（模拟轮询路径）。 */
    probeAttach: () => attachCalc(),
    /** 测试钩子：模拟归属窗口（单测没有真战斗）。 */
    fakeOwner: owner => { currentOwner = owner; },
    clearOwner: () => { currentOwner = null; },
    /** 停掉轮询定时器（测试收尾/热重用）。 */
    stop: () => { if (attachTimer) { clearInterval(attachTimer); attachTimer = null; } }
  };
  host.__worldolSkillFxPatch = api;
  return api;
}

/**
 * build/server 两用的补丁入口：把 installSkillFxSwitch.toString() 追加到主包末尾。
 * 追加而非替换中间文本——锚点只用于「原版换包即抛错」的存在性校验。
 */
export function patchSkillFxSwitch(source) {
  if (source.includes('__worldolSkillFxPatch')) throw Error('Skill fx patch already installed');
  if (!source.includes('createBattleUseSkillControl=function'))
    throw Error('skill fx patch mismatch: createBattleUseSkillControl=function');
  return source + '\n;(' + installSkillFxSwitch.toString() + ')(window.__worldReq,window);\n';
}
