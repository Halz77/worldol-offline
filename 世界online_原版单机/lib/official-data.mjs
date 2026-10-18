import fs from 'node:fs';
import {lazyBox} from './lazy-data.mjs';
import {applyBossChallenges,applyBossChallengeRepairs} from './boss-challenges.mjs';
import {applyYunruoTemple} from './yunruo-temple.mjs';
import {applyRecordedExpansion} from './recorded-expansion.mjs';
import {nativeCommerce} from './native-commerce-data.mjs';
import {applyOpenPortals} from './open-portals.mjs';
import {applyBossHub} from './boss-hub.mjs';
import {applyDungeonChallengeRepairs} from './dungeon-challenge-data.mjs';
import {applyBossTournament} from './boss-tournament-data.mjs';
import {applySolarChallenges} from './solar-challenge-data.mjs';
import {registerTrialChallenge} from './trial-challenge-data.mjs';
import {localPetSkillBooks,petSkillBookRegistry} from './pet-skill-book-data.mjs';
import {localEnchantments} from './enchantment-data.mjs';
import {spiritData,applySpiritNpcs,spiritBoxDefinition,spiritBoxes} from './spirit-seal-data.mjs';
import {LEGENDARY_EGG_ID,legendaryEggDefinition,selectablePetEggs} from './pet-catalog.mjs';
import {localGems} from './local-gems.mjs';
import {localFashion} from './local-fashion.mjs';
import {applyOverrideToDefinition} from './local-skill-overrides.mjs';
import {applyCaptured81} from './captured81.mjs';
import {applyMayaContinuation} from './maya-continuation.mjs';
import {applyLostSoulDesert} from './lost-soul-desert.mjs';
import {fixMidAutumnFinalBoss} from './mid-autumn-final-boss.mjs';
import {applyDungeonStoryRepairs} from './dungeon-story-repairs.mjs';
import {applyDungeonRepairs} from './dungeon-repairs.mjs';
import {applyCustomAdventures} from './custom-adventures.mjs';
import {applyCityTemplateFixes,applyCityFlightStations} from './city-template-fixes.mjs';

/**
 * 原版 v305 目录（34.8 MB）+ 五张 id 索引表 —— 整个服务端最重的一份数据。
 *
 * 以前模块顶层「读 JSON → 连打六种补丁 → 再叠本地补充道具 → 建索引」一气做完，
 * 于是 `import {official}` 就等于把 34.8 MB 拉进堆，**哪怕只是想启动一个 HTTP 服务**
 * （架构评审 P1-1）。现在整套初始化挂在 ensure() 上，由第一次真正访问官方资料触发：
 * 起服务、发静态资源、连上 WebSocket 都不再吃这份成本；登录进世界时一次付清。
 *
 * 使用方代码不变 —— 导出的对象/Map 都是惰性代理，`official.items`、
 * `officialMaps.get(id)` 的写法照旧。只有数组型的 `officialSkills` 是函数
 * （代理没法包数组，见 lib/lazy-data.mjs 的说明）。
 */
let built=null;
function ensure(){
 if(built)return built;
 const official=JSON.parse(fs.readFileSync(new URL('../data/official-v305.json',import.meta.url),'utf8'));
 applyBossChallenges(official);
 applyYunruoTemple(official);
 applyRecordedExpansion(official);
 // 「boss直达」入口要排在 applyOpenPortals 之前：菜单补好之后再统一按传送门
 // 规则放行（status|3、需求条件清零），否则新加的那一项不会被打开。
 applyBossHub(official);
 applyOpenPortals(official);
 applySpiritNpcs(official);
 for(const item of nativeCommerce.items)if(!official.items.some(x=>x.id===item.id))official.items.push(item);
 official.items=official.items.map(e=>e.id===LEGENDARY_EGG_ID?legendaryEggDefinition(e):e);
 for(const egg of selectablePetEggs()){
  if(official.items.some(item=>item.id===egg.id))throw Error('Selectable pet egg ID collision: '+egg.id);
  official.items.push(egg.item);
 }
 for(const item of localPetSkillBooks){if(official.items.some(x=>x.id===item.id))throw Error('Local pet skill book ID collision: '+item.id);official.items.push(item);}
 // 宠物满级技能书（目录里每个宠物技能各一本，见 lib/pet-skill-book-data.mjs）。
 // 注意这里登记的是 **registry（全量）而不是 shop（在架）**：哪几本进商店由
 // supply-shops 的 supplyCategory 决定，而定义必须一律留着 —— 商店名单会随版本变
 // （第 45 版就把训练师能教到的那批下架了），玩家背包里已经买下的书不能因为下架
 // 变成「未知道具」，否则 itemPacket 抛错、整个进入世界的包发不出去、角色黑屏。
 for(const item of petSkillBookRegistry()){if(official.items.some(x=>x.id===item.id))throw Error('Pet skill book ID collision: '+item.id);official.items.push(item);}
 for(const item of localEnchantments){if(official.items.some(x=>x.id===item.id))throw Error('Local enchantment ID collision: '+item.id);official.items.push(item);}
 for(const item of spiritData.items){const index=official.items.findIndex(e=>e.id===item.id);if(index>=0)official.items[index]=item;else official.items.push(item);}
 for(const spiritBox of [spiritBoxDefinition(),...spiritBoxes.map(spiritBoxDefinition)]){
  if(official.items.some(e=>e.id===spiritBox.id))throw Error('Local spirit box ID collision: '+spiritBox.id);
  official.items.push(spiritBox);
 }
 // 单机补充的五维 +4 宝石：原版有这一档（见原版角色导出里的宝石字段），目录里却没采到
 // 完整道具定义，这里按原版宝石的字节格式补齐，之后会随 type 30 一起进「镶嵌宝石」商店。
 for(const gem of localGems(official.items))official.items.push(gem);
 // 美容院「更换发型 / 更换脸型 / 全新发型」的造型道具（商店 51 / 52 / 55）。
 // 原版这两个菜单是普通道具商店，卖的是改写角色外观位域的 type 12 时装；商品清单
 // 从来没有采集到，这里按「世界OL_源码」下的发型/脸型贴图还原一套：一件道具对应一张
 // 贴图，道具编号即图标子键（见 lib/local-fashion.mjs 与 tools/build-fashion-icons.mjs）。
for(const fashion of localFashion(official.items))official.items.push(fashion);
// MOD(local-skill-overrides)：怪物自带技能也吃技能覆盖。
 // 怪物 AI 放的技能定义就在 official.skills 里（sources 带 monsterAI），战斗包发的是
 // monsterWireBase64||wireBase64（见 official-packets.mapBattleData）；怪物技能与
 // 人物技能共用 id，所以在所有补丁合完之后、建索引之前对整张表套一次覆盖。
 // 覆盖只改命中规则的记录，未命中的保持原对象引用。
 for(let i=0;i<official.skills.length;i++){
  const skill=official.skills[i];
  const next=applyOverrideToDefinition(skill.id,skill);
  if(next!==skill)official.skills[i]=next;
 }
 // 日常副本扩展：给「任务齐了但编队没采集到」的 9 个副本补编队（本地推算，带 sources 标记）。
 // 必须在建索引之前：battleSupported() 查的是建好的 officialGroups。
 applyDungeonChallengeRepairs(official);
 // BOSS 挑战赛（1305）：克隆 3315 巨石神兵 / 3314 古龙-多拉斯，补棋盘三场的编队，
 // 把 2451 / 2452 的入口指到同一批怪，并给入口 NPC 103 补可见位。见 lib/boss-tournament-data.mjs。
 // 排在日常副本扩展之后：它复用的 30022（千年魔牛）就是那一步补出来的。
 applyBossTournament(official);
// 英雄挑战赛 / 团队副本（太阳神殿棋盘）：81 只怪 + 76 个编队。
// 同样必须在建索引之前 —— 12501 与棋盘协议都查 officialGroups / officialMonsters。
applySolarChallenges(official);
// 无限试炼：三只 BOSS + 编队 24000。与上面两批同理，必须在建索引之前。
registerTrialChallenge(official);
// 八一副本（81 后续）：2026-09-26 录制包，31 个任务 + 15 组 + 20 怪 + 2 张地图。
// 必须在建索引之前 —— 战斗组与怪物都要被12501 和任务导航查到。
applyCaptured81(official);
// 玛雅副本地下宫殿：新建地图 962 + 8700—8709 十环，并把 3219 / 1824 / 1831
// 三处指向缺失任务的边改接过来。依赖 applyRecordedExpansion 补出的 3219/1824/1831
// 与地图 838，同样必须在建索引之前。
applyMayaContinuation(official);
// 迷失之魂沙漠：补上录制缺失的 10 / 11 两环，让 9 → 10 → 11 → 12 接得上。
applyLostSoulDesert(official);
// 中秋最终 BOSS：原版编队 11733 放的是分身 3298，任务 1940 却要真身 3297 的击杀数，
// 赢了不算完成。克隆一只真身进编队（见 lib/mid-autumn-final-boss.mjs）。
fixMidAutumnFinalBoss(official);
 // 单机副本续篇补完（移植自社区 dungeon-story-repairs）：恢复 13 张残缺地图几何 +
 // 加出口 + 复活/补 NPC + 克隆怪 + 生成【单机续篇】任务链。必须在建索引之前：
 // 新加的地图/NPC/任务/组/怪都要被任务导航与 12501 战斗协议查到。
 applyDungeonStoryRepairs(official);
 // 挑战型副本本地补完（见 lib/boss-challenges.mjs）：葬送佣兵团队长三战、堕狼魔再战入口、
 // 十殿阎罗逐殿菜单、剧情「接受即开战」重试、跨服副本五关连战。必须排在
 // applyDungeonChallengeRepairs / applyBossTournament 之后（要复用它们补出的编队 30150/30152
 // 与十王编队），且在建索引之前（新任务/新组/新怪都要被任务导航与 12501 查到）。
 applyBossChallengeRepairs(official);
 // 挑战/剧情副本里两处「客户端点了没反应」的收尾（见 lib/dungeon-repairs.mjs）：补上
 // 紫禁城·平民（263:99）菜单指向却缺失的编队 1838（克隆 1833 姬无丹）。与上面同理，
 // 必须建索引之前 —— 12501 与 NPC 菜单都要查得到这个组。
 applyDungeonRepairs(official);
 // 单机自定义冒险（移植自社区 custom-adventures 的城市部分，见 lib/custom-adventures.mjs）：
 // 补 1002/1011/1022/1032 四条加工材料定义 + 城市日常 8801—8808，并把 127 级门槛收到
 // 人物上限 97（3052/3072/3073 则删掉超限条件）。新道具与任务必须在建索引之前 push。
 applyCustomAdventures(official);
 // 城市模板小补丁（见 lib/city-template-fixes.mjs）：任务公告板的可见位、市长「扩建后」对白、
 // 飞行驿站航线扩展。必须排在所有「补地图」的补丁之后 —— 航线目的地要在地图表里存在；
 // 又必须在建索引之前 —— 客户端下发的 NPC wire 直接从 official.maps 取。
 applyCityTemplateFixes(official);
 applyCityFlightStations(official);
 built={
  official,
  officialMaps:new Map(official.maps.map(m=>[m.id,m])),
  officialMissions:new Map(official.missions.map(m=>[m.id,m])),
  officialMonsters:new Map(official.monsters.map(m=>[m.id,m])),
  officialGroups:new Map(official.groups.map(m=>[m.groupId,m])),
  officialItems:new Map(official.items.map(m=>[m.id,m])),
  officialSkills:official.skills.filter(s=>s.sources.some(x=>x.origin==='shop'||x.origin==='learned-definition')),
 };
 return built;
}

export const official=lazyBox(()=>ensure().official,'official');
export const officialMaps=lazyBox(()=>ensure().officialMaps,'officialMaps');
export const officialMissions=lazyBox(()=>ensure().officialMissions,'officialMissions');
export const officialMonsters=lazyBox(()=>ensure().officialMonsters,'officialMonsters');
export const officialGroups=lazyBox(()=>ensure().officialGroups,'officialGroups');
export const officialItems=lazyBox(()=>ensure().officialItems,'officialItems');
/** 商店/导师来源的技能定义（数组），惰性数组用函数导出。 */
export const officialSkills=()=>ensure().officialSkills;
export const OFFICIAL_SHOP=902;
export function origins(q){return [...new Map(q.sources.filter(x=>x.mapId&&x.npcId!==undefined).map(x=>[`${x.mapId}:${x.npcId}`,{mapId:x.mapId,npcId:x.npcId}])).values()];}
export function atNpc(q,mapId,npcId){return origins(q).some(x=>x.mapId===mapId&&x.npcId===npcId);}
export const rawRecord=x=>Buffer.from(x.wireBase64,'base64');
export const itemSlots=type=>({0:[7],1:[5],2:[12],3:[13],4:[11],5:[4],6:[9],7:[6],8:[0],9:[2,16],10:[14],11:[15],12:[3]}[type]||((type>=13&&type<=24)||(type>=34&&type<=39)?[8,10]:[]));
