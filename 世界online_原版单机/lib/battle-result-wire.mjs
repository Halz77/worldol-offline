export const BATTLE_TRAILER_V2=0x4f4c3032;
export const BATTLE_TRAILER_V3=0x4f4c3033;

export function readBattleResultTail(r,battle,{pet,nativeRounds,role,log}){
 const members=battle.legion||[];
 // The native planVector includes legion orders and can end with an odd
 // number of plans. Its header truncates planVector.length / (pet ? 2 : 1).
 // Locate our fixed-size outcome tail from the party recorded at battle start,
 // then consume every length-prefixed plan up to that exact boundary.
 const tailSize=9+(pet?8:0)+(members.length?5+members.reduce((n,m)=>n+13+(m.petUid?8:0),0):0);
 const v2Offset=r.b.length-tailSize,v3Offset=v2Offset-2;
 const modern=v3Offset>=r.pos&&r.b.readInt32BE(v3Offset)===BATTLE_TRAILER_V3;
 const trailerOffset=modern?v3Offset:v2Offset;
 if(trailerOffset<r.pos)throw Error('战斗结果数据不完整，未发放奖励。');
 const marker=r.b.readInt32BE(trailerOffset),receivedToken=r.b.readInt32BE(trailerOffset+4);
 if(marker!==(modern?BATTLE_TRAILER_V3:BATTLE_TRAILER_V2)||receivedToken!==battle.token){
  log('battle-envelope-mismatch',{role,nativeRounds,trailerOffset,length:r.b.length,marker,receivedToken,expectedToken:battle.token});
  throw Error('战斗会话不匹配，未发放奖励。');
 }
 let commands=0;
 while(r.pos<trailerOffset){
  if(trailerOffset-r.pos<3)throw Error('战斗指令数据不完整，未发放奖励。');
  const size=r.length();
  if(r.pos+size>trailerOffset||++commands>4096)throw Error('战斗指令数据不完整，未发放奖励。');
  r.take(size);
 }
 if(nativeRounds!==(Math.floor(commands/(pet?2:1))&255))throw Error('战斗指令数量不一致，未发放奖励。');
 r.int();r.int();const result=r.byte(),rounds=modern?r.short()&65535:nativeRounds;
 // V3 carries the engine's actual round count, independent of party size.
 // V2 remains readable by clients opened before this update.
 if((modern||!members.length)&&rounds>100)throw Error('战斗回合数据不完整，未发放奖励。');
 return {result,rounds,commands,wireVersion:modern?3:2};
}
