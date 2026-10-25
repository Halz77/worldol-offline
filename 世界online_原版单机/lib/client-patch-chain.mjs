/**
 * 客户端补丁链 —— 唯一来源。
 *
 * 原版主包（4.5MB 压缩产物）与引导脚本不改字节落盘，一律在内存里按固定
 * 顺序做字符串替换：
 *
 *   · 引导脚本 analysis/gd.decoded.js   → patchClientBoot()
 *   · 主包     js/ff/<hash>.js          → patchClientMain()
 *
 * 这条链以前会在两个地方各写一份：
 *   1. server.mjs（Node 直跑时运行时打补丁）
 *   2. 安卓打包/standalone/build.mjs（构建期打给站点用）
 * 两边的顺序必须完全一致，却只靠一句注释约束 —— 加第 18 个补丁时漏改一边、
 * 或把顺序写岔让两个补丁抢同一段文本，都要等到跑起来才炸。
 * 现在两个调用方都只 import 本模块，顺序在这里唯一确定。
 *
 * 顺序有讲究：同一个锚点附近如果被两个补丁动过，先跑的会把后跑的锚点改掉。
 * 调整顺序前先看 client-patch-chain.test.mjs —— 那里按名字把顺序钉死了。
 */
import {patchOfflineLegionBattles} from './client-legion-patch.mjs';
import {patchImmediateRoleDeletion} from './client-role-deletion-patch.mjs';
import {patchBattleDamageMath} from './client-damage-patch.mjs';
import {patchAttackPlan} from './client-attack-plan-patch.mjs';
import {patchCombatLimits} from './client-combat-limits.mjs';
import {patchGardenerManaRecovery} from './client-monster-recovery-patch.mjs';
import {patchNpcRepeatableMissions,patchOfflineStoryBattles,patchDailyCatalogVisibility,patchNpcMissionRefresh} from './client-mission-patch.mjs';
import {patchPlayerLevelRewards} from './client-progression-patch.mjs';
import {patchBulkItemUse} from './client-bag-patch.mjs';
import {patchBattleSkillPanel} from './client-battle-skill-panel-patch.mjs';
import {patchBattleFont} from './client-battle-font-patch.mjs';
import {patchLegionSurvivors} from './client-legion-survivors-patch.mjs';
import {patchLegionPetGuard} from './client-legion-petguard-patch.mjs';
import {patchBattleSpeedSteps,patchBattleSpeedPersist} from './client-battle-speed-patch.mjs';
import {patchBattleCheckFields} from './client-battle-check-patch.mjs';
import {patchBattleMonsterBars} from './client-battle-bars-patch.mjs';
import {patchBattleMonsterManaRecovery} from './client-battle-mana-recovery-patch.mjs';
import {patchWeaponSlots} from './client-weapon-slot-patch.mjs';
import {patchPhantomImmunity} from './client-phantom-immunity-patch.mjs';
import {patchIllusion} from './client-illusion-patch.mjs';
import {patchWeaponIcon} from './client-weapon-icon-patch.mjs';
import {patchEmptyNativeShop} from './native-ui-restoration.mjs';
import {patchEscortBattle} from './client-escort-battle-patch.mjs';
import {patchEscortBoard} from './client-escort-board-patch.mjs';
import {patchPromptBriefing} from './client-prompt-patch.mjs';
import {patchFormationBooks} from './client-formation-book-patch.mjs';
import {patchSkillFxSwitch} from './client-skill-fx-patch.mjs';
import {patchAutoSkillChance} from './client-auto-skill-chance-patch.mjs';
import {patchRandomTarget} from './client-random-target-patch.mjs';

/** 原版主包在 v305 客户端里的相对路径（站点根 / client 根通用）。 */
export const CLIENT_MAIN_PATH='js/ff/fff570bb4753f056432680e781d827dc.js';

/**
 * 替换且必须命中恰好一次。
 *
 * 补丁依赖「锚点在原文里唯一出现」这条前提。命中 0 次说明原版换了、补丁过期；
 * 命中 ≥2 次说明会误伤。两种情况都直接抛错，不要让它悄悄跑过去。
 */
export function replaceOnce(source,from,to){
  if(source.split(from).length!==2)throw Error('Client patch mismatch: '+from);
  return source.replace(from,to);
}

// ---------------------------------------------------------------------------
// 引导脚本（analysis/gd.decoded.js）
// ---------------------------------------------------------------------------

/** 把离线运行时挂到原版启动流程上，并摘掉原版那个 50ms 轮询定时器。 */
export const CLIENT_BOOT_STEPS=[
 ['offlineBootSettings',source=>replaceOnce(source,'(a["gs"] = new n())','(window.offlineBootSettings(), a["gs"] = new n())')],
 ['offlineInstall',source=>replaceOnce(source,'(s["startEgret"] = function () {','(s["startEgret"] = function () { window.offlineInstall();')],
 ['dropPollingTimer',source=>source.replace(/\(function \(\) \{\s*try \{\s*setInterval\(function \(\) \{[\s\S]*?\}, 50\);\s*\} catch \(e\) \{\}\s*\}\)\(\),/,'')]
];

export function patchClientBoot(source){
  for(const [,apply] of CLIENT_BOOT_STEPS)source=apply(source);
  return source;
}

// ---------------------------------------------------------------------------
// 主包（js/ff/<hash>.js）
// ---------------------------------------------------------------------------

/**
 * 主包补丁链，**按实际作用顺序**排列（数组前面的先跑）。
 *
 * 每一步都是 source → source 的纯函数；除 patchBattleFont()（要读同目录的
 * 0180 模块文本）外都不碰文件系统，也不依赖 cwd —— 这里保留这个性质，
 * 方便测试直接拿原版主包跑一遍全链。
 */
export const CLIENT_MAIN_STEPS=[
 ['worldReq',source=>replaceOnce(source,'t.m=e,t.c=i,',WORLD_REQUEST_MARKER)],
 ['battleDamageMath',patchBattleDamageMath],
 ['attackPlan',patchAttackPlan],
 ['npcRepeatableMissions',patchNpcRepeatableMissions],
 ['offlineStoryBattles',patchOfflineStoryBattles],
 ['playerLevelRewards',patchPlayerLevelRewards],
 ['dailyCatalogVisibility',patchDailyCatalogVisibility],
 ['npcMissionRefresh',patchNpcMissionRefresh],
 ['offlineLegionBattles',patchOfflineLegionBattles],
 ['gardenerManaRecovery',patchGardenerManaRecovery],
 ['emptyNativeShop',patchEmptyNativeShop],
 ['bulkItemUse',patchBulkItemUse],
 ['combatLimits',patchCombatLimits],
 ['immediateRoleDeletion',patchImmediateRoleDeletion],
 ['legionSurvivors',patchLegionSurvivors],
 ['legionPetGuard',patchLegionPetGuard],
 ['battleSpeedSteps',patchBattleSpeedSteps],
 ['battleSpeedPersist',patchBattleSpeedPersist],
 ['battleSkillPanel',patchBattleSkillPanel],
 ['battleCheckFields',patchBattleCheckFields],
 ['battleMonsterBars',patchBattleMonsterBars],
 ['battleMonsterMana',patchBattleMonsterManaRecovery],
 ['battleFont',patchBattleFont],
 ['weaponSlots',patchWeaponSlots],
 ['phantomImmunity',patchPhantomImmunity],
 ['illusion',patchIllusion],
 ['weaponIcon',patchWeaponIcon],
 ['escortBattle',patchEscortBattle],
 ['escortBoard',patchEscortBoard],
 ['promptBriefing',patchPromptBriefing],
 ['formationBooks',patchFormationBooks],
 // 追加式补丁（append install 函数），无锚点冲突，放链尾。战斗播放层替换技能特效，
 // 读 web/skill-fx.js 维护的 window.__worldolSkillFx 桥。
 ['skillFxSwitch',patchSkillFxSwitch],
 // 第 93 版 B 层玩法补丁：自动技能触发概率 + 技能随机目标。
 // 两者都在运行时按特征扫 req.c 找战斗类（不硬编码模块号），配置缺失即退化为原生。
 ['autoSkillChance',patchAutoSkillChance],
 ['randomTarget',patchRandomTarget]
];

/** 第一个补丁注入的标记，同时也是「已打过补丁」的判据。 */
export const WORLD_REQUEST_MARKER='t.m=e,t.c=i,window.__worldReq=t,';

/**
 * 判断主包是否已经打过补丁。
 *
 * 站点构建（安卓打包/standalone/build.mjs）会在构建期把整条链打一遍并把成品
 * 放进站点；standalone 里的 server.mjs 读到的就是这份成品。没有这个判断的话
 * 每次启动都要把 4.5MB 的主包重读、重跑全链（实测约 840ms，其中
 * patchCombatLimits 的 acorn 全量解析独占 700ms 以上）。
 *
 * 判据用第一个补丁注入的标记：它在链的最前面执行，出现即说明整条链跑完了。
 */
export function isClientMainPatched(source){
 return source.includes(WORLD_REQUEST_MARKER);
}

export function patchClientMain(source){
 if(isClientMainPatched(source))return source;
 for(const [,apply] of CLIENT_MAIN_STEPS)source=apply(source);
 return source;
}

/** 链上所有步骤名（按作用顺序），供守卫用例与 /api/status 之类的地方引用。 */
export function clientPatchStepNames(){
  return {boot:CLIENT_BOOT_STEPS.map(([name])=>name),main:CLIENT_MAIN_STEPS.map(([name])=>name)};
}
