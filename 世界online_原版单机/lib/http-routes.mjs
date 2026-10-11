/**
 * HTTP 路由表 —— 有序、显式、可断言。
 *
 * 以前这段是 server.mjs 里连着的 27 个 `if(pathname===...)`，夹着两条特殊规则：
 *
 *   · `/api/shutdown` 与 `/api/client-log` 只接受 POST，条件写在 if 里；
 *   · 中间那句 `if(req.method!=='GET'&&req.method!=='HEAD')return 405` 是**位置敏感**的：
 *     它上面的路由什么方法都收（POST /api/status 会正常返回 JSON），
 *     下面的静态资源只收 GET/HEAD。
 *
 * 现在整张表是有序数组，三种条目：
 *   {kind:'path'}    精确路径（可选 `when` 前置条件），
 *   {kind:'gate'}    通配拦截（命中即回，不再往下走），
 *   {kind:'static'}  末尾的静态文件兜底。
 *
 * 条目顺序与原 if 链**逐条对应**（含 gate 的位置），这样 review 时能一行一行比。
 * tests/server-dispatch.test.mjs 把顺序与 gate 的位置钉住了。
 *
 * 路由体需要的一大堆数据模块（约 45 个）集中在本模块 import ——
 * server.mjs 因此从 70 多个 import 缩到十几个，只留运行时真正用得上的。
 */
import fs from 'node:fs';
import path from 'node:path';
import {official,officialItems} from './official-data.mjs';
import {supportedMissionCount} from './official-service.mjs';
import {recorded,recordedFinishedPets} from './recorded-content.mjs';
import {recordedDirectory} from './recorded-service.mjs';
import {careerDirectory,careers} from './career-skills.mjs';
import {supplyDirectory} from './supply-shops.mjs';
import {dropDirectory} from './loot.mjs';
import {playerExperience} from './player-experience.mjs';
import {clientProgressionRevision} from './client-progression-patch.mjs';
import {petSnapshotDirectory} from './pet-snapshot-vitals.mjs';
import {homeFeatureRevision,towerPreviews} from './home-feature-data.mjs';
import {homeSnapshot} from './home-features.mjs';
import {featureSnapshot} from './character-feature-service.mjs';
import {legionSnapshot} from './legion-service.mjs';
import {dailyKey,dailySnapshot} from './daily-activity.mjs';
import {combatRating,combatRatingRevision} from './combat-rating.mjs';
// 动态生成给客户端的全局变量（/equipment-rules.js 等）与 standalone 共用一份实现，
// 别再在这儿抄表达式：第 37 版就是因为两处各写一份、只改了一处，导致包进 APK 后
// 客户端拿到的 identifyItemIds 是个函数，整个菜单加载不出来。
import {equipmentRulesGlobals,compositionGlobals} from './generated-globals.mjs';
import {upgradeRules} from './item-affixes.mjs';
import {starLimit} from './equipment-policy.mjs';
import {nativeUiRevision,nativeResourceManifest} from './native-ui-restoration.mjs';
import {openPortalsRevision} from './open-portals.mjs';
import {systemSettingsRevision} from './system-settings-service.mjs';
import {yunruoTempleRevision} from './yunruo-temple.mjs';
import {recordedExpansionRevision} from './recorded-expansion.mjs';
import {bossChallengeRevision} from './boss-challenges.mjs';
import {legionRevision} from './legion-state.mjs';
import {damageMathRevision} from './client-damage-patch.mjs';
import {combatLimitsRevision,characterAttackLimits} from './client-combat-limits.mjs';
import {bossManaRecoveryRevision} from './client-monster-recovery-patch.mjs';
import {clientMissionRevision} from './client-mission-patch.mjs';
import {petCatalogSummary} from './pet-catalog.mjs';
import {clientBagRevision} from './client-bag-patch.mjs';
import {battleSkillPanelRevision} from './client-battle-skill-panel-patch.mjs';
import {battleFontRevision} from './client-battle-font-patch.mjs';
import {legionSurvivorsRevision} from './client-legion-survivors-patch.mjs';
import {legionPetGuardRevision} from './client-legion-petguard-patch.mjs';
import {battleSpeedRevision} from './client-battle-speed-patch.mjs';
import {weaponSlotRevision} from './client-weapon-slot-patch.mjs';
import {phantomImmunityRevision} from './client-phantom-immunity-patch.mjs';
import {illusionRevision} from './client-illusion-patch.mjs';
import {weaponIconRevision} from './client-weapon-icon-patch.mjs';
import {taskResetRevision,nextTaskResetAt} from './task-reset.mjs';
import {patchClientBoot,patchClientMain,CLIENT_MAIN_PATH} from './client-patch-chain.mjs';

export const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.mp3':'audio/mpeg','.bin':'application/octet-stream'};

export function answer(res,code,type,body){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);}

/**
 * 静态资源白名单：站点上的 `/xxx.js` 实际取自 web/ 目录。
 *
 * 单机版把 web/*.js 平铺在站点根上，不能靠目录列表兜底，所以是显式白名单。
 */
const WEB_PATHS={'/':'index.html','/index.html':'index.html','/offline.js':'offline.js','/native-pet-shop.js':'native-pet-shop.js','/role-slots.js':'role-slots.js','/recorded-content.js':'recorded-content.js','/combat-rating.js':'combat-rating.js','/career-skills.js':'career-skills.js','/equipment-workshop.js':'equipment-workshop.js','/equipment-composition.js':'equipment-composition.js','/offline.css':'offline.css','/catalog':'catalog.html','/catalog.js':'catalog.js','/catalog.css':'catalog.css',
 '/entry-pledge.js':'entry-pledge.js','/system-settings.js':'system-settings.js','/daily-reset.js':'daily-reset.js','/pet-snapshot-vitals.js':'pet-snapshot-vitals.js','/character-features.js':'character-features.js','/native-vip.js':'native-vip.js','/legion.js':'legion.js','/home-features.js':'home-features.js','/home-features.css':'home-features.css','/native-features.js':'native-features.js'};

/**
 * 造路由表。
 *
 * env 只需要运行时那一小撮东西 —— 数据类模块由本文件自己 import。
 *   root/raw          资源根目录（原版客户端目录）
 *   store             存档
 *   log               日志
 *   controlToken      /api/shutdown 的本地控制令牌
 *   port              监听端口
 *   stats()           返回 {requests,missing,unknown,recent}，供 /api/status 现取
 *   onMissing(p)      静态资源缺失时记一笔（同时进 /api/status 的 missing 列表）
 *   onShutdown()      收到合法的关闭请求后由 server.mjs 执行真正的收尾
 */
export function createHttpRouter(env){
 const {root,raw,store,log,controlToken,port,stats,onMissing,onShutdown}=env;
 const mainPath=CLIENT_MAIN_PATH;
 // 构建期产物替运行期省下的那一半（架构评审 P1-3 的后半段）：补丁链要读 4.4 MB 主包
 // 再跑 23 步字符串注入（本机约 830 ms，WebView 更慢），过去在 createHttpRouter 里
 // 无条件做掉 —— 可客户端一个字节都没请求。改成首次请求 /gd.js 与主包时才算。
 //
 // standalone 站点里 VFS 登记的就是打过补丁的成品，patchClientMain 会命中幂等分支
 // 直接返回入参，所以安卓侧这一步是「读一次 + 比一次标记」，不再是整条链。
 let bootCache=null,mainCache=null,manifestCache=null;
 const bootCode=()=>bootCache??=patchClientBoot(fs.readFileSync(path.join(root,'analysis/gd.decoded.js'),'utf8'));
 const mainCode=()=>mainCache??=patchClientMain(fs.readFileSync(path.join(raw,mainPath),'utf8'));
 const restoredManifest=()=>manifestCache??=JSON.stringify(nativeResourceManifest(root,raw));

 const findRole=id=>store.data.characters.find(p=>p.id===Number(id));
 const roleJson=(res,role,payload,notFound)=>role?answer(res,200,mime['.json'],JSON.stringify(payload(role))):answer(res,404,mime['.json'],notFound);

 const routes=[
  {kind:'path',path:'/v/gd/305.json',reply:({res})=>answer(res,200,mime['.json'],restoredManifest())},
  {kind:'path',path:'/api/native-ui',reply:({res})=>answer(res,200,mime['.json'],JSON.stringify({revision:nativeUiRevision,commerce:'native-commerce-20260922-v1',portals:openPortalsRevision}))},
  {kind:'path',path:'/native-commerce.js',reply:({res})=>answer(res,200,mime['.js'],fs.readFileSync(path.join(root,'web/native-commerce.js')))},
  {kind:'path',path:'/api/home-features',reply:({res,url})=>roleJson(res,findRole(url.searchParams.get('role')),homeSnapshot,'{"error":"角色不存在"}')},
  {kind:'path',path:'/api/tower-preview',reply:({res,url})=>{
   // 永泽塔怪物预览：wire 体不进 JSON，只给字段。
   const p=towerPreviews.get(Number(url.searchParams.get('id')));
   return p?answer(res,200,mime['.json'],JSON.stringify({...p,bodyBase64:undefined,monsters:p.monsters.map(({wireBase64,...m})=>m)})):answer(res,404,mime['.json'],'{"error":"怪物预览待补"}');
  }},
  {kind:'path',path:'/api/pet-snapshot-vitals',reply:({res})=>answer(res,200,mime['.json'],JSON.stringify(petSnapshotDirectory(store.data.characters)))},
  {kind:'path',path:'/pet-snapshot-data.js',reply:({res})=>answer(res,200,mime['.js'],'window.offlinePetSnapshotProfiles='+JSON.stringify(petSnapshotDirectory(store.data.characters))+';')},
  {kind:'path',path:'/api/character-features',reply:({res,url})=>roleJson(res,findRole(url.searchParams.get('role')),featureSnapshot,'{"error":"角色不存在"}')},
  {kind:'path',path:'/api/legion',reply:({res,url})=>roleJson(res,findRole(url.searchParams.get('role')),legionSnapshot,'{"error":"角色不存在"}')},
  {kind:'path',path:'/api/daily-activity',reply:({res,url})=>roleJson(res,findRole(url.searchParams.get('role')),dailySnapshot,'{"error":"角色不存在"}')},
  {kind:'path',path:'/api/career-skills',reply:({res})=>answer(res,200,mime['.json'],careerDirectory())},
  {kind:'path',path:'/api/recorded-content',reply:({res})=>answer(res,200,mime['.json'],JSON.stringify(recordedDirectory()))},
  {kind:'path',path:'/api/drops',reply:({res})=>answer(res,200,mime['.json'],JSON.stringify(dropDirectory()))},
  {kind:'path',path:'/api/player-experience',reply:({res})=>answer(res,200,mime['.json'],JSON.stringify({...playerExperience,clientProgressionRevision}))},
  {kind:'path',path:'/api/supply-shops',reply:({res})=>answer(res,200,mime['.json'],JSON.stringify(supplyDirectory))},
  {kind:'path',path:'/api/combat-rating',reply:({res,url})=>roleJson(res,findRole(url.searchParams.get('role')),combatRating,'{"error":"没有找到这个角色"}')},
  {kind:'path',path:'/equipment-composition-data.js',reply:({res})=>answer(res,200,mime['.js'],`window.worldolCompositionData=${JSON.stringify(compositionGlobals())};`)},
  {kind:'path',path:'/equipment-rules.js',reply:({res})=>answer(res,200,mime['.js'],`(()=>{const rules=${JSON.stringify(equipmentRulesGlobals())},starRules=rules.star;window.worldolEquipmentRules=rules;window.worldolStarLimit=${starLimit.toString()};})();`)},
  {kind:'path',path:'/api/content-library',reply:({res})=>answer(res,200,mime['.json'],fs.readFileSync(path.join(root,'data/content-library.json')))},
  {kind:'path',path:'/api/official-content',reply:({res})=>answer(res,200,mime['.json'],JSON.stringify({version:'0.6.4',maps:official.maps.map(m=>({id:m.id,name:m.name})),itemIds:[...officialItems.keys()],catalog:official.catalog.length,missions:official.missions.length,supportedMissions:supportedMissionCount}))},
  // /api/status 必须排在 /status 前面：否则 /status 会被前者吃掉前 11 个字符？不会 —— 精确匹配，
  // 只是若两者顺序颠倒，任何重构都更容易把 /api/status 写成前缀匹配。保持原顺序，便于逐行比对。
  {kind:'path',path:'/api/status',reply:({res})=>answer(res,200,mime['.json'],JSON.stringify({combatLimitsRevision,characterAttackLimits,battleStatusLimit:null,project:'worldonline-original-offline',projectRoot:root,version:'0.6.4',client:305,petCatalog:petCatalogSummary,systemSettingsRevision,homeFeatureRevision:homeFeatureRevision(),yunruoTempleRevision,recordedExpansionRevision:recordedExpansionRevision(),bossChallengeRevision,legionRevision,damageMathRevision,bossManaRecoveryRevision,clientMissionRevision,clientBagRevision,combatRatingRevision,battleSkillPanelRevision,battleFontRevision,legionSurvivorsRevision,legionPetGuardRevision,battleSpeedRevision,weaponSlotRevision,phantomImmunityRevision,illusionRevision,weaponIconRevision,taskResetRevision,taskResetDay:dailyKey(),nextTaskResetAt:nextTaskResetAt(),port,pid:process.pid,equipmentUpgrades:{version:upgradeRules.version,mode:upgradeRules.mode,starMax:upgradeRules.star.max,star:upgradeRules.star,gem:upgradeRules.gem},careerSkills:{version:careers.version,effectRevision:careers.effectRevision,teachers:careers.teachers.length,skills:careers.skills.length,maxLevel:22,learningMode:careers.learningMode},accounts:store.data.accounts.map(a=>({id:a.id,name:a.name})),characters:store.data.characters,...stats()},null,2))},
  {kind:'path',path:'/status',reply:({res})=>answer(res,200,mime['.html'],`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>世界OL单机状态</title><h1>原版单机 v0.6.4</h1><p>${official.maps.length}张原版地图，${official.missions.length}条任务定义，其中${supportedMissionCount}条通过当前条件与奖励检查。</p><p>已整合全部保存录制中可解析的公开配置：${recorded.pets.length}个宠物模板、${recorded.petSnapshots.length}份实际宠物样本、${recorded.petSkills.length}条宠物技能等级、${recordedFinishedPets.size}套97级成品宠物、20个称号、192组套装、16种宠物蛋和4份VIP页面记录。</p><p>左上单机菜单 → 录制内容 / 宠物与称号。宠物可按已录模板免费领取并出战，称号可选择并保存；套装效果按穿戴件数和VIP等级生效。</p><p>保留97级存档及原有强化、镶嵌、免费合成、技能和战力规则。未录到的随机概率、各品质完整成长曲线、16级之后经验表和部分国家/护送功能仍为缺项。</p><a href="/">进入游戏</a></html>`)},
  {kind:'path',path:'/api/shutdown',when:({req})=>req.method==='POST',reply:async({req,res})=>{
   if(req.headers['x-worldol-control']!==controlToken)return answer(res,403,'text/plain','Invalid local control token');
   answer(res,200,mime['.json'],'{"stopped":true}');
   onShutdown();
  }},
  {kind:'path',path:'/api/client-log',when:({req})=>req.method==='POST',reply:async({req,res})=>{
   let data='';for await(const chunk of req){data+=chunk;if(data.length>16384)throw Error('Log too large');}
   log('client',JSON.parse(data));return answer(res,200,mime['.json'],'{}');
  }},

  // 方法门：位置承重。它上面的路由任何方法都收（POST /api/status 会正常返回 JSON），
  // 下面只剩静态资源，因此只放 GET/HEAD 过去。
  {kind:'gate',when:({req})=>req.method!=='GET'&&req.method!=='HEAD',status:405,body:'Method not allowed'},

  {kind:'path',path:'/viewport.js',reply:({res})=>answer(res,200,mime['.js'],fs.readFileSync(path.join(root,'web/viewport.js')))},
  {kind:'path',path:'/gd.js',reply:({res})=>answer(res,200,mime['.js'],bootCode())},
  {kind:'path',path:'/'+mainPath,reply:({res})=>answer(res,200,mime['.js'],mainCode())},

  // 静态文件兜底：web/ 白名单优先，其余落到原版资源目录。
  {kind:'static'},
 ];

 async function serveStatic({req,res,pathname}){
  const base=Object.hasOwn(WEB_PATHS,pathname)?path.join(root,'web'):raw;
  const relative=WEB_PATHS[pathname] || pathname.slice(1);
  const file=path.resolve(base,relative),rel=path.relative(base,file);
  if(rel.startsWith('..')||path.isAbsolute(rel)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
   if(pathname!=='/favicon.ico')onMissing(pathname);
   return answer(res,404,'text/plain','Local resource missing');
  }
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':fs.statSync(file).size,'Cache-Control':'no-cache'});
  if(req.method==='HEAD')return res.end();
  fs.createReadStream(file).pipe(res);
 }

 /** 走一遍路由表。返回 true 表示已作答（含 404/405/500）。 */
 async function handle(req,res){
  try{
   const url=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(url.pathname);
   const ctx={req,res,url,pathname};
   for(const step of routes){
    if(step.kind==='path'){
     if(pathname!==step.path)continue;
     if(step.when&&!step.when(ctx))continue;
     await step.reply(ctx);return true;
    }
    if(step.kind==='gate'){
     if(step.when(ctx)){answer(res,step.status,'text/plain',step.body);return true;}
     continue;
    }
    if(step.kind==='static'){await serveStatic(ctx);return true;}
   }
   return false;
  }catch(error){log('http-error',{error:String(error)});answer(res,500,'text/plain',String(error));return true;}
 }

 return {routes,handle};
}
