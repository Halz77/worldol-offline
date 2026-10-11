// User-defined single-player rules, separate from recorded official item data.
export const starRules={scroll:40021,max:52,scrollsPerLevel:1,successRate:50,
  bands:[{minLevel:70,max:18},{minLevel:50,max:24}],lowLevelWeaponMax:52,lowLevelArmorMax:32,otherMax:10};
export const gemRules={guaranteed:30,successRate:50,failure:'keep-broken',restart:'reset'};
// Advanced stars use their own material and counter. The local success/failure
// rule matches ordinary strengthening; the recorded equipment coefficient stays.
export const advancedRules={identifyScrolls:[40024,40025],starScrolls:[40026,40027],max:20,successRate:50};
export function advancedStarLimit(item){return item?.isUpgradeItem&&item.upgradeAscensionStar>0?advancedRules.max:0;}
export function starLimit(item,rules=starRules){
  if(!item?.ascensionStar)return 0;
  const level=item.reqLv??item.level??0;
  for(const band of rules.bands)if(level>=band.minLevel)return band.max;
  if((item.type>=13&&item.type<=24)||(item.type>=34&&item.type<=39))return rules.lowLevelWeaponMax;
  if(item.type>=0&&item.type<=10)return rules.lowLevelArmorMax;
  return rules.otherMax;
}
