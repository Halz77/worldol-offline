// The native POWER_SKILL_HIT_FORCE (85) stores percentage points. Some recorded
// guide descriptions omit its percent sign. Preserve the raw source and add the
// unit only when compiling/displaying this specific attached-skill effect.
// Do not change basic force-hit (76) or the separate force-hit multiplier (46).
export function normalizeSkillEffectUnits(text){
 return String(text).replace(/^((?:技能附带|附带|附加)强制命中率\s*[+-]?\d+(?:\.\d+)?)\s*$/,'$1%');
}
