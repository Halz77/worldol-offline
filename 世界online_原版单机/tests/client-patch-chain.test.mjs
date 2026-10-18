import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchClientBoot,patchClientMain,replaceOnce,clientPatchStepNames,CLIENT_MAIN_PATH,isClientMainPatched} from '../lib/client-patch-chain.mjs';
import {codeOnly} from './source-scan.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const MAIN=path.join(root,'client',CLIENT_MAIN_PATH);
const BOOT=path.join(root,'analysis','gd.decoded.js');
// client/ 与 analysis/ 不进版本库（见 .gitignore）。在一个干净检出上，
// 依赖原版文件的那几条会跳过；结构性的断言任何时候都要跑。
const hasBundle=fs.existsSync(MAIN)&&fs.existsSync(BOOT);
const skipNoBundle={skip:hasBundle?false:'没有 client/ 或 analysis/，跳过原版文件相关断言'};

/**
 * 链上每一步的名字，按实际作用顺序。
 *
 * 这里是刻意钉死的：调整顺序（或增删一步）必然改变行为，改这个数组就是让人
 * 在 diff 里看见它。之前这条链在两个文件里各写一份、只靠注释说「顺序必须一致」，
 * 加补丁时漏改一边不会有任何提示。
 */
const EXPECTED_BOOT_STEPS=['offlineBootSettings','offlineInstall','dropPollingTimer'];
const EXPECTED_MAIN_STEPS=[
 'worldReq',
 'battleDamageMath',
 'npcRepeatableMissions',
 'offlineStoryBattles',
 'playerLevelRewards',
 'dailyCatalogVisibility',
 'npcMissionRefresh',
 'offlineLegionBattles',
 'gardenerManaRecovery',
 'emptyNativeShop',
 'bulkItemUse',
 'combatLimits',
 'immediateRoleDeletion',
 'legionSurvivors',
 'legionPetGuard',
 'battleSpeedSteps',
 'battleSpeedPersist',
 'battleSkillPanel',
 'battleCheckFields',
 'battleMonsterBars',
 'battleMonsterMana',
 'battleFont',
 'weaponSlots',
 'phantomImmunity',
 'illusion',
 'weaponIcon',
 'escortBattle',
 'escortBoard',
 'promptBriefing'
];

/** 收敛前散落在调用方里的补丁函数名，调用方不该再出现它们。 */
const PATCH_FUNCTIONS=[
 'patchOfflineLegionBattles','patchImmediateRoleDeletion','patchBattleDamageMath',
 'patchCombatLimits','patchGardenerManaRecovery','patchNpcRepeatableMissions',
 'patchOfflineStoryBattles','patchDailyCatalogVisibility','patchNpcMissionRefresh',
 'patchPlayerLevelRewards','patchBulkItemUse','patchBattleSkillPanel','patchBattleCheckFields','patchBattleMonsterBars','patchBattleFont',
 'patchLegionSurvivors','patchLegionPetGuard','patchBattleSpeedSteps','patchBattleSpeedPersist',
 'patchWeaponSlots','patchPhantomImmunity','patchIllusion','patchWeaponIcon','patchEscortBattle','patchEscortBoard','patchPromptBriefing','patchEmptyNativeShop'
];

function readIfPresent(file){
 return fs.existsSync(file)?fs.readFileSync(file,'utf8'):null;
}

test('补丁链只有一份，顺序被钉死',()=>{
 assert.deepEqual(clientPatchStepNames(),{boot:EXPECTED_BOOT_STEPS,main:EXPECTED_MAIN_STEPS});
});

test('server.mjs 不自带补丁链（运行时那处已归口到 lib/http-routes.mjs）',()=>{
 const source=fs.readFileSync(path.join(root,'server.mjs'),'utf8');
 const code=codeOnly(source);
 for(const name of PATCH_FUNCTIONS)assert.ok(!code.includes(name),'server.mjs 不该再直接引用 '+name);
 assert.ok(!code.includes('function replaceOnce'),'server.mjs 不该再自带 replaceOnce');
 assert.ok(!code.includes('patchClientBoot')&&!code.includes('patchClientMain'),'server.mjs 不该自己打补丁了');
});

test('standalone 构建不再自带补丁链',()=>{
 const build=path.resolve(root,'..','安卓打包','standalone','build.mjs');
 assert.ok(fs.existsSync(build),'找不到 安卓打包/standalone/build.mjs');
 const source=fs.readFileSync(build,'utf8');
 assert.match(source,/client-patch-chain\.mjs/,'build.mjs 必须从共享模块引入补丁链');
 const code=codeOnly(source);
 for(const name of PATCH_FUNCTIONS)assert.ok(!code.includes(name),'build.mjs 不该再直接调用 '+name);
 assert.ok(!code.includes('function replaceOnce'),'build.mjs 不该再自带 replaceOnce');
});

test('replaceOnce 要求锚点恰好出现一次',()=>{
 assert.equal(replaceOnce('aXb','X','Y'),'aYb');
 assert.throws(()=>replaceOnce('ab','X','Y'),/Client patch mismatch/,'锚点没命中要抛错');
 assert.throws(()=>replaceOnce('aXbXc','X','Y'),/Client patch mismatch/,'锚点命中两次也要抛错');
});

test('主包全链跑通，产物长度与既有构建指纹一致',skipNoBundle,()=>{
 const original=fs.readFileSync(MAIN,'utf8');
 // 4557839 / 4565872 是 v305 主包打补丁前后的长度。
// （第 75 版 battleCheckFields 补一行派生的「生命百分比伤害减免」后 +76：算式照抄参考实现
//  min(TOUGH/100, 80)%。）
 // （第 66 版加 escortBattle 补丁后 +28：另外两条同类条件早已由
  //  client-mission-patch / client-legion-patch 打过，这条补的是漏掉的 isEscortStatus。第 70 版
  //  加 escortBoard 补丁后 +152：把「打完棋盘战斗把棋盘恢复」塞进 BattleProxy.exitBattle 的 viewData。第 73 版加 promptBriefing 补丁后 +155：战斗提示弹窗单条 2e3→800ms、按队列长度加速、入队带上限 6 条，避免战斗都结束了还在慢慢滚。）原版换包或补丁增删都会
 // 让这里失败 —— 那正是需要停下来核对锚点的时刻。
 assert.equal(original.length,4557839,'原版主包长度变了，补丁锚点需要重新核对');
 const patched=patchClientMain(original);
 assert.equal(patched.length,4565872,'补丁链产物长度变了，构建指纹会跟着变');
 assert.ok(patched.includes('t.m=e,t.c=i,window.__worldReq=t,'),'离线请求入口没注入成功');
});

test('引导脚本补丁生效，并摘掉原版的 50ms 轮询定时器',skipNoBundle,()=>{
 const source=fs.readFileSync(BOOT,'utf8');
 const boot=patchClientBoot(source);
 assert.equal(source.length,35493);
 assert.equal(boot.length,35317);
 assert.ok(boot.includes('window.offlineBootSettings()'),'离线启动设置没挂上');
 assert.ok(boot.includes('window.offlineInstall();'),'离线运行时没挂上');
 assert.ok(
  !/\(function \(\) \{\s*try \{\s*setInterval\(function \(\) \{[\s\S]*?\}, 50\);\s*\} catch \(e\) \{\}\s*\}\)\(\),/.test(boot),
  '原版那个 50ms 轮询定时器应该被摘掉'
 );
});

test('锚点缺失时整条链必须抛错，不能静默跳过',skipNoBundle,()=>{
 const brokenMain=fs.readFileSync(MAIN,'utf8').replace('t.m=e,t.c=i,','t.m=e,t.c=i_不存在的锚点,');
 assert.throws(()=>patchClientMain(brokenMain),/Client patch mismatch/,'主包锚点缺失必须抛错');
 const brokenBoot=fs.readFileSync(BOOT,'utf8').replace('(a["gs"] = new n())','(a["gs"] = new N())');
 assert.throws(()=>patchClientBoot(brokenBoot),/Client patch mismatch/,'引导脚本锚点缺失必须抛错');
});

test('对已打过补丁的主包再打一次是幂等的（standalone 靠这条跳过重打）',skipNoBundle,()=>{
 const original=fs.readFileSync(MAIN,'utf8');
 assert.equal(isClientMainPatched(original),false,'原版主包不该带已打补丁的标记');
 const patched=patchClientMain(original);
 assert.equal(isClientMainPatched(patched),true);
 assert.equal(patchClientMain(patched),patched,'已打过补丁的主包必须原样返回，不能重复注入');
});

test('standalone 的 VFS 清单把主包指向打过补丁的那一份',()=>{
 const build=fs.readFileSync(path.resolve(root,'..','安卓打包','standalone','build.mjs'),'utf8');
 // 站点里 client/<MAIN> 就是打过补丁的成品；VFS 直接指向它，server.mjs 读进来后
 // 由 patchClientMain() 的幂等判断跳过重打。不能再指向 .orig（那会每次启动重跑全链）。
 const entry=build.split('\n').find(line=>line.includes("vfs: '/worldol/client/' + MAIN_PATH"));
 assert.ok(entry,'找不到主包的 VFS 清单项');
 assert.ok(/url:\s*'\/'\s*\+\s*MAIN_PATH\s*\}/.test(entry),'VFS 里的主包地址应该就是 MAIN_PATH：'+entry.trim());
 assert.ok(!build.includes("write(path.join(outRoot, MAIN_PATH + '.orig')"),'不该再产出主包 .orig');
});

test('全工程只有两处打补丁，且都指向同一份链（避免再次分叉）',()=>{
 // 真正要守的契约是「打补丁的地方只有一个运行时、一个构建期」，而不是「必须在某个文件里」。
 // 第 36 版把运行时那处从 server.mjs 挪到了 lib/http-routes.mjs（它负责给客户端发
 // /gd.js 与主包），这里按「谁真的调用了 patchClientBoot/patchClientMain」来判定，
 // 比钉文件名更能反映意图，也不会因为搬家而误报。
 const libDir=path.join(root,'lib');
 const targets=[
  ['server.mjs',path.join(root,'server.mjs')],
  // 定义补丁函数的模块自己当然会「调用」（其实是被调用），排除掉。
  ...fs.readdirSync(libDir).filter(n=>n.endsWith('.mjs')&&n!=='client-patch-chain.mjs').map(n=>['lib/'+n,path.join(libDir,n)]),
  ['安卓打包/standalone/build.mjs',path.resolve(root,'..','安卓打包','standalone','build.mjs')],
 ];
 const consumers=[];
 for(const [label,file] of targets){
  const source=readIfPresent(file);
  if(source===null)continue;
  if(/patchClientBoot\s*\(|patchClientMain\s*\(/.test(codeOnly(source)))consumers.push(label);
 }
 assert.deepEqual(consumers,['lib/http-routes.mjs','安卓打包/standalone/build.mjs']);

 // 定义链的模块只有一个；两个调用方都只从它取，不能再出现按名字逐个 import 补丁函数的老写法。
 assert.match(readIfPresent(path.join(libDir,'client-patch-chain.mjs')),/export function patchClientMain/);
 for(const [label,file] of targets){
  const source=readIfPresent(file);
  if(source===null)continue;
  const imports=codeOnly(source).split('\n').filter(line=>line.trimStart().startsWith('import '));
  for(const line of imports)for(const name of PATCH_FUNCTIONS){
   assert.ok(!line.includes(name),label+' 仍在逐个 import '+name+'：'+line.trim());
  }
 }
});

test('escortBattle：isEscortStatus 不能把棋盘战斗推向 12503 远程战斗',skipNoBundle,async()=>{
 const {patchEscortBattle}=await import('../lib/client-escort-battle-patch.mjs');
 const main=fs.readFileSync(MAIN,'utf8');
 const patched=patchEscortBattle(main);
 // 这条是棋盘玩法唯一会踩的：棋盘一开 isEscortStatus() 恒真，不加固就一定走 12503，
 // 而服务端只接 12501 → 客户端等不到回包、静默无反应（第 66 版玩家实测）。
 assert.ok(patched.includes('e.isEscortStatus()&&null==e.getMonsterGroup(t)&&(s=!0)'),
  'isEscortStatus 必须带上「本地没有这一组才走远程」');
 assert.ok(!patched.includes('e.isEscortStatus()&&(s=!0)'),'不能留下没加固的原文');
 // 另外两条同类条件：本补丁写成幂等的，前两个补丁打过就走跳过分支。
 for(const anchor of ['1==f["default"].isNetBattleID(t)','!s&&this.myPlayer.checkIsHasLegionTem()'])
  assert.ok(!patched.includes(anchor+'&&(s=!0)'),anchor+' 也不该留下没加固的原文');
 // 再打一次必须原样返回（standalone 靠幂等跳过重打）。
 assert.equal(patchEscortBattle(patched),patched,'补丁必须幂等');
});

test('escortBoard：exitBattle 必须把还开着的棋盘排进战后恢复（viewData）',skipNoBundle,async()=>{
 const {patchEscortBoard}=await import('../lib/client-escort-board-patch.mjs');
 const main=fs.readFileSync(MAIN,'utf8');
 const patched=patchEscortBoard(main);
 // 棋盘先被 closeAllUI（StartBattleCmd）藏掉，退战斗时 showMain 又 hideTop+clearStack
 // 藏一次，而 escort 一直没清 → MyPlayer.isCanMove() 恒 false
 // →「打赢了棋盘消失、人物卡住不能走」（第 70 版玩家实测）。
 // exitBattle 末尾的 if(t) 本来就会按 viewData 恢复界面，缺的只是「把棋盘排进去」。
 assert.ok(patched.includes('o.viewData||null==s["default"].getEscort()||null==s["default"].getEscort().pointList||(o.viewData={modName:"Escort",viewType:"EscortNewMain",isWin:!0})'),
  'exitBattle 必须把还开着的新版棋盘塞进 viewData（用 pointList 认新版，别误伤旧版护送）');
 assert.ok(patched.includes('isWin:!0'),'要走 showWin：原版开棋盘（14508）就是 showWin，棋盘得留在 UISTACK 上');
 assert.ok(!patched.includes(',o.isChangeMap=!1}var S=s["default"].myPlayer;'),
  '不能留下没有恢复棋盘的原文');
 assert.equal(patchEscortBoard(patched),patched,'补丁必须幂等');
});

test('promptBriefing：战斗提示弹窗要滚快、按队列加速、入队带上限',skipNoBundle,async()=>{
 const {patchPromptBriefing,PROMPT_TIME_MS,PROMPT_QUEUE_LIMIT,PROMPT_MIN_MS,PROMPT_REF_MS}=await import('../lib/client-prompt-patch.mjs');
 const main=fs.readFileSync(MAIN,'utf8');
 const patched=patchPromptBriefing(main);
 // 单条停留时间：原版 Briefing.TIME=2e3（每加一条就固定占屏 2 秒）。
 assert.equal(PROMPT_TIME_MS,800);
 assert.ok(patched.includes(',t.TIME=800,t.timeKey=0'),'Briefing.TIME 要从 2e3 改成 800');
 assert.ok(!patched.includes(',t.TIME=2e3,t.timeKey=0'),'不能留下原来的 2 秒');
 // 队列越长切得越快（队列里剩下的条数就是 promptMsssage.size()）。
 assert.ok(patched.includes(`Math.max(${PROMPT_MIN_MS},Math.min(this.TIME,Math.floor(${PROMPT_REF_MS}/Math.max(1,a["default"].getInstance().promptMsssage.size()))))`),
  'showNext 的下一次延迟要按队列长度收缩');
 // 入队上限：原版 promptMsssage 无上限，战斗里攒下的旧提示会一直占位。
 assert.equal(PROMPT_QUEUE_LIMIT,6);
 assert.ok(patched.includes(`function(q){q.addElement(t);for(;q.size()>${PROMPT_QUEUE_LIMIT};)q.removeElementAt(0)}(e.getInstance().promptMsssage),_.Briefing.show()`),
  'addPromptMsg 入队后要裁到上限（丢最旧的）');
 assert.ok(!patched.includes('e.getInstance().promptMsssage.addElement(t),_.Briefing.show()'),'不能留下没有上限的入队原文');
 assert.equal(patchPromptBriefing(patched),patched,'补丁必须幂等');
});
