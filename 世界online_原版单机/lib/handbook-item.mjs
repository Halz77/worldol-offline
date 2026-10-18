// 「点亮所有图鉴」消耗品的字节定义（第 77 版）。
//
// 为什么单独一个模块：这条道具要在 lib/official-data.mjs 的 ensure() 里注册进
// official.items（和 lib/enchantment-data.mjs 的附魔卡同一处），而 official-data
// 是所有东西的地基 —— 它不能反过来 import lib/handbook.mjs（会绕成循环）。
// 所以这里只放「定义」，图鉴的规则/加成/存档状态在 lib/handbook.mjs。
import {Writer} from './codec.mjs';
import {HANDBOOK_LIGHT_ALL_ITEM_ID} from './local-items.mjs';

// 定义字节格式（原版 Item.fromBytesAtts2 读的那一份）。type 28 走 ITEM_CLASS_USE_ITEM 分支：
//   byte(type) bool(handBookItem) int(id) string(name) int(bagIcon) string(info)
//   byte(grade) byte(autoBinding) byte(stackNum) bool(decomCHest)
//   byte(reqLv) short(ownTime) int(durMax) int(price) byte(round) byte(area)
//   short(power1) short(powerValue1) short(power2) short(powerValue2) byte(vipLevelReq)
//   [short(power3) short(powerValue3) —— **仅当 power1==181（附魔卡）才有这两项**]
//   bool(needShowRate)
// 本道具不带任何 power（power1=0），所以那两项**不能**写 —— 多写 4 个字节解码器会剩在
// 缓冲区里（tests/handbook.test.mjs 的 r.finish() 就是钉这个的）。
// 客户端因此把它当普通消耗品，使用请求的等待类型是 BAG_NO_WAIT(0)（见客户端
// createPlayerBagMessage 上游那段 b=BAG_NO_WAIT 的分支），服务端在
// lib/restoration-service.mjs 的 12001/action3 里按 itemId 认领。
export const HANDBOOK_LIGHT_ALL_NAME = '点亮所有图鉴';
export const HANDBOOK_LIGHT_ALL_INFO = '一次性点亮「英雄图鉴」的全部条目，立刻生效对应的图鉴加成。';

function definition(item) {
  return new Writer()
    .byte(28).bool(false).int(item.id).string(item.name).int(item.bagIcon).string(item.info)
    .byte(item.grade).byte(item.autoBinding).byte(item.stackNum).bool(false)
    .byte(item.reqLv).short(0).int(0).int(item.price).byte(0).byte(-1)
    .short(0).short(0).short(0).short(0).byte(0).bool(false)
    .done()
    .toString('base64');
}

export const handbookLightAllItem = {
  id: HANDBOOK_LIGHT_ALL_ITEM_ID,
  type: 28,
  name: HANDBOOK_LIGHT_ALL_NAME,
  bagIcon: 26,
  grade: 4,
  autoBinding: 0,
  stackNum: 99,
  reqLv: 0,
  price: 0,
  round: 0,
  area: -1,
  power1: 0,
  powerValue1: 0,
  power2: 0,
  powerValue2: 0,
  power3: 0,
  powerValue3: 0,
  vipLevelReq: 0,
  needShowRate: false,
  info: HANDBOOK_LIGHT_ALL_INFO,
  native: true,
  localPrice: 0,
  level: 0,
  durability: 0,
};
handbookLightAllItem.definitionBase64 = definition(handbookLightAllItem);
export const handbookItems = [handbookLightAllItem];
