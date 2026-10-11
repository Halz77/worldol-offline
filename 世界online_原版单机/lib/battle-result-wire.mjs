export const BATTLE_TRAILER_V2=0x4f4c3032;
export const BATTLE_TRAILER_V3=0x4f4c3033;

// 这条链路上原本 8 处共用同一句「战斗结果数据不完整，未发放奖励。」，线上出问题时
// 只能靠猜是哪一项（第 40 版排查「打怪偶尔结算失败」时就被这个坑住了：包尾长度不足、
// 回合数为 0、胜败标记为 0 全报同一句话）。现在每条都带上具体数值 —— 客户端弹的就是
// 这句话，玩家截图即可定位，不必再把日志捞出来。
const reject=(label,detail)=>{throw Error(`${label}（${detail}），未发放奖励。`);};

/**
 * [start,end) 能不能正好按「3 字节长度前缀 + 内容」铺满 —— 用来验一个候选包尾位置。
 * 计划表由客户端原生代码写（web/offline.js 的 encode 钩子原样带上），长度前缀与
 * lib/codec.mjs 的 bytes() 一致，所以这里能拿它当校验。
 */
function plansFit(b,start,end){
 let at=start,count=0;
 while(at<end){
  if(end-at<3)return false;
  const size=(b[at]<<16)|(b[at+1]<<8)|b[at+2];
  at+=3+size;
  if(at>end||++count>4096)return false;
 }
 return at===end;
}

/**
 * 从后往前找「包尾标记 + 会话令牌」都对得上、且前面计划区能正好铺满的那个位置。
 *
 * **为什么不按开战时的队伍快照推算**：包尾长度 = 固定 11 字节 + 主宠 8 + 军团段
 * (5 + 每员 13(+8))，而军团段只有在客户端那边的军团 VO 就绪、助战真的上场了才会有。
 * 客户端在「军团资料没就绪」时会打一场**只有主角色**的战斗（web/legion.js 的
 * `World.toBattle` 包装在 `members()` 为空时直接放行，`getLocalBattlePlayerList` 也不加助战），
 * 而服务端仍按开战快照算包尾 → 推算位置落进计划表 → 整包被拒、奖励不发、玩家还被卡住。
 * 令牌是 4 字节随机数，标记 + 令牌 + 计划区能铺满三者同时成立，误判概率可以忽略。
 */
function locateTrailer(r,battle){
 const length=r.b.length,start=r.pos;
 // 从 length-9 起：V2 的最低包尾就是 9 字节（标记 4 + 令牌 4 + 胜败 1）。
 for(let offset=length-9;offset>=start;offset--){
  const marker=r.b.readInt32BE(offset);
  if(marker!==BATTLE_TRAILER_V3&&marker!==BATTLE_TRAILER_V2)continue;
  if(r.b.readInt32BE(offset+4)!==battle.token)continue;
  if(!plansFit(r.b,start,offset))continue;
  return {offset,modern:marker===BATTLE_TRAILER_V3};
 }
 return null;
}

export function readBattleResultTail(r,battle,{pet,nativeRounds,role,log}){
 const members=battle.legion||[];
 let located=locateTrailer(r,battle);
 if(!located){
  // 没找到可信包尾（多半是包被改坏/截断了）。退回按开战队伍推算的老办法，让下面几个
  // 分支照旧报出「长度不足 / 会话不匹配 / 计划表异常」，而不是只丢一句「找不到包尾」。
  const tailSize=9+(pet?8:0)+(members.length?5+members.reduce((n,m)=>n+13+(m.petUid?8:0),0):0);
  const v2Offset=r.b.length-tailSize,v3Offset=v2Offset-2;
  const modern=v3Offset>=r.pos&&r.b.readInt32BE(v3Offset)===BATTLE_TRAILER_V3;
  const trailerOffset=modern?v3Offset:v2Offset;
  if(trailerOffset<r.pos)reject('战斗结果数据不完整',`整包 ${r.b.length} 字节，按开战队伍算出的包尾起点 ${trailerOffset} 早于已读位置 ${r.pos}（即预期包尾 ${tailSize} 字节比剩下的还多）`);
  const marker=r.b.readInt32BE(trailerOffset),receivedToken=r.b.readInt32BE(trailerOffset+4);
  if(marker!==(modern?BATTLE_TRAILER_V3:BATTLE_TRAILER_V2)||receivedToken!==battle.token){
   log('battle-envelope-mismatch',{role,nativeRounds,trailerOffset,length:r.b.length,marker,receivedToken,expectedToken:battle.token});
   reject('战斗会话不匹配',`包尾位置 ${trailerOffset} 处的标记 ${marker.toString(16)}/令牌 ${receivedToken}，预期 ${battle.token}`);
  }
  located={offset:trailerOffset,modern};
 }
 const {offset:trailerOffset,modern}=located;
 let commands=0;
 while(r.pos<trailerOffset){
  if(trailerOffset-r.pos<3)reject('战斗指令数据不完整',`包尾前只剩 ${trailerOffset-r.pos} 字节，凑不满一条计划的长度前缀`);
  const size=r.length();
  if(r.pos+size>trailerOffset||++commands>4096)reject('战斗指令数据不完整',`第 ${commands} 条计划 ${size} 字节越过了包尾 ${trailerOffset}`);
  r.take(size);
 }
 if(nativeRounds!==(Math.floor(commands/(pet?2:1))&255))reject('战斗指令数量不一致',`包内 ${commands} 条计划折合 ${Math.floor(commands/(pet?2:1))} 回合，头部写的是 ${nativeRounds}`);
 r.int();r.int();const result=r.byte(),rounds=modern?r.short()&65535:nativeRounds;
 // V3 carries the engine's actual round count, independent of party size.
 // V2 remains readable by clients opened before this update.
 if((modern||!members.length)&&rounds>100)reject('战斗回合数据不完整',`回合数 ${rounds} 超过上限 100`);
 return {result,rounds,commands,wireVersion:modern?3:2};
}
