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
import {firstFree} from '../lib/restoration.mjs';
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

function packet(h,plans,{rounds=30,result=2,legacy=false}={}){
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
 const army=roles.slice(1).map(r=>({id:r.id,hp:r.hp-1,mp:r.mp,...(activePet(r)?{petHP:activePet(r).hp-1,petMP:activePet(r).mp}:{})}));
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
 assert.equal(JSON.stringify(h.roles),before);assert.equal(h.context.battle.token,token);
 h.call(12502,bytes);assert.equal(h.p.battles.wins,1);assert.equal(h.context.battle,null);
 assert.throws(()=>h.call(12502,bytes),/已结算/);assert.equal(h.p.battles.wins,1);
 assert.equal(h.events.at(-1).commands,7);
});
