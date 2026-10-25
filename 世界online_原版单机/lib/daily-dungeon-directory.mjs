/**
 * 每日活动「挑战副本」目录（38 行）—— 移植自「幻想世界OL 4.0AI版」的
 * `data/daily-dungeon-expansion.json` 与 `applyDailyDungeonEntrances()`。
 *
 * ## 为什么需要它
 * 原版客户端的「每日活动」看板（协议 22105/22106 → `lib/daily-service.mjs`）里，
 * 本工程的数据文件 `data/daily-activity-v1.json` 只有 1—58 号行；而录制之外的那些
 * 剧情 / 挑战副本（问剑十一峰、黄金十二宫、英灵迷宫、月宫、十殿阎罗、圣诞、情人节…）
 * 在 4.0 里是一张**目录**：每行给出「入口在哪」（mapId/px/py/npcID）与「这一行
 * 覆盖哪些任务」（navigationMissionIds）。这一版把这张目录整体搬过来（第 84 版）：
 *
 *   1. 38 行原样推进看板（`applyDailyDungeonDirectory`，在 `lib/daily-activity.mjs`
 *      的 `ensure()` 里、`applyRepairedDaily` 之前调用）；
 *   2. 其中 16 行（12 个故事副本 + 70/79/80/94 四个「收尾任务」型）的进度与「前往」
 *      导航由 `lib/dungeon-repairs.mjs` 绑定，另外 3 行（97/98/99）按故事链根入口
 *      现场建行；剩下 22 行是**纯目录导航**（问剑十一峰、黄金十二宫、糖果森林…）：
 *      它们的重玩由各自玩法模块负责，不参与任务次数与进度统计；
 *   3. 季节入口 NPC 的可见位修复（`applyDailyDungeonEntrances`：91 财神爷、92 祈福小子
 *      在被抓包时 status 是「可交互但看不见」，看板点过去找不到人）。
 *
 * ## 与 4.0 的差异
 * - `unavailable` 备注已于 2026-10-25 **全部清除**。第 84 版移植时保留了三行
 *   （77 缺地图 943 / 78 缺任务 941 / 86 缺地图 973），那原是 4.0 自己数据里缺的号；
 *   全量复验证明本工程这三行的任务/地图/NPC/链**全部完整**——水底秘洞在 980/982、
 *   鹊桥在 985/986、彩蛋森林在 834/835，且 77 的续链 1211、9159—9162 是
 *   `lib/dungeon-story-repairs.mjs` 本地补写的（收尾 9162 返回九歌镇 954）。
 *   943/941/973 在本工程**没有任何引用方**：补定义只会造出幻影数据，故只清备注。
 *   4.0 的其余备注（「地图未收录」「缺编队 11706」等）在本工程早已补完
 *   （英灵迷宫 2813—2816、英雄枷锁 9149—9152、月宫编队 11733、十殿 11706、无极深渊
 *   9167—9171、太阳城 9163—9166、辞灶 9153—9156、情人节 2791—2796、BOSS 挑战赛 1305…），
 *   照抄只会误导。`unavailable` 字段本就不进任务包（`encodeWithSchema` 只发 schema 里的字段）。
 * - `entryPrerequisite/entryFallback`（行 74 高难万圣噩梦）原样保留作数据，但**不**实现
 *   4.0 那套「前置没完成就改指 263:10」的降级 —— 本工程里 259:98 这处入口本来就能用。
 */
import {Reader} from './codec.mjs';

export const DIRECTORY_REVISION='daily-dungeon-directory-v2-20261025';

/** 看板行默认字段（与 4.0 推进看板时用的那份默认值一致）。 */
const ROW_DEFAULTS={
 itemID:[],proposalLevel:0,frequency:-1,openLevel:0,missionId:-1,value:0,mapId:0,px:0,py:0,npcID:0,
 proposal:0,progressSum:0,prosper:0,shopid:0,missionIdname:'0',grade:0,combatPower:0,
};

/**
 * 38 条副本目录。字段含义：
 * - `mapId/px/py/npcID`：入口（未绑定的行，「前往」直接按这四个字段导航）；
 * - `navigationMissionIds`：这一行覆盖的任务（绑定进度时与故事登记的节点集合并）；
 * - `frequency:-1`：不限次；
 * - `proposalLevel`：建议等级（原版只用来显示）。
 */
export const DAILY_DUNGEON_DIRECTORY=[
 {id:59,name:'问剑十一峰（初级）',icon:'fuben_pic_12',proposalLevel:50,frequency:-1,mapId:37,px:12,py:10,npcID:11,navigationMissionIds:[2604]},
 {id:60,name:'问剑十一峰（中级）',icon:'fuben_pic_12',proposalLevel:60,frequency:-1,mapId:37,px:12,py:10,npcID:11,navigationMissionIds:[2650]},
 {id:61,name:'问剑十一峰（高级）',icon:'fuben_pic_12',proposalLevel:70,frequency:-1,mapId:37,px:12,py:10,npcID:11,navigationMissionIds:[2651]},
 {id:62,name:'黄金十二宫',icon:'dungeon_zodiac',proposalLevel:90,frequency:-1,mapId:263,px:29,py:7,npcID:70,navigationMissionIds:[1030,1031,1032,1033,1034,1035,1036,1037,1038,1039,1040,1041]},
 {id:63,name:'英灵迷宫',icon:'dungeon_heroic_maze',proposalLevel:52,frequency:-1,mapId:271,px:2,py:3,npcID:2,navigationMissionIds:[2813]},
 {id:64,name:'英雄枷锁',icon:'dungeon_hero_shackles',proposalLevel:0,frequency:-1,mapId:271,px:27,py:3,npcID:3,navigationMissionIds:[]},
 {id:65,name:'死神的挑战',icon:'fuben_pic_38',proposalLevel:30,frequency:-1,mapId:271,px:12,py:17,npcID:0,navigationMissionIds:[2587,2588,2590]},
 {id:66,name:'超级BOSS·霸天虎',icon:'dungeon_batianhu',proposalLevel:0,frequency:-1,mapId:945,px:20,py:11,npcID:1,navigationMissionIds:[1317]},
 {id:67,name:'超级BOSS·东哥',icon:'dungeon_dongge',proposalLevel:0,frequency:-1,mapId:945,px:25,py:12,npcID:4,navigationMissionIds:[3459]},
 {id:68,name:'牛种反乱',icon:'dungeon_bull_rebellion',proposalLevel:60,frequency:-1,mapId:14,px:34,py:22,npcID:78,navigationMissionIds:[1601,1602,1603,1604,1605,1606,1607,1608,1609,1610]},
 {id:69,name:'克里特迷宫·灾难裂隙',icon:'dungeon_crete_labyrinth',proposalLevel:65,frequency:-1,mapId:273,px:26,py:6,npcID:2,navigationMissionIds:[2060,2061,2062,2063,2064,2065,2066,2067,2068,2069,2070,2071,2072,2073,2074,2075,2076,2077,2078,2079,2080,2081,2082,2083,2084,2085,2086,2087,2088]},
 {id:70,name:'众神殿·光暗试炼',icon:'dungeon_gods_light_dark',proposalLevel:90,frequency:-1,mapId:940,px:18,py:11,npcID:2,navigationMissionIds:[1050,1051,1052,1053]},
 {id:71,name:'朱雀村国师与81后续',icon:'dungeon_zhuque',proposalLevel:40,frequency:-1,mapId:955,px:25,py:32,npcID:1,navigationMissionIds:[902,903,904,905,906,907,908,909,910,911,912,913,914,915,916,917,918,919,920,921,922,1421,1422,1423,1424,1425,1426,1427,1428,1429,1430]},
 {id:72,name:'糖果森林',icon:'fuben_pic_39',proposalLevel:60,frequency:-1,mapId:960,px:5,py:18,npcID:22,navigationMissionIds:[1864,1865,1866,1867,1868,1869,1870,1871,1872,1873,1874,1875,1876,1877,1878,1879,1880,1881,1882,1883,1884,1885,1886,1887,1888,1889,1890,1891,1892,1893,1894,1895]},
 {id:73,name:'周年狂欢',icon:'dungeon_anniversary',proposalLevel:120,frequency:-1,mapId:457,px:9,py:20,npcID:1,navigationMissionIds:[2841,2842,2843,2844,2845,2846,2847,2848,2849,2850,2852,2859,2860,2862,2863,2864,2865]},
 {id:74,name:'高难万圣噩梦',icon:'dungeon_nightmare_halloween',proposalLevel:120,frequency:-1,mapId:259,px:21,py:24,npcID:98,navigationMissionIds:[3038,3039,3040,3041,3042,3250,3251,3252,3253,3254,3255,3256,3257,3258,3259,3260,3261,3262,3263,3264],entryPrerequisite:3042,entryPrerequisiteMissionIds:[3038,3039,3040,3041,3042],entryFallback:{mapId:263,npcID:10,px:2,py:19}},
 {id:75,name:'光棍村',icon:'dungeon_singles_village',proposalLevel:120,frequency:-1,mapId:967,px:9,py:7,npcID:1,navigationMissionIds:[3265,3266,3267,3268,3269,3270,3271,3272,3273,3274,3275,3276,3277,3278,3279,3280,3281,3282,3283]},
 {id:76,name:'圣诞副本',icon:'dungeon_christmas',proposalLevel:120,frequency:-1,mapId:969,px:15,py:14,npcID:1,navigationMissionIds:[3284,3285,3286,3287,3288,3300]},
 {id:77,name:'九歌端午与水底秘洞',icon:'dungeon_dragonboat_water',proposalLevel:60,frequency:-1,mapId:954,px:17,py:12,npcID:1,navigationMissionIds:[885,886,887,888,889,890,891,892,893,894,895,896,897,898,899,1200,1201,1202,1203,1204,1205,1206,1207,1208,1209,1210,1218]},
 {id:78,name:'碧莲山·鹊桥',icon:'dungeon_magpie_bridge',proposalLevel:70,frequency:-1,mapId:985,px:22,py:27,npcID:0,navigationMissionIds:[1900,1901,1902,1903,1904,1905,1906,1907,1908,1909,1910,1911,1912,1913,1914,1915,1916,1917,1918,1919,1920,1921,1922,1923,1924,1925]},
 {id:79,name:'月宫',icon:'dungeon_moon_palace',proposalLevel:120,frequency:-1,mapId:987,px:7,py:27,npcID:0,navigationMissionIds:[1926,1927,1928,1929,1930,1931,1932,1933,1934,1935,1936,1937,1938,1939,1940,1941,1942]},
 {id:80,name:'地狱之门·十殿阎罗',icon:'dungeon_hell_yama',proposalLevel:120,frequency:-1,mapId:959,px:15,py:36,npcID:0,navigationMissionIds:[3956,3957,3958,3959,3960,3961,3962,3963,3964,3965,3966,3967,3968,3969,3970,3971,3972]},
 {id:81,name:'帕伦克·正义与邪恶',icon:'dungeon_world_end',proposalLevel:70,frequency:-1,mapId:35,px:17,py:30,npcID:2,navigationMissionIds:[1950,1951,1952,1953,1954,1955,1956,1957,1958,1959,1960,1961,1962,1963,1964,1965,1966,1967,1968,1969,1970,1971,1972,1973,1974,1975,1976,1977,1978,1979,1980,1981,1982,1983,1984,1985,1986,1987,1988,1989,1990]},
 {id:82,name:'雪城叛变·热焰城',icon:'dungeon_snow_city_rebellion',proposalLevel:60,frequency:-1,mapId:861,px:9,py:26,npcID:2,navigationMissionIds:[1045,1046,1047,1048,1049,1054,1055,1056,1057,1058,1059,1060,1061,1062,1063,3194,3195,3196,3197,1064]},
 {id:83,name:'屠苏村元旦副本',icon:'dungeon_tusu_newyear',proposalLevel:120,frequency:-1,mapId:911,px:15,py:27,npcID:2,navigationMissionIds:[1230,1231,1232,1233,1234,1235,1236,1237,1238,1239,1240,1241,1242,1243,1244,1245]},
 {id:84,name:'劳动节·小城市',icon:'dungeon_labour_town',proposalLevel:60,frequency:-1,mapId:912,px:15,py:8,npcID:2,navigationMissionIds:[1346,1347,1348,1349,1350,1351,1352,1353,1354,1355,1356,1357,1358,1359,1360,1361,1362,1363,1364,1365,1366]},
 {id:85,name:'MJ纪念副本',icon:'dungeon_mj_thriller',proposalLevel:120,frequency:-1,mapId:952,px:22,py:8,npcID:52,navigationMissionIds:[2820,2821,2822,2823,2824,2825,2826,2827,2828,2829,2831]},
 {id:86,name:'奥哈拉·彩蛋森林',icon:'dungeon_egg_forest',proposalLevel:85,frequency:-1,mapId:835,px:13,py:25,npcID:1,navigationMissionIds:[1450,1451,1452,1453,1454,1455,1456,1457,1458,1459,1460,1461,1462,1463,1464,1465,1466,1467,1468,1469,1470,1471,1472,1473,1474,1475,1476,1477,1478]},
 {id:87,name:'无极深渊',icon:'dungeon_infinite_abyss',proposalLevel:0,frequency:-1,mapId:988,px:7,py:4,npcID:1,navigationMissionIds:[1401,1402,1403,1404,1405,1406,1407]},
 {id:88,name:'太阳城遗迹·考古救援',icon:'dungeon_sun_ruins',proposalLevel:65,frequency:-1,mapId:260,px:19,py:22,npcID:10,navigationMissionIds:[1318,1319,1320,1321,1322,1323,1324]},
 {id:89,name:'失魂沙漠精英挑战',icon:'dungeon_desert_elite',proposalLevel:30,frequency:-1,mapId:279,px:27,py:22,npcID:1,navigationMissionIds:[2765,2766,2767,2768,2769]},
 {id:90,name:'元旦年兽副本',icon:'dungeon_newyear_nian',proposalLevel:126,frequency:-1,mapId:98,px:9,py:28,npcID:1,navigationMissionIds:[204,205,206,207,208,209,210,211,212,213,214,215,218]},
 {id:91,name:'驱赶年兽（普通/精英）',icon:'dungeon_nian_challenge',proposalLevel:60,frequency:-1,mapId:14,px:14,py:18,npcID:10,navigationMissionIds:[2775,2786,2787],restoreNpcVisibility:true},
 {id:92,name:'元宵福队（普通/高难）',icon:'dungeon_lantern_fu',proposalLevel:40,frequency:-1,mapId:19,px:32,py:6,npcID:13,navigationMissionIds:[2789,2790],restoreNpcVisibility:true},
 {id:93,name:'远古守卫者',icon:'dungeon_ancient_guardian',proposalLevel:90,frequency:-1,mapId:35,px:39,py:15,npcID:15,navigationMissionIds:[1781]},
 {id:94,name:'BOSS挑战赛',icon:'fuben_pic_18',proposalLevel:60,frequency:-1,mapId:14,px:27,py:32,npcID:103,navigationMissionIds:[1305,2451,2452,2453]},
 {id:95,name:'辞灶副本',icon:'dungeon_kitchen_god',proposalLevel:0,frequency:-1,mapId:19,px:30,py:14,npcID:50,navigationMissionIds:[]},
 {id:96,name:'情人节副本',icon:'dungeon_valentine',proposalLevel:0,frequency:-1,mapId:14,px:25,py:10,npcID:121,navigationMissionIds:[]},
];

/** 按行号取目录项（`register()` 与看板绑定都要用它）。 */
export function directoryEntry(id){return DAILY_DUNGEON_DIRECTORY.find(row=>row.id===Number(id))||null;}

/**
 * 靠「收尾任务」判通关的四行（4.0 的 `terminalByDirectory`）：
 * 70 众神殿·光暗试炼 → 1052 暗之赠礼、79 月宫 → 1942 继续前进、
 * 80 地狱之门·十殿阎罗 → 3972 挑战十殿阎罗、94 BOSS挑战赛 → 1305 挑战BOSS。
 * 看板绑定（`lib/dungeon-repairs.mjs` 的 `applyRepairedDaily`）用这一份。
 */
export const DIRECTORY_TERMINALS={70:1052,79:1942,80:3972,94:1305};

/**
 * 把 38 条目录推进每日活动看板。
 * 在 `lib/daily-activity.mjs` 的 `ensure()` 里、`applyRepairedDaily` **之前**调用。
 * @returns {number[]} 新推进去的行号
 */
export function applyDailyDungeonDirectory(dailyData){
 const applied=[];
 for(const entry of DAILY_DUNGEON_DIRECTORY){
  if(dailyData.tasks.some(row=>row.id===entry.id))throw Error('挑战副本目录编号重复：'+entry.id);
  dailyData.tasks.push({...ROW_DEFAULTS,...entry,type:3,typeName:'挑战副本',canonicalId:entry.id,linkage:null});
  applied.push(entry.id);
 }
 return applied;
}

/**
 * 季节入口 NPC 的可见位修复（4.0 的 `applyDailyDungeonEntrances`）。
 *
 * 91「驱赶年兽」的财神爷（14:10）与 92「元宵福队」的祈福小子（19:13）在抓包里是
 * `status=66`（可交互 + 隐藏玩家）与 `status=2`（可交互但**看不见**）—— 看板把玩家带到
 * 面前却看不到人。这里把「可见 + 可交互」两位补上（`status&~3|3`），并同步改 wire。
 *
 * ⚠ 与 4.0 的差异：NPC 缺失 / 是任务 NPC / 状态字节对不上时**只记账跳过、不抛错**
 * —— 这段在 `official-data.ensure()` 里跑，抛错等于服务起不来。
 */
export function applyDailyDungeonEntrances(official){
 const applied=[];
 for(const entry of DAILY_DUNGEON_DIRECTORY){
  if(!entry.restoreNpcVisibility)continue;
  const npc=official.maps.find(m=>m.id===entry.mapId)?.npcs.find(n=>n.id===entry.npcID);
  if(!npc){applied.push({id:entry.id,skipped:'missing-npc'});continue;}
  if(npc.missionData){applied.push({id:entry.id,skipped:'mission-npc'});continue;}
  const wire=Buffer.from(npc.wireBase64,'base64'),r=new Reader(wire);
  r.take(14);r.utf();r.utf();r.utf();
  const statusAt=r.pos,status=r.byte();
  if(status!==npc.status){applied.push({id:entry.id,skipped:'status-mismatch'});continue;}
  if((npc.status&3)===3){applied.push({id:entry.id,skipped:'already-visible'});continue;}
  npc.status=(npc.status&~3)|3;
  wire[statusAt]=npc.status;
  npc.wireBase64=wire.toString('base64');
  applied.push({id:entry.id,npc:entry.mapId+':'+entry.npcID,status:npc.status});
 }
 return applied;
}
