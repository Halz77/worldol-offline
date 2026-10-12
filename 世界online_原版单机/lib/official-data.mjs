import fs from 'node:fs';
import {lazyBox} from './lazy-data.mjs';
import {applyBossChallenges} from './boss-challenges.mjs';
import {applyYunruoTemple} from './yunruo-temple.mjs';
import {applyRecordedExpansion} from './recorded-expansion.mjs';
import {nativeCommerce} from './native-commerce-data.mjs';
import {applyOpenPortals} from './open-portals.mjs';
import {applyBossHub} from './boss-hub.mjs';
import {localPetSkillBooks,petSkillShopBooks} from './pet-skill-book-data.mjs';
import {localEnchantments} from './enchantment-data.mjs';
import {spiritData,applySpiritNpcs,spiritBoxDefinition,spiritBoxes} from './spirit-seal-data.mjs';
import {LEGENDARY_EGG_ID,legendaryEggDefinition,selectablePetEggs} from './pet-catalog.mjs';
import {localGems} from './local-gems.mjs';
import {localFashion} from './local-fashion.mjs';

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
 // 「装备与补给商人 → 技能书」上架的宠物满级技能书（每个宠物技能一本，见
 // lib/pet-skill-book-data.mjs）。它们必须进 official.items，restoration 的
 // equipment 表才会把定义（含 definitionBase64）带给商店与背包。
 for(const item of petSkillShopBooks()){if(official.items.some(x=>x.id===item.id))throw Error('Pet skill shop book ID collision: '+item.id);official.items.push(item);}
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
