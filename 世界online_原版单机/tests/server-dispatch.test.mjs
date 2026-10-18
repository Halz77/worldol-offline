/**
 * 服务端分派与路由的守卫用例。
 *
 * 这套东西的两处「顺序」都是承重的，却完全看不出来：
 *   1. 入站分派链（lib/protocol-dispatch.mjs）：21 个 service 依次问「这个包是不是你的」。
 *      约定是「认领就回 true，不认领就回 false 且一个字节都不许读」。谁把顺序调了、
 *      谁在拒绝时偷读了字节，症状都是「某个功能莫名其妙跑到别人手里」，而且往往只在
 *      特定操作下复现。
 *   2. HTTP 路由表（lib/http-routes.mjs）：`/api/shutdown`、`/api/client-log` 只收 POST；
 *      它们后面那道方法门是位置敏感的 —— 门上面的路由什么方法都收，下面的只收 GET/HEAD。
 *
 * 所以这里把「顺序」「归属」「不变量」三样都钉住。改动 server.mjs / 分派链 / 路由表时，
 * 本文件红了先看断言名字，再决定是改代码还是改这份期望（后者要写明理由）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Reader} from '../lib/codec.mjs';
import {loadProtocolConstants,protocolLookup,parseProtocolConstants} from '../lib/protocol-constants.mjs';
import {INBOUND_CHAIN,createInboundDispatcher,validateInboundChain} from '../lib/protocol-dispatch.mjs';
import {createHttpRouter} from '../lib/http-routes.mjs';
import {codeOnly} from './source-scan.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const P=loadProtocolConstants(root);

// ───────────────────────── 分派链 ─────────────────────────

test('分派链是 22 段且顺序被钉死',()=>{
 // 顺序承重：同一个协议号被两段同时认领时，先到的接走。已知重叠只有 32110（illusion 抢先 official）。
 const expected=['characterFeatures','legion','city','systemSettings','attributes','nativeCommerce','illusion','homeFeatures','recorded','official','equipmentComposition','petEquipment', 'equipmentUpgrades','petItems','petIllusion','petRename','roleRename','restoration','enchantment','spiritSeals','solarChallenge','game'];
 assert.deepEqual(INBOUND_CHAIN.map(s=>s.name),expected);
 assert.equal(INBOUND_CHAIN.length,22);
 // game 是兜底，必须留在最后：战斗/场景/任务的包全归它。
 assert.equal(INBOUND_CHAIN.at(-1).name,'game');
 assert.equal(INBOUND_CHAIN.at(-1).file,'game-service');
 // 每段都要能定位到模块，便于报错时直接去找。
 for(const step of INBOUND_CHAIN){
  assert.equal(typeof step.handle,'function',step.name+' 缺少 handle');
  assert.match(step.file,/-service$|^native-commerce$|^pet-service$/,'第 '+step.name+' 段的 file 字段不像模块名：'+step.file);
 }
});

test('补推钩子写的是协议常量名，且必须能解析到',()=>{
 assert.equal(validateInboundChain(P),true);
 const hooks=INBOUND_CHAIN.filter(s=>s.afterClaim);
 assert.deepEqual(hooks.map(s=>s.name),['city','official']);
 // 名 → 号 的绑定也钉住：改错名字会在这里红。
 assert.deepEqual(hooks.map(s=>P[s.afterClaim.onType]),[P.CG_CITY_EXTRACT_MONEY,P.CG_TASK_DELIVER]);
 assert.deepEqual(hooks.map(s=>s.afterClaim.onType),['CG_CITY_EXTRACT_MONEY','CG_TASK_DELIVER']);
 // 名字写错时必须在建分派器这一步就炸，而不是让钩子静默不跑。
 const broken={...P};delete broken.CG_TASK_DELIVER;
 assert.throws(()=>createInboundDispatcher(broken),/不存在的协议常量：CG_TASK_DELIVER/);
});

// ─────────────────── 归属快照（谁接哪个号）───────────────────

const PROBE_TYPES=[
 1,2,3,7,5000,5002,5007,5019,16001,16021,
 10001,10002,10003,10015,10503,10504,10505,10506,10510,10511,10512,10513,10514,10515,10518,10519,10521,10522,10523,
 11003,11004,11006,11023,11024,11025,11026,11027,11038,11053,11054,11055,11078,11083,11160,11161,11163,11172,
 11501,11506,11507,11508,11520,11521,11528,11530,12001,12003,12004,12005,12006,12015,12019,12036,12037,12041,12052,12060,12061,
 12501,12502,13101,13529,13541,13542,13543,14001,14002,14003,14004,14005,14006,14009,14010,14016,14017,
 14501,14502,14503,14504,14551,14553,14554,14562,15502,15511,15512,15514,15516,15517,16009,16051,17001,17002,17015,17017,17101,17102,
 22106,24204,27301,27303,29000,29002,29004,29006,29008,29010,30001,30003,30005,30101,30103,30105,
 31051,31053,31055,31101,31103,31105,32101,32103,32107,32110,
 90001,90002,90003,90004,90015,90016,90017,90019,90020,90021,90022,90023,90024,
 12345,19999,88888,
];

/**
 * 归属快照：号 → 接手的链条段名，`__unclaimed__` 表示全链都不认领。
 *
 * 「不认领」的 27 个号分两类，都是有意留在 server.mjs 里的：
 *   · 登录/系统类：5000/5002/5007/5019/1/2/3/7/16001/16021/10001/10002/10003/10015
 *     —— 它们在 context.account 建立之前就得处理，不能进分派链（分派链的 handler 都要求 context.role）。
 *   · 场景/背包/外观同步：10503/10505/12019/12060 与本地扩展 22106/32107/90021/90022。
 *   · 12345/19999/88888 是哨兵：确认「谁都不认领」这件事本身没变。
 */
const EXPECTED_OWNER={
 characterFeatures:[27301,27303,29000,29002,29004,29006,29008,29010,90015,90016],
 legion:[31051,31053,31055,90017],
 city:[10511,10512,10513,10514,10515],
 systemSettings:[11006],
 attributes:[11003],
 nativeCommerce:[11078,11083,11172,17001,17002,17015,17017,17101,17102,24204],
 illusion:[11530,32110],
 homeFeatures:[13101,30001,30003,30005,90019,90020],
 recorded:[11023,11024,11025,11026,11027,11053,11054,11055,11160,11161,11163,12052,13529,13541,13542,13543,14551,14553,14554,14562,15512,15514,16009,90004],
 official:[10510,10521,10522,10523,16051,32101,32103],
 equipmentComposition:[11501,90001,90002,90003],
 petEquipment:[12061,31101,31103,31105],
 equipmentUpgrades:[11506,11507,11508,11528,12015,12041],
 petItems:[14016,14017,15502,15516,15517],
 petIllusion:[90023,90024],
 petRename:[15511],
 roleRename:[11038],
 restoration:[12001,12003,12004,12005,12006,12036,12037,14001,14002,14003,14004,14005,14006,14009,14010],
 enchantment:[11520,11521],
 spiritSeals:[30101,30103,30105],
 game:[10504,10506,10518,10519,11004,12501,12502,14501,14502,14503,14504],
 __unclaimed__:[1,2,3,7,5000,5002,5007,5019,16001,16021,10001,10002,10003,10015,10503,10505,12019,12060,22106,32107,90021,90022,12345,19999,88888],
};

function stubRole(){return {id:1,level:50,hp:100,mp:100,baseStats:[10,10,10,10,10],inventory:[],skills:[],quests:{completed:[],active:{}},coins:1,icon1:1,icon2:0,icon3:0,mapId:1,x:1,y:1};}

function probeEnv(){
 return {
  store:{save(){},data:{characters:[],accounts:[]},roles(){return[];}},
  send(){},log(){},now:1700000000000,random:()=>0.5,draw(){},
 };
}

/**
 * 用与分派器相同的顺序与短路语义找出「谁接的」。
 *
 * 包体给 96 个 0 字节：正好等价于「客户端发了个编号对但内容是空的包」。
 * 认领（含认领后抛异常）之后读指针可以不为 0 —— 那时已经没有别的段会读它了。
 * 只在**拒绝**时要求读指针一动不动，那才是链条成立的前提。
 */
function ownerOf(type,head,context){
 const reader=new Reader(Buffer.alloc(96).fill(0));
 if(head)reader.b.set(head,0);
 for(const step of INBOUND_CHAIN){
  let claimed=false;
  try{claimed=step.handle(type,reader,context||{role:stubRole()},probeEnv());}catch{claimed=true;}
  if(claimed)return step.name;
  assert.equal(reader.pos,0,'第 '+step.name+' 段拒绝了 '+type+' 却读走了 '+reader.pos+' 字节 —— 后面的段会从错位置开始解析');
 }
 return '__unclaimed__';
}

/** 认领之后抛异常的段（认领了但拒绝执行）。 */
function throwersOf(type){
 for(const step of INBOUND_CHAIN){
  let claimed=false,threw=false;
  try{claimed=step.handle(type,new Reader(Buffer.alloc(96)),{role:stubRole()},probeEnv());}catch{threw=true;claimed=true;}
  if(claimed)return threw?step.name:null;
 }
 return null;
}

test('每个协议号的归属与快照一致',()=>{
 const actual={};
 for(const type of PROBE_TYPES){
  const owner=ownerOf(type);
  (actual[owner]=actual[owner]||[]).push(type);
 }
 assert.deepEqual(actual,EXPECTED_OWNER);
});

test('分派器认领的合并结果与逐段探测一致',()=>{
 // ownerOf 是为了定位「谁接的」而逐段试；这里确认真正的分派器给出的布尔值一致，
 // 避免两者语义跑偏（例如分派器改成不短路了）。
 const dispatch=createInboundDispatcher(P);
 for(const type of PROBE_TYPES){
  const context={role:stubRole()};
  const reader=new Reader(Buffer.alloc(96));
  let result;
  try{result=dispatch(type,reader,context,probeEnv());}catch{result=true;}
  assert.equal(result,ownerOf(type)!=='__unclaimed__','分派器与逐段探测对 '+type+' 的判断不一致');
 }
});

test('12001 的三个接手方由包内首个字节决定',()=>{
 // 使用道具（CG_ACTOR_PLAYERBAG）同时被三段实现，路由结果取决于包内容：
 //   首个字节是 wait（等待类型）。
 //   · 5/6（鉴定、强化）→ equipment-upgrade-service，它排在最前面，直接接手。
 //   · 1/2/3/4/11/12（宠物出战、卸下、开容器、经验卷…）→ pet-service。
 //   · 其余 → pet-service 会把读指针还原并放行，最后落到 restoration-service（穿戴/卸下/转职/丢弃/吃药）。
 // 这三段里任何一段的「拒绝时不许读」被破坏（pet-service 少还原一次 r.pos / 少判一次白名单），
 // 都会让穿戴类请求掉进宠物分支，症状是「穿装备没反应」。
 assert.equal(ownerOf(12001,[5]),'equipmentUpgrades');
 assert.equal(ownerOf(12001,[6]),'equipmentUpgrades');
 assert.equal(ownerOf(12001,[1]),'petItems');
 assert.equal(ownerOf(12001,[4]),'petItems');
 assert.equal(ownerOf(12001,[11]),'petItems');
 assert.equal(ownerOf(12001,[0]),'restoration');
 assert.equal(ownerOf(12001,[9]),'restoration');
 assert.equal(ownerOf(12001,[18]),'restoration');
});

test('32110 归 illusion；official 里那份同名分支不可达',()=>{
 // illusion-service 对 32110 一律返回 true（成功走 32111，失败也走 32111 并记日志），
 // 所以 official-service 里那条 `type===32110` 的分支永远轮不到 —— 是个死分支。
 // 这里把它记下来而不是「修掉」：行为要逐字节保持。
 // 第 77 版：原来它和 32103 挤在同一行（`[32103,32110].includes(type)`），图鉴点亮真正
 // 接入之后两件事分开写了 —— 32103 自己一个分支，32110 这条占位保留原返回值 true。
 assert.equal(ownerOf(32110),'illusion');
 const officialSource=fs.readFileSync(path.join(root,'lib/official-service.mjs'),'utf8');
 assert.match(officialSource,/if\(type===32110\)return true/,'official-service 的 32110 死分支不见了？先确认是不是被有意删掉');
 assert.equal(ownerOf(32103),'official','32103 仍应由 official 接手');
});

// ───────────────────── 拒绝时不消费读指针 ─────────────────────

test('全链在拒绝任何协议号时都不动读指针',()=>{
 // 这是链条成立的前提：所有段共用同一个 Reader。
 // 上面 ownerOf() 里已经带了逐段的断言，这里再对「谁都没认领」的号单独过一遍，
 // 确保走到链尾也没人偷读。
 for(const type of EXPECTED_OWNER.__unclaimed__){
  const context={role:stubRole()};
  const reader=new Reader(Buffer.alloc(96));
  for(const step of INBOUND_CHAIN){
   let claimed;
   try{claimed=step.handle(type,reader,context,probeEnv());}catch{claimed=true;break;}
   assert.equal(reader.pos,0,step.name+' 在拒绝 '+type+' 时读走了 '+reader.pos+' 字节');
   assert.equal(claimed,false,step.name+' 认领了预期无人认领的 '+type);
  }
 }
});

test('没有 context.role 时，只有这五段会接走包（都是抛「请先进入角色」）',()=>{
 // 分派链主要处理「已进入角色」的包：登录/选角由 server.mjs 排在链前。
 // 但有几段把自己的入参校验写在 `!context.role` 之后，于是没有角色时它们会认领并抛异常 ——
 // 服务端的 catch 会记一条 protocol-error（这几个号不在「回失败包」名单里，所以客户端收不到回包）。
 // 这是原有行为，本用例把它定死，免得哪天有人「顺手」把它们改成 return false，
 // 反而让请求掉进后面的段里被误处理。
 const expected={systemSettings:[11006],roleRename:[11038],illusion:[11530,32110],petIllusion:[90023,90024],petRename:[15511]};
 const actual={};
 for(const type of PROBE_TYPES){
  const owner=ownerOf(type,null,{});
  if(owner!=='__unclaimed__')(actual[owner]=actual[owner]||[]).push(type);
 }
 assert.deepEqual(actual,expected);
});

test('认领之后抛异常的号被钉住',()=>{
 // 这些号会被某段接走、然后因为包内容不合规而抛异常 —— 服务端据此回「状态字节 -1 + 文案」。
 // 集合变了就意味着某个功能的失败路径变了。第 77 版 32103（图鉴点亮）真正接管之后
 // 也要解析 group/type（和 32101 同一个 bookRequest），空包同样抛「Invalid handbook request」，
 // 于是它和 32101 并排进了 official 这一格。
 const expected={game:[10506,10518,12501,12502,14502,14503,14504],official:[32101,32103]};
 const actual={};
 for(const type of PROBE_TYPES){
  const owner=throwersOf(type);
  if(owner)(actual[owner]=actual[owner]||[]).push(type);
 }
 assert.deepEqual(actual,expected);
});

// ───────────────────────── 协议常量 ─────────────────────────

test('协议常量从 0019.js 解析，且关键号绑定未被改动',()=>{
 assert.ok(Object.keys(P).length>700,'常量表条目太少，解析规则可能失效了');
 const expected={
  LC_CHECKEDITION:5000,LC_PLAYER_LOGIN:5002,LC_GAME_GET_AREA_AND_LINE:5007,LC_RE_LOGIN_GET_LINE_LIST:5019,
  CG_LOGIN_PLAYERCHECK:1,CG_LOGIN_ACTORENTER:2,CG_LOGIN_ACTORLEAVE:3,CG_LOGIN_ACTORENTER_AGAIN:7,
  CG_LOGIN_ACTORLIST:10001,CG_LOGIN_CREATEACTOR:10002,CG_LOGIN_DELETEACTOR:10003,CG_GUIDE_STATUE_RANDOM_NAME:10015,
  CG_SYSTEM_TIME:16021,CG_SYSTEM_HEART:16001,
  CG_SCENE_WORLDDATA:10503,CG_SCENE_GET_OTHER_PLAYER_STATE:10505,
  CG_BAG_REPAIR:12019,CG_EQUIP_IDENTIFY_ATTR:12060,
  CG_ACTOR_PLAYERBAG:12001,CG_CITY_EXTRACT_MONEY:10512,CG_TASK_DELIVER:14503,
 };
 for(const [name,value] of Object.entries(expected))assert.equal(P[name],value,name+' 的号变了');
 // 反查：日志里要能打成人话。
 const lookup=protocolLookup(P);
 assert.equal(lookup.name(10001),'CG_LOGIN_ACTORLIST');
 assert.ok(lookup.names(10001).includes('CG_LOGIN_ACTORLIST'));
 assert.equal(lookup.name(1234567),undefined);
});

test('解析口径是字面量赋值，负数字面量按原样漏掉',()=>{
 // 0019.js 里唯一的非字面量条目是 ADD_ITEM_DEF = -1。原实现漏掉它，这里保持同口径，
 // 免得有人以为常量表「变全了」而依赖上新增的键。
 const parsed=parseProtocolConstants('(e.A = 1),(e.B = 2e3),(e.C = -1),(e.D = e.A)');
 assert.deepEqual(parsed,{A:1,B:2000});
});

// ───────────────────────── HTTP 路由表 ─────────────────────────

/**
 * 假响应对象：够 `answer()` 用，也够 `fs.createReadStream().pipe()` 用。
 *
 * 静态兜底走的是管道，所以这里得有个最小的 Writable 形状（write/end/on/once/emit），
 * 否则 pipe 会抛异常、被 handle 的 catch 变成 500，把用例引到岔路上。
 */
function fakeResponse(){
 const out={status:null,headers:{},body:null,chunks:0};
 const res={
  out,writable:true,
  writeHead(status,headers){out.status=status;Object.assign(out.headers,headers||{});return res;},
  write(chunk){out.chunks+=1;void chunk;return true;},
  end(body){if(body!==undefined)out.body=body;return res;},
  on(){return res;},once(){return res;},removeListener(){return res;},emit(){return false;},
 };
 return res;
}
function routerForTest(missingRef){
 return createHttpRouter({
  root,raw:path.join(root,'client'),store:{data:{characters:[],accounts:[]}},
  log(){},controlToken:'测试令牌',port:8775,
  stats:()=>({requests:0,missing:[],unknown:[],recent:[]}),
  onMissing:p=>missingRef.push(p),
  onShutdown(){missingRef.push('__shutdown__');},
 });
}

test('路由表顺序与原 if 链逐条对应',()=>{
 const expected=[
  '/v/gd/305.json','/api/native-ui','/native-commerce.js','/api/home-features','/api/tower-preview',
  '/api/pet-snapshot-vitals','/pet-snapshot-data.js','/api/character-features','/api/legion','/api/daily-activity',
  '/api/career-skills','/api/recorded-content','/api/drops','/api/player-experience','/api/supply-shops','/api/combat-rating',
  '/equipment-composition-data.js','/equipment-rules.js','/api/content-library','/api/official-content',
  '/api/status','/status','/api/shutdown','/api/client-log',
 ];
 const missing=[];
 const {routes}=routerForTest(missing);
 assert.deepEqual(routes.filter(r=>r.kind==='path').map(r=>r.path).slice(0,expected.length),expected);
 // 方法门的位置：必须紧跟在两条 POST-only 路由之后、静态资源之前。
 const gateIndex=routes.findIndex(r=>r.kind==='gate');
 assert.equal(routes[gateIndex-1].path,'/api/client-log','方法门前面应正好是两条 POST 路由');
 assert.equal(routes[gateIndex+1].path,'/viewport.js','方法门后面就应是只收 GET/HEAD 的静态资源');
 // /api/status 必须排在 /status 之前。
 assert.ok(routes.findIndex(r=>r.path==='/api/status')<routes.findIndex(r=>r.path==='/status'));
 // 兜底条目必须只有一个，且在末尾。
 assert.equal(routes.at(-1).kind,'static');
 assert.equal(routes.filter(r=>r.kind==='static').length,1);
});

test('方法门：POST 落在门上的路由得 405，落在门下的静态资源也得 405，门上的仍正常作答',async()=>{
 const missing=[];
 const router=routerForTest(missing);

 // 门上方：任何方法都收 —— 原版就是如此（POST /api/status 会正常返回 JSON）。
 let res=fakeResponse();
 await router.handle({url:'/api/status',method:'POST',headers:{}},res);
 assert.equal(res.out.status,200);
 assert.equal(res.out.headers['Content-Type'],'application/json; charset=utf-8');

 // 门下方：只收 GET/HEAD。
 for(const p of ['/viewport.js','/gd.js','/offline.js','/']){
  res=fakeResponse();
  await router.handle({url:p,method:'POST',headers:{}},res);
  assert.equal(res.out.status,405,p+' 的 POST 应为 405');
  assert.equal(res.out.body,'Method not allowed');
 }
});

test('静态兜底：GET 命中、缺失记一笔并回 404，favicon 永不记',async()=>{
 const missing=[];
 const router=routerForTest(missing);
 let res=fakeResponse();
 await router.handle({url:'/',method:'GET',headers:{}},res);
 assert.equal(res.out.status,200);
 assert.equal(res.out.body,null,'/ 走 createReadStream 管道，不应由 end() 直接给 body');

 res=fakeResponse();
 await router.handle({url:'/这个文件不存在.js',method:'GET',headers:{}},res);
 assert.equal(res.out.status,404);
 assert.deepEqual(missing,['/这个文件不存在.js']);

 // /favicon.ico 在 client/ 里是存在的（会正常发出 200）；这里只守「不论在不在，
 // 都不许进 missing 列表」——浏览器会自动请求它，记进去会把 /api/status 刷脏。
 res=fakeResponse();
 await router.handle({url:'/favicon.ico',method:'GET',headers:{}},res);
 assert.ok([200,404].includes(res.out.status),'favicon 只可能是 200 或 404，实际 '+res.out.status);
 assert.deepEqual(missing,['/这个文件不存在.js'],'favicon 缺失不应进 missing 列表');
});

test('关闭接口要本地控制令牌',async()=>{
 const missing=[];
 const router=routerForTest(missing);
 let res=fakeResponse();
 await router.handle({url:'/api/shutdown',method:'POST',headers:{'x-worldol-control':'错令牌'}},res);
 assert.equal(res.out.status,403);
 assert.deepEqual(missing,[],'令牌不对时不该真的关服务');

 res=fakeResponse();
 await router.handle({url:'/api/shutdown',method:'POST',headers:{'x-worldol-control':'测试令牌'}},res);
 assert.equal(res.out.status,200);
 assert.equal(res.out.body,'{"stopped":true}');
 assert.deepEqual(missing,['__shutdown__']);
});

test('GET /api/shutdown 不匹配那条 POST-only 路由',async()=>{
 const missing=[];
 const router=routerForTest(missing);
 const res=fakeResponse();
 await router.handle({url:'/api/shutdown',method:'GET',headers:{}},res);
 // 落到方法门：GET 是允许的方法，所以继续往下走，最后 404（静态里没有这个路径）。
 assert.equal(res.out.status,404);
 assert.deepEqual(missing,['/api/shutdown']);
});

// ───────────────────── server.mjs 的收敛状态 ─────────────────────

test('server.mjs 走共享模块，不再自己排分派链与路由',()=>{
 const source=fs.readFileSync(path.join(root,'server.mjs'),'utf8');
 const code=codeOnly(source);
 assert.match(code,/from '\.\/lib\/protocol-dispatch\.mjs'/,'server.mjs 必须从共享模块引入分派链');
 assert.match(code,/from '\.\/lib\/http-routes\.mjs'/,'server.mjs 必须从共享模块引入路由表');
 assert.match(code,/from '\.\/lib\/protocol-constants\.mjs'/,'server.mjs 必须从共享模块引入协议常量');
 assert.match(code,/createInboundDispatcher\(/);
 assert.match(code,/createHttpRouter\(/);
 // 旧的 20 行 if 链不许回来。
 for(const name of INBOUND_CHAIN.map(s=>s.handle.name)){
  assert.ok(!new RegExp('[^\\w.]'+name+'\\(').test(code),'server.mjs 不该再直接调用 '+name);
 }
 assert.ok(!code.includes('if(handleGame('),'server.mjs 不该再自带 handler 链');
 assert.ok(!code.includes('matchAll(/'),'server.mjs 不该再自己解协议常量');
});

test('server.mjs 里的协议号只剩已登记的本地扩展',()=>{
 // 连字符串一起丢掉，免得把端口、路径、URL 里的数字当协议号。
 const code=codeOnly(fs.readFileSync(path.join(root,'server.mjs'),'utf8'),{strings:'drop'});
 const numbers=new Set([...code.matchAll(/\b\d{4,6}\b/g)].map(m=>Number(m[0])));
 // 允许清单：每个都要说清是什么。
 const allowed=new Set([
  8775,    // 默认监听端口
  1024,    // WebSocket maxPayload 的 KB 数
  60000,   // 任务重置定时器的最大间隔（毫秒）
  1000,    // 进程退出兜底延时（毫秒）
  1001,    // WebSocket 正常关闭码
  100000,  // 登录会话号基数
  200000,  // 重连会话号基数
  90021,   // 本地扩展：跨天任务重置推送
  90022,   // 本地扩展：外观同步到角色列表
  32107,   // 本地扩展：图鉴分组推送
  32109,   // 本地扩展：图鉴加成推送（第 77 版，进世界时把存档里的加成喂给客户端）
  22106,   // 本地扩展：每日任务信息推送
 ]);
 const unexpected=[...numbers].filter(n=>!allowed.has(n)).sort((a,b)=>a-b);
 assert.deepEqual(unexpected,[],'server.mjs 里出现了未登记的协议号，请改用 P.<常量名> 或补进 allowed 并写明理由');
});
