export const bossManaRecoveryRevision='gardener-current-mp-5pct-v1';

// Only monster 1985 (怪异的园丁) changes its innate BUFFER_ADD_MP tick.
// TYPE_MONSTER is 2 in v305 module 31. Use its numeric value here because the
// original doRoundHpMp function shadows both the model and monster module aliases.
// Keep native timing, poison suppression, flat recovery bonuses and MP clamping.
export function patchGardenerManaRecovery(source){
  const from='s=g.GUtil.intNum(.005*a)';
  const to='s=g.GUtil.intNum(1985===e.id&&2===e.getType()?e.get(f.ModelConst.MP)/20:.005*a)';
  if(source.split(from).length!==2)throw Error('v305 gardener mana recovery patch mismatch');
  return source.replace(from,to);
}
