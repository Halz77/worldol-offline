// 新月繁华之都的纪念 NPC（lib/memorial-npcs.mjs）。
//
// 这几位是纯聊天角色：复用原版 NPC 的点击 / 选中 / 对话窗口机制，没有新增任何协议。
// 这里守住四件事：
//   1. 它们确实被挂进了地图 19，且编号、落点都不和原版冲突（落点还要能站得住）；
//   2. 编号留在 0..127 —— NPC 编号在协议里按有符号字节处理，官方 500+ 个 NPC 无一越界；
//   3. pureTalk 让 npcSign 返回 0，玩家身上挂着可接任务时它们头上也不会冒感叹号；
//   4. 名字 / 欢迎语 / 对话逐字编码正确，换行不丢 —— 客户端就是靠 talkDetail 弹窗的。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {maps,npcSign,normalizeRole,walkable} from '../lib/content.mjs';
import {memorialNpcs,MEMORIAL_MAP_ID,MEMORIAL_NPC_IDS} from '../lib/memorial-npcs.mjs';
import {npcPacket} from '../lib/game-packets.mjs';
import {handleGame} from '../lib/game-service.mjs';
import {Writer,Reader} from '../lib/codec.mjs';

const scene=()=>maps[MEMORIAL_MAP_ID];
const role=extra=>normalizeRole({id:1,name:'纪念NPC验收',level:97,mapId:MEMORIAL_MAP_ID,x:3,y:3,restoration:{starterIssued:true},...extra});

test('四位纪念 NPC 都挂在新月繁华之都，字段齐全',()=>{
 assert.equal(MEMORIAL_MAP_ID,19);
 assert.equal(memorialNpcs.length,4);
 const names=['创世神N','界王·猫神','洛天依&初音','猎狗座'];
 assert.deepEqual(memorialNpcs.map(n=>n.name),names,'顺序与文案要和人给的清单一致');
 for(const npc of memorialNpcs){
  const placed=scene().npcs.find(n=>n.id===npc.id);
  assert.ok(placed,`地图 19 里应该有「${npc.name}」`);
  assert.equal(placed,npc,'挂进地图的就是定义里的那个对象');
  assert.equal(npc.type,0,'纯聊天走 npcType 0');
  assert.equal(npc.local,true,'本地新增要标 local，否则会被 officialSign 接管');
  assert.equal(npc.pureTalk,true);
  assert.ok(npc.welcome&&npc.welcome.length>0,`${npc.name} 要有欢迎语`);
  assert.ok(npc.talk&&npc.talk.length>0,`${npc.name} 要有对话`);
  assert.ok(Number.isInteger(npc.icon)&&npc.icon>0,`${npc.name} 的 icon 要指向一个 model`);
 }
});

test('编号留在 0..127，落点不冲突且能站得住',()=>{
 const seen=new Set();
 for(const npc of memorialNpcs){
  assert.ok(npc.id>=0&&npc.id<=127,`${npc.name} 的编号 ${npc.id} 超出有符号字节范围`);
  assert.equal(seen.has(npc.id),false,`编号 ${npc.id} 重复`);
  seen.add(npc.id);
  assert.equal(walkable(MEMORIAL_MAP_ID,npc.x,npc.y),true,`${npc.name} 站在不可通行的 (${npc.x},${npc.y})`);
 }
 // 与地图上其余 NPC（原版 20 个 + 补给商人）互不重叠
 const others=scene().npcs.filter(n=>!MEMORIAL_NPC_IDS.includes(n.id));
 for(const npc of memorialNpcs){
  assert.equal(others.some(n=>n.x===npc.x&&n.y===npc.y),false,`(${npc.x},${npc.y}) 已被占用`);
  assert.equal(others.some(n=>n.id===npc.id),false,`编号 ${npc.id} 与原版冲突`);
 }
});

// 站位：分开站。四位各占广场上一处互不相邻的空地（最小间距 3 格以上），合起来的重心
// 落在「宠物训练师(18,8)」与「装备与补给商人(20,18)」的中点附近。
// 另外还要确认每一格都没压到「高大装饰」上 —— 地图数据里的灯柱 / 花坛（344x 那一批）
// 只是摆件，blocks 通行位看不出它们，必须直接查图层里的对象框，否则 NPC 会跟灯柱重叠。
test('四位分开站在宠物训练师与装备与补给商人之间的广场，各占一处空地',()=>{
 const map=JSON.parse(fs.readFileSync(new URL('../data/maps/19.json',import.meta.url),'utf8'));
 const T=24;
 const tall=[];
 for(const layer of map.layers)for(const o of layer.obj||[])if(o[0]===2&&!(o[4]>=900&&o[5]>=900)&&o[5]>=45)tall.push(o);
 const onTall=(x,y)=>{const px=x*T,py=y*T;return tall.some(o=>px<o[2]+o[4]&&px+T>o[2]&&py<o[3]+o[5]&&py+T>o[3]);};

 assert.equal(memorialNpcs.length,4);
 const at=id=>memorialNpcs.find(x=>x.id===id);
 // 固定站位（改动这个用例时记得同步 lib/memorial-npcs.mjs 的注释）
 assert.deepEqual([at(122).x,at(122).y],[16,10]);
 assert.deepEqual([at(123).x,at(123).y],[21,10]);
 assert.deepEqual([at(124).x,at(124).y],[18,16]);
 assert.deepEqual([at(125).x,at(125).y],[21,14]);

 for(const npc of memorialNpcs){
  assert.equal(walkable(MEMORIAL_MAP_ID,npc.x,npc.y),true,`${npc.name} 站在不可通行的 (${npc.x},${npc.y})`);
  assert.equal(onTall(npc.x,npc.y),false,`${npc.name} 压在高大装饰物上 (${npc.x},${npc.y})`);
 }

 // 各自分开：两两之间至少隔 3 格，不能挤成一团
 const gap=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 let minGap=Infinity;
 for(let i=0;i<memorialNpcs.length;i++)for(let j=i+1;j<memorialNpcs.length;j++)minGap=Math.min(minGap,gap(memorialNpcs[i],memorialNpcs[j]));
 assert.ok(minGap>=3,`四位要分开站，最小间距只有 ${minGap.toFixed(2)} 格`);

 // 与地图上其余 NPC 也要留出距离，别贴着宠物训练师 / 竞技场站
 const others=scene().npcs.filter(n=>!MEMORIAL_NPC_IDS.includes(n.id));
 let minOther=Infinity;
 for(const npc of memorialNpcs)for(const o of others)minOther=Math.min(minOther,gap(npc,o));
 assert.ok(minOther>=2,`与原有 NPC 太近，最近只有 ${minOther.toFixed(2)} 格`);

 // 整体落在两位商店 NPC 之间，且重心靠近两者连线的中点
 const pet=scene().npcs.find(n=>n.name==='宠物训练师');
 const shop=scene().npcs.find(n=>n.name==='装备与补给商人');
 assert.ok(pet&&shop,'地图 19 应该有宠物训练师与装备与补给商人');
 const cx=memorialNpcs.reduce((s,n)=>s+n.x,0)/4;
 const cy=memorialNpcs.reduce((s,n)=>s+n.y,0)/4;
 assert.ok(cy>pet.y&&cy<shop.y,`纵向重心 ${cy} 要落在两位 NPC 的 ${pet.y}..${shop.y} 之间`);
 assert.ok(Math.abs(cx-(pet.x+shop.x)/2)<=2,`横向重心 ${cx} 要靠近两位 NPC 的中线`);
 const span=Math.hypot(pet.x-shop.x,pet.y-shop.y);
 assert.ok(Math.hypot(cx-pet.x,cy-pet.y)<span,'重心到宠物训练师要比两位 NPC 之间还近');
 assert.ok(Math.hypot(cx-shop.x,cy-shop.y)<span,'重心到补给商人要比两位 NPC 之间还近');
});

test('纯聊天标记让它们不挂任务标记（玩家身上还挂着可接任务时也一样）',()=>{
 // 新角色默认就有未接的本地任务，普通 type 0 NPC 在这个状态下会返回 3（可接取）
 const fresh=role();
 for(const npc of memorialNpcs)assert.equal(npcSign(fresh,npc),0,`${npc.name} 不该冒感叹号`);
 // 对照：同一个角色下，新手村守卫仍然会正常挂标记
 const guard=maps[1].npcs.find(n=>n.name==='村口守卫');
 assert.equal(npcSign({...fresh,mapId:1},guard),3,'普通 NPC 的任务标记不能被误伤');
});

test('封包把名字、欢迎语、多行对话逐字带过去',()=>{
 const player=role();
 const packet=npcPacket(new Writer(),player,memorialNpcs);
 const r=new Reader(packet.done());
 r.byte();r.byte();r.byte();
 assert.equal(r.byte(),memorialNpcs.length);
 const decoded=[];
 for(let i=0;i<memorialNpcs.length;i++){
  const sign=r.byte();r.byte();r.byte();
  const type=r.byte();
  const icon=Number(r.long());r.short();
  const name=r.utf(),welcome=r.utf(),talk=r.utf();
  const status=r.byte();r.byte();
  const x=r.byte(),y=r.byte();r.byte();r.byte();
  decoded.push({sign,type,icon,name,welcome,talk,x,y,status});
 }
 for(const [i,npc] of memorialNpcs.entries()){
  const got=decoded[i];
  assert.equal(got.sign,0);
  assert.equal(got.type,0);
  assert.equal(got.icon,npc.icon);
  assert.equal(got.name,npc.name);
  assert.equal(got.welcome,npc.welcome);
  assert.equal(got.talk,npc.talk,'对话要逐字一致，换行也不能丢');
  assert.equal(got.talk.split('\n').length,npc.talk.split('\n').length);
  assert.equal(got.x,npc.x);assert.equal(got.y,npc.y);
  assert.equal(got.status,23,'type 0 的展示状态位是原版既定的 23');
  assert.ok(got.y>0&&got.y<127,`${npc.name} 的 y 落在地图内`);
 }
});

test('对话文本没有被换行拆坏：每行都以句号类标点收尾，没有空行',()=>{
 for(const npc of memorialNpcs){
  const lines=npc.talk.split('\n');
  assert.ok(lines.length>=2,`${npc.name} 的对话应该分段`);
  for(const line of lines){
   assert.ok(line.trim().length>0,`${npc.name} 的对话里有空行`);
   assert.notEqual(line[0],'\n');
  }
  assert.equal(/[。！？]$/.test(lines[lines.length-1]),true,`${npc.name} 的最后一行应该是完整句子`);
 }
});

test('点开这些 NPC 不会触发任务请求的死路（14501 回 0 个任务）',()=>{
 // type 0 在客户端等于 NPC_MISSION，点击时会先请求任务数据再弹窗。
 // 服务端必须回一个「0 个任务」的包，客户端才会继续走到 doMissionNpc 打开对话窗。
 const player=role();
 for(const npc of memorialNpcs){
  const sent=[];
  const request=new Reader(new Writer().short(npc.id).byte(0).byte(0).done());
  const handled=handleGame(14501,request,{role:player},{store:{save(){}},send(type,buf){sent.push(buf);},log(){}});
  assert.equal(handled,true,'14501 必须被本地世界认领');
  assert.equal(sent.length,1,'一次请求只回一包');
  const r=new Reader(sent[0].done());
  assert.equal(r.short(),npc.id,'回包要带上 NPC 编号');
  assert.equal(r.byte(),0,`${npc.name} 没有任务，任务数必须是 0`);
 }
});

test('不在世界里的编号仍然按原样拒绝，避免被当成新 NPC 的漏洞',()=>{
 const sent=[];
 handleGame(14501,new Reader(new Writer().short(200).byte(0).byte(0).done()),{role:role()},{store:{save(){}},send(type,buf){sent.push(buf);},log(){}});
 const r=new Reader(sent[0].done());
 assert.equal(r.short(),200);
 assert.equal(r.byte(),-1,'未知 NPC 要回错误状态而不是空任务表');
 assert.ok(r.string().length>0,'并给出可读的原因');
});
