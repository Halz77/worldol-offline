(() => {
 'use strict';
 window.installHomeFeatures=req=>{
  const World=req(5).default,UI=req(1).default,Main=req(604).MainMdr.prototype,Network=req(35).default,Message=req(22).Message;
  // 主界面图标白名单。抽奖/福利/超值/霸业/聚义酒馆与邮件对单机玩家无用且容易误触，
  // 已从本表移除并列入下面的 removedButtons 强制隐藏（见 hideRemoved）。
  // 打榜（btnCrossPla）/ 对战（btnPetBattle）不在本表里：原版自己会把它们摆出来，
  // 所以只靠「不列进白名单」藏不住，必须一起进 removedButtons（见下）。
  const buttons={btnCharge:'charge',btnFuLi:'special',btnHint:'notice',btnTower:'tower',btnFinalBoss:'trial',btnDaily:'daily',btnManor:'country',btnBag:'bag',btnRole:'role',btnPet:'pet',btnMap:'map',btnShop:'shop',btnCity:'city'};
  // 需要永久隐藏的主界面元素：
  //   btnLottery 抽奖 / btnReward 福利 / btnBulk 超值 / btnCampWar 霸业 / btnBuddy 聚义酒馆 —— 活动图标；
  //   btnMail 邮件；
  //   btnCrossPla 打榜 / btnNewTask 新手 / btnPetBattle 对战 / btnDigHole 矿洞 —— 单机版用不到（第 73 版
  //   按玩家要求整体去掉）。矿洞与新手的内容仍可从单机菜单的「矿洞 / 新手」页查看；
  //   grp_chat 是底部聊天栏（左侧 btnMail + 右侧 scroller_chat「聊天遮罩」，
  //   原版把 scroller_chat 绑定了 tapChat，点它就会进聊天页）。
  // 这些按钮由原版 setLayout(可见性) 或活动回调随时显示，所以不能只从 buttons 摘掉，
  // 还要在这些回调之后强制隐藏。
  const removedButtons=['btnLottery','btnReward','btnBulk','btnCampWar','btnBuddy','btnMail','btnCrossPla','btnNewTask','btnPetBattle','btnDigHole'];
  const removedGroups=['grp_chat'];
  const names={charge:'充值',welfare:'福利',special:'特惠',lottery:'抽奖',notice:'公告',tower:'永泽塔',mine:'矿洞',trial:'试炼',bulk:'超值',buddy:'聚义酒馆',daily:'日常',newbie:'新手',mail:'邮件',country:'国家',bag:'背包',role:'人物',pet:'宠物',map:'地图',shop:'商店',city:'主城'};
  const native={bag:Main.tapBag,role:Main.tapRole,pet:Main.tapPet,daily:Main.tapDaily,city:Main.onTapCity,map:Main.tapMap};
  const dialog=document.createElement('dialog');dialog.id='home-feature-dialog';dialog.setAttribute('aria-label','游戏功能');document.body.append(dialog);
  const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');close.textContent='关闭';close.onclick=()=>{generation++;dialog.close();};header.append(title,close);
  const nav=document.createElement('nav'),body=document.createElement('section'),status=document.createElement('p');status.setAttribute('role','status');dialog.append(header,nav,body,status);
  let state=null,current='notice',generation=0,activeRole=0,busy=false,main=null;
  const element=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
  function button(text,fn,parent=body,disabled=false){const b=element('button',text);b.disabled=disabled;b.onclick=()=>Promise.resolve().then(fn).catch(e=>status.textContent=e.message);parent.append(b);return b;}
  const text=(s,parent=body)=>parent.append(element('p',s));
  async function wire(type,value){const p=World.myPlayer;if(!p?.id)throw Error('请先进入角色。');const m=new Message(type);if(value)m.putString(JSON.stringify({...value,role:p.id}));const r=await Network.sendProtoAsync(m);if(!r)throw Error('本地服务未响应，请刷新后重试。');if(r.getByte()<0)throw Error(r.getString());const data=JSON.parse(r.getString());if(World.myPlayer?.id!==p.id||data.role!==p.id)throw Error('角色已切换，请重新打开。');return data;}
  async function action(value){
   if(busy||activeRole!==World.myPlayer?.id)return;busy=true;status.textContent='正在保存…';for(const b of body.querySelectorAll('button'))b.disabled=true;
   try{state=await wire(90020,value);const p=World.myPlayer;p.setVipLevel(state.vip.level);p.setVipLevel2(state.vip.level);for(const key of [11,12,13])req(3).default.sendNt(req(2).MainEvent.ON_PLAYER_ATTR_UPDATE,key);render();status.textContent='已保存。';}
   catch(e){status.textContent=e.message;render();}finally{busy=false;}
  }
  function itemText(items=[]){return items.map(i=>`${i.name||i.itemId||i.id} × ${i.quantity||i.itemCount||1}`).join('、')||'无道具';}
  function render(){
   body.replaceChildren();nav.replaceChildren();title.textContent=names[current]||'游戏功能';
   for(const key of ['notice','welfare','tower','newbie'])button(names[key],()=>open(key),nav);button('已采集副本',()=>open('dungeons'),nav);
   const entry=state.entries.find(e=>e.id===current);if(entry)text(entry.description);
   if(current==='charge'){
    text('单机免费补给。输入本次增加的数量，资源保存到当前角色。');
    text(`黄金 ${state.balance.gold}　白银 ${state.balance.silver}　铜币 ${state.balance.coins}`);
    const form=element('div');form.className='home-form';const currency=element('select');currency.setAttribute('aria-label','补给货币');for(const [key,name]of [['gold','黄金'],['silver','白银'],['coins','铜币']]){const o=element('option',name);o.value=key;currency.append(o);}
    const amount=element('input');amount.type='number';amount.min='1';amount.step='1';amount.value='10000';amount.setAttribute('aria-label','增加数量');form.append(currency,amount);body.append(form);button('领取单机补给',()=>action({action:'charge',currency:currency.value,amount:Number(amount.value)}));
   }else if(current==='welfare'){
    const v=state.vip;text(`VIP ${v.level} · ${v.permanent?'单机永久有效':'未开通'}。任务经验 ${v.missionMultiplier} 倍，每日活跃度 +${v.vitality}。单机战后全队人物和出战宠物生命、法力回满，无需VIP。`);
    button('打开VIP',()=>{dialog.close();document.getElementById('vip-open').click();});
    button(v.dailyClaimed?'今日VIP礼包已领取':'领取VIP1基础每日礼包',()=>action({action:'vip-daily'}),body,!v.level||v.dailyClaimed);
    button(v.growthClaimed?'成长礼包已领取':'领取VIP成长礼包',()=>action({action:'vip-growth'}),body,!v.level||v.growthClaimed);
    text(v.level<=1?`VIP经验：${v.experience} / ${v.nextLevelExp}`:'当前等级的后续VIP经验表待补。');
    button('500黄金兑换500VIP经验',()=>action({action:'vip-exp'}),body,v.level!==1||v.experience>=v.nextLevelExp);
    text(v.pending+' 高阶VIP暂领已录制的VIP1基础礼包。礼包内未录到的随机内容保持待补。');
    body.append(element('h3',`在线奖励 · 本日累计 ${Math.floor(state.online.seconds/60)} 分钟`));
    for(const r of state.online.rewards){const row=element('article');row.className='home-row';text(`${r.minutes}分钟：${itemText(r.items)}${r.currencies.length?'；'+r.currencies.map(c=>`${({[-1]:'黄金',[-2]:'白银',[-3]:'铜币',[-12]:'能量精华'})[c.id]||'待补资源'} × ${c.quantity}`).join('、'):''}`,row);button(r.pending?'奖励账户待补':r.claimed?'已领取':r.ready?'领取':'时长未达到',()=>action({action:'online',minutes:r.minutes}),row,r.pending||r.claimed||!r.ready);body.append(row);}
    button('刷新在线进度',()=>open('welfare'));
   }else if(current==='tower'){
    button('原版塔层目录',()=>{dialog.close();UI.showWin(req(0).ModName.Tower,req(0).TowerViewType.TowerMain);});
    for(const mode of state.tower){const group=element('details');group.open=mode.mode===1;group.append(element('summary',`${mode.mode===1?'普通':'困难'} · ${mode.levels.length}关`));for(const f of mode.levels){const row=element('article');row.className='home-row';text(`第${f.rank}层 · 建议${f.level}级`,row);text(f.info,row);button('怪物属性',()=>preview(f.id),row,!f.previewAvailable);group.append(row);}body.append(group);}
   }else if(current==='dungeons'){
    title.textContent='已采集副本与地图';text(`共 ${state.dungeons.length} 张地图。已恢复入口不限制等级；未采集的后续场景会提示待补。`);
    button('原版日常任务',()=>{dialog.close();native.daily.call(main);});
    const search=element('input');search.placeholder='搜索副本或地图';search.setAttribute('aria-label','搜索副本或地图');body.append(search);const list=element('div');body.append(list);
    const show=()=>{list.replaceChildren();for(const map of state.dungeons.filter(m=>m.name.includes(search.value.trim()))){const row=element('article');row.className='home-row';text(`${map.name} · ${map.missions}条任务 · ${map.npcs}个NPC`,row);button('进入地图',async()=>{if(req(54).default.ins.isFight)throw Error('请先结束战斗。');dialog.close();await req(197).default.Instance.doJumpMap({id:map.id});},row).dataset.mapId=String(map.id);list.append(row);}};search.oninput=show;show();
   }else if(current==='lottery'&&state.lottery){
    const l=state.lottery;text(`录制价格：每次 ${l.price} 黄金，批量抽取折扣 ${l.discount*10} 折。`);text('连续登录奖励：'+Array.from({length:l.messages.length/2},(_,i)=>`${l.messages[i*2]} ${l.messages[i*2+1]}`).join('；'));text(l.vipDescription);
    body.append(element('h3',`已采集奖池 · ${l.rewards.length}项`));for(const [i,r]of l.rewards.entries())text(`${i+1}. ${r.name?r.name+' × '+r.quantity:r.description}${l.probabilities?.[i]?' · '+l.probabilities[i]:''}`);
    button('抽奖概率及结算待补',()=>{},body,true);
   }else if(current==='mine'&&state.mine){
    const m=state.mine;text(`已采集 ${m.pointCount} 个矿点。录制配置：每日战斗 ${m.fightSum} 次，搜索 ${m.searchSum} 次。`);text(`录制中的次数购买价格：战斗 ${m.fightBuyPrice}，搜索 ${m.searchBuyPrice}；币种与完整购买规则待核实。`);text('本地尚未占领矿点。矿点产出、驻守和争夺战待补。');
   }else if(current==='newbie'){
    for(const q of state.newbie){const row=element('article');row.className='home-row';text(`${q.completed?'已完成':q.active?'进行中':'未完成'} · ${q.name}`,row);text(q.locations.map(o=>`${o.mapName||o.mapId} / NPC ${o.npcId}`).join('，'),row);const loc=q.locations.find(o=>o.mapName);if(loc)button('查看所在地图',()=>{dialog.close();req(197).default.Instance.doGetMapList({id:0,name:'单机已恢复地图'});},row);body.append(row);}
   }else if(current==='notice'){
    text('已接入截图中的20个主页入口。VIP、在线福利、已恢复地图和任务使用角色存档；永泽塔已收录132个关卡、160种怪物的属性预览。');
    for(const entry of state.entries){const row=element('article');row.className='home-row';button(entry.name,()=>route(entry.id,main),row);text(entry.description,row);body.append(row);}
   }else if(current==='trial'&&state.trial){
    const t=state.trial;
    text(`${t.name}：打一只超肉 BOSS，按造成的伤害比例领奖。三只 BOSS 按时间段轮换。`);
    if(t.boss){body.append(element('h3',`当前 BOSS · ${t.boss.name}`));text(`${t.boss.level}级 · 生命 ${t.boss.hpMax} · 攻击 ${t.boss.atkMin}-${t.boss.atkMax}`,body);}
    else text('试炼 BOSS 尚未就绪。');
    for(const b of t.bosses)text(`${b.fromHour} 点 – ${b.toHour} 点：${b.name||('怪物'+b.id)}${b.exists?'':'（未就绪）'}`);
    text(`今日剩余 ${t.challenge.left} / ${t.challenge.total} 次（已购 ${t.challenge.bought} 次） · 我的最高伤害 ${t.bestDamage}`);
    button('挑战（打完自动结算发奖）',async()=>{
     state=await wire(90020,{action:'trial-challenge'});render();dialog.close();World.toBattle(t.groupId);
    },body,!t.available||t.challenge.left<=0);
    button(`购买 1 次（${t.challenge.buyPrice} 黄金，今日还可买 ${t.challenge.buyLeft} 次）`,()=>action({action:'trial-buy'}),body,t.challenge.buyLeft<=0);
    body.append(element('h3','奖励档位'));
    for(const r of t.rewards)text(`${r.label}：${itemText(r.items)}`);
    if(t.rankInfo.length)for(const row of t.rankInfo)text(`我的排名：第 ${row.rank} 名 · 伤害 ${row.hurt}`);
   }else if(current==='mail'){text('当前本地收件箱为空。录制中的其他玩家来信不会复制到本地角色。附件投递机制待补，福利请在“福利”中领取。');button('福利',()=>open('welfare'));}
   else if(current==='country'){button('个人城市',()=>{dialog.close();document.getElementById('city-open').click();});}
   else if(current==='buddy'){button('打开军团',()=>{dialog.close();main?.onTapLegion();});}
   if(entry?.pending)text('待补：相关操作不会扣除货币、道具或次数。');
  }
  async function preview(id){
   const token=++generation;status.textContent='正在读取怪物属性…';const r=await fetch('/api/tower-preview?id='+id);if(!r.ok)throw Error('怪物属性尚未采集。');const p=await r.json();if(token!==generation||activeRole!==World.myPlayer?.id)return;
   body.replaceChildren();title.textContent=`永泽塔 · 关卡 ${id}`;button('返回塔层目录',()=>open('tower'));text('以下数值来自该关卡实际预览回包。塔怪技能与AI待补（只会普攻），编队已可正常开战。');
   const fields={level:'等级',hpMax:'生命',mpMax:'法力',speed:'速度',atkType:'攻击类型',atkMin:'最小攻击',atkMax:'最大攻击',atk_time:'攻击次数',atk_str:'劈砍伤害',atk_agi:'穿刺伤害',atk_magic:'魔法伤害',def_str:'劈砍防御',def_agi:'穿刺防御',def_magic:'魔法防御',hitrate:'物理命中',hitMagic:'魔法命中',dodge:'闪避',critical:'致命',wil:'意志',tough:'韧性',block:'格挡',insight:'洞察',brkArmor:'破甲',magic_penetration:'魔法穿透',def_field:'伤害减免',life_absorption:'生命吸取',mana_absorption:'法力吸取'};
   for(const m of p.monsters){body.append(element('h3',`${m.name} · ${m.id}`));const table=element('dl');table.className='home-stats';for(const [key,label]of Object.entries(fields)){table.append(element('dt',label),element('dd',m[key]??'未下发'));}body.append(table);}
   status.textContent='';
  }
  async function open(key='notice'){
   const token=++generation,p=World.myPlayer;if(!p?.id)return;activeRole=p.id;current=key;body.replaceChildren();status.textContent='正在读取角色状态…';document.getElementById('offline-panel').classList.remove('open');if(!dialog.open)dialog.showModal();
   try{const next=await wire(90019);if(token!==generation)return;state=next;render();status.textContent='';}catch(e){if(token===generation)status.textContent=e.message;}
  }
  function route(key,mdr){
   if(busy)return;main=mdr||main;dialog.close();document.getElementById('offline-panel').classList.remove('open');
   if(native[key]&&main)return native[key].call(main);
   if(key==='charge'||key==='special')return UI.createChargeUI(key==='special'?2:0);
   if(key==='tower')return UI.showWin(req(0).ModName.Tower,req(0).TowerViewType.TowerMain);
   if(key==='shop')return UI.showWin(req(0).ModName.Shop,req(0).ShopViewType.ShopVIPMain);
   if(key==='map')return req(197).default.Instance.doEnterWorldMap();
   return open(key);
  }
  function visible(mdr){main=mdr;const v=mdr._view;if(!v)return;if(v.grp_act)v.grp_act.visible=true;for(const [key,id]of Object.entries(buttons)){const b=v[key];if(!b)continue;b.visible=b.includeInLayout=b.enabled=true;b.mandatory=false;if(b.lock)b.lock.visible=false;if(b.hint)b.hint.visible=false;if(b.label!==names[id])b.label=names[id];}hideRemoved(v);}
  // 把 removedButtons / removedGroups 里的元素钉成不可见、不参与布局、不接收点击。
  function hideRemoved(v){
   for(const key of removedButtons){const b=v[key];if(!b)continue;b.visible=false;b.includeInLayout=false;b.touchEnabled=false;b.enabled=false;}
   for(const key of removedGroups){const g=v[key];if(!g)continue;g.visible=false;g.includeInLayout=false;g.touchEnabled=false;}
  }
  // onShowCampWar / onShowSailing / onSevenDay / onConquerBoss / dealIcon / updateAllIcon
  // 都会把活动图标设成可见（多数走 GUtil.setLayout），而 addLevelOpenButton / levelOpenButton
  // 会按等级开放状态重设 btnMail 等图标，所以它们之后都要再重新隐藏一遍。
  for(const method of ['onInit','onShow','updateIcon','updateChargeBtn','onBulkInfo','onShowBuddy','updateOpenLevel','onShowCampWar','onShowSailing','onSevenDay','onConquerBoss','dealIcon','updateAllIcon','addLevelOpenButton','levelOpenButton']){const original=Main[method];Main[method]=function(...args){const result=original?.apply(this,args);visible(this);return result;};}
  const setIcon=Main.setIconIncludeLayout;Main.setIconIncludeLayout=function(b,v,r){if(Object.keys(buttons).some(k=>this._view?.[k]===b)){b.mandatory=false;if(b.lock)b.lock.visible=false;return setIcon.call(this,b,true,false);}return setIcon.call(this,b,v,r);};
  const listeners=Main.addListeners;Main.addListeners=function(){listeners.call(this);for(const [key,id]of Object.entries(buttons)){const target=this._view[key];if(!target)continue;for(const h of [...(this.__egretHandler||[])])if(h.target===target&&h.type===egret.TouchEvent.TOUCH_TAP)this.offEgret(h.target,h.type,h.listener,h.thisObject);this.onEgret(target,egret.TouchEvent.TOUCH_TAP,()=>route(id,this),this);}};
  // 永泽塔：塔层编队是服务端按「23000 + 层号」现场生成的（lib/climb-tower.mjs 的 TOWER_GROUP_BASE），
  // 只在下一次 10503 世界数据里下发；而客户端原生收到 30004 后**没有任何模块**去进战斗
  // （TowerEvent.TowerChallenge 全客户端无人监听），所以要在这里补桥接：
  //   点「挑战/实战」→ 原生 sendClimbTowerChallenge 发 30003 → 服务端受理后回 30004 并把塔组随
  //   10503 一起下发 → World.addMonsterGroup 收到这一组时才调 World.toBattle 进战斗。
  // 与无限试炼（上面的 World.toBattle(t.groupId)）同一套做法，也和社区版注释一致。
  // ⚠️ 只有服务端**受理**时塔组才会经过 addMonsterGroup；被拒（次数用尽/未开放）只回 25003 错误
  //    提示，不会误进战斗 —— 所以触发条件是「收到塔组」，不是「发过请求」。
  const TOWER_GROUP_BASE=23000;
  const Tower=req(1500).default.prototype,nativeTowerChallenge=Tower.sendClimbTowerChallenge;
  let pendingTowerFloor=0;
  Tower.sendClimbTowerChallenge=function(floorId,type){
   const floor=Number(floorId)||0;pendingTowerFloor=floor;
   // 服务端拒绝时不推 10503，挂起标记要自己过期，免得之后的世界数据误触发。
   if(floor)setTimeout(()=>{if(pendingTowerFloor===floor)pendingTowerFloor=0;},10000);
   return nativeTowerChallenge.call(this,floorId,type);
  };
  const addMonsterGroup=World.addMonsterGroup;
  if(typeof addMonsterGroup==='function')World.addMonsterGroup=function(group){
   const result=addMonsterGroup.call(this,group);
   const groupId=Number(group?.groupId)||0;
   if(pendingTowerFloor&&groupId===TOWER_GROUP_BASE+pendingTowerFloor){
    const floor=pendingTowerFloor;pendingTowerFloor=0;
    // 下一帧再开战：现在还在解析 10503 的编队列表，就地开战会和读包打架。
    // 塔面板不用手动关 —— 战斗开始会走原版 ON_BATTLE_START → StartBattleCmd → closeAllUI。
    setTimeout(()=>World.toBattle(TOWER_GROUP_BASE+floor),0);
   }
   return result;
  };
  // Settlement applies and saves recovery on the service. Suppress the same
  // native presentation-side addition so a late callback cannot add it twice.
  const Player=req(56).default.prototype,getPower=Player.getBagEquipPowerValue,recover=World.handeBattleEndHp;let settling=false;
  Player.getBagEquipPowerValue=function(key,...args){return settling&&key===98?0:getPower.call(this,key,...args);};
  World.handeBattleEndHp=function(...args){settling=true;try{return recover.apply(this,args);}finally{settling=false;}};
  const menu=element('button','全部游戏功能');menu.id='home-features-open';menu.onclick=()=>open('notice');document.getElementById('panel-body').append(menu);button('已采集副本与地图',()=>open('dungeons'),document.getElementById('panel-body'));
  const api={open,route,preview,getSnapshot:()=>state,getMain:()=>main};window.offlineHomeFeatures=api;return api;
 };
})();
