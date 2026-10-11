const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'analysis/native-ui-qa');
const port=Number(process.env.WORLDOL_UI_PORT||8792),base='http://127.0.0.1:'+port;
app.setPath('userData',path.join(out,'electron-profile'));app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{
 let win;const report={passed:false,errors:[],network:[],checks:[]};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  win=new BrowserWindow({show:false,width:720,height:1100,webPreferences:{offscreen:true,backgroundThrottling:false,nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.webContents.session.webRequest.onBeforeRequest((r,done)=>{const ok=r.url.startsWith(base+'/')||r.url.startsWith(base.replace('http:','ws:')+'/')||r.url==='about:blank'||r.url.startsWith('data:');if(!ok)report.network.push(r.url);done({cancel:!ok});});
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)report.errors.push(message);});
  const js=code=>win.webContents.executeJavaScript(code,true);
  async function until(code,timeout=25000){const end=Date.now()+timeout;while(Date.now()<end){const result=await js(code).catch(()=>null);if(result)return result;await sleep(100);}throw Error('Timeout '+code);}
  const shot=async name=>{await sleep(600);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());};
  await win.loadURL(base+'/?save=home-ui-qa');
  await until(`!!(window.__worldReq&&window.offlineNativeFeatures)`);
  await until(`(()=>{const r=__worldReq;return r(3).default._moduleMap[r(0).ModName.Login]?.__mdrIns[r(0).LoginViewType.Start]?.isOpen})()`);
  await js(`(()=>{const r=__worldReq;window.r=r;r(3).default.hideView(r(0).ModName.Login,r(0).LoginViewType.Notice);r(3).default.getMod(r(0).ModName.Login).__mdrIns[r(0).LoginViewType.Start].tapStart()})()`);
  await until(`r(3).default.getMod(r(0).ModName.Login).__mdrIns[r(0).LoginViewType.RoleList]?.curItem?.data?.id===1001`);
  await js(`r(3).default.getMod(r(0).ModName.Login).__mdrIns[r(0).LoginViewType.RoleList].tapEnter()`);
  await until(`r(5).default.myPlayer?.id===1001&&!!offlineHomeFeatures.getMain()`,45000);await sleep(2000);
  report.role=await js(`({id:r(5).default.myPlayer.id,map:r(5).default.mapId})`);
  await js(`offlineHomeFeatures.getMain()._view.btnMap.dispatchEventWith(egret.TouchEvent.TOUCH_TAP,true)`);
  await until(`r(3).default.getMod(r(0).ModName.WorldMap).__mdrIns[r(0).WorldMapViewType.WorldMap]?.isOpen`);report.checks.push('world-map-direct');await shot('world-map');
  await js(`r(1).default.showMain();offlineHomeFeatures.getMain()._view.btnTower.dispatchEventWith(egret.TouchEvent.TOUCH_TAP,true)`);
  await until(`r(3).default.getProxy(r(0).ModName.Tower,r(0).ProxyType.Tower).climbTowerInfoVo?.infos?.length===120`);
  assert.equal(await js(`document.getElementById('home-feature-dialog').open`),false);report.checks.push('tower-direct');await shot('tower');
  await js(`r(1).default.showMain();offlineHomeFeatures.getMain()._view.btnCity.dispatchEventWith(egret.TouchEvent.TOUCH_TAP,true)`);
  report.city=await until(`(()=>{const c=r(3).default.getMod(r(0).ModName.Main).__mdrIns[r(0).MainViewType.MainCity];return c?.isOpen&&Object.fromEntries(['btnRank','btnBook','btnAchievement','btnWarehouse','btnHome','btnSocial'].map(k=>[k,{visible:c._view[k].visible,label:c._view[k].label}]))})()`);
  assert.ok(Object.values(report.city).every(b=>b.visible));report.checks.push('six-original-city-signs');await shot('city');
  await js(`r(1).default.showMain();r(1).default.openBag(r(5).default.myPlayer)`);await sleep(1200);
  report.bag=await js(`(()=>{const result=[];function visit(n){if(n?.nativeVipIcon)result.push({vip:{visible:n.visible,source:n.nativeVipIcon.source,texture:!!n.nativeVipIcon.texture}});for(const child of n?.$children||[])visit(child);}visit(r(9).Layer.ins.stage);return result})()`);
  assert.ok(report.bag.some(v=>v.vip?.texture));report.checks.push('vip-recorded-icon');await shot('vip-icon');
  await js(`document.getElementById('vip-open').click()`);await until(`r(3).default.getMod(r(0).ModName.Bag).__mdrIns[r(0).BagViewType.BagUserView]?.isOpen`);await shot('vip-window');
  await js(`r(1).default.showMain();offlineNativeFeatures.openMenu()`);await until(`offlineNativeFeatures.snapshot()?.id==='native-menu-model'&&offlineNativeFeatures.snapshot().rows.length>=18`);report.menu=await js(`offlineNativeFeatures.snapshot()`);await shot('menu');
  for(const [id,mod,type]of [['legion-open','Legion','LegionMain'],['city-open','City','CityMain'],['talents-open','Role','RoleMain'],['artifact-open','Role','RoleMain']]){
   await js(`r(1).default.showMain();document.getElementById(${JSON.stringify(id)}).click()`);
   await until(`r(3).default.getMod(r(0).ModName.${mod}).__mdrIns[r(0).${mod}ViewType.${type}]?.isOpen`);report.checks.push(id);await shot(id);
  }
  for(const id of ['features-open','combat-rating-open','recorded-open','pet-shop-open','career-open','equipment-open','composition-open']){
   await js(`r(1).default.showMain()`);
   await js(`document.getElementById(${JSON.stringify(id)}).click()`);
   await until(`offlineNativeFeatures.snapshot()?.native`);await sleep(800);
   const state=await js(`offlineNativeFeatures.snapshot()`);assert.ok(state.rows.length>1,id);report.checks.push(id+':'+state.id);
   assert.equal(await js(`getComputedStyle(document.getElementById(${JSON.stringify(state.id)})).display`),'none');
   await shot(id);
  }
  await js(`offlineHomeFeatures.open('charge')`);await until(`offlineNativeFeatures.snapshot()?.title==='充值'`);await sleep(500);
  const before=await js(`r(5).default.myPlayer.money1`);
  await js(`(()=>{const m=r(3).default.getMod('OfflineNativeFeatures').__mdrIns.main;const input=m.rows.find(v=>v.kind==='input');input.el.value='1';m.render(true);const b=m.content.$children.find(v=>v.label==='领取单机补给');b.dispatchEventWith(egret.TouchEvent.TOUCH_TAP,true)})()`);
  await until(`r(5).default.myPlayer.money1===${before+1}`);report.checks.push('native-button-real-save');
  const saved=await js(`fetch('/api/home-features?role=1001').then(r=>r.json()).then(s=>s.balance.gold)`);assert.equal(saved,before+1);
  await until(`document.querySelector('#home-feature-dialog [role=status]').textContent==='已保存。'`);
  // Selectors use native lists and dispatch the same persisted controller action.
  await js(`(()=>{const m=r(3).default.getMod('OfflineNativeFeatures').__mdrIns.main; m.activate(m.rows.find(x=>x.kind==='select'))})()`);
  await until(`r(3).default.getMod('OfflineNativeFeatures').__mdrIns.main.rows.some(x=>x.kind==='option')`);
  await js(`(()=>{const m=r(3).default.getMod('OfflineNativeFeatures').__mdrIns.main; m.activate(m.rows.find(x=>x.kind==='option'&&x.option.value==='silver'))})()`);
  assert.equal(await js(`document.querySelector('#home-feature-dialog select').value`),'silver');report.checks.push('native-selector-controller');
  for(const [key,mod,enumName,type]of [['btnRank','Leaderboard','LeaderboardType','Leaderboard'],['btnAchievement','Achievement','AchievementType','Achievement'],['btnBook','Raiders','RaidersViewType','BookGroupMain'],['btnWarehouse','Shop','ShopViewType','ShopVIPMain'],['btnSocial','Relation','RelationViewType','RelationMain']]){
   await js(`r(1).default.showMain();offlineHomeFeatures.getMain()._view.btnCity.dispatchEventWith(egret.TouchEvent.TOUCH_TAP,true)`);await sleep(250);
   await js(`r(3).default.getMod(r(0).ModName.Main).__mdrIns[r(0).MainViewType.MainCity]._view.${key}.dispatchEventWith(egret.TouchEvent.TOUCH_TAP,true)`);await sleep(800);
   await until(`r(3).default.getMod(r(0).ModName.${mod}).__mdrIns[r(0).${enumName}.${type}]?.isOpen`);
   report.checks.push('town-'+key);await shot('town-'+key);
  }
  await js(`r(1).default.showMain();offlineHomeFeatures.getMain()._view.btnCharge.dispatchEventWith(egret.TouchEvent.TOUCH_TAP,true)`);
  await until(`r(3).default.getMod(r(0).ModName.Charge).__mdrIns[r(0).ChargeType.ChargeMain]?.isOpen`);
  await js(`window.charge=r(3).default.getMod(r(0).ModName.Charge).__mdrIns[r(0).ChargeType.ChargeMain];void 0`);
  report.chargeTabs=await js(`charge.dataPro.source.map(x=>x.lab)`);assert.equal(report.chargeTabs.length,5);
  for(let i=0;i<5;i++){
   await js(`charge._tab.selectIndex=${i}`);
   await until(`charge._tab._mdrInstList[${i}]?.isOpen`);await sleep(750);
   const data=await js(`(()=>{const m=charge._tab._mdrInstList[${i}];return {rows:m._list?.length,selected:charge._tab.selectIndex,preview:!!m._proxy?.payDescObjectData}})()`);
   if(i===0)assert.equal(data.rows,9);if(i===1)assert.equal(data.rows,2);if(i===2)assert.ok(data.rows>0);if(i===3)assert.ok(data.preview);if(i===4)assert.equal(data.rows,23);
   report.checks.push('native-recharge-tab-'+i);await shot('recharge-'+i);
  }
  await js(`charge._tab.selectIndex=2`);
  for(let type=0;type<3;type++){await js(`charge._tab._mdrInstList[2].onChange(${type})`);assert.ok(await js(`charge._tab._mdrInstList[2]._list.length>0`));await shot('recharge-gift-'+type);}
  await js(`charge._tab.selectIndex=0`);await sleep(400);
  const balanceBefore=await js(`r(5).default.myPlayer.money1`);
  await js(`(()=>{const m=charge._tab._mdrInstList[0];m._view.list.getElementAt(2).dispatchEventWith(egret.TouchEvent.TOUCH_TAP,true)})()`);
  await until(`r(5).default.myPlayer.money1===${balanceBefore+2250}`);
  assert.equal(await js(`fetch('/api/home-features?role=1001').then(r=>r.json()).then(s=>s.balance.gold)`),balanceBefore+2250);
  await until(`r(3).default.getProxy(r(0).ModName.Charge,r(0).ProxyType.Charge).isMultiple.includes('3')`);
  report.checks.push('native-recharge-touch-saves-first-bonus');await shot('recharge-after-claim');
  await js(`r(1).default.showMain();r(197).default.Instance.doGetMapList({id:0,name:'已采集地图'})`);await sleep(700);
  const allMaps=await js(`(()=>{const m=r(3).default.getMod(r(0).ModName.WorldMap).__mdrIns[r(0).WorldMapViewType.WorldMapList];return m?._showArgs?.list?.size?.()??m?._showArgs?.list?.arr?.length})()`);assert.equal(allMaps,139);report.checks.push('unsigned-map-directory-139');
  report.newMaps=[];
  for(const id of [953,966,807,809,459,502,954,985,987,844,854,861,963,938]){
   await js(`r(1).default.closeAllUI();r(197).default.Instance.doJumpMap({id:${id}})`);await until(`r(5).default.mapId===${id}`);await sleep(550);report.newMaps.push(id);
   if([953,966,854].includes(id))await shot('dungeon-'+id);
  }
  assert.equal(report.network.length,0);assert.equal(report.errors.length,0,report.errors.join('\n'));report.passed=true;
 }catch(e){report.error=e.stack;if(win){report.debug=await win.webContents.executeJavaScript(`({req:typeof window.__worldReq,install:typeof window.installNativeFeatures,native:typeof window.offlineNativeFeatures,status:document.getElementById('offline-status')?.textContent,log:document.getElementById('offline-log')?.textContent,scripts:[...document.scripts].map(s=>s.src)})`).catch(()=>null);fs.writeFileSync(path.join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());}}
 finally{fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));if(win&&!win.isDestroyed())win.destroy();app.exit(report.passed?0:1);}
});
