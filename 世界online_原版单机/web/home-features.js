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
  /* ===== 无限试炼：直接打开原版「无限试炼」界面（第 78 版） =====
     移植参考实现「幻想世界OL 3.0 最终版」的 home-features.js。原版这个界面本来要靠一串
     C2S_FINAL_BOSS_* 协议驱动，本工程没接（见 lib/trial-challenge.mjs），所以做法是：
       · 把本地 90019 的 trial 数据直接塞进原版 FinalBossProxy._data.finalBossInfo；
       · 把门面里那几个「发协议」的方法（applyFinalBossInfo / Challenge / BuyTimes /
         SetPets / Rank / Record）整个换成本地 90020 的动作；
       · 伤害由客户端统计（原版战斗是本地算的），战斗结束（ON_BATTLE_END）用
         trial-settle 上报，服务端据此定档并刷新「我的最高伤害」。
     ⚠️ 原版 onShow 会 await applyFinalBossInfo()，必须连它一起换掉，否则塞进去的
        finalBossInfo 会被那次协议回包冲掉（我们也没有这个协议）。
     ⚠️ 原版 addPet/delPet 会对编队里的宠物 id 调 .eq()，只能塞宠物模型上的真 Long
        （见 trialPetRefs），塞字符串进去当场 TypeError。
     原版界面打不开时（拿不到门面）退回下面那套自画面板，不影响开战。 */
  const Facade=req(3).default,Mod=req(0),FBEvent=req(2).FinalBossEvent,BattleEvent=req(2).BattleEvent;
  let trialGroupId=0,trialPendingGroup=0,trialInBattle=false,trialDamageTotal=0,trialProxy=null,trialSnapshot=null;
  const trialIdText=v=>{try{return v&&typeof v.toNumber==='function'?String(v.toNumber()):String(v??'');}catch(e){return '';}};
  const trialAlert=message=>{try{if(UI.alertMessage)UI.alertMessage(message);else alert(message);}catch(e){try{alert(message);}catch(x){}}};
  /** 编队槽位给原版用：把存下来的字符串 id 换回宠物模型上的真 Long。 */
  function trialPetRefs(ids){
   const out=[];
   try{
    const pets=Facade.getProxy(Mod.ModName.Pet,Mod.ProxyType.Pet);
    for(const id of Array.isArray(ids)?ids:[]){
     const pet=pets&&pets.getMyPetById(id);
     if(pet&&pet.petItem&&pet.petItem.petId)out.push(pet.petItem.petId);
    }
   }catch(e){}
   return out;
  }
  const trialItemClass=(function findItemClass(){
   for(let id=0;id<900;id++){
    let mod;try{mod=req(id);}catch(e){continue;}
    if(!mod||typeof mod!=='object')continue;
    for(const key of Object.keys(mod)){
     const C=mod[key];
     if(C&&C.prototype&&typeof C.prototype.getNameInfo==='function'
        &&typeof C.prototype.getIsItemPetEquip==='function'
        &&typeof C.prototype.getIconString==='function')return C;
    }
   }
   return null;
  })();
  // 奖励格对长名/特殊字符不稳（实机长名会空白），所以留一张短名表兜底。
  const trialRewardNames={100897:'周年礼盒',40006:'宠物经验',40007:'人物经验',40002:'指令书'};
  function makeTrialRewardItem(x){
   const name=trialRewardNames[x.id]||x.name||('物品'+x.id);
   if(trialItemClass)try{
    const it=new trialItemClass();
    it.id=x.id;it.name=name;it.bagIcon=x.bagIcon;it.type=x.type;it.quantity=x.quantity;
    // grade 是「品质底图」的下标（原版 p[grade]，0..6），越界会让底图 source 变 undefined。
    it.grade=Math.max(0,Math.min(6,Number(x.grade)||0));it.star=0;it.attachDone=0;it.petLevel=0;
    it.enchantPower1=0;it.enchantPower2=0;
    it.info=x.name||'';
    // 原版物品类的 getNameInfo 从配置表取名（奖励格会空白/乱码），这里按服务端下发的名字答。
    it.getNameInfo=function(){return String(this.name||('物品'+this.id));};
    it.getIconString=it.getIconString||function(){return '';};
    return it;
   }catch(e){console.warn('[无限试炼] 物品类实例化失败，退回普通对象',e);}
   return {id:x.id,name,bagIcon:x.bagIcon,type:x.type,quantity:x.quantity,
    grade:Math.max(0,Math.min(6,Number(x.grade)||0)),star:0,
    attachDone:0,petLevel:0,enchantPower1:0,enchantPower2:0,isUpgradeItem:false,
    isVipItem(){return false;},getIsItemPetEquip(){return false;},doViewItem(){},
    getIconString(){return '';},getNameInfo(){return this.name;}};
  }
  // icon1 在原版里是 Long（Tool.getHeadIcon2 调 .toNumber()）；rank 是 0 基（条目自己 +1 显示）。
  const trialLongLike=v=>({toNumber:()=>Number(v)||0});
  /** 本地 trial 数据 → 原版 finalBossInfo（字段名对齐客户端 FinalBossMdr.updateView）。 */
  function buildTrialInfo(t){
   const rankInfo=(t.rankInfo||[]).map((r,i)=>({rank:i,actorId:r.actorId,name:r.name||'我',
    power:Number(r.power)||0,hurt:Number(r.hurt)||0,icon1:trialLongLike(r.icon1)}));
   const reward=[],seen=new Set();
   for(const tier of (t.rewards||[]))for(const x of (tier&&tier.items)||[]){
    const key=x.id+'_'+x.quantity;
    if(seen.has(key))continue;seen.add(key);reward.push(makeTrialRewardItem(x));
   }
   return {name:(t.boss&&t.boss.name)||t.name||'无限试炼',icon:Number((t.boss&&t.boss.icon1)||0)||0,
    maxHurt:Number(t.bestDamage)||0,fightTimes:Number(t.challenge&&t.challenge.left)||0,
    sumTimes:Number(t.challenge&&t.challenge.total)||1,petIds:trialPetRefs(t.pets),rankInfo,reward};
  }
  async function trialRefreshInfo(){
   const d=await wire(90019);
   if(d&&d.trial){trialSnapshot=d.trial;if(trialProxy&&trialProxy._data)trialProxy._data.finalBossInfo=buildTrialInfo(d.trial);}
   return d;
  }
  /** 原版排行榜/记录两页：数据也由我们本地供（原版协议同样没接）。 */
  function trialRankRows(){
   const info=(trialProxy&&trialProxy._data&&trialProxy._data.finalBossInfo)||{};
   const rows=(info.rankInfo||[]).slice();
   const me=World.myPlayer,myId=me&&(typeof me.getId==='function'?me.getId():me.id);
   // 原版 onShow 要在列表里找到自己，找不到就去 new pb.FinalBossRankInfo（本工程没有 pb 全局），
   // 所以一律把自己那行补进去（rank=-1 时条目会按「未上榜」渲染）。
   if(me&&!rows.some(r=>Number(r.actorId)===Number(myId)))rows.push({rank:-1,actorId:myId,
    name:me.name||'我',power:Number(me.combatPoint)||0,hurt:Number(info.maxHurt)||0,icon1:trialLongLike(me.icon1)});
   return rows;
  }
  function trialRecordRows(){
   const list=trialSnapshot&&Array.isArray(trialSnapshot.history)?trialSnapshot.history:[];
   return list.map(r=>({hurt:Number(r.hurt)||0,fightPower:Number(r.fightPower)||0,
    time:{toNumber:()=>Number(r.time)||0},info:[]}));
  }
  /** 门面那几个「发协议」的方法整体换成本地 90020。 */
  function trialInstallProxy(FB){
   trialProxy=FB;
   FB.applyFinalBossInfo=async()=>({});   // onShow 里那次协议请求：拦掉，不然塞进去的数据被冲掉
   FB.applyChallenge=async()=>{
    try{
     // 每次挑战都从干净起点统计（上一场的残留不能算进这一场）。
     trialDamageTotal=0;trialInBattle=false;trialPendingGroup=trialGroupId;
     // ⚠️ 服务端在 90020 回包**之前**就推了 10503（带试炼组），所以挂起标记必须先设好：
     //    下面 addMonsterGroup 的桥就靠它认领「收到试炼组 → 开战」。
     const d=await wire(90020,{action:'trial-challenge'});
     if(!(Number(d&&d.trialEnterBattle)||trialGroupId))throw Error('未取得战斗组。');
    }catch(e){trialPendingGroup=0;trialAlert('挑战失败：'+e.message);}
   };
   FB.applyBuyTimes=async()=>{
    try{
     await wire(90020,{action:'trial-buy'});
     await trialRefreshInfo();
     if(FBEvent&&Facade.sendNt){Facade.sendNt(FBEvent.OnGotBuyTimes);Facade.sendNt(FBEvent.OnGotInfo);}
    }catch(e){trialAlert('购买次数失败：'+e.message);}
   };
   FB.applySetPets=async()=>{
    try{
     const pets=(FB._data.petsConfig||[]).map(trialIdText).filter(Boolean);
     const d=await wire(90020,{action:'trial-config',pets});
     if(d&&d.trial)FB._data.finalBossInfo=buildTrialInfo(d.trial);
     if(FBEvent&&Facade.sendNt)Facade.sendNt(FBEvent.OnGotPetIds);
    }catch(e){trialAlert('编队保存失败：'+e.message);}
   };
   FB.applyRank=async()=>({rankInfo:trialRankRows()});
   FB.applyRecord=async()=>({info:trialRecordRows()});
  }
  /* 伤害统计：原版战斗本地算，只有这里能拿到数字。
     dmg[0] 是对目标造成的（正）伤害；我方 = 玩家/宠物/伙伴/军团，敌方 = 非我方。
     战斗单位类是按需加载的，所以进战斗前要再补装一次（ensureTrialDamageHook）。 */
  function ensureTrialDamageHook(){
   for(let id=0;id<900;id++){
    let mod;try{mod=req(id);}catch(e){continue;}
    if(!mod||typeof mod!=='object')continue;
    for(const key of Object.keys(mod)){
     const C=mod[key];
     if(!C||!C.prototype||typeof C.prototype.delDamageEffect!=='function')continue;
     if(C.prototype.__trialDamageHooked)continue;
     const original=C.prototype.delDamageEffect;
     C.prototype.delDamageEffect=function(dmg,attacker,target){
      try{
       if(trialInBattle&&dmg&&attacker&&target){
        const value=Number(dmg[0]||0);
        const mine=t=>t&&(t.getType&&(t.getType()===3||t.getType()===4||t.getType()===5||t.getType()===10||t.getType()===11)||t.isMyPlayer);
        if(value>0&&mine(attacker)&&!mine(target))trialDamageTotal+=value;
       }
      }catch(e){/* 统计失败不影响战斗 */}
      return original.apply(this,arguments);
     };
     C.prototype.__trialDamageHooked=true;
    }
   }
  }
  ensureTrialDamageHook();
  if(BattleEvent&&typeof Facade.onNt==='function')Facade.onNt(BattleEvent.ON_BATTLE_END,()=>{
   const damage=trialDamageTotal;trialDamageTotal=0;
   if(!trialInBattle)return;
   trialInBattle=false;
   // 这里只报「打出了多少伤害」：打赢的那份奖励 12502 已经在服务端发过了，
   // 服务端用 state.awarded 做闸门，两条路先到的发、后到的只更新记录。
   wire(90020,{action:'trial-settle',damage,victory:false}).then(d=>{
    const report=(d&&d.trialReport)||{},granted=Number(report.granted)||0;
    trialAlert('本次对 BOSS 造成 '+damage+' 伤害'+(report.tier?('（'+report.tier+'）'):'')+(granted?('，获得 '+granted+' 件奖励。'):'。'));
   }).catch(e=>trialAlert('试炼结算失败：'+e.message));
  });
  /* 「+」按钮**不用重绑**：原版 onTapBuyTimes 自己会调 this._proxy.applyBuyTimes()，
     而那个方法已经被我们换成本地动作了（重绑反而会一次点击买两次）。
     原版逻辑是「还有剩余次数就先提示、买不了」，这里照抄保留；只保证按钮本身可见可点。
     买完由 OnGotBuyTimes 通知原版 updateLeftTimes 刷新 x/y。 */
  function ensureTrialBuyButton(){
   try{
    const mod=Facade.getMod(Mod.ModName.FinalBoss),mdr=mod&&mod.__mdrIns&&mod.__mdrIns[Mod.FinalBossViewType.Main];
    const btn=mdr&&mdr._view&&mdr._view.btn_buyTimes;
    if(!btn)return;
    btn.visible=true;btn.enabled=true;btn.touchEnabled=true;btn.alpha=1;
   }catch(e){console.warn('[无限试炼] 取购买按钮失败',e);}
  }
  /** 打开原版「无限试炼」界面；false = 打不开，调用方退回自画面板。 */
  async function openTrialNative(){
   const data=await wire(90019),t=data&&data.trial;
   if(!t){status.textContent='试炼数据不可用。';return false;}
   trialSnapshot=t;trialGroupId=Number(t.groupId)||0;
   if(!t.boss){
    trialAlert('当前时段的试炼 BOSS 还没就绪（'+(t.bosses||[]).filter(b=>!b.exists).map(b=>b.id+' '+b.name).join('、')+'）。');
    return false;
   }
   let FB=null;
   try{FB=Facade.getProxy(Mod.ModName.FinalBoss,Mod.ProxyType.FinalBoss);}catch(e){FB=null;}
   if(!FB||!FB._data){trialAlert('打不开原版「无限试炼」界面（取不到 FinalBossProxy），改用单机面板。');return false;}
   FB._data.finalBossInfo=buildTrialInfo(t);
   trialInstallProxy(FB);
   ensureTrialDamageHook();
   if(dialog.open)dialog.close();
   UI.showWin(Mod.ModName.FinalBoss,Mod.FinalBossViewType.Main);
   ensureTrialBuyButton();
   return true;
  }
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
     // 备用入口：直接 World.toBattle（不走 addMonsterGroup 桥，所以不设 trialPendingGroup），
     // 但要把「这一场在统计」的标记打开，战斗结束好把真实伤害上报定档。
     state=await wire(90020,{action:'trial-challenge'});
     trialDamageTotal=0;trialInBattle=true;trialPendingGroup=0;ensureTrialDamageHook();
     render();dialog.close();World.toBattle(t.groupId);
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
   // 试炼：优先打开**原版**「无限试炼」界面（第 78 版）；打不开时退回下面这套自画面板。
   if(key==='trial'){
    try{if(await openTrialNative())return;}
    catch(e){status.textContent='打开无限试炼界面失败：'+e.message;}
   }
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
   // 无限试炼（第 78 版）：挑战时服务端把试炼组随 10503 下发，收到这一组才开战。
   if(trialPendingGroup&&groupId===trialPendingGroup){
    const gid=trialPendingGroup;trialPendingGroup=0;
    trialInBattle=true;trialDamageTotal=0;
    ensureTrialDamageHook();   // 战斗单位类此刻必然已加载，补装一次更稳
    let fighting=false;try{fighting=!!req(54).default.ins.isFight;}catch(e){}
    if(!fighting)setTimeout(()=>{try{World.toBattle(gid);}catch(e){trialAlert('进入战斗失败：'+e.message);}},0);
   }
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
