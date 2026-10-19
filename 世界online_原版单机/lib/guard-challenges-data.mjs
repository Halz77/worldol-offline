/**
 * 守卫挑战（33 条，8901—8933）—— 移植自「幻想世界OL 4.0AI版」的
 * `data/boss-challenges-v1.json`（`guardChallenges` / `guardChallengeSources`）。
 *
 * ## 这是什么
 * 征战广场（地图 945）的两个「守卫」NPC（2 / 3）在 4.0 里挂了一整套**可重复**的
 * 单体 BOSS 挑战：接取即开战（任务包里的 `acceptBattleID`），打赢回守卫处交付，
 * 每次 10000 经验 + 10000 铜币。33 条里的**27 条复用本工程已有的战斗编队**
 * （11615 大年兽、11678 祈福小队长、11781 库库尔坎、20368 狂暴巨象…），
 * 只有 6 条需要新编队：12100—12103（光/暗守护者单挑）与 20501/20502
 * （东哥高难、合成兽-索菲亚两队）。
 *
 * ## 与 4.0 的三处差异
 * 1. **奖励箱 9300931「紫色武器箱」不落地**：本工程没有定义这个道具（也没有开箱机制），
 *    `lib/official-rules.mjs` 的 `missionRewards()` 会把无定义的道具静默滤掉
 *    —— 任务照常可接可交，只是拿不到箱子（2026-10-19 用户明确「奖励无所谓的啦」）。
 *    这里仍把它写进 `GUARD_REWARD` 并保留在任务里，是为了与 4.0 的数据对得上。
 * 2. **怪物 4200—4208 原样搬运**（云座、烧饼、花哥、灵魂画师-奇奇、东哥(高难)、强哥、
 *    实验体1号、合成兽-索菲亚、佣兵头目-迪克特平）。4.0 的这几只是从
 *    `com.worldol.h5` 移植的（`sources.origin` 写着 port-from-com.worldol.h5），
 *    本工程照抄、不另调数值。
 * 3. **技能 9999「不死不灭」**只有一只怪用（东哥(高难) 的 AI 4204：无条件每回合释放）。
 *    它的 `monsterWireBase64` 为 null，战斗包里取 `wireBase64`（与 4.0 一致）。
 *
 * ## 为什么任务常量能这么写
 * 33 条任务除「编号 / 名字 / 守卫 NPC / 编队 / 目标怪 / 说明」之外**完全一致**
 * （4.0 用同一段模板生成，逐条核对过）：等级 0、`setting 1034`（含「接取即开战」）、
 * 经验 10000、铜币 10000、可接等级 90、`submitBattleID 0`、条件三格（等级 90 + 两个
 * CONDITION_NONE / 击杀目标 + 两个 CONDITION_NONE）。所以这里只存差异，公共部分由
 * `guardMission()` 拼出来 —— 与 4.0 的 wireBase64 逐字节等价
 * （`tests/guard-challenges.test.mjs` 拿 4.0 的 wire 对过）。
 */
import {Writer} from './codec.mjs';

/** 4.0 侧的来源版本号（便于核对搬的是哪一版）。 */
export const GUARD_CHALLENGE_REVISION='guard-challenges-v7-dong-sophia';

/** 征战广场地图与两个守卫 NPC（各管一半挑战）。 */
export const GUARD_MAP=945;
export const GUARD_NPCS=[2,3];

/** 每次交付的固定奖励：经验 / 铜币 / 箱子（箱子本工程无定义，会被静默滤掉）。 */
export const GUARD_EXP=10000;
export const GUARD_COINS=10000;
export const GUARD_REWARD={illusion:[],id:9300931,quantity:1,name:'紫色武器箱',bagIcon:7,grade:4};

/** 可接等级（`acceptCondition` 的第一格，rawHex 就是 1 字节等级 0x5a=90）。 */
export const GUARD_MIN_LEVEL=90;

/**
 * 33 条守卫挑战：`group` 是接取时开战的编队，`boss` 是击杀目标怪物。
 * `desc` 原样取自 4.0（里面写的「多少级、气血多少」是他们的观测值）。
 */
export const GUARD_CHALLENGES=[
 {id:8901,name:"挑战超级BOSS-大年兽",npcId:2,group:11615,boss:1735,bossName:"大年兽",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败大年兽（120级，气血10000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8902,name:"挑战超级BOSS-年兽",npcId:2,group:11616,boss:1736,bossName:"年兽",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败年兽（70级，气血5000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8903,name:"挑战超级BOSS-祈福小队长",npcId:2,group:11678,boss:2051,bossName:"祈福小队长",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败祈福小队长（100级，气血6000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8904,name:"挑战超级BOSS-鬼王",npcId:2,group:11727,boss:4044,bossName:"鬼王",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败鬼王（120级，气血8000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8905,name:"挑战超级BOSS-鬼王分身",npcId:2,group:11728,boss:4045,bossName:"鬼王分身",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败鬼王分身（100级，气血6000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8906,name:"挑战超级BOSS-塔洛斯女神",npcId:3,group:11739,boss:4070,bossName:"塔洛斯女神",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败塔洛斯女神（120级，气血10000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8907,name:"挑战超级BOSS-暗精灵王-夕",npcId:3,group:11811,boss:2524,bossName:"暗精灵王-夕",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败暗精灵王-夕（120级，气血25000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8908,name:"挑战超级BOSS-石化冰哥",npcId:3,group:11802,boss:2063,bossName:"石化冰哥",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败石化冰哥（80级，气血3000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8909,name:"挑战超级BOSS-午后的轩姐",npcId:3,group:11799,boss:2066,bossName:"午后的轩姐",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败午后的轩姐（100级，气血5000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8910,name:"挑战超级BOSS-绯红·地火之心",npcId:3,group:11725,boss:3287,bossName:"绯红·地火之心",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败绯红·地火之心（120级，气血8000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8911,name:"挑战超级BOSS-太阳神-库库尔坎",npcId:2,group:11781,boss:3352,bossName:"太阳神-库库尔坎",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败太阳神-库库尔坎（120级，气血20000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8912,name:"挑战超级BOSS-阿努比斯",npcId:2,group:4052,boss:3353,bossName:"阿努比斯",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败阿努比斯（120级，气血10000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8913,name:"挑战超级BOSS-荷鲁斯",npcId:2,group:4053,boss:3354,bossName:"荷鲁斯",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败荷鲁斯（120级，气血10000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8914,name:"挑战超级BOSS-魔王灾厄星（高难）",npcId:2,group:11792,boss:3378,bossName:"魔王灾厄星（高难）",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败魔王灾厄星（高难）（120级，气血12000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8915,name:"挑战超级BOSS-复仇死神",npcId:2,group:11771,boss:4133,bossName:"复仇死神",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败复仇死神（120级，气血12000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8916,name:"挑战超级BOSS-被附魔的晴菜",npcId:2,group:11764,boss:4116,bossName:"被附魔的晴菜",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败被附魔的晴菜（100级，气血10000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8917,name:"挑战超级BOSS-鹰头人-荷鲁斯",npcId:2,group:11743,boss:4092,bossName:"鹰头人-荷鲁斯",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败鹰头人-荷鲁斯（120级，气血10000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8918,name:"挑战超级BOSS-紫金公主",npcId:2,group:11762,boss:4114,bossName:"紫金公主",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败紫金公主（120级，气血6000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8919,name:"挑战超级BOSS-无极天王-BOSS",npcId:2,group:11732,boss:4061,bossName:"无极天王-BOSS",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败无极天王-BOSS（120级，气血10000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8920,name:"挑战超级BOSS-魅影女王-要离",npcId:2,group:11731,boss:4050,bossName:"魅影女王-要离",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败魅影女王-要离（120级，气血10000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8921,name:"挑战超级BOSS-人形死神-溶狱者",npcId:2,group:12007,boss:3461,bossName:"人形死神-溶狱者",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败人形死神-溶狱者（120级，气血12000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8922,name:"挑战超级BOSS-机械之心-爆裂者",npcId:3,group:4090,boss:3460,bossName:"机械之心-爆裂者",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败机械之心-爆裂者（90级，气血6000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8923,name:"挑战超级BOSS-彩荷仙子（高难）",npcId:3,group:11913,boss:3427,bossName:"彩荷仙子（高难）",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败彩荷仙子（高难）（120级，气血12000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8924,name:"挑战超级BOSS-克罗米翁（高难）",npcId:3,group:11906,boss:3412,bossName:"克罗米翁（高难）",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败克罗米翁（高难）（105级，气血6500000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8925,name:"挑战超级BOSS-王母",npcId:3,group:11704,boss:3336,bossName:"王母",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败王母（120级，气血15000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8926,name:"挑战超级BOSS-狂暴巨象",npcId:3,group:20368,boss:2579,bossName:"狂暴巨象",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败狂暴巨象（110级，气血10000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8927,name:"挑战超级BOSS-光之守护者秩序",npcId:3,group:12100,boss:2529,bossName:"光之守护者秩序",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败光之守护者秩序（125级，气血30000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8928,name:"挑战超级BOSS-光之守护者戒律",npcId:3,group:12101,boss:2530,bossName:"光之守护者戒律",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败光之守护者戒律（125级，气血30000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8929,name:"挑战超级BOSS-暗之守护者混沌",npcId:3,group:12102,boss:2532,bossName:"暗之守护者混沌",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败暗之守护者混沌（125级，气血30000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8930,name:"挑战超级BOSS-暗之守护者破戒",npcId:3,group:12103,boss:2533,bossName:"暗之守护者破戒",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败暗之守护者破戒（125级，气血30000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8931,name:"挑战超级BOSS-东海龙王",npcId:3,group:11685,boss:2508,bossName:"东海龙王",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败东海龙王（70级，气血8000000）。获胜后回到接取任务的守卫处交付，可重复挑战。"},
 {id:8932,name:"挑战东哥(高难)",npcId:2,group:20501,boss:4204,bossName:"东哥(高难)",origin:"port-from-com.worldol.h5",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败东哥(高难)。「东哥(高难)」带着六名龙宫同伴：云座、烧饼、花哥、灵魂画师-奇奇(高难)、强哥、实验体1号，七人血量合计约 93,000,000；东哥(高难)会连续释放自动技能「雷怒天火」。获胜后回到守卫处交付，可重复挑战。"},
 {id:8933,name:"挑战合成兽-索菲亚",npcId:3,group:20502,boss:4207,bossName:"合成兽-索菲亚",origin:"port-from-com.worldol.h5",
  desc:"在征战广场向守卫接取挑战，接取后立即进入战斗。目标：击败合成兽-索菲亚。「合成兽-索菲亚」带着佣兵头目-迪克特平与钢铁护卫：钢铁战士、钢铁法师，九只怪血量合计约 72,000,000；索菲亚会释放自动技能「星流冰寒」，迪克特平会释放「弹雨流星」。获胜后回到守卫处交付，可重复挑战。"},
];

/** 6 个新编队：12100—12103 单挑光/暗守护者，20501 东哥(高难) 七人队，20502 索菲亚九人队。 */
export const GUARD_GROUPS=[
 {
  "groupId": 12100,
  "type": 0,
  "nextBattleGroupID": 0,
  "flag": 0,
  "coefficient": 0,
  "monsters": [
   0,
   0,
   0,
   0,
   2529,
   0,
   0,
   0,
   0,
   0
  ],
  "npcs": [],
  "localRebuild": true,
  "localRebuildReason": "录制数据里没有该 boss 的战斗组（怪物/AI/技能数据齐全）",
  "sources": [
   {
    "origin": "local-rebuild-guard-challenge"
   }
  ],
  "wireBase64": "L0QAAAAAAAAAAAAAAAAAAAAACeEAAAAAAAAAAAAA"
 },
 {
  "groupId": 12101,
  "type": 0,
  "nextBattleGroupID": 0,
  "flag": 0,
  "coefficient": 0,
  "monsters": [
   0,
   0,
   0,
   0,
   2530,
   0,
   0,
   0,
   0,
   0
  ],
  "npcs": [],
  "localRebuild": true,
  "localRebuildReason": "录制数据里没有该 boss 的战斗组（怪物/AI/技能数据齐全）",
  "sources": [
   {
    "origin": "local-rebuild-guard-challenge"
   }
  ],
  "wireBase64": "L0UAAAAAAAAAAAAAAAAAAAAACeIAAAAAAAAAAAAA"
 },
 {
  "groupId": 12102,
  "type": 0,
  "nextBattleGroupID": 0,
  "flag": 0,
  "coefficient": 0,
  "monsters": [
   0,
   0,
   0,
   0,
   2532,
   0,
   0,
   0,
   0,
   0
  ],
  "npcs": [],
  "localRebuild": true,
  "localRebuildReason": "录制数据里没有该 boss 的战斗组（怪物/AI/技能数据齐全）",
  "sources": [
   {
    "origin": "local-rebuild-guard-challenge"
   }
  ],
  "wireBase64": "L0YAAAAAAAAAAAAAAAAAAAAACeQAAAAAAAAAAAAA"
 },
 {
  "groupId": 12103,
  "type": 0,
  "nextBattleGroupID": 0,
  "flag": 0,
  "coefficient": 0,
  "monsters": [
   0,
   0,
   0,
   0,
   2533,
   0,
   0,
   0,
   0,
   0
  ],
  "npcs": [],
  "localRebuild": true,
  "localRebuildReason": "录制数据里没有该 boss 的战斗组（怪物/AI/技能数据齐全）",
  "sources": [
   {
    "origin": "local-rebuild-guard-challenge"
   }
  ],
  "wireBase64": "L0cAAAAAAAAAAAAAAAAAAAAACeUAAAAAAAAAAAAA"
 },
 {
  "groupId": 20501,
  "type": 0,
  "nextBattleGroupID": 0,
  "flag": 1,
  "coefficient": 0,
  "monsters": [
   0,
   4200,
   4201,
   4202,
   0,
   0,
   0,
   4203,
   0,
   0,
   0,
   4204,
   0,
   0,
   4205,
   0,
   0,
   0,
   0,
   4206
  ],
  "npcs": [],
  "wireBase64": "UBUAAAABAAAAAAAAEGgQaRBqAAAAAAAAEGsAAAAAAAAQbAAAAAAQbQAAAAAAAAAAEG4=",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 },
 {
  "groupId": 20502,
  "type": 0,
  "nextBattleGroupID": 0,
  "flag": 1,
  "coefficient": 0,
  "monsters": [
   3271,
   3272,
   3272,
   0,
   0,
   4208,
   4207,
   0,
   0,
   4208,
   3272,
   3271,
   3271,
   0,
   0,
   0,
   0,
   0,
   0,
   0
  ],
  "npcs": [],
  "wireBase64": "UBYAAAABAAAAAAzHDMgMyAAAAAAQcBBvAAAAABBwDMgMxwzHAAAAAAAAAAAAAAAAAAA=",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 }
];

/** 9 只本地怪 4200—4208（原样搬运，wire 里带名字与属性）。 */
export const GUARD_MONSTERS=[
 {
  "hpMax": 2000000,
  "mpMax": 200000,
  "speed": 5000,
  "atkType": 4,
  "atkMin": 50000,
  "atkMax": 65535,
  "atk_time": 4,
  "dodge": 50000,
  "atk_str": 65535,
  "atk_str_nearby": 0,
  "atk_str_range": 0,
  "atk_agi": 65535,
  "atk_agi_nearby": 0,
  "atk_agi_range": 0,
  "atk_magic": 65535,
  "def_str": 65535,
  "def_str_nearby": 0,
  "def_str_range": 0,
  "def_agi": 65535,
  "def_agi_nearby": 0,
  "def_agi_range": 0,
  "def_magic": 65535,
  "hitrate": 8000,
  "hitMagic": 8000,
  "critical": 3000,
  "ignoreCritical": 0,
  "criticalDmg": 0,
  "ignore_back": 0,
  "ignore_magic_back": 0,
  "ignore_block": 0,
  "ignore_insight": 0,
  "ignore_touch": 0,
  "ignore_wil": 0,
  "wil": 80000,
  "tough": 100000,
  "block": 5000,
  "brkArmor": 50000,
  "insight": 50000,
  "def_field": 50000,
  "back": 8000,
  "magic_back": 8000,
  "life_absorption": 3000,
  "mana_absorption": 3000,
  "magic_penetration": 30000,
  "bornStatus": "134770688",
  "newReflection": 99,
  "level": 120,
  "monstertype": 4,
  "id": 4200,
  "name": "云座",
  "icon1": "20838",
  "wireBase64": "AAAQaAAAAk6RXqcAAAAAAABRZngEAB6EgAADDUAAABOIBAAAw1AAAP//BAAAw1AAAP//AAAAAAAAAAAAAP//AAAAAAAAAAAAAP//AAD//wAAAAAAAAAAAAD//wAAAAAAAAAAAAD//wAAH0AAAB9AC7gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOIAAAYagAAATiAAAw1AAAMNQAADDUAAAH0AAAB9AAAALuAAAC7gAAHUwAAAAAAgIcAAAAABj",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 },
 {
  "hpMax": 4000000,
  "mpMax": 400000,
  "speed": 5000,
  "atkType": 4,
  "atkMin": 50000,
  "atkMax": 65535,
  "atk_time": 4,
  "dodge": 50000,
  "atk_str": 65535,
  "atk_str_nearby": 0,
  "atk_str_range": 0,
  "atk_agi": 65535,
  "atk_agi_nearby": 0,
  "atk_agi_range": 0,
  "atk_magic": 65535,
  "def_str": 65535,
  "def_str_nearby": 0,
  "def_str_range": 0,
  "def_agi": 65535,
  "def_agi_nearby": 0,
  "def_agi_range": 0,
  "def_magic": 65535,
  "hitrate": 8000,
  "hitMagic": 8000,
  "critical": 3000,
  "ignoreCritical": 0,
  "criticalDmg": 0,
  "ignore_back": 0,
  "ignore_magic_back": 0,
  "ignore_block": 0,
  "ignore_insight": 0,
  "ignore_touch": 0,
  "ignore_wil": 0,
  "wil": 80000,
  "tough": 100000,
  "block": 5000,
  "brkArmor": 50000,
  "insight": 50000,
  "def_field": 50000,
  "back": 8000,
  "magic_back": 8000,
  "life_absorption": 3000,
  "mana_absorption": 3000,
  "magic_penetration": 30000,
  "bornStatus": "553940992",
  "newReflection": 99,
  "level": 120,
  "monstertype": 4,
  "id": 4201,
  "name": "烧饼",
  "icon1": "20832",
  "wireBase64": "AAAQaQAAAnDnmXwAAAAAAABRYHgEAD0JAAAGGoAAABOIBAAAw1AAAP//BAAAw1AAAP//AAAAAAAAAAAAAP//AAAAAAAAAAAAAP//AAD//wAAAAAAAAAAAAD//wAAAAAAAAAAAAD//wAAH0AAAB9AC7gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOIAAAYagAAATiAAAw1AAAMNQAADDUAAAH0AAAB9AAAALuAAAC7gAAHUwAAAAACEEeAAAAABj",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 },
 {
  "hpMax": 3000000,
  "mpMax": 300000,
  "speed": 5000,
  "atkType": 4,
  "atkMin": 50000,
  "atkMax": 65535,
  "atk_time": 4,
  "dodge": 50000,
  "atk_str": 65535,
  "atk_str_nearby": 0,
  "atk_str_range": 0,
  "atk_agi": 65535,
  "atk_agi_nearby": 0,
  "atk_agi_range": 0,
  "atk_magic": 65535,
  "def_str": 65535,
  "def_str_nearby": 0,
  "def_str_range": 0,
  "def_agi": 65535,
  "def_agi_nearby": 0,
  "def_agi_range": 0,
  "def_magic": 65535,
  "hitrate": 8000,
  "hitMagic": 8000,
  "critical": 3000,
  "ignoreCritical": 0,
  "criticalDmg": 0,
  "ignore_back": 0,
  "ignore_magic_back": 0,
  "ignore_block": 0,
  "ignore_insight": 0,
  "ignore_touch": 0,
  "ignore_wil": 0,
  "wil": 80000,
  "tough": 100000,
  "block": 5000,
  "brkArmor": 50000,
  "insight": 50000,
  "def_field": 50000,
  "back": 8000,
  "magic_back": 8000,
  "life_absorption": 3000,
  "mana_absorption": 3000,
  "magic_penetration": 30000,
  "bornStatus": "581632",
  "newReflection": 99,
  "level": 120,
  "monstertype": 4,
  "id": 4202,
  "name": "花哥",
  "icon1": "20836",
  "wireBase64": "AAAQagAAAoKxVOUAAAAAAABRZHgEAC3GwAAEk+AAABOIBAAAw1AAAP//BAAAw1AAAP//AAAAAAAAAAAAAP//AAAAAAAAAAAAAP//AAD//wAAAAAAAAAAAAD//wAAAAAAAAAAAAD//wAAH0AAAB9AC7gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOIAAAYagAAATiAAAw1AAAMNQAADDUAAAH0AAAB9AAAALuAAAC7gAAHUwAAAAAAAI4AAAAABj",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 },
 {
  "hpMax": 20000000,
  "mpMax": 2000000,
  "speed": 100000,
  "atkType": 4,
  "atkMin": 50000,
  "atkMax": 65535,
  "atk_time": 4,
  "dodge": 50000,
  "atk_str": 65535,
  "atk_str_nearby": 0,
  "atk_str_range": 0,
  "atk_agi": 65535,
  "atk_agi_nearby": 0,
  "atk_agi_range": 0,
  "atk_magic": 65535,
  "def_str": 65535,
  "def_str_nearby": 0,
  "def_str_range": 0,
  "def_agi": 65535,
  "def_agi_nearby": 0,
  "def_agi_range": 0,
  "def_magic": 65535,
  "hitrate": 8000,
  "hitMagic": 8000,
  "critical": 3000,
  "ignoreCritical": 0,
  "criticalDmg": 0,
  "ignore_back": 0,
  "ignore_magic_back": 0,
  "ignore_block": 0,
  "ignore_insight": 0,
  "ignore_touch": 0,
  "ignore_wil": 0,
  "wil": 80000,
  "tough": 100000,
  "block": 5000,
  "brkArmor": 50000,
  "insight": 50000,
  "def_field": 50000,
  "back": 8000,
  "magic_back": 8000,
  "life_absorption": 3000,
  "mana_absorption": 3000,
  "magic_penetration": 30000,
  "bornStatus": "151990272",
  "newReflection": 99,
  "level": 120,
  "monstertype": 4,
  "id": 4203,
  "name": "灵魂画师-奇奇(高难)",
  "icon1": "20837",
  "wireBase64": "AAAQawAAC3B1m0J1O14IAC1ZR1lHACia2Ja+ACkAAAAAAABRZXgEATEtAAAehIAAAYagBAAAw1AAAP//BAAAw1AAAP//AAAAAAAAAAAAAP//AAAAAAAAAAAAAP//AAD//wAAAAAAAAAAAAD//wAAAAAAAAAAAAD//wAAH0AAAB9AC7gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOIAAAYagAAATiAAAw1AAAMNQAADDUAAAH0AAAB9AAAALuAAAC7gAAHUwAAAAAAkPMAAAAABj",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 },
 {
  "hpMax": 30000000,
  "mpMax": 3000000,
  "speed": 200000,
  "atkType": 4,
  "atkMin": 50000,
  "atkMax": 65535,
  "atk_time": 4,
  "dodge": 50000,
  "atk_str": 65535,
  "atk_str_nearby": 0,
  "atk_str_range": 0,
  "atk_agi": 65535,
  "atk_agi_nearby": 0,
  "atk_agi_range": 0,
  "atk_magic": 65535,
  "def_str": 200000,
  "def_str_nearby": 0,
  "def_str_range": 0,
  "def_agi": 200000,
  "def_agi_nearby": 0,
  "def_agi_range": 0,
  "def_magic": 200000,
  "hitrate": 8000,
  "hitMagic": 8000,
  "critical": 3000,
  "ignoreCritical": 0,
  "criticalDmg": 0,
  "ignore_back": 0,
  "ignore_magic_back": 0,
  "ignore_block": 0,
  "ignore_insight": 0,
  "ignore_touch": 0,
  "ignore_wil": 0,
  "wil": 80000,
  "tough": 100000,
  "block": 5000,
  "brkArmor": 50000,
  "insight": 50000,
  "def_field": 50000,
  "back": 8000,
  "magic_back": 8000,
  "life_absorption": 3000,
  "mana_absorption": 3000,
  "magic_penetration": 30000,
  "bornStatus": "269545472",
  "newReflection": 99,
  "level": 120,
  "monstertype": 4,
  "id": 4204,
  "name": "东哥(高难)",
  "icon1": "20840",
  "wireBase64": "AAAQbAAABk4cVOUAKJrYlr4AKQAAAAAAAFFoeAQBycOAAC3GwAADDUAEAADDUAAA//8EAADDUAAA//8AAAAAAAAAAAAA//8AAAAAAAAAAAAA//8AAw1AAAAAAAAAAAAAAw1AAAAAAAAAAAAAAw1AAAAfQAAAH0ALuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE4gAABhqAAABOIAADDUAAAw1AAAMNQAAAfQAAAH0AAAAu4AAALuAAAdTAAAAAAEBDwAAAAAGM=",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 },
 {
  "hpMax": 30000000,
  "mpMax": 300000,
  "speed": 5000,
  "atkType": 4,
  "atkMin": 50000,
  "atkMax": 65535,
  "atk_time": 4,
  "dodge": 50000,
  "atk_str": 65535,
  "atk_str_nearby": 0,
  "atk_str_range": 0,
  "atk_agi": 65535,
  "atk_agi_nearby": 0,
  "atk_agi_range": 0,
  "atk_magic": 65535,
  "def_str": 65535,
  "def_str_nearby": 0,
  "def_str_range": 0,
  "def_agi": 65535,
  "def_agi_nearby": 0,
  "def_agi_range": 0,
  "def_magic": 65535,
  "hitrate": 8000,
  "hitMagic": 8000,
  "critical": 3000,
  "ignoreCritical": 0,
  "criticalDmg": 0,
  "ignore_back": 0,
  "ignore_magic_back": 0,
  "ignore_block": 0,
  "ignore_insight": 0,
  "ignore_touch": 0,
  "ignore_wil": 0,
  "wil": 80000,
  "tough": 100000,
  "block": 5000,
  "brkArmor": 50000,
  "insight": 50000,
  "def_field": 50000,
  "back": 8000,
  "magic_back": 8000,
  "life_absorption": 3000,
  "mana_absorption": 3000,
  "magic_penetration": 30000,
  "bornStatus": "537157632",
  "newReflection": 99,
  "level": 120,
  "monstertype": 4,
  "id": 4205,
  "name": "强哥",
  "icon1": "20839",
  "wireBase64": "AAAQbQAAAl86VOUAAAAAAABRZ3gEAcnDgAAEk+AAABOIBAAAw1AAAP//BAAAw1AAAP//AAAAAAAAAAAAAP//AAAAAAAAAAAAAP//AAD//wAAAAAAAAAAAAD//wAAAAAAAAAAAAD//wAAH0AAAB9AC7gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOIAAAYagAAATiAAAw1AAAMNQAADDUAAAH0AAAB9AAAALuAAAC7gAAHUwAAAAACAEYAAAAABj",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 },
 {
  "hpMax": 4000000,
  "mpMax": 400000,
  "speed": 5000,
  "atkType": 4,
  "atkMin": 50000,
  "atkMax": 65535,
  "atk_time": 4,
  "dodge": 50000,
  "atk_str": 65535,
  "atk_str_nearby": 0,
  "atk_str_range": 0,
  "atk_agi": 65535,
  "atk_agi_nearby": 0,
  "atk_agi_range": 0,
  "atk_magic": 65535,
  "def_str": 65535,
  "def_str_nearby": 0,
  "def_str_range": 0,
  "def_agi": 65535,
  "def_agi_nearby": 0,
  "def_agi_range": 0,
  "def_magic": 65535,
  "hitrate": 8000,
  "hitMagic": 8000,
  "critical": 3000,
  "ignoreCritical": 0,
  "criticalDmg": 0,
  "ignore_back": 0,
  "ignore_magic_back": 0,
  "ignore_block": 0,
  "ignore_insight": 0,
  "ignore_touch": 0,
  "ignore_wil": 0,
  "wil": 80000,
  "tough": 100000,
  "block": 5000,
  "brkArmor": 50000,
  "insight": 50000,
  "def_field": 50000,
  "back": 8000,
  "magic_back": 8000,
  "life_absorption": 3000,
  "mana_absorption": 3000,
  "magic_penetration": 30000,
  "bornStatus": "557854720",
  "newReflection": 99,
  "level": 120,
  "monstertype": 4,
  "id": 4206,
  "name": "实验体1号",
  "icon1": "20842",
  "wireBase64": "AAAQbgAABVuemoxPUwAxU/cAAAAAAABRangEAD0JAAAGGoAAABOIBAAAw1AAAP//BAAAw1AAAP//AAAAAAAAAAAAAP//AAAAAAAAAAAAAP//AAD//wAAAAAAAAAAAAD//wAAAAAAAAAAAAD//wAAH0AAAB9AC7gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABOIAAAYagAAATiAAAw1AAAMNQAADDUAAAH0AAAB9AAAALuAAAC7gAAHUwAAAAACFAMAAAAABj",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 },
 {
  "hpMax": 20000000,
  "mpMax": 2000000,
  "speed": 150000,
  "atkType": 4,
  "atkMin": 50000,
  "atkMax": 65535,
  "atk_time": 4,
  "dodge": 150000,
  "atk_str": 65535,
  "atk_str_nearby": 0,
  "atk_str_range": 0,
  "atk_agi": 65535,
  "atk_agi_nearby": 0,
  "atk_agi_range": 0,
  "atk_magic": 65535,
  "def_str": 150000,
  "def_str_nearby": 0,
  "def_str_range": 0,
  "def_agi": 150000,
  "def_agi_nearby": 0,
  "def_agi_range": 0,
  "def_magic": 150000,
  "hitrate": 8000,
  "hitMagic": 8000,
  "critical": 3000,
  "ignoreCritical": 0,
  "criticalDmg": 0,
  "ignore_back": 0,
  "ignore_magic_back": 0,
  "ignore_block": 0,
  "ignore_insight": 0,
  "ignore_touch": 0,
  "ignore_wil": 0,
  "wil": 80000,
  "tough": 100000,
  "block": 5000,
  "brkArmor": 50000,
  "insight": 50000,
  "def_field": 50000,
  "back": 8000,
  "magic_back": 8000,
  "life_absorption": 3000,
  "mana_absorption": 3000,
  "magic_penetration": 30000,
  "bornStatus": "135329792",
  "newReflection": 99,
  "level": 120,
  "monstertype": 4,
  "id": 4207,
  "name": "合成兽-索菲亚",
  "icon1": "20791",
  "wireBase64": "AAAQbwAAB1QIYhBRfQAtfSKD8k6aAAAAAAAAUTd4BAExLQAAHoSAAAJJ8AQAAMNQAAD//wQAAknwAAD//wAAAAAAAAAAAAD//wAAAAAAAAAAAAD//wACSfAAAAAAAAAAAAACSfAAAAAAAAAAAAACSfAAAB9AAAAfQAu4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATiAAAGGoAAAE4gAAMNQAADDUAAAw1AAAB9AAAAfQAAAC7gAAAu4AAB1MAAAAAAIEPgAAAAAYw==",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 },
 {
  "hpMax": 8000000,
  "mpMax": 800000,
  "speed": 100000,
  "atkType": 4,
  "atkMin": 50000,
  "atkMax": 65535,
  "atk_time": 4,
  "dodge": 50000,
  "atk_str": 65535,
  "atk_str_nearby": 0,
  "atk_str_range": 0,
  "atk_agi": 65535,
  "atk_agi_nearby": 0,
  "atk_agi_range": 0,
  "atk_magic": 65535,
  "def_str": 100000,
  "def_str_nearby": 0,
  "def_str_range": 0,
  "def_agi": 100000,
  "def_agi_nearby": 0,
  "def_agi_range": 0,
  "def_magic": 100000,
  "hitrate": 8000,
  "hitMagic": 8000,
  "critical": 3000,
  "ignoreCritical": 0,
  "criticalDmg": 0,
  "ignore_back": 0,
  "ignore_magic_back": 0,
  "ignore_block": 0,
  "ignore_insight": 0,
  "ignore_touch": 0,
  "ignore_wil": 0,
  "wil": 80000,
  "tough": 50000,
  "block": 5000,
  "brkArmor": 50000,
  "insight": 50000,
  "def_field": 50000,
  "back": 8000,
  "magic_back": 8000,
  "life_absorption": 3000,
  "mana_absorption": 3000,
  "magic_penetration": 30000,
  "bornStatus": "269563904",
  "newReflection": 99,
  "level": 120,
  "monstertype": 4,
  "id": 4208,
  "name": "佣兵头目-迪克特平",
  "icon1": "20790",
  "wireBase64": "AAAQcAAACU9jUXVZNHbuAC2P6lFLcnlecwAAAAAAAFE2eAQAehIAAAw1AAABhqAEAADDUAAA//8EAADDUAAA//8AAAAAAAAAAAAA//8AAAAAAAAAAAAA//8AAYagAAAAAAAAAAAAAYagAAAAAAAAAAAAAYagAAAfQAAAH0ALuAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE4gAAAw1AAABOIAADDUAAAw1AAAMNQAAAfQAAAH0AAAAu4AAALuAAAdTAAAAAAEBE4AAAAAGM=",
  "sources": [
   {
    "origin": "port-from-com.worldol.h5",
    "mapId": 945
   }
  ]
 }
];

/** 东哥(高难) 的 AI（无条件每回合放 9999）。 */
export const GUARD_AI=[
 {
  "id": 4204,
  "conType": [
   0
  ],
  "conValue": [
   0
  ],
  "msg": [
   "东哥发动不死不灭！"
  ],
  "skill1": [
   {
    "id": 9999,
    "level": 1,
    "definitionFound": true
   }
  ],
  "skill2": [
   {
    "id": 9999,
    "level": 1,
    "definitionFound": true
   }
  ],
  "targetType": [
   0
  ],
  "wireBase64": "EGwBAAAAAAAAAAlOHFTlU9FSqE4Na3tODXBt/wEnDwEnDwEA",
  "sources": [
   {
    "origin": "local-ai-4204-dongge-immortal",
    "note": "东哥(高难)自动技能：CONDITION_NONE 无条件每回合释放 9999 不死不灭",
    "applied": "2026-10-19T18:23:01"
   }
  ]
 }
];

/** 「不死不灭」技能定义（9999:1）。 */
export const GUARD_SKILLS=[
 {
  "id": 9999,
  "level": 1,
  "name": "不死不灭",
  "info": "每回合恢复己方10%生命，伤害减免10%，攻击次数+6，持续7回合",
  "type": 2,
  "skillWeapon": 0,
  "power1": 50,
  "powerValue1": 10,
  "power2": 35,
  "powerValue2": 10,
  "power3": 130,
  "powerValue3": 6,
  "skillAtkType": 6,
  "area": 29,
  "round": 7,
  "atk_time": 0,
  "useMP": 4000,
  "useHP": 0,
  "anime1": 1,
  "anime2": 1225,
  "anime3": 0,
  "position": 0,
  "statusBit1": 0,
  "statusBit2": 0,
  "statusBit3": 0,
  "isLearnByBook": false,
  "wireBase64": "Jw8BAAAETg1re04NcG0CAAAha89W3lQIYGJZDV3xZbkAMQAwACV1H1R9/wxPJFuzUc9RTQAxADAAJf8MZTtR+2shZXAAKwA2/wxjAX7tADdW3lQIAAAyAAoAIwAKAIIABgYdBwAPoAAAAQTJAAAAAAAAAA==",
  "monsterWireBase64": null,
  "maxLevel": 10,
  "reqJob": 0,
  "reqLevel": 1,
  "money1": 0,
  "money2": 0,
  "money3": 0,
  "sp": 0,
  "sources": [
   {
    "origin": "local-skill-9999-immortal",
    "note": "由逆向分析补配：将 catalog-skills.json id=9999「不死不灭」接入怪物技能段，供东哥(4204) MonsterAI 引用",
    "applied": "2026-10-19T18:23:01"
   },
   {
    "origin": "local-skill-9999-powerfix",
    "note": "修复回血/减伤：power1=47→50(HP_PERCENT=10 每回合回10%最大生命), power2=40→35(TOUGH_PERCENT=10 伤害减免+10%), power3=130 不变",
    "applied": "2026-10-19T18:58:09"
   }
  ]
 }
];

/** 击杀条件（type 2）的 rawHex：short(怪号) + utf(名字) + byte(数量) + byte(0)。 */
export function guardKillCondition(official,monsterId,required=1){
 const monster=official.monsters.find(m=>m.id===monsterId);
 if(!monster)throw Error('守卫挑战缺少击杀目标怪物：'+monsterId);
 return {type:2,typeName:'CONDITION_KILL_MONSTER',not:0,monsterId,name:monster.name,required,current:0,
  rawHex:new Writer().short(monsterId).utf(monster.name).byte(required).byte(0).done().toString('hex')};
}

/** 拼一条守卫挑战任务（公共字段见文件头的说明）。 */
export function guardMission(entry,kill){
 const source={origin:entry.origin||'local-guard-challenge',mapId:GUARD_MAP,npcId:entry.npcId};
 return {
  id:entry.id,name:entry.name,level:0,simpleDesc:entry.name,desc:entry.desc,
  setting:1034,mapId:GUARD_MAP,npcId:entry.npcId,radarMapID:0,
  dialogNotStartNotReady:'需要达到'+GUARD_MIN_LEVEL+'级方可接取该任务！',dialogStartNotFinish:'',dialogStartFinish:'',
  exp:GUARD_EXP,money2:0,money3:GUARD_COINS,
  acceptJumpMapID:0,submitJumpMapID:0,acceptBattleID:entry.group,submitBattleID:0,submitNextMissionID:0,
  rewardItems:[{...GUARD_REWARD}],selectItems:[],
  acceptCondition:[
   {type:1,typeName:'CONDITION_LEVEL',not:0,rawHex:new Writer().byte(GUARD_MIN_LEVEL).done().toString('hex'),minimum:GUARD_MIN_LEVEL},
   {type:0,typeName:'CONDITION_NONE',not:0,rawHex:''},
   {type:0,typeName:'CONDITION_NONE',not:0,rawHex:''}],
  submitCondition:[
   kill,
   {type:0,typeName:'CONDITION_NONE',not:0,rawHex:''},
   {type:0,typeName:'CONDITION_NONE',not:0,rawHex:''}],
  type:0,series:'',acceptMapId:GUARD_MAP,acceptNpcId:entry.npcId,canAccept:1,_isHelp:false,
  sources:[source],localChallenge:true,
 };
}

/**
 * 注册 33 条守卫挑战 + 6 个编队 + 9 只怪 + AI + 技能。
 * 在 `lib/boss-challenges.mjs` 的 `applyBossChallenges()` 里调用（那时 3271/3272 与
 * 地图 945 已经在表里，20502 的编队槽位要用到它们），且必须在 official 建索引之前。
 * 编号冲突一律抛错（与 applyBossChallenges 的既有纪律一致）。
 */
export function applyGuardChallenges(official){
 const applied={skills:[],monsters:[],groups:[],ai:[],missions:[]};
 for(const skill of GUARD_SKILLS){
  const existing=official.skills.find(s=>s.id===skill.id&&s.level===skill.level);
  if(existing){
   if(existing.monsterWireBase64&&existing.monsterWireBase64!==skill.wireBase64)throw Error('守卫挑战技能定义冲突：'+skill.id+':'+skill.level);
  }else{official.skills.push(structuredClone(skill));applied.skills.push(skill.id+':'+skill.level);}
 }
 for(const monster of GUARD_MONSTERS){
  if(official.monsters.some(m=>m.id===monster.id))throw Error('守卫挑战怪物编号冲突：'+monster.id);
  official.monsters.push(structuredClone(monster));applied.monsters.push(monster.id);
 }
 for(const group of GUARD_GROUPS){
  if(official.groups.some(g=>g.groupId===group.groupId))throw Error('守卫挑战编队编号冲突：'+group.groupId);
  official.groups.push(structuredClone(group));applied.groups.push(group.groupId);
 }
 for(const row of GUARD_AI){
  if(official.ai.some(a=>a.id===row.id))throw Error('守卫挑战 AI 编号冲突：'+row.id);
  official.ai.push(structuredClone(row));applied.ai.push(row.id);
 }
 for(const entry of GUARD_CHALLENGES){
  if(official.missions.some(q=>q.id===entry.id))throw Error('守卫挑战任务编号冲突：'+entry.id);
  official.missions.push(guardMission(entry,guardKillCondition(official,entry.boss,1)));
  applied.missions.push(entry.id);
 }
 return applied;
}
