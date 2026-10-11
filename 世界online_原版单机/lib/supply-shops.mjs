import {official,officialItems} from './official-data.mjs';
import {soldPetItem,selectablePetEggs} from './pet-catalog.mjs';
import {MAGIC_EXHAUSTION_BOOK_ID,KNIGHTS_DEVOTION_BOOK_ID} from './pet-skill-book-data.mjs';
import {spiritRunes,isSpiritBox} from './spirit-seal-data.mjs';
import {PINNED_SUPPLY_ITEM_IDS} from './local-items.mjs';
import {APPEARANCE_ITEM_IDS} from './local-fashion.mjs';
export const PET_SHOP=917;

// These are local free shops backed only by complete captured item definitions.
// Catalog-only entries do not have enough data to create an inventory item.
export const PURPLE_GRADE=4; // Native GRADE_4 uses purple #c675ff; GRADE_3 is orange.
// Native type 28 mixes usable items, eggs, chests and enchantment materials.
// Classify by the captured item effect before falling back to its broad type.
const chestPowers=new Set([100,101,102,183,184]);
const skillBookPowers=new Set([176,177,182,186]);
const identifyScrolls=new Set([40000,40001,40022,40023,40024,40025]);
const strengthenScrolls=new Set([40021,40026,40027]);
const consumableTokens=new Set([718,781,787,5300,42016,40068,40096]);
function supplyCategory(e){
 if(spiritRunes.has(e.id)||isSpiritBox(e.id))return null;
 if([MAGIC_EXHAUSTION_BOOK_ID,KNIGHTS_DEVOTION_BOOK_ID].includes(e.id))return 906;
 if(e.type===11)return 907;
 if(e.type===12)return 908;
 if((e.type>=0&&e.type<=24)||(e.type>=34&&e.type<=41)){
  if(e.grade!==PURPLE_GRADE)return null;
  if((e.type>=13&&e.type<=24)||(e.type>=34&&e.type<=39))return 909;
  if(e.type<=7)return 910;
  if(e.type<=10)return 911;
  if(e.type===41)return 912;
  return null;
 }
 if(e.type===31||skillBookPowers.has(e.power1)||e.id===61001)return 919;
 // Some recovered egg definitions have no effect yet; their recorded names
 // still identify them as eggs (not generic consumables).
 if(e.power1===109||(e.type===28&&e.name.includes('宠物蛋')))return 918;
 if(chestPowers.has(e.power1)||e.type===45)return 920;
 if(identifyScrolls.has(e.id))return 904;
 if(strengthenScrolls.has(e.id))return 903;
 if(e.type===30)return e.id===1200?906:905; // Copper-exchange diamond is not a socket gem.
 if(consumableTokens.has(e.id))return 906;
 if(e.power1===181||[25,29,42,43,44].includes(e.type))return 916;
 if([26,27,28,33,46,47].includes(e.type))return 906;
 return null;
}
const categories=[
  [906,'消耗品'],
  [918,'宠物蛋'],
  [919,'技能书'],
  [920,'礼包'],
  [916,'材料'],
  [903,'强化卷轴'],
  [904,'鉴定卷轴'],
  [905,'镶嵌宝石'],
  [907,'坐骑'],
  [908,'时装'],
  [909,'紫色武器'],
  [910,'紫色防具与背饰'],
  [911,'紫色首饰与护符'],
  [912,'紫色宠物装备'],
];
const selectableEggIds=new Set(selectablePetEggs.map(egg=>egg.id));
// 美容院的造型道具（lib/local-fashion.mjs）也是 type 12，但它们只在商店 51/52/55 里
// 出现、买下即换造型，不属于「装备与补给商人」卖的时装，不能混进 908 的分类列表。
export const supplyShops=categories.map(([id,name])=>({id,name,items:[...officialItems.values()].filter(e=>!APPEARANCE_ITEM_IDS.has(e.id)&&supplyCategory(e)===id&&(id===918?(selectableEggIds.has(e.id)||soldPetItem(e)):soldPetItem(e))).sort((a,b)=>(a.reqLv||0)-(b.reqLv||0)||a.id-b.id).map(e=>e.id)}));
export const supplyShopById=new Map(supplyShops.map(s=>[s.id,s]));
// 每个分类按 id 去重（只保留第一次出现），再把「无视装备穿戴要求」与两张经验卷
// 剔掉原位置后放到 906 消耗品最前面。直接 unshift 会让本来就被 supplyCategory
// 判进 906 的道具（如两张经验卷，type 28）在列表里出现两次。
for(const shop of supplyShops)shop.items=[...new Set(shop.items)];
{const pinned=PINNED_SUPPLY_ITEM_IDS,shop=supplyShopById.get(906);shop.items=[...new Set([...pinned,...shop.items.filter(id=>!pinned.includes(id))])];}
export const supplyNpc={id:126,type:5,name:'装备与补给商人',icon:5133,x:20,y:18,local:true,
  welcome:'装备、材料与自选宠物蛋。',
  talk:'宠物蛋可免费选择并固定孵化对应宠物。上下滑动选择分类。\n强化、鉴定、镶嵌可从背包或装备工坊进入。',
  shops:[...supplyShops.map(s=>({id:s.id,name:`${s.name}（${s.items.length}种）`})),{id:913,name:'免费合成装备属性'},{id:914,name:'免费合成装备技能'},{id:915,name:'VIP等级与装备属性'}]};
const coverage=type=>{const entries=official.catalog.filter(e=>e.type===type);return {catalog:entries.length,available:entries.filter(e=>officialItems.has(e.itemId)).length,total:[...officialItems.values()].filter(e=>e.type===type&&!APPEARANCE_ITEM_IDS.has(e.id)).length};};
export const supplyDirectory={npc:{mapId:19,mapName:'新月繁华之都',id:supplyNpc.id,name:supplyNpc.name,x:supplyNpc.x,y:supplyNpc.y},equipmentGrade:PURPLE_GRADE,shops:supplyShops.map(({id,name,items})=>({id,name,count:items.length})),coverage:{mounts:coverage(11),costumes:coverage(12)}};
