const {app,BrowserWindow}=require('electron');const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'analysis/home-features-qa'),url='http://127.0.0.1:8792/?save=home-ui-qa';
app.setPath('userData',path.join(out,'electron-profile'));app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async()=>{let window;const report={passed:false,errors:[],network:[],buttons:[]};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 try{
  window=new BrowserWindow({show:false,width:720,height:1100,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,backgroundThrottling:false,offscreen:true}});
  window.webContents.session.webRequest.onBeforeRequest((r,done)=>{const allowed=/^(http|ws):\/\/127\.0\.0\.1:8792(?:\/|$)/.test(r.url)||r.url==='about:blank'||r.url.startsWith('data:');if(!allowed)report.network.push(r.url);done({cancel:!allowed});});
  window.webContents.on('console-message',(_event,level,message)=>{if(level>=3)report.errors.push(message);});
  await window.loadURL(url);const js=code=>window.webContents.executeJavaScript(code,true);
  async function until(code,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await js(code).catch(()=>null);if(value)return value;await sleep(100);}throw Error('UI timeout: '+code);}
  await until(`!!(window.__worldReq && window.offlineHomeFeatures)`);
  report.boot=await js(`(()=>{const r=window.__worldReq;return {mods:Object.keys(r(3).default._moduleMap),scripts:[...document.scripts].map(s=>s.src),globals:Object.keys(window).filter(k=>/facade|req|game/i.test(k))}})()`);
  await until(`(()=>{const r=window.__worldReq;return r(3).default._moduleMap[r(0).ModName.Login]?.__mdrIns[r(0).LoginViewType.Start]?.isOpen})()`);
  await js(`(()=>{const r=window.__worldReq,f=r(3).default;f.hideView(r(0).ModName.Login,r(0).LoginViewType.Notice);f.getMod(r(0).ModName.Login).__mdrIns[r(0).LoginViewType.Start].tapStart()})()`);
  await until(`(()=>{const r=window.__worldReq;return r(3).default._moduleMap[r(0).ModName.Login]?.getProxy(r(0).ProxyType.Login)?.data?.allPlayerList?.length>0})()`);
  await until(`(()=>{const r=window.__worldReq;return r(3).default.getMod(r(0).ModName.Login).__mdrIns[r(0).LoginViewType.RoleList]?.curItem?.data?.id===1001})()`);
  await js(`(()=>{const r=window.__worldReq;r(3).default.getMod(r(0).ModName.Login).__mdrIns[r(0).LoginViewType.RoleList].tapEnter()})()`);
  await until(`window.__worldReq(5).default.myPlayer?.id===1001&&!!window.offlineHomeFeatures.getMain()`,45000);await sleep(4000);
  report.buttons=await js(`(()=>{const v=window.offlineHomeFeatures.getMain()._view;const child=b=>({type:b.constructor.name,text:b.text,source:b.source,children:b.$children?.map(child)});return Object.keys(v).filter(k=>/^btn/.test(k)&&v[k]?.visible&&v[k]?.includeInLayout).map(k=>({key:k,label:v[k].label,source:v[k].source,x:v[k].x,y:v[k].y,parent:v[k].parent?.name,content:child(v[k])}))})()`);
  fs.writeFileSync(path.join(out,'home-native.png'),(await window.webContents.capturePage()).toPNG());
  const homeIcons={btnCharge:'充值',btnFuLi:'特惠',btnHint:'公告',btnTower:'永泽塔',btnDigHole:'矿洞',btnFinalBoss:'试炼',btnNewTask:'新手',btnManor:'国家'};
  for(const [key,name]of Object.entries(homeIcons)){
   assert.ok(report.buttons.some(b=>b.key===key),'Missing '+key);
   await js(`window.offlineHomeFeatures.getMain()._view[${JSON.stringify(key)}].dispatchEventWith(egret.TouchEvent.TOUCH_TAP,true)`);
   await until(`document.getElementById('home-feature-dialog').open&&document.querySelector('#home-feature-dialog h2').textContent===${JSON.stringify(name)}&&!document.querySelector('#home-feature-dialog [role=status]').textContent.includes('正在')`);
  }
  // 按需求移除：抽奖/福利/超值/霸业/聚义酒馆图标、邮件，以及底部聊天栏（含邮件右边的聊天遮罩）都不再显示。
  for(const key of ['btnLottery','btnReward','btnBulk','btnCampWar','btnBuddy','btnMail'])assert.ok(!report.buttons.some(b=>b.key===key),'Removed home icon still visible: '+key);
  assert.ok(!(await js(`window.offlineHomeFeatures.getMain()._view.grp_chat?.visible`)),'chat bar (grp_chat) must stay hidden');
  await js(`window.offlineHomeFeatures.open('welfare')`);await until(`document.querySelector('#home-feature-dialog h2').textContent==='福利'&&!document.querySelector('#home-feature-dialog [role=status]').textContent.includes('正在')`);
  await sleep(500);fs.writeFileSync(path.join(out,'welfare.png'),(await window.webContents.capturePage()).toPNG());
  await js(`window.offlineHomeFeatures.open('dungeons')`);await until(`document.querySelector('#home-feature-dialog h2').textContent==='已采集副本与地图'`);
  report.dungeons=await js(`window.offlineHomeFeatures.getSnapshot().dungeons.length`);assert.equal(report.dungeons,92);
  await js(`window.offlineHomeFeatures.preview(1)`);await until(`document.querySelector('#home-feature-dialog h2').textContent==='永泽塔 · 关卡 1'`);
  assert.match(await js(`document.getElementById('home-feature-dialog').textContent`),/野狼/);await sleep(500);fs.writeFileSync(path.join(out,'tower-monsters.png'),(await window.webContents.capturePage()).toPNG());
  await js(`document.getElementById('home-feature-dialog').close();window.__worldReq(1).default.showWin(window.__worldReq(0).ModName.Tower,window.__worldReq(0).TowerViewType.TowerMain)`);
  await until(`(()=>{const r=window.__worldReq;return r(3).default.getProxy(r(0).ModName.Tower,r(0).ProxyType.Tower).climbTowerInfoVo?.infos?.length===120})()`);await sleep(1000);
  fs.writeFileSync(path.join(out,'tower-native.png'),(await window.webContents.capturePage()).toPNG());
  await js(`(()=>{const r=window.__worldReq;r(3).default.hideView(r(0).ModName.Tower,r(0).TowerViewType.TowerMain);window.offlineHomeFeatures.open('charge')})()`);
  await until(`document.querySelector('#home-feature-dialog h2').textContent==='充值'&&!document.querySelector('#home-feature-dialog [role=status]').textContent.includes('正在')`);
  const gold=await js(`window.__worldReq(5).default.myPlayer.money1`);
  await js(`(()=>{document.querySelector('#home-feature-dialog input').value='100';[...document.querySelectorAll('#home-feature-dialog button')].find(b=>b.textContent==='领取单机补给').click()})()`);
  await until(`window.__worldReq(5).default.myPlayer.money1===${gold+100}`);
  await until(`window.offlineHomeFeatures.getMain()._view.comMoney_1.textNum.text===${JSON.stringify(String(gold+100))}`);
  report.charge=await js(`fetch('/api/home-features?role=1001').then(r=>r.json()).then(s=>s.balance.gold)`);assert.equal(report.charge,gold+100);
  await js(`window.offlineHomeFeatures.open('welfare')`);await until(`document.querySelector('#home-feature-dialog h2').textContent==='福利'&&!document.querySelector('#home-feature-dialog [role=status]').textContent.includes('正在')`);
  if(!await js(`window.offlineHomeFeatures.getSnapshot().vip.dailyClaimed`)){
   await js(`[...document.querySelectorAll('#home-feature-dialog button')].find(b=>b.textContent==='领取VIP1基础每日礼包').click()`);await until(`window.offlineHomeFeatures.getSnapshot().vip.dailyClaimed`);
  }
  const gift=await js(`fetch('/api/status').then(r=>r.json()).then(s=>s.characters.find(p=>p.id===1001).inventory.find(i=>i.itemId===100146))`);
  assert.ok(gift);await until(`window.__worldReq(5).default.myPlayer.bag.getItem(${gift.slot})?.id===100146`);report.vipGift=gift;
  report.maps=[];
  for(const id of [829,843,988,940,35,965,457,12,273,501,260,840]){
   await js(`window.offlineHomeFeatures.open('dungeons')`);await until(`!!document.querySelector('#home-feature-dialog button[data-map-id="${id}"]')`);
   await js(`document.querySelector('#home-feature-dialog button[data-map-id="${id}"]').click()`);await until(`window.__worldReq(5).default.mapId===${id}`);await sleep(1000);report.maps.push(id);
   if([843,501,260].includes(id))fs.writeFileSync(path.join(out,'map-'+id+'.png'),(await window.webContents.capturePage()).toPNG());
  }
  assert.equal(fs.readFileSync(path.join(out,'saves/world.json'),'utf8').includes('100146'),true);
  assert.equal(report.network.length,0);assert.equal(report.errors.length,0,report.errors.join('\n'));report.passed=true;
 }catch(error){report.error=error.stack;if(window)fs.writeFileSync(path.join(out,'ui-failure.png'),(await window.webContents.capturePage()).toPNG());}
 finally{fs.writeFileSync(path.join(out,'ui-result.json'),JSON.stringify(report,null,2));if(window&&!window.isDestroyed())window.destroy();app.exit(report.passed?0:1);}
});
