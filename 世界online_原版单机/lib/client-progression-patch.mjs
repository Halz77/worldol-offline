export const clientProgressionRevision='player-xp97-wide-reward-v1';

// Keep ordinary v305 reward packets unchanged. A -1 sentinel carries an int
// only when a multi-level award exceeds the original signed short/byte.
export function patchPlayerLevelRewards(source){
 const start=source.indexOf('.processUpLevelMsg=function');
 const end=source.indexOf('.processAddItemMsg=function',start);
 if(start<0||end<start)throw Error('v305 level reward function not found');
 const original=source.slice(start,end);
 let patched=original;
 for(const [from,to] of [
  ['var _=e.getShort();','var _=e.getShort();-1===_&&(_=e.getInt());'],
  ['var d=e.getByte();','var d=e.getByte();-1===d&&(d=e.getInt());']
 ]){
  if(patched.split(from).length!==2)throw Error('v305 level reward patch mismatch: '+from);
  patched=patched.replace(from,to);
 }
 return source.slice(0,start)+patched+source.slice(end);
}
