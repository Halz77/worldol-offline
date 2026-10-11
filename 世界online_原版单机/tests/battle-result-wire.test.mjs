import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';
import {Writer,Reader,unframe} from '../lib/codec.mjs';
import {initializeNewbie} from '../lib/progression.mjs';
import {normalizeRole,hpMax,mpMax} from '../lib/content.mjs';
import {bindLegionRoster,changeLegionFormation} from '../lib/legion-state.mjs';
import {handleLegion} from '../lib/legion-service.mjs';
import {handleGame} from '../lib/game-service.mjs';
import {activePet,openContainer,equipPet} from '../lib/pet-state.mjs';
import {firstFree,nativeVitalsCeiling} from '../lib/restoration.mjs';
import {BATTLE_TRAILER_V2,BATTLE_TRAILER_V3} from '../lib/battle-result-wire.mjs';
import {decoders} from '../tools/capture-decoders.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),d=decoders(root),BC=d.module(61).constants;
const source=fs.readFileSync(new URL('../web/offline.js',import.meta.url),'utf8');
let encodeSource;
simple(parse(source,{ecmaVersion:'latest'}),{VariableDeclarator(n){if(n.id.name==='encode')encodeSource=source.slice(n.init.start,n.init.end);}});
assert.ok(encodeSource);

function fixture({pet=true}={}){
 const roles=Array.from({length:5},(_,i)=>{
  const p={id:1001+i,accountId:1,name:'战斗测试'+i,sex:0,race:0,job:1,level:1,icon1:'2240667',icon2:'0',icon3:'0'};
  initializeNewbie(p);normalizeRole(p);return p;
 });
 bindLegionRoster(roles);const p=roles[0];
 for(let i=1;i<roles.length;i++)changeLegionFormation(p,{type:1,legionId:1,index:i,actorId:roles[i].id});
 for(const role of pet?[p,roles[1]]:[]){
  const slot=firstFree(role);role.inventory.push({itemId:30100,slot,quantity:1});
  openContainer(role,slot,1);equipPet(role,role.inventory.find(i=>i.pet).slot,1);
 }
 p.mapId=10;p.x=17;p.y=20;p.hp=hpMax(p);p.mp=mpMax(p);
 const context={role:p},sent=[],events=[],env={store:{save(){}},send(type,w){sent.push({type,bytes:w instanceof Writer?w.done():Buffer.from(w)});},log(kind,data){events.push({kind,...data});}};
 const call=(type,bytes)=>handleGame(type,new Reader(bytes instanceof Writer?bytes.done():bytes),context,env);
 function start(){p.battles.cooldowns[701]=0;call(12501,new Writer().short(701));}
 start();return {roles,p,context,env,sent,events,call,start};
}

function packet(h,plans,{rounds=30,result=2,legacy=false,armyOverride}={}){
 const {p,roles,context}=h,pet=activePet(p),battle={round:rounds,result,seed:17,getType:()=>BC.LOCAL,getMonsterGroup:()=>({groupId:701})};
 class Message{
  constructor(type){this.type=type;this.w=new Writer();}
  putInt(v){this.w.int(v);}putShort(v){this.w.short(v);}putByte(v){this.w.byte(v);}
  putBoolean(v){this.w.bool(v);}putBytes(v){if(v)this.w.bytes(v);}
  get ba(){return {position:this.w.done().length};}
  // Egret reserves capacity beyond the last written byte.
  get bytes(){return Buffer.concat([this.w.done(),Buffer.alloc(64)]);}
 }
 let msg;const nativeEnd=d.native(369,'sendLocalBattleReward',{
  y:{default:BC},o:{Message},l:{default:{CG_FIGHT_RUN_LOCALBATTLE:12502}},u:{default:{myPlayer:p}},
  w:{default:{getProxy:()=>({buddyNum:0})}},b:{ModName:{},ProxyType:{}},s:{default:{sendRequest:value=>{msg=value;}}}
 });
 nativeEnd.call({battle,startHP:p.hp,startMP:p.mp,battlePanel:{planVector:plans},isTag:()=>!!pet,updateMercenaryHpMP(){}});
 let army=roles.slice(1).map(r=>({id:r.id,hp:r.hp-1,mp:r.mp,...(activePet(r)?{petHP:activePet(r).hp-1,petMP:activePet(r).mp}:{})}));
 // 模拟客户端那边的军团资料没就绪：它只带回部分（或一个都不带）助战行。
 if(armyOverride)army=armyOverride(army);
 const req=id=>id===54?{default:{ins:{battle}}}:id===5?{default:{myPlayer:{getPet:()=>pet}}}:{};
 const encode=new vm.Script('('+encodeSource+')').runInNewContext({req,legion:{battleResult:()=>army},battleToken:context.battle.token,record(){},flushPosition(){},Uint8Array,DataView});
 let bytes=Buffer.from(encode(msg));const nativeLength=msg.ba.position;
 assert.equal(bytes.readInt32BE(4+nativeLength),BATTLE_TRAILER_V3);
 if(legacy){
  bytes=Buffer.concat([bytes.subarray(0,4+nativeLength+9),bytes.subarray(4+nativeLength+11)]);
  bytes.writeInt32BE(BATTLE_TRAILER_V2,4+nativeLength);
 }
 return {bytes:unframe(bytes).body,nativeLength};
}

test('native odd legion plan list reproduces the 869-byte failed result and now settles V2 and V3',()=>{
 // 133 plans, pet enabled: v305 writes 66 into its round byte and still
 // serializes all 133 entries, including the final five-byte attack record.
 const plans=[...Array.from({length:77},()=>[2,5,1,2]),...Array.from({length:55},()=>[0]),[1,5]];
 for(const legacy of [true,false]){
  const h=fixture(),{bytes,nativeLength}=packet(h,plans,{legacy});
  assert.equal(nativeLength,787);assert.equal(bytes[22],66);
  const old=new Reader(bytes);old.take(23);for(let i=0;i<66*2;i++)old.bytes();
  assert.equal(old.pos,782);assert.equal(old.int(),513,'Matches the production marker mismatch');
  if(legacy)assert.equal(bytes.length,869);
  h.call(12502,bytes);assert.equal(h.context.battle,null);assert.equal(h.p.battles.wins,1);
  assert.equal(h.p.battles.last.rounds,legacy?66:30);
  handleLegion(90017,new Reader([]),h.context,h.env);
  assert.equal(JSON.parse(new Reader(h.sent.at(-1).bytes).string()).ready,true);
  const before=JSON.stringify(h.roles);
  assert.throws(()=>h.call(12502,bytes),/已结算/);assert.equal(JSON.stringify(h.roles),before);
  h.start();assert.ok(h.context.battle,'Next encounter must remain available');
 }
});

test('actual rounds stay independent of 150 or more helper commands across consecutive battles',()=>{
 const h=fixture({pet:false});
 for(const count of [150,155,260]){
  const {bytes}=packet(h,Array.from({length:count},()=>[1,5]),{rounds:30});
  assert.equal(bytes[22],count&255);
  h.call(12502,bytes);assert.equal(h.context.battle,null);assert.equal(h.p.battles.last.rounds,30);
  if(count!==260)h.start();
 }
 assert.equal(h.p.battles.wins,3);
});

test('malformed plan lengths and stale tokens preserve state and can retry once without duplicate rewards',()=>{
 const h=fixture(),{bytes,nativeLength}=packet(h,Array.from({length:7},()=>[1,5]),{rounds:2});
 const before=JSON.stringify(h.roles),token=h.context.battle.token;
 const stale=Buffer.from(bytes);stale.writeInt32BE(token^1,nativeLength+4);
 assert.throws(()=>h.call(12502,stale),/会话不匹配/);
 const truncated=Buffer.from(bytes);truncated.writeUIntBE(nativeLength,23,3);
 assert.throws(()=>h.call(12502,truncated),/指令数据不完整/);
 // 第 40 版起被拒的战斗搬去 context.rejectedBattle：context.battle 一空，二十多处
 // 「战斗期间不许动」的守卫（移动/传送/鉴定/军团/加点…）就自动放行，玩家不会被锁死。
 assert.equal(JSON.stringify(h.roles),before,'结算被拒必须把角色状态回滚干净');
 assert.equal(h.context.battle,null);
 assert.equal(h.context.rejectedBattle.token,token,'作废的那场要留着，客户端重发同一包还能再试一次');
 h.call(12502,bytes);assert.equal(h.p.battles.wins,1);assert.equal(h.context.battle,null);assert.equal(h.context.rejectedBattle,null);
 assert.throws(()=>h.call(12502,bytes),/已结算/);assert.equal(h.p.battles.wins,1);
 assert.equal(h.events.at(-1).commands,7);
});

test('rejected settlements never lock the player out of the next battle',()=>{
 // 线上表现（第 40 版修的）：打怪结算偶发被拒后，再去打下一只怪只会得到
 // 「请先结束上一场战斗」（军团 90017 的 ready=!context.battle）/「上一场战斗尚未结束」，
 // 只能重进角色。这里把「被拒 → 还能继续开战」钉住。
 const h=fixture();
 const {bytes}=packet(h,Array.from({length:2},()=>[1,5]),{rounds:2});
 const corrupt=Buffer.from(bytes);corrupt.writeInt8(0,22);     // 头部回合字节与包内计划数对不上
 let rejected='';
 try{h.call(12502,corrupt);}catch(error){rejected=error.message;}
 assert.match(rejected,/战斗指令数量不一致/);
 const event=h.events.find(e=>e.kind==='battle-result-rejected');
 assert.ok(event,'被拒时必须落一条 battle-result-rejected 日志');
 assert.match(event.reason,/战斗指令数量不一致/);
 // 军团面板问「准备好了吗」：被拒之后必须回 ready=true，否则客户端自己就拦住玩家。
 handleLegion(90017,new Reader([]),h.context,h.env);
 assert.equal(JSON.parse(new Reader(h.sent.at(-1).bytes).string()).ready,true);
 // 直接开下一场：必须能开，而且开成功后作废的那场要被丢掉。
 h.start();
 assert.ok(h.context.battle,'被拒之后必须能开下一场');
 assert.equal(h.context.rejectedBattle,null);
 // 本用例的 fixture 把编队 1–4 号位都填满了（4 个助战；线上那个「魔攻」存档是 3 个）。
 assert.equal(h.context.battle.legion.length,4,'新一场照样带上助战');
});

test('客户端带回来的助战比开战快照少（军团资料没就绪 → 助战没上场）照样结算',()=>{
 // 线上那条「打怪偶尔结算失败」的主因：客户端 members()（军团 VO）没就绪时，
 // web/legion.js 的 World.toBattle 包装会直接放行、getLocalBattlePlayerList 也不加助战，
 // 于是客户端打的是「只有主角色」的一场，包尾里没有军团段；而服务端仍按开战快照
 // 推算包尾位置 → 推算位置落进计划表 → 整包被拒、不发奖励、还把玩家卡死。
 // 现在包尾按「标记 + 令牌」定位、军团队伍按包里的行数读，这类不一致照旧结算。
 const partial=fixture();
 const {bytes}=packet(partial,Array.from({length:2},()=>[1,5]),{rounds:1,armyOverride:rows=>rows.slice(0,1)});
 partial.call(12502,bytes);
 assert.equal(partial.context.battle,null);assert.equal(partial.context.rejectedBattle,null);
 assert.equal(partial.p.battles.wins,1);
 const event=partial.events.find(e=>e.kind==='battle-legion-mismatch');
 assert.deepEqual({expected:event.expected,received:event.received},{expected:4,received:1},'少带了助战要落一条日志');

 const none=fixture();
 const {bytes:bytes2}=packet(none,Array.from({length:2},()=>[1,5]),{rounds:1,armyOverride:()=>[]});
 none.call(12502,bytes2);
 assert.equal(none.p.battles.wins,1,'一个助战都没带（纯主角色那场）也要能结算');
 assert.equal(none.context.rejectedBattle,null);
});

test('rejection messages name the exact field so a screenshot is enough to diagnose',()=>{
 // 原来十项校验共用一句「战斗结果数据不完整，未发放奖励。」，线上只能靠猜（第 40 版）。
 // 结算被拒后 context.battle 就空了，所以每种情形都要用新的 fixture 单独造包。
 const zeroRounds=fixture();
 const {bytes}=packet(zeroRounds,Array.from({length:2},()=>[1,5]),{rounds:0});
 assert.throws(()=>zeroRounds.call(12502,bytes),/战斗结果数据不完整（判定胜利但回合数为 0），未发放奖励。/);
 const badResult=fixture();
 const {bytes:bytes2}=packet(badResult,Array.from({length:2},()=>[1,5]),{rounds:3,result:0});
 assert.throws(()=>badResult.call(12502,bytes2),/战斗结果数据不完整（胜败标记 0 不在 1\.\.4），未发放奖励。/);
});

test('客户端口径的血蓝上限不被误判（第 41 版：服务端近似公式对称号偏小）',()=>{
 // 服务端 attributes() 把称号 power 并进「装备列」参与运算，而原生引擎把它当独立的
 // titlePower 放在另一个层级 —— 同一套配装两边算出的上限不同。实测玩家「魔攻」
 // （称号 1302）自研 MP 273677 / 原生 280546。结算校验的是客户端发回来的当前值，
 // 用自研口径去卡它就会把合法战斗判成「战斗结果数据不完整」而扣发奖励（玩家实际报的
 // 就是「法力 280546 超出 0..273677」）。
 const h=fixture();
 h.p.titleId=1302;                     // power 7/+75、8/+20，足以把两条口径拉开
 const client=nativeVitalsCeiling(h.p);
 assert.ok(client&&client.mp>mpMax(h.p),`该称号应当造出「原生上限 > 自研上限」：${JSON.stringify(client)} vs 自研 ${mpMax(h.p)}`);
 h.p.mp=client.mp;                     // 客户端把「它的上限」当当前法力发回来
 h.call(12502,packet(h,Array.from({length:2},()=>[1,5]),{rounds:3}).bytes);
 assert.equal(h.p.battles.wins,1,'超出服务端口径、但在客户端口径内的法力不该拒绝结算');
 const over=h.events.filter(e=>e.kind==='battle-vitals-over-self');
 assert.equal(over.length,1,'两条口径不同要落一条日志，便于以后和「真异常」区分');
 assert.deepEqual(over[0].native,client);

 // 真异常（远超客户端口径）仍要拒绝，而且报错点名是哪一项。
 // 注意上面那场胜利会发经验、可能让角色升级，所以上限要重新取。
 h.start();
 const next=nativeVitalsCeiling(h.p)||{hp:mpMax(h.p),mp:mpMax(h.p)};
 h.p.mp=next.mp*3;
 assert.throws(()=>h.call(12502,packet(h,Array.from({length:2},()=>[1,5]),{rounds:3}).bytes),
   /法力 \d+ 超出 0\.\.\d+），未发放奖励。/);   // 原因被全角括号包住
});

test('nativeVitalsCeiling 在原生模块算不出结果时退回 null，不让结算崩掉',()=>{
 // 服务端存档里可能有原生模块认不出的本地道具（造型/本地补充装备）。那种情况下原生
 // 解析会抛错（实测 itemId 999999 就会），校验必须退回服务端口径，而不是把整场结算打断。
 assert.equal(nativeVitalsCeiling({id:1,level:1,inventory:[{itemId:999999,slot:0}]}),null);
 // 反过来，算得出的角色必须给正数 —— 否则「放宽」判断会形同虚设。
 const ok=nativeVitalsCeiling({id:1,level:1,inventory:[]});
 assert.ok(ok&&ok.hp>0&&ok.mp>0);
});
