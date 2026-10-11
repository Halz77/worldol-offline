export function patchOfflineLegionBattles(source){
 const pattern=/!s\s*&&\s*this\.myPlayer\.checkIsHasLegionTem\(\)\s*&&\s*\(s\s*=\s*!0\)/g;
 if([...source.matchAll(pattern)].length!==1)throw Error('v305 legion battle routing patch mismatch');
 return source.replace(pattern,'!s&&this.myPlayer.checkIsHasLegionTem()&&null==e.getMonsterGroup(t)&&(s=!0)');
}
