// 本地新增道具的 ID 常量（数据定义见 data/restored-v03.json 与 data/native-commerce.json）。
// 单独放一个小模块，供 restoration.mjs / supply-shops.mjs / restoration-service.mjs 共用，
// 避免互相 import 造成循环依赖。
export const IGNORE_REQUIREMENT_ITEM_ID=800100;      // 「无视装备穿戴要求」单手剑（五维各 +3000）
export const MAX_LEVEL_PLAYER_SCROLL_ITEM_ID=800200; // 人物经验卷（一键满级）
export const MAX_LEVEL_PET_SCROLL_ITEM_ID=800201;    // 宠物经验卷（一键满级）
// 第 77 版：「点亮所有图鉴」消耗品（定义见 lib/handbook-item.mjs，规则见 lib/handbook.mjs）。
export const HANDBOOK_LIGHT_ALL_ITEM_ID=800110;
// 这四个要固定摆在「新月繁华之都 · 装备与补给商人」的消耗品分类最前面
export const PINNED_SUPPLY_ITEM_IDS=[IGNORE_REQUIREMENT_ITEM_ID,MAX_LEVEL_PLAYER_SCROLL_ITEM_ID,MAX_LEVEL_PET_SCROLL_ITEM_ID,HANDBOOK_LIGHT_ALL_ITEM_ID];
