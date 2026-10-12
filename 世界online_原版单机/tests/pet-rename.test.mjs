/**
 * 15511 = CG_PET_CHANGE_NAME（宠物改名）的守卫用例。
 *
 * 客户端那条链路一直在（宠物面板「改名」→ showInput → doPetChangeNameMsg →
 * createPetChangeName(petItem.slotPos, name)），只是服务端从来没接过这个号，
 * 点确认之后石沉大海。这份用例钉住三件事：
 *   1. 回包字段与客户端解析逐字节对齐 —— byte 状态（负数=错误串）+ 黄金/银/铜 三个 int
 *      （`ModelVo.setPlayerMoney(m1,m2,m3)`），少一个 int 客户端就会把货币条读花；
 *   2. 名字只存在宠物自己身上，但要**同时**体现在背包条目名与宠物详情里；
 *   3. 六种拒绝路径都不许改存档。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {Writer,Reader} from '../lib/codec.mjs';
import {normalizeRole} from '../lib/content.mjs';
import {initializeNewbie} from '../lib/progression.mjs';
import {openContainer} from '../lib/pet-state.mjs';
import {petItemPacket,petDetail} from '../lib/pet-packets.mjs';
import {bagPacket} from '../lib/restoration-packets.mjs';
import {handlePetRename,PET_NAME_LIMIT} from '../lib/pet-rename-service.mjs';

function harness(save=()=>{}) {
 const p={id:91,name:'宠物改名验收',sex:1,race:0,job:1,level:1};initializeNewbie(p);p.level=40;normalizeRole(p);
 p.inventory.push({itemId:30100,slot:31,quantity:1});openContainer(p,31,1);
 const item=p.inventory.find(i=>i.pet),pet=item.pet;
 const sent=[],context={role:p},env={store:{save},send(type,w){sent.push({type,bytes:w.done()});},log(type,row){sent.push({type:'log',name:type,row});}};
 assert.ok(item.slot>=30,'刚开出来的宠物在背包槽里');
 return {p,item,pet,slot:item.slot,sent,context,
  /** 发一个包，默认断言请求体被完整读完。 */
  reply(type,body,complete=true){
   const r=new Reader(body.done());assert.equal(handlePetRename(type,r,context,env),true);
   if(complete)assert.equal(r.pos,r.b.length,'请求体应被完整读取');
   return sent.findLast(s=>s.type===type).bytes;
  },
  /** 发一个预期被拒的包，返回错误串。 */
  deny(type,body){
   const out=new Reader(this.reply(type,body,false));
   assert.equal(out.byte(),-1,'应该被拒绝');
   return out.string();
  }};
}
const purse=p=>[p.gold||0,p.silver||0,p.coins||0];
/** 宠物道具（背包条目）里的名字：跳过 18 字节的公共前缀，再读 type/bool/string。 */
function nameInBag(bytes){
 const r=new Reader(bytes);
 r.short();r.int();r.int();r.byte();r.short();r.short();r.short();r.byte();
 assert.equal(r.byte(),32,'宠物道具的 type 是 32');r.bool();
 return r.string();
}
/** 宠物详情里的名字：byte 状态后紧跟 string。 */
function nameInDetail(bytes){const r=new Reader(bytes);assert.equal(r.byte(),0);return r.string();}

test('15511 给出战宠物改名：回包逐字节等于客户端要读的四个字段',()=>{
 const h=harness();
 h.item.slot=1; // 出战
 const before=structuredClone(h.p),reply=h.reply(15511,new Writer().short(1).string('阿黄'));
 assert.equal(h.pet.name,'阿黄');
 // byte 0 + 黄金/银/铜。改名免费（enterWorld 里 PET_CHANGE_NAME_MONEY = [2,0]），货币一个不动。
 assert.deepEqual(reply,new Writer().byte(0).int(purse(h.p)[0]).int(purse(h.p)[1]).int(purse(h.p)[2]).done());
 assert.deepEqual(purse(h.p),purse(before),'改名不该动货币');
 assert.equal(h.sent.filter(s=>s.name==='pet-renamed').length,1,'只写一次存档、只记一条日志');
 // 背包条目名与宠物详情名都跟着变（客户端 createItemPet / fromBytesDetail 读的就是它们）。
 assert.equal(nameInBag(petItemPacket(new Writer(),h.item).done()),'阿黄');
 assert.equal(nameInDetail(petDetail(new Writer(),h.pet).done()),'阿黄');
 // 整包背包也带得出去，且解析回来还是新名字（只放宠物道具，方便按字段走一遍）。
 const bag=new Reader(bagPacket(new Writer(),{...h.p,inventory:[h.item]}).done());
 assert.equal(bag.short(),1);
 bag.short();bag.int();bag.int();bag.byte();bag.short();bag.short();assert.equal(bag.short(),1);bag.byte();
 assert.equal(bag.byte(),32);bag.bool();assert.equal(bag.string(),'阿黄');
});

test('15511 也能给休息中的宠物改名（客户端传的是背包槽位，不是出战槽）',()=>{
 const h=harness();
 h.reply(15511,new Writer().short(h.slot).string('小黑'));
 assert.equal(h.pet.name,'小黑');
 assert.equal(nameInBag(petItemPacket(new Writer(),h.item).done()),'小黑');
});

test('15511 两端空白会被去掉，长度按「字」算而不是按字节',()=>{
 const h=harness();
 h.reply(15511,new Writer().short(h.slot).string('  小白  '));
 assert.equal(h.pet.name,'小白');
 const name='喵'.repeat(PET_NAME_LIMIT); // 16 个汉字 = 48 字节，按字节算早就超了
 h.reply(15511,new Writer().short(h.slot).string(name));
 assert.equal(h.pet.name,name);
});

test('15511 的六种拒绝路径都不改存档',()=>{
 for(const [mode,body,pattern] of [
  ['空名字',h=>new Writer().short(h.slot).string(''),/不能为空/],
  ['纯空格',h=>new Writer().short(h.slot).string('   '),/不能为空/],
  ['超长',h=>new Writer().short(h.slot).string('喵'.repeat(PET_NAME_LIMIT+1)),/最多 16 个字/],
  ['带换行',h=>new Writer().short(h.slot).string('阿\n黄'),/特殊字符/],
  ['槽位没有宠物',h=>new Writer().short(h.slot+9).string('阿黄'),/没有宠物/],
  ['包尾有多余字节',h=>new Writer().short(h.slot).string('阿黄').byte(0),/格式有误/],
 ]){
  const h=harness(),before=JSON.stringify(h.p);
  assert.match(h.deny(15511,body(h)),pattern,mode);
  assert.equal(JSON.stringify(h.p),before,mode);
 }
 // 槽位上是普通道具（不是宠物）时同样拒绝。
 const h=harness();h.p.inventory.push({itemId:40021,slot:40,quantity:1});
 const before=JSON.stringify(h.p);
 assert.match(h.deny(15511,new Writer().short(40).string('阿黄')),/没有宠物/);
 assert.equal(JSON.stringify(h.p),before);
});

test('15511 存盘失败要回滚名字，没进角色也要拒绝',()=>{
 const h=harness(()=>{throw Error('disk failure');}),before=h.pet.name;
 assert.match(h.deny(15511,new Writer().short(h.slot).string('阿黄')),/disk failure/);
 assert.equal(h.pet.name,before,'存盘失败必须把名字改回去');
 const bare=harness(),sent=[];
 assert.equal(handlePetRename(15511,new Reader(new Writer().short(bare.slot).string('阿黄').done()),{},{
  store:{save(){}},send(type,w){sent.push(w.done());},log(){}}),true);
 assert.equal(new Reader(sent[0]).byte(),-1);
});

test('15511 不在分派链里就什么都不做，且战斗中允许改名',()=>{
 const h=harness();
 // 别的号一律不认领（且不读字节 —— 分派链的约定）。
 const untouched=new Reader(new Writer().short(h.slot).string('阿黄').done());
 assert.equal(handlePetRename(14006,untouched,{role:h.p},{store:{save(){}},send(){},log(){}}),false);
 assert.equal(untouched.pos,0,'拒绝时一个字节都不许读');
 // 战斗是客户端本地跑完再把结算包发上来的；改名只动名字，不碰血量/技能/背包，
 // 所以有意不加「请先结束战斗」这道门（玩家要的正是战斗里也能改）。
 h.context.battle={roleId:h.p.id,round:1};
 h.reply(15511,new Writer().short(h.slot).string('战斗中改的'));
 assert.equal(h.pet.name,'战斗中改的');
});
