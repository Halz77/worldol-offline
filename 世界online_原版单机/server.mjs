import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Writer,Reader,frame,unframe } from './lib/codec.mjs';
import { SaveStore } from './lib/store.mjs';
import {handleCharacterFeatures,pushCharacterFeatures,featureSnapshot} from './lib/character-feature-service.mjs';
import {handleLegion,pushLegionMembers,legionSnapshot} from './lib/legion-service.mjs';
import {legionRevision} from './lib/legion-state.mjs';
import {bossChallengeRevision} from './lib/boss-challenges.mjs';
import {yunruoTempleRevision} from './lib/yunruo-temple.mjs';
import {recordedExpansionRevision} from './lib/recorded-expansion.mjs';
import {patchOfflineLegionBattles} from './lib/client-legion-patch.mjs';
import {patchImmediateRoleDeletion} from './lib/client-role-deletion-patch.mjs';
import {handleCity} from './lib/city-service.mjs';
import {handleHomeFeatures,flushHomeSession} from './lib/home-feature-service.mjs';
import {homeFeatureRevision,towerPreviews} from './lib/home-feature-data.mjs';
import {homeSnapshot} from './lib/home-features.mjs';
import { enterWorld,worldData } from './lib/world.mjs';
import {handleGame} from './lib/game-service.mjs';
import {handlePetEquipment,pushPetEquipmentExperience} from './lib/pet-equipment-service.mjs';
import {handlePetItems} from './lib/pet-service.mjs';
import {handlePetIllusion} from './lib/pet-illusion-service.mjs';
import {handleRoleRename} from './lib/role-rename-service.mjs';
import {handleIllusion} from './lib/illusion-service.mjs';
import {handleRestoration} from './lib/restoration-service.mjs';
import {handleEnchantment} from './lib/enchantment-service.mjs';
import {handleSpiritSeals,pushSpiritInfo} from './lib/spirit-seal-service.mjs';
import {spiritRules} from './lib/spirit-seal-data.mjs';
import {handleEquipmentUpgrades} from './lib/equipment-upgrade-service.mjs';
import {handleEquipmentComposition} from './lib/equipment-composition-service.mjs';
import {handleRecorded,recordedDirectory} from './lib/recorded-service.mjs';
import {recorded,recordedFinishedPets} from './lib/recorded-content.mjs';
import {setData,VIP_MAX} from './lib/equipment-sets.mjs';
import {upgradeRules,upgradeIdentifyItemIds} from './lib/item-affixes.mjs';
import {handleOfficial,handbookGroups,supportedMissionCount} from './lib/official-service.mjs';
import {handleAttributes,pushNewbieMission} from './lib/newbie-service.mjs';
import {official,officialItems} from './lib/official-data.mjs';
import {identificationPreview} from './lib/catalog-packets.mjs';
import {careerDirectory,careers} from './lib/career-skills.mjs';
import {supplyDirectory} from './lib/supply-shops.mjs';
import {starLimit} from './lib/equipment-policy.mjs';
import {damageMathRevision,patchBattleDamageMath} from './lib/client-damage-patch.mjs';
import {combatLimitsRevision,characterAttackLimits,patchCombatLimits} from './lib/client-combat-limits.mjs';
import {bossManaRecoveryRevision,patchGardenerManaRecovery} from './lib/client-monster-recovery-patch.mjs';
import {clientMissionRevision,patchNpcRepeatableMissions,patchOfflineStoryBattles,patchDailyCatalogVisibility,patchNpcMissionRefresh} from './lib/client-mission-patch.mjs';
import {combatRatingRevision,combatRating,syncCombatRating} from './lib/combat-rating.mjs';
import {petSnapshotDirectory} from './lib/pet-snapshot-vitals.mjs';
import {petCatalogSummary} from './lib/pet-catalog.mjs';
import {dropDirectory} from './lib/loot.mjs';
import {playerExperience} from './lib/player-experience.mjs';
import {clientProgressionRevision,patchPlayerLevelRewards} from './lib/client-progression-patch.mjs';
import {clientBagRevision,patchBulkItemUse} from './lib/client-bag-patch.mjs';
import {battleSkillPanelRevision,patchBattleSkillPanel} from './lib/client-battle-skill-panel-patch.mjs';
import {battleFontRevision,patchBattleFont} from './lib/client-battle-font-patch.mjs';
import {legionSurvivorsRevision,patchLegionSurvivors} from './lib/client-legion-survivors-patch.mjs';
import {legionPetGuardRevision,patchLegionPetGuard} from './lib/client-legion-petguard-patch.mjs';
import {battleSpeedRevision,patchBattleSpeedSteps,patchBattleSpeedPersist} from './lib/client-battle-speed-patch.mjs';
import {weaponSlotRevision,patchWeaponSlots} from './lib/client-weapon-slot-patch.mjs';
import {phantomImmunityRevision,patchPhantomImmunity} from './lib/client-phantom-immunity-patch.mjs';
import {illusionRevision,patchIllusion} from './lib/client-illusion-patch.mjs';
import {weaponIconRevision,patchWeaponIcon} from './lib/client-weapon-icon-patch.mjs';
import {dailyKey,dailyRevision,dailySnapshot,ensureDaily,taskSnapshot} from './lib/daily-activity.mjs';
import {notifyDaily,encodeDaily} from './lib/daily-service.mjs';
import {taskResetRevision,nextTaskResetAt,resetTaskDays} from './lib/task-reset.mjs';
import {nativeUiRevision,patchEmptyNativeShop,nativeResourceManifest} from './lib/native-ui-restoration.mjs';
import {openPortalsRevision} from './lib/open-portals.mjs';
import {handleNativeCommerce} from './lib/native-commerce.mjs';
import {handleSystemSettings,systemSettingsRevision} from './lib/system-settings-service.mjs';
import {rolePayload,roleListPacket} from './lib/role-list.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const raw=process.env.WORLDOL_RESOURCES || (fs.existsSync(path.join(root,'client/v/gd/305.json'))?path.join(root,'client'):path.resolve(root,'../H5客户端_v305_20260920/files/resgood'));
const port=Number(process.env.WORLDOL_PORT || 8775);
if(!fs.existsSync(path.join(raw,'v/gd/305.json')))throw Error('未找到 v305 原版资源目录：'+raw);
const store=new SaveStore(process.env.WORLDOL_SAVES || path.join(root,'saves'));
const logDir=process.env.WORLDOL_LOGS || path.join(root,'logs');
fs.mkdirSync(logDir,{recursive:true});
const controlToken=randomBytes(24).toString('hex');
let recent=[],requests=0,missing=new Set(),unknown=new Set();
function log(kind,data){const entry={time:new Date().toISOString(),kind,...data};recent.push(entry);if(recent.length>150)recent.shift();const file=path.join(logDir,'session.jsonl');if(fs.existsSync(file)&&fs.statSync(file).size>512*1024)fs.renameSync(file,file+'.previous');fs.appendFileSync(file,JSON.stringify(entry)+'\n');}
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw Error('Client patch mismatch: '+from);return source.replace(from,to);}
let boot=fs.readFileSync(path.join(root,'analysis/gd.decoded.js'),'utf8');
boot=replaceOnce(boot,'(a["gs"] = new n())','(window.offlineBootSettings(), a["gs"] = new n())');
boot=replaceOnce(boot,'(s["startEgret"] = function () {','(s["startEgret"] = function () { window.offlineInstall();');
boot=boot.replace(/\(function \(\) \{\s*try \{\s*setInterval\(function \(\) \{[\s\S]*?\}, 50\);\s*\} catch \(e\) \{\}\s*\}\)\(\),/,'');
const mainPath='js/ff/fff570bb4753f056432680e781d827dc.js';
const baseMain=patchNpcMissionRefresh(patchDailyCatalogVisibility(patchPlayerLevelRewards(patchOfflineStoryBattles(patchNpcRepeatableMissions(patchBattleDamageMath(replaceOnce(fs.readFileSync(path.join(raw,mainPath),'utf8'),'t.m=e,t.c=i,','t.m=e,t.c=i,window.__worldReq=t,')))))));
const main=patchWeaponIcon(patchIllusion(patchPhantomImmunity(patchWeaponSlots(patchBattleFont(patchBattleSkillPanel(patchBattleSpeedPersist(patchBattleSpeedSteps(patchLegionPetGuard(patchLegionSurvivors(patchImmediateRoleDeletion(patchCombatLimits(patchBulkItemUse(patchEmptyNativeShop(patchGardenerManaRecovery(patchOfflineLegionBattles(baseMain))))))))))))))));
const restoredManifest=JSON.stringify(nativeResourceManifest(root,raw));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.mp3':'audio/mpeg','.bin':'application/octet-stream'};
function answer(res,code,type,body){res.writeHead(code,{'Content-Type':type,'Cache-Control':'no-store'});res.end(body);}
const taskClients=new Map();let taskResetTimer;
function resetTasks(){
 const changes=resetTaskDays(store);
 for(const change of changes.filter(c=>c.reset)){
  log('daily-tasks-reset',change);
  for(const {context,send}of taskClients.values())if(context.role?.id===change.role){
   context.taskResetPending=change;context.questTeleport=null;context.storyBattle=null;
   try{send(90021,new Writer().string(JSON.stringify(change)));}catch(error){log('daily-reset-notify-error',{role:change.role,error:String(error)});}
  }
 }
 return changes;
}
function scheduleTaskReset(){
 taskResetTimer=setTimeout(()=>{try{resetTasks();}catch(error){log('daily-reset-error',{error:String(error)});}finally{scheduleTaskReset();}},Math.min(60000,Math.max(1,nextTaskResetAt()-Date.now())));
 taskResetTimer.unref();
}
const server=http.createServer(async(req,res)=>{
  requests++;
  res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:${port}; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'`);
  try{
    const url=new URL(req.url,'http://localhost');const pathname=decodeURIComponent(url.pathname);
    if(pathname==='/v/gd/305.json')return answer(res,200,mime['.json'],restoredManifest);
    if(pathname==='/api/native-ui')return answer(res,200,mime['.json'],JSON.stringify({revision:nativeUiRevision,commerce:'native-commerce-20260922-v1',portals:openPortalsRevision}));
    if(pathname==='/native-commerce.js')return answer(res,200,mime['.js'],fs.readFileSync(path.join(root,'web/native-commerce.js')));
    if(pathname==='/api/home-features'){const p=store.data.characters.find(p=>p.id===Number(url.searchParams.get('role')));return p?answer(res,200,mime['.json'],JSON.stringify(homeSnapshot(p))):answer(res,404,mime['.json'],'{"error":"角色不存在"}');}
    if(pathname==='/api/tower-preview'){const p=towerPreviews.get(Number(url.searchParams.get('id')));return p?answer(res,200,mime['.json'],JSON.stringify({...p,bodyBase64:undefined,monsters:p.monsters.map(({wireBase64,...m})=>m)})):answer(res,404,mime['.json'],'{"error":"怪物预览待补"}');}
    if(pathname==='/api/pet-snapshot-vitals')return answer(res,200,mime['.json'],JSON.stringify(petSnapshotDirectory(store.data.characters)));
    if(pathname==='/pet-snapshot-data.js')return answer(res,200,mime['.js'],'window.offlinePetSnapshotProfiles='+JSON.stringify(petSnapshotDirectory(store.data.characters))+';');
    if(pathname==='/api/character-features'){const p=store.data.characters.find(p=>p.id===Number(url.searchParams.get('role')));return p?answer(res,200,mime['.json'],JSON.stringify(featureSnapshot(p))):answer(res,404,mime['.json'],'{"error":"角色不存在"}');}
    if(pathname==='/api/legion'){const p=store.data.characters.find(p=>p.id===Number(url.searchParams.get('role')));return p?answer(res,200,mime['.json'],JSON.stringify(legionSnapshot(p))):answer(res,404,mime['.json'],'{"error":"角色不存在"}');}
    if(pathname==='/api/daily-activity'){const p=store.data.characters.find(p=>p.id===Number(url.searchParams.get('role')));return p?answer(res,200,mime['.json'],JSON.stringify(dailySnapshot(p))):answer(res,404,mime['.json'],'{"error":"角色不存在"}');}
    if(pathname==='/api/career-skills')return answer(res,200,mime['.json'],careerDirectory);
    if(pathname==='/api/recorded-content')return answer(res,200,mime['.json'],JSON.stringify(recordedDirectory()));
    if(pathname==='/api/drops')return answer(res,200,mime['.json'],JSON.stringify(dropDirectory()));
    if(pathname==='/api/player-experience')return answer(res,200,mime['.json'],JSON.stringify({...playerExperience,clientProgressionRevision}));
    if(pathname==='/api/supply-shops')return answer(res,200,mime['.json'],JSON.stringify(supplyDirectory));
    if(pathname==='/api/combat-rating'){
      const role=store.data.characters.find(p=>p.id===Number(url.searchParams.get('role')));
      return role?answer(res,200,mime['.json'],JSON.stringify(combatRating(role))):answer(res,404,mime['.json'],'{"error":"没有找到这个角色"}');
    }
    if(pathname==='/equipment-composition-data.js')return answer(res,200,mime['.js'],`window.worldolCompositionData=${JSON.stringify({vipMax:VIP_MAX,sets:setData.sets.map(({id,bonuses})=>({id,bonuses}))})};`);
    if(pathname==='/equipment-rules.js')return answer(res,200,mime['.js'],`(()=>{const rules=${JSON.stringify({...upgradeRules,advanced:{...upgradeRules.advanced,identifyItemIds:upgradeIdentifyItemIds},spirit:spiritRules})},starRules=rules.star;window.worldolEquipmentRules=rules;window.worldolStarLimit=${starLimit.toString()};})();`);
    if(pathname==='/api/content-library')return answer(res,200,mime['.json'],fs.readFileSync(path.join(root,'data/content-library.json')));
    if(pathname==='/api/official-content')return answer(res,200,mime['.json'],JSON.stringify({version:'0.6.4',maps:official.maps.map(m=>({id:m.id,name:m.name})),itemIds:[...officialItems.keys()],catalog:official.catalog.length,missions:official.missions.length,supportedMissions:supportedMissionCount}));
    if(pathname==='/api/status')return answer(res,200,mime['.json'],JSON.stringify({combatLimitsRevision,characterAttackLimits,battleStatusLimit:null,project:'worldonline-original-offline',projectRoot:root,version:'0.6.4',client:305,petCatalog:petCatalogSummary,systemSettingsRevision,homeFeatureRevision,yunruoTempleRevision,recordedExpansionRevision,bossChallengeRevision,legionRevision,damageMathRevision,bossManaRecoveryRevision,clientMissionRevision,clientBagRevision,combatRatingRevision,battleSkillPanelRevision,battleFontRevision,legionSurvivorsRevision,legionPetGuardRevision,battleSpeedRevision,weaponSlotRevision,phantomImmunityRevision,illusionRevision,weaponIconRevision,taskResetRevision,taskResetDay:dailyKey(),nextTaskResetAt:nextTaskResetAt(),port,pid:process.pid,equipmentUpgrades:{version:upgradeRules.version,mode:upgradeRules.mode,starMax:upgradeRules.star.max,star:upgradeRules.star,gem:upgradeRules.gem},careerSkills:{version:careers.version,effectRevision:careers.effectRevision,teachers:careers.teachers.length,skills:careers.skills.length,maxLevel:22,learningMode:careers.learningMode},accounts:store.data.accounts.map(a=>({id:a.id,name:a.name})),characters:store.data.characters,requests,missing:[...missing],unknown:[...unknown],recent},null,2));
    if(pathname==='/status')return answer(res,200,mime['.html'],`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>世界OL单机状态</title><h1>原版单机 v0.6.4</h1><p>${official.maps.length}张原版地图，${official.missions.length}条任务定义，其中${supportedMissionCount}条通过当前条件与奖励检查。</p><p>已整合全部保存录制中可解析的公开配置：${recorded.pets.length}个宠物模板、${recorded.petSnapshots.length}份实际宠物样本、${recorded.petSkills.length}条宠物技能等级、${recordedFinishedPets.size}套97级成品宠物、20个称号、192组套装、16种宠物蛋和4份VIP页面记录。</p><p>左上单机菜单 → 录制内容 / 宠物与称号。宠物可按已录模板免费领取并出战，称号可选择并保存；套装效果按穿戴件数和VIP等级生效。</p><p>保留97级存档及原有强化、镶嵌、免费合成、技能和战力规则。未录到的随机概率、各品质完整成长曲线、16级之后经验表和部分国家/护送功能仍为缺项。</p><a href="/">进入游戏</a></html>`);
    if(pathname==='/api/shutdown' && req.method==='POST'){
      if(req.headers['x-worldol-control']!==controlToken)return answer(res,403,'text/plain','Invalid local control token');
      answer(res,200,mime['.json'],'{"stopped":true}');
      setTimeout(()=>{for(const ws of wss.clients)ws.close(1001,'Local service stopped');server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref();},100);return;
    }
    if(pathname==='/api/client-log' && req.method==='POST'){
      let data=''; for await(const chunk of req){data+=chunk;if(data.length>16384)throw Error('Log too large');}
      log('client',JSON.parse(data));return answer(res,200,mime['.json'],'{}');
    }
    if(req.method!=='GET' && req.method!=='HEAD')return answer(res,405,'text/plain','Method not allowed');
    if(pathname==='/viewport.js')return answer(res,200,mime['.js'],fs.readFileSync(path.join(root,'web/viewport.js')));
    if(pathname==='/gd.js')return answer(res,200,mime['.js'],boot);
    if(pathname==='/'+mainPath)return answer(res,200,mime['.js'],main);
    const webPaths={'/':'index.html','/index.html':'index.html','/offline.js':'offline.js','/native-pet-shop.js':'native-pet-shop.js','/role-slots.js':'role-slots.js','/recorded-content.js':'recorded-content.js','/combat-rating.js':'combat-rating.js','/career-skills.js':'career-skills.js','/equipment-workshop.js':'equipment-workshop.js','/equipment-composition.js':'equipment-composition.js','/offline.css':'offline.css','/catalog':'catalog.html','/catalog.js':'catalog.js','/catalog.css':'catalog.css'};
    webPaths['/entry-pledge.js']='entry-pledge.js';webPaths['/system-settings.js']='system-settings.js';webPaths['/daily-reset.js']='daily-reset.js';webPaths['/pet-snapshot-vitals.js']='pet-snapshot-vitals.js';webPaths['/character-features.js']='character-features.js';webPaths['/native-vip.js']='native-vip.js';webPaths['/legion.js']='legion.js';webPaths['/home-features.js']='home-features.js';webPaths['/home-features.css']='home-features.css';webPaths['/native-features.js']='native-features.js';
    const base=Object.hasOwn(webPaths,pathname)?path.join(root,'web'):raw;
    const relative=webPaths[pathname] || pathname.slice(1);
    const file=path.resolve(base,relative);const rel=path.relative(base,file);
    if(rel.startsWith('..') || path.isAbsolute(rel) || !fs.existsSync(file) || !fs.statSync(file).isFile()){
      if(pathname!=='/favicon.ico'){missing.add(pathname);log('missing',{path:pathname});}
      return answer(res,404,'text/plain','Local resource missing');
    }
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':fs.statSync(file).size,'Cache-Control':'no-cache'});
    if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
  }catch(error){log('http-error',{error:String(error)});answer(res,500,'text/plain',String(error));}
});
const sessions=new Map();
const wss=new WebSocketServer({server,maxPayload:1024*1024,verifyClient:({origin,req})=>!origin || origin===`http://127.0.0.1:${port}` || origin===`http://localhost:${port}`});
wss.on('connection',(ws,request)=>{
  const context={account:null};
  log('connect',{path:request.url});
  function send(type,body=new Writer()){ws.send(frame(type,body));log('send',{type,length:body instanceof Writer?body.done().length:body.length});}
  taskClients.set(ws,{context,send});
  ws.on('message',data=>{
    let type,leaveType=1;
    try{
      const packet=unframe(data);type=packet.type; const r=new Reader(packet.body); const w=new Writer();
      log('receive',{type,length:packet.body.length});
      resetTasks();
      if(type===5000)return send(type,w.byte(0).byte(0).byte(0).string('').bool(false).long(Date.now()));
      if(type===5002){context.account=store.account(r.string());const session=100000+context.account.id;sessions.set(session,context.account.id);return send(type,w.byte(0).long(context.account.id).int(session).string('').int(0));}
      if(type===5007 || type===5019)return send(5007,w.byte(1).short(1).string('本地世界').byte(context.account?store.roles(context.account).length:0).byte(0).string('单机').string('').bool(false).byte(1).short(1).string('离线存档').string(`ws://127.0.0.1:${port}/game`).string('').string('').byte(0).string('本地'));
      if(type===1 || type===7){const id=Number(r.long());const session=r.int();context.account=store.data.accounts.find(a=>a.id===id);if(!context.account || sessions.get(session)!==id)return send(type,w.byte(-1).string('本地会话已失效，请刷新。'));sessions.set(200000+id,id);return send(type,w.byte(0).int(200000+id));}
      if(type===protocol.CG_SYSTEM_TIME)return send(type,w.long(Date.now()));
      if(type===protocol.CG_SYSTEM_HEART)return send(type);
      if(!context.account)throw Error('请先进入本地存档。');
      if(type===10001)return send(type,roleListPacket(store,context.account));
      if(type===10003){
        const id=r.int();if(r.pos!==r.b.length)throw Error('删除角色请求格式有误。');
        const index=store.data.characters.findIndex(role=>role.id===id&&role.accountId===context.account.id);
        if(index<0)throw Error('没有找到这个本地角色。');
        const previousLastRoleId=context.account.lastRoleId,[deleted]=store.data.characters.splice(index,1);
        if(context.account.lastRoleId===id)context.account.lastRoleId=store.roles(context.account)[0]?.id||0;
        try{store.save();}catch(error){store.data.characters.splice(index,0,deleted);context.account.lastRoleId=previousLastRoleId;throw error;}
        send(type,new Writer().short(0));send(10001,roleListPacket(store,context.account));
        log('role-deleted',{account:context.account.id,role:id,name:deleted.name});return;
      }
      if(type===10015){const names=['云间行者','青岚','长风','星河','逐月','远山'];return send(type,w.byte(0).string(names[Math.floor(Math.random()*names.length)]+String(Math.floor(Math.random()*100))));}
      if(type===10002){const input={sex:r.byte(),race:r.byte(),job:r.byte(),icon1:r.long().toString(),icon2:r.long().toString(),icon3:r.long().toString(),name:r.string()};const role=store.create(context.account,input);return send(type,rolePayload(w.byte(0),role));}
      if(type===2){const id=r.int();const role=store.roles(context.account).find(p=>p.id===id);if(!role)return send(type,w.byte(-1).string('没有找到这个本地角色。'));if(context.role)flushHomeSession(context,store);const previous=structuredClone(role),last=context.account.lastRoleId;try{ensureDaily(role);context.account.lastRoleId=id;store.save();}catch(error){for(const key of Object.keys(role))if(!(key in previous))delete role[key];Object.assign(role,previous);context.account.lastRoleId=last;throw error;}context.role=role;context.homeOnlineStart=Date.now();context.battle=null;context.taskResetPending=null;pushCharacterFeatures(role,send);pushPetEquipmentExperience(send);pushSpiritInfo(send);send(type,enterWorld(role));pushLegionMembers(role,send,{appearance:false});send(32107,handbookGroups());pushNewbieMission(role,send);return;}
      if(type===10503 && context.role){pushCharacterFeatures(context.role,send);pushPetEquipmentExperience(send);pushSpiritInfo(send);send(type,w.byte(0).raw(worldData(context.role,true).done()));pushLegionMembers(context.role,send,{appearance:false});if(context.taskResetPending){pushNewbieMission(context.role,send);notifyDaily(context.role,send);send(22106,encodeDaily('s2c_TaskInfo',taskSnapshot(context.role)));context.taskResetPending=null;}return;}
      // Native bag opens its appearance catalogue even for ordinary gear.
      // Native sendProtoAsync consumes the repair status before reading copper.
      if(type===12019&&context.role){r.short();return send(type,w.byte(0).int(context.role.coins));}
      // 修复外观不同步到角色列表
      if(type===90022&&context.role){
          const roleId=r.int(),
              icon1=r.long(),
              icon2=r.long(),
              icon3=r.long();

      if(r.pos!==r.b.length || roleId!==context.role.id)
        throw Error('角色外观同步数据无效。');
      context.role.icon1=icon1.toString();
      context.role.icon2=icon2.toString();
      context.role.icon3=icon3.toString();
      store.save();
      send(type,w.byte(0));

      log('appearance-synced',{
        role:roleId,
        icon1:context.role.icon1,
        icon2:context.role.icon2,
        icon3:context.role.icon3
      });return;}

      // Preserve recorded raw range tables; unidentified entries have no guessed stats.
      if(type===12060&&context.role)return send(type,identificationPreview(r.int()));
      if(handleCharacterFeatures(type,r,context,{store,send,log}))return;
      if(handleLegion(type,r,context,{store,send,log}))return;
      if(handleCity(type,r,context,{store,send,log})){if(type===10512)pushCharacterFeatures(context.role,send);return;}
      if(handleSystemSettings(type,r,context,{store,send,log}))return;
      if(handleAttributes(type,r,context,{store,send,log}))return;
      if(handleNativeCommerce(type,r,context,{store,send,log}))return;
      if(handleIllusion(type,r,context,{store,send,log}))return;
      if(handleHomeFeatures(type,r,context,{store,send,log}))return;
      if(handleRecorded(type,r,context,{store,send,log}))return;
      if(handleOfficial(type,r,context,{store,send,log})){if(type===14503)pushCharacterFeatures(context.role,send);return;}
      if(handleEquipmentComposition(type,r,context,{store,send,log}))return;
      if(handlePetEquipment(type,r,context,{store,send,log}))return;
      if(handleEquipmentUpgrades(type,r,context,{store,send,log}))return;
      if(handlePetItems(type,r,context,{store,send,log}))return;
      if(handlePetIllusion(type,r,context,{store,send,log}))return;
      if(handleRoleRename(type,r,context,{store,send,log}))return;
      if(handleRestoration(type,r,context,{store,send,log}))return;
      if(handleEnchantment(type,r,context,{store,send,log}))return;
      if(handleSpiritSeals(type,r,context,{store,send,log}))return;
      if(handleGame(type,r,context,{store,send,log}))return;
      if(type===10505)return send(type,w.short(0));
      if(type===3){
        leaveType=r.pos<r.b.length?r.byte():1;
        if(![1,3].includes(leaveType))throw Error('无效的退出类型。');
        flushHomeSession(context,store);
        // Keep the authenticated account while clearing all state belonging to
        // the previous actor. v305 reads logout type first, then result status.
        for(const key of Object.keys(context))if(key!=='account')delete context[key];
        return send(type,w.byte(leaveType).byte(0));
      }
      unknown.add(type);log('unsupported',{type});
    }catch(error){log('protocol-error',{type,error:String(error),stack:error.stack});if(type===3)send(type,new Writer().byte(leaveType).byte(-1).string(error.message));else if([10002,10506,10518,12501,12502,14502,14503,14504].includes(type))send(type,new Writer().byte(-1).string(error.message));}
    finally{try{syncCombatRating(context,send);}catch(error){log('combat-rating-error',{role:context.role?.id,error:String(error)});}}
  });
  ws.on('error',e=>log('socket-error',{error:String(e)}));
  ws.on('close',()=>{taskClients.delete(ws);try{flushHomeSession(context,store);}catch(error){log('home-session-save-error',{role:context.role?.id,error:String(error)});}});
});
const protocol=Object.fromEntries([...fs.readFileSync(path.join(root,'analysis/modules/0019.js'),'utf8').matchAll(/\(e\.(\w+) = ([\de]+)\)/g)].map(m=>[m[1],Number(m[2])]));
server.listen(port,'127.0.0.1',()=>{try{resetTasks();fs.writeFileSync(path.join(logDir,'control.json'),JSON.stringify({projectRoot:root,pid:process.pid,port,token:controlToken}));scheduleTaskReset();log('ready',{port,pid:process.pid});console.log(`世界 online 原版单机：http://127.0.0.1:${port}/`);}catch(error){console.error(error);process.exitCode=1;server.close();}});
server.on('close',()=>clearTimeout(taskResetTimer));
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
