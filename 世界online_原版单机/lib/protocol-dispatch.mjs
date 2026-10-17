/**
 * 入站协议分派链 —— 顺序在这里唯一确定。
 *
 * 以前这一段是 server.mjs 里的 20 个连续判断：
 *
 *   if(handleCharacterFeatures(type,r,context,{store,send,log}))return;
 *   if(handleLegion(type,r,context,{store,send,log}))return;
 *   ...
 *   if(handleGame(type,r,context,{store,send,log}))return;
 *
 * 「谁先谁后」在这套设计里是**承重的**，不是随手排的：
 *   · 每个 handler 的约定是「认领就返回 true 并回包，不认领就返回 false，
 *     且**一个字节都不许读**」。链条共用同一个 Reader，谁偷偷读了，
 *     后面的 handler 就会从错误的位置开始解析。
 *   · 真正被两个 handler 同时认领的号只有一个：32110（32103/32110 图鉴幻化），
 *     由 illusion-service 先接走，official-service 里那个分支其实永远到不了。
 *   · 12001（使用道具）更微妙：equipment-upgrade 只在包内第 5/6 号动作时接，
 *     宠道具交给 pet-service，其余兜到 restoration —— 路由结果取决于包内容。
 *
 * 所以这个链条**不许重排**。tests/server-dispatch.test.mjs 把顺序、每一段的
 * 认领边界、以及「拒绝时不消费读指针」这条不变量都钉住了；改动前先看那个用例。
 *
 * 常量表由调用方注入（server.mjs 用自己算出来的 root 去读 0019.js）：
 * standalone 下整个服务端被 esbuild 打成单文件，模块内拿不到可靠的根目录。
 */
import {handleCharacterFeatures,pushCharacterFeatures} from './character-feature-service.mjs';
import {handleLegion} from './legion-service.mjs';
import {handleCity} from './city-service.mjs';
import {handleSystemSettings} from './system-settings-service.mjs';
import {handleAttributes} from './newbie-service.mjs';
import {handleNativeCommerce} from './native-commerce.mjs';
import {handleIllusion} from './illusion-service.mjs';
import {handleHomeFeatures} from './home-feature-service.mjs';
import {handleRecorded} from './recorded-service.mjs';
import {handleOfficial} from './official-service.mjs';
import {handleEquipmentComposition} from './equipment-composition-service.mjs';
import {handlePetEquipment} from './pet-equipment-service.mjs';
import {handleEquipmentUpgrades} from './equipment-upgrade-service.mjs';
import {handlePetItems} from './pet-service.mjs';
import {handlePetIllusion} from './pet-illusion-service.mjs';
import {handlePetRename} from './pet-rename-service.mjs';
import {handleRoleRename} from './role-rename-service.mjs';
import {handleRestoration} from './restoration-service.mjs';
import {handleEnchantment} from './enchantment-service.mjs';
import {handleSpiritSeals} from './spirit-seal-service.mjs';
import {handleGame} from './game-service.mjs';
import {handleSolarChallenge} from './solar-challenge-service.mjs';

/**
 * 有序分派链。
 *
 * 每项：
 *   name        用于测试与日志的稳定标识（改名等于改契约，用例会红）
 *   file        实现在哪个模块
 *   handle      主体。返回 true = 已认领并回包
 *   afterClaim  认领成功后的补推钩子。`onType` 写协议常量**名字**而不是数字，
 *              避免这里再出现裸号；解析不到名字会直接抛错（见 validateInboundChain）
 */
export const INBOUND_CHAIN=Object.freeze([
 {name:'characterFeatures',file:'character-feature-service',handle:handleCharacterFeatures},
 {name:'legion',file:'legion-service',handle:handleLegion},
 // 提取城市资金成功后，客户端要连带刷新角色功能面板。
 {name:'city',file:'city-service',handle:handleCity,
  afterClaim:{onType:'CG_CITY_EXTRACT_MONEY',run:(context,{send})=>pushCharacterFeatures(context.role,send)}},
 {name:'systemSettings',file:'system-settings-service',handle:handleSystemSettings},
 {name:'attributes',file:'newbie-service',handle:handleAttributes},
 {name:'nativeCommerce',file:'native-commerce',handle:handleNativeCommerce},
 // 32110（图鉴幻化）在 illusion 与 official 里都有分支，illusion 排前面。
 {name:'illusion',file:'illusion-service',handle:handleIllusion},
 {name:'homeFeatures',file:'home-feature-service',handle:handleHomeFeatures},
 {name:'recorded',file:'recorded-service',handle:handleRecorded},
 // 交任务成功后同样要刷新角色功能面板。
 {name:'official',file:'official-service',handle:handleOfficial,
  afterClaim:{onType:'CG_TASK_DELIVER',run:(context,{send})=>pushCharacterFeatures(context.role,send)}},
 {name:'equipmentComposition',file:'equipment-composition-service',handle:handleEquipmentComposition},
 {name:'petEquipment',file:'pet-equipment-service',handle:handlePetEquipment},
 // 12001 在这里只接「鉴定/强化」两个动作，其余放给后面的 pet / restoration。
 {name:'equipmentUpgrades',file:'equipment-upgrade-service',handle:handleEquipmentUpgrades},
 {name:'petItems',file:'pet-service',handle:handlePetItems},
 {name:'petIllusion',file:'pet-illusion-service',handle:handlePetIllusion},
 // 15511（宠物改名）全链只有这一段认领，位置不影响结果，放在宠物相关这几段旁边。
 {name:'petRename',file:'pet-rename-service',handle:handlePetRename},
 {name:'roleRename',file:'role-rename-service',handle:handleRoleRename},
 // 12001 的兜底：穿戴/卸下/转职/丢弃/吃药都在这。
 {name:'restoration',file:'restoration-service',handle:handleRestoration},
 {name:'enchantment',file:'enchantment-service',handle:handleEnchantment},
 {name:'spiritSeals',file:'spirit-seal-service',handle:handleSpiritSeals},
 // 兜底，必须留在最后：它承担所有战斗/场景/任务包。
 // 英雄挑战赛 / 团队副本（太阳神殿棋盘）：14508-14511/14514 全链只有这一段认领。
 // 排在 official 之后：任务先按普通任务流程走，棋盘协议单独认领。
 {name:'solarChallenge',file:'solar-challenge-service',handle:handleSolarChallenge},
 {name:'game',file:'game-service',handle:handleGame},
]);

/**
 * 校验钩子里写的协议常量名真实存在。
 *
 * 不做这步的话，0019.js 里少一个名字会让 `afterType` 变成 undefined，
 * 钩子静默不跑 —— 属于「改了实现但测试全绿」的那类事故。
 */
export function validateInboundChain(constants){
 for(const step of INBOUND_CHAIN){
  if(!step.afterClaim)continue;
  if(!Object.hasOwn(constants,step.afterClaim.onType))throw Error(`分派链 ${step.name} 的 afterClaim 引用了不存在的协议常量：${step.afterClaim.onType}`);
 }
 return true;
}

/**
 * 造出分派函数。常量表只解析一次，不在每个包上重复查名。
 *
 * 返回的 `dispatchInbound(type,r,context,env)` 为 true 表示链条已认领该包。
 * 全链都没认领时返回 false，由调用方决定怎么回。
 */
export function createInboundDispatcher(constants){
 validateInboundChain(constants);
 const steps=INBOUND_CHAIN.map(step=>step.afterClaim?{...step,afterType:constants[step.afterClaim.onType]}:step);
 return function dispatchInbound(type,r,context,env){
  for(const step of steps){
   if(!step.handle(type,r,context,env))continue;
   if(step.afterType!==undefined&&type===step.afterType)step.afterClaim.run(context,env);
   return true;
  }
  return false;
 };
}
