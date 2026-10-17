(() => {
  'use strict';
  const logs=[];
  const status=document.getElementById('offline-status');
  function record(message,error=false){
    const entry=`${new Date().toLocaleTimeString()} ${message}`; logs.push(entry); if(logs.length>80)logs.shift();
    document.getElementById('offline-log').textContent=logs.join('\n');
    if(error){status.textContent=message; document.getElementById('offline-panel').classList.add('open');}
    fetch('/api/client-log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message,error})}).catch(()=>{});
  }
  window.addEventListener('error',e=>record(`${e.message || '资源加载失败'} ${e.filename || ''}:${e.lineno || ''}`,true));
  window.addEventListener('unhandledrejection',e=>record(String(e.reason?.stack || e.reason),true));
  document.getElementById('panel-toggle').onclick=()=>document.getElementById('offline-panel').classList.toggle('open');
  window.offlineBootSettings=()=>{
    const fromQuery=new URLSearchParams(location.search).get('save');
    let account=fromQuery||'offline';
    // 没在 URL 里点明存档名时，跟随存档里已有的账号。
    // 随包存档和自己导入的存档未必是按 offline 建的（qa-v05-saves 用的是
    // xia-v05-qa / pet-v05-qa）。写死 offline 会匹配不上账号，服务端就会新建
    // 一个空账号，表现为「存档导进去了，但一个角色都没有」。
    if(!fromQuery&&window.__worldolStandalone){
      try{
        const raw=window.__worldolStandalone.readText('/saves/world.json');
        if(raw){
          const saved=JSON.parse(raw);
          const accounts=Array.isArray(saved.accounts)?saved.accounts:[];
          const characters=Array.isArray(saved.characters)?saved.characters:[];
          const owner=accounts.find(a=>characters.some(c=>c.accountId===a.id));
          const pick=owner||accounts[0];
          if(pick&&pick.name)account=pick.name;
        }
      }catch(error){/* 读不到就用默认值，不影响启动 */}
    }
    Object.assign(window.go,{host:'ws://127.0.0.1',port:location.port,wsurl:`ws://127.0.0.1:${location.port}/game`,res_version:305,dbg:'1',account,apiUrl:location.origin,cdn_url:'',subchannel:'offline'});
    document.getElementById('save-name').textContent=account;
  };
  window.offlineInstall=()=>{
    window.installOfflineViewport(window.egret);
    const req=window.__worldReq;
    window.installOfflineRoleSlots(req);
    window.installOfflineSystemSettings(req);
    // 美容院本地造型道具（原版号段：发型 40100–40199 / 脸型 40200–40249，本地只用
    // 40101–40129 / 40201–40214）：道具编号本身就是图标图集 fashion_icon 的子键，
    // 资源清单里已经挂好（见 lib/fashion-icons.mjs），图集就绪时直接显示那一款发型/脸型，
    // 没就绪就退回客户端自带的问号图，保证列表不会出现空白图标。
    const fashionItemIds=id=>Number.isInteger(id)&&((id>=40101&&id<=40129)||(id>=40201&&id<=40214));
    // 图集里每件造型道具都有两张帧：「<编号>」是男性、「<编号>f」是女性。
    // 每张都是「脸型碎片 + 发型碎片」叠出来的头像，和角色穿在身上的样子同源，
    // 不再是孤零零的一撮头发（那才是「图标和实际表现对不上」的原因）。
    // 角色渲染时按 icon1 的性别位（OFFSET_SEX=0、LEN_SEX=1）取自己那一半碎片，
    // 图标也跟着取，免得女角色看到男款。图集没就绪时依次退回另一性别、再退回问号图。
    const playerIsFemale=()=>{const player=req(5).default.myPlayer;return !!player&&((Number(player.icon1?.low)||0)&1)===1;};
    const fashionTool=req(8).Tool,getIconByData=fashionTool.getIconByData;
    fashionTool.getIconByData=function(item){
      if(item&&fashionItemIds(item.itemId)){
        const base=String(item.bagIcon),name=playerIsFemale()?base+'f':base;
        for(const candidate of [name,base]){
          try{if(req(132).default.getRes(candidate))return candidate;}catch(error){/* 图集没就绪就换下一个 */}
        }
        return 'common_icon_wenhao2';
      }
      return getIconByData.call(this,item);
    };
    window.installOfflinePetSnapshotVitals(req(42).default,req(12).ModelConst,window.offlinePetSnapshotProfiles||{});
    const characterFeatures=window.installCharacterFeatures(req);
    const legion=window.installOfflineLegion(req);
    if(legion.revision)record('军团手动指令已载入：'+legion.revision);
    const Message=req(22).Message;
    // Both daily pages have local data. Their visibility must not depend on
    // temporary online activity registrations, including after red-dot updates.
    const dailyActivity=req(45).default.getInstance,dailyTypes=req(38).ActType,getActivityRed=dailyActivity.getTypeRed;
    dailyActivity.getTypeRed=function(types){
      const result=getActivityRed.call(this,types);
      if(types.includes(dailyTypes.DAILY_GAME)||types.includes(dailyTypes.ACTIVITY_VITALIY))result.isShow=true;
      return result;
    };
    // The local acknowledgement carries the complete rotation so expanding an
    // empty/full old slot list also updates the native checkboxes immediately.
    req(57).default.doSetAutoSkillCb=function(player,skill,enabled,message){
      const body=message.body;if(!body)return;
      if(body.getByte()<0)req(1).default.alertMessage(body.getString(),req(10).GameText.getText(req(10).GameText.TI_ERROR));
      else{player.autoSkillID=[];for(let n=body.getByte();n>0;n--)player.autoSkillID.push(body.getShort());}
      req(3).default.sendNt(req(2).SkillEvent.DO_SET_AUTO_SKILL);
    };
    window.installDailyTaskReset(req);
    let battleToken=0;
    function flushPosition(){
      const world=req(5).default,p=world.myPlayer;
      if(!p?.id||req(54).default.ins.isFight)return;
      const scene=req(3).default.getProxy(req(0).ModName.Scene,req(0).ProxyType.Scene);
      scene?.createMoveMessage(p.getGx(),p.getGy());
    }
    // Keep all original message parsers; replace only the remote wire envelope.
    const encode=msg=>{
      // Original movement batches can omit the final few tiles before NPC interaction.
      if([10506,14501,14502,14503,14504,12501].includes(msg.type))flushPosition();
      // Egret putBytes reserves extra capacity; battle plans may leave zero padding.
      const payload=msg.type===12502&&msg.ba?msg.bytes.subarray(0,msg.ba.position):msg.bytes;
      const pet=msg.type===12502&&payload[20]?req(5).default.myPlayer?.getPet():null;
      const army=msg.type===12502?legion.battleResult():[];
      const extra=msg.type===12502?11+(pet?8:0)+(army.length?5+army.reduce((n,a)=>n+13+(a.petHP!==undefined?8:0),0):0):0;
      const data=new Uint8Array(4+payload.length+extra); const view=new DataView(data.buffer);view.setInt32(0,msg.type); data.set(payload,4);
      if(extra){
        const battle=req(54).default.ins.battle;let at=4+payload.length;
        view.setInt32(at,0x4f4c3033);at+=4;view.setInt32(at,battleToken);at+=4;
        view.setInt8(at++,battle?.result||0);view.setUint16(at,battle?.round||0);at+=2;
        if(pet){view.setInt32(at,pet.hp);at+=4;view.setInt32(at,pet.mp);at+=4;}
        if(army.length){view.setInt32(at,0x4c454731);at+=4;view.setInt8(at++,army.length);for(const a of army){view.setInt32(at,a.id);at+=4;view.setInt32(at,a.hp);at+=4;view.setInt32(at,a.mp);at+=4;view.setInt8(at++,a.petHP!==undefined?1:0);if(a.petHP!==undefined){view.setInt32(at,a.petHP);at+=4;view.setInt32(at,a.petMP);at+=4;}}}
      }
      record(`发送 ${msg.type} (${payload.length} 字节)`);
      return data;
    };
    const decode=buffer=>{
      const view=new DataView(buffer); const type=view.getInt32(0);
      if(type===12501&&view.getInt8(4)===0)battleToken=view.getInt32(5);
      record(`接收 ${type} (${buffer.byteLength-4} 字节)`);
      if(type===5002)status.textContent='本地账号已就绪，可选择角色。';
      if(type===2)status.textContent='角色数据已载入，进度自动保存在本机。';
      return new Message(type,new Uint8Array(buffer.slice(4)));
    };
    Object.defineProperty(gg,'encodeMsg',{configurable:true,get:()=>encode,set:()=>{}});
    Object.defineProperty(gg,'decodeMsg',{configurable:true,get:()=>decode,set:()=>{}});
    // 公告富文本：applyNotice 的返回值会经模块 0014 parseHtml -> 0008 convertDescToTextFlow，
    // 这套解析只认游戏自身的颜色标记，不认 HTML —— /cRRGGBB 开始着色，/p 结束着色。
    // 规则：颜色必须是 6 位十六进制；每段着色都要用 /p 收尾，否则颜色会串到后面的文字；
    // 不要写 <font>/<color> 之类的标签，手机上会原样显示成"特殊字符"。
    // 常用配色：FFD700 金黄(标题) / 00FF00 绿(强调) / 87CEEB 天蓝(说明) / FF6666 红(警示) / FFFFFF 白(正文)
    req(360).default.prototype.applyNotice=async()=>[
      "/cFFD700世界OL · 单机版/p",
      "",
      "/cFFFFFF一个人的世界，也有无限的冒险。/p",
      "/cFFFFFF重温熟悉的地图，培养心爱的宠物，打造属于自己的装备与阵容。/p",
      "/cFFFFFF不赶进度，自在探索，让每一次出发都由自己决定。/p",
      "",
      "/cFFD700★ 本次更新 ★/p",
      "",
      "/c00FF00【角色】/p",
      "/cFFFFFF1、显著降低了升级所需的经验。/p",
      "/cFFFFFF2、属性点可自由重新分配。/p",
      "",
      "/c00FF00【宠物】/p",
      "/cFFFFFF1、商店可直接购买宠物蛋，开启即为 90 级。/p",
      "/cFFFFFF2、支持遗忘宠物技能，也可以「放弃一级」逐级降下来，降到 1 级再点一次即为完全遗忘。/p",
      "/cFFFFFF3、封印宠物默认获得该宠物的全部技能书。/p",
      "/cFFFFFF4、宠物可以改名了：宠物面板的「改名」现在真的能用，战斗中也能改。/p",
      "/cFFFFFF5、「装备与补给商人」-「技能书」改为出售宠物训练师教不到的那些宠物满级技能书；训练师能教的直接找训练师免费学，不再重复上架。/p",
      "",
      "/c00FF00【装备与道具】/p",
      "/cFFFFFF1、装备鉴定词条取最高数值。/p",
      "/cFFFFFF2、宝石镶嵌保底次数调整为 30 次。/p",
      "/cFFFFFF3、新增一键强化与一键镶嵌宝石。/p",
      "/cFFFFFF4、消耗品新增 50 级「魔力衰竭」、8 级「骑士奉献」。/p",
      "/cFFFFFF5、灵符宝箱固定开出 12 级玄阶。/p",
      "/cFFFFFF6、取消物品一次只能开一个的限制，可批量使用。/p",
      "/cFFFFFF7、恢复原版 +4 宝石，并恢复宝石替换功能。/p",
      "/cFFFFFF8、新增单手剑「无视装备穿戴要求」：五维各 +3000，穿上即可满足任何装备穿戴需求，脱下立即恢复。/p",
      "/cFFFFFF9、新增「一键满级」经验卷，在新月繁华之都商人的「消耗品」处购买。/p",
      "",
      "/c00FF00【技能】/p",
      "/cFFFFFF1、侠客「赤练神掌」、「飘雪穿云掌」解除绑定状态。/p",
      "/cFFFFFF2、人物与宠物支持一键学满技能。/p",
      "/cFFFFFF3、完善国家专属技能所，任意技能所均可学习「防御战术（劈砍）」「防御战术（穿刺）」。/p",
      "/cFFFFFF4、优化了部分职业的技能效果。/p",
      "",
      "/c00FF00【外观】/p",
      "/cFFFFFF1、更换装备后角色列表同步刷新。/p",
      "/cFFFFFF2、支持宠物、时装、坐骑与武器幻化。/p",
      "/cFFFFFF3、伤害字体替换为官服原版。/p",
      "/cFFFFFF4、新月繁华之都「美容院」可更换发型与脸型。/p",
      "",
      "/c00FF00【玩法】/p",
      "/cFFFFFF1、降低了打怪掉落概率。/p",
      "/cFFFFFF2、新建角色默认关闭游戏音乐（旧存档不适用）。/p",
      "/cFFFFFF3、战斗失败可原地复活。/p",
      "/cFFFFFF4、战斗倍速固定为 1 / 3 / 5 倍，不再随自动、手动战斗的切换而改变。/p",
      "/cFFFFFF5、补齐原版全部称号，可在「主城」-「成就」中查看。/p",
      "/cFFFFFF6、每回合待机时间调整为 180 秒。/p",
      "/cFFFFFF7、地图「boss 直达」可直接挑战所有千万血量 boss，入口在风雪之城 NPC「小白」处。/p",
      "",
      "/cFFD700★ 问题修复 ★/p",
      "/cFFFFFF1、修复附灵符无法卖出的问题。/p",
      "/cFFFFFF2、修正「创角角色」等文案。/p",
      "/cFFFFFF3、修复改名卷轴无法正常改名的问题。/p",
      "/cFFFFFF4、修复角色无法删除的问题。/p",
      "/cFFFFFF5、修复军团宠物技能释放错位，骑士奉献、抵挡伤害等现已正常表现。/p",
      "/cFFFFFF6、修复装备「进阶鉴定」报错，可正常进阶鉴定与强化。/p",
      "/cFFFFFF7、修复军团队长阵亡后直接判定战斗失败的问题。/p",
      "/cFFFFFF8、修复军团队友的宠物无法替人物抵挡伤害的问题。/p",
      "/cFFFFFF9、修复「天魔惊神戒指」技能叠加不正确的问题。/p",
      "/cFFFFFF10、修复清除增益的群体祝福对幻影怪不生效的问题。/p",
      "",
      "/c00FF00再次感谢每一位为游戏作出贡献的玩家！/p",
      "",
      "/cFFD700【严禁商用】/p",
      "/c00FF00本版本仅供个人单机体验与学习交流。/p",
      "/c00FF00禁止售卖、付费传播、收费运营及其他商业用途。/p",
      "",
      "/c87CEEB请尊重原作与创作者，珍惜交流成果。/p",
      "/c87CEEB祝各位冒险者游戏愉快！/p",
    ].join('\n');
    // Temporary unarmed damage for the local tutorial; equipped weapon values stay native.
    const Player=req(56).default, originalGet=Player.prototype.get;
    Player.MAX_LEARN_SKILL_SIZE=100;
    Player.prototype.get=function(key){const value=originalGet.call(this,key);return (this===req(5).default.myPlayer||this._offlineLegionActorId)&&value<=0&&(key===73||key===74)?(key===73?12:18):value;};
    // 修复角色外观和角色列表不同步
    const baseFaces=new WeakMap(), appearanceSyncState=new WeakMap(), model=req(12).ModelConst, updateIcon=Player.prototype.updateIcon; const syncAppearance=player=>{ if(!player?.id || player!==req(5).default.myPlayer) return; const icons=[ player.icon1, player.icon2, player.icon3 ].map(icon=>icon?.toString?.()??String(icon)); const key=icons.join('/'); 
    if(appearanceSyncState.get(player)===key) return; appearanceSyncState.set(player,key); const m=new Message(90022); m.putInt(player.id); m.putLong(player.icon1); m.putLong(player.icon2); m.putLong(player.icon3); req(35).default.sendProtoAsync(m).catch(()=>{}); };
    const faceLowMask=(model.LEN_HAIR_STYLE<<model.OFFSET_HAIR_STYLE)|(model.LEN_HAIR_COLOR<<model.OFFSET_HAIR_COLOR)|(model.LEN_FACE_STYLE<<model.OFFSET_FACE_STYLE);
    const faceHighMask=(model.LEN_HAIR_ADD<<model.OFFSET_HAIR_ADD)|(model.LEN_FACE_ADD<<model.OFFSET_FACE_ADD);
    Player.prototype.updateIcon=function(){
      if(!baseFaces.has(this))baseFaces.set(this,{low:this.icon1.low,high:this.icon1.high});
      const base=baseFaces.get(this);
      // Fashion overwrites hair/face in-place; start each rebuild from the saved
      // base so removing a costume restores the character's own appearance.
      this.icon1.low=(this.icon1.low&~faceLowMask)|(base.low&faceLowMask);
      this.icon1.high=(this.icon1.high&~faceHighMask)|(base.high&faceHighMask);
      const result=updateIcon.call(this),fashion=this.bag?.getItem(3);
      // Captured item 15209 explicitly requires a bald hairstyle. Native style
      // 16 means no hair layer; keep this local cosmetic change out of saves.
      if(fashion?.id===15209&&(!fashion.isTimeItem()||!fashion.isExpired())){
        this.icon1.low&=~((model.LEN_HAIR_STYLE<<model.OFFSET_HAIR_STYLE)|(model.LEN_HAIR_COLOR<<model.OFFSET_HAIR_COLOR));
        this.icon1.high=(this.icon1.high&~(model.LEN_HAIR_ADD<<model.OFFSET_HAIR_ADD))|(1<<model.OFFSET_HAIR_ADD);
      }
      syncAppearance(this);
      return result;
    };
    // 美容院的造型道具走的正是原版这条链路：购买回包状态位 2 时客户端调
    // updateHair / updateFace 改写自己的 icon1，商店列表的「点选预览」
    //（ModelTool.getCompareSprite）也是同一条路。
    // 但上面那个 baseFaces 基准是「角色自己的发型/脸型」，updateIcon() 每轮都会把
    // icon1 还原成它——于是刚写进去的新造型被立刻抹掉，表现就是「脱掉时装后点选
    // 发型/脸型，右边的角色预览一动不动」。所以基准必须跟着造型一起走。
    const rememberFaceBase=self=>{const base=baseFaces.get(self);if(base){base.low=self.icon1.low;base.high=self.icon1.high;}};
    for(const name of ['updateHair','updateFace']){
      const original=Player.prototype[name];
      Player.prototype[name]=function(item){const result=original.call(this,item);rememberFaceBase(this);return result;};
    }
    const Country=req(1001).default,preLevel=Country.prototype.getPreLevel;
    Country.prototype.getPreLevel=function(){return this.gameConfig?.length?preLevel.call(this):0;};
    // The original pay-feature switch also gates ordinary NPC shops. Route only
    // our local copper shop through its preserved native screen.
    const World=req(5).default,browseShop=World.doBrowseShop;
    const careerTeachers=window.installCareerTeachers(req);
    window.installEquipmentWorkshop?.(req);
    window.installPetEquipment?.(req);
    window.installSpiritSeals?.(req);
    const recordedContent=window.installRecordedContent(req);
    const composition=window.installEquipmentComposition(req);
    window.installNativeVip(req);
    window.installHomeFeatures(req);
    const petIllusion=window.installPetIllusion?.(req);
    if(!petIllusion?.revision)record('宠物幻化未载入：主包模块 288 缺失。');
    const combatRating=window.installCombatRating(req);
    // 美容院的「更换发型 / 更换脸型 / 全新发型」在原版里也是普通道具商店
    //（商店号 51 / 52 / 55），同样被 go.openPay 挡在门外。一起放进本地白名单，
    // 至少让请求真的发出去：服务端会对这几个商店回一条「造型商品资料未采集」的
    // 明确提示，而不是像以前那样点了毫无反应。
    const localShops=[51,52,55,901,902,903,904,905,906,907,908,909,910,911,912,916,918,919,920];
    World.doBrowseShop=function(id,...args){if(id===req(1).default.EVENT_ALL_MENU_CSS)return req(1).default.createChiselSealUI();if(id===917)return req(67).ShopItem.openItemShop(918);if(id>=913&&id<=915)return composition.open(id===913?'attribute':id===914?'skill':'vip');return localShops.includes(id)?req(67).ShopItem.openItemShop(id):browseShop.call(this,id,...args);};
    // Keep the longer supply menu inside the screen, using the original choice
    // list and click handlers as a scrollable viewport.
    const MissionDialog=req(737).MissionDialogMdr.prototype,showMission=MissionDialog.onShow,hideMission=MissionDialog.onHide;
    function restoreSupplyMenu(dialog){
      const scroll=dialog._supplyChoiceScroller;if(!scroll)return;
      const parent=scroll.parent,list=scroll.viewport,index=parent?.getChildIndex(scroll);
      scroll.viewport=null;if(parent){parent.removeChild(scroll);parent.addChildAt(list,index);}
      dialog._supplyChoiceScroller=null;
    }
    MissionDialog.onShow=function(...args){
      restoreSupplyMenu(this);
      if(World.orgMapID===19&&this._showArgs?.uiObj?.npc?.id===126){
        const list=this._view.list_choice,parent=list.parent,index=parent.getChildIndex(list),scroll=new eui.Scroller();
        scroll.width=list.width;scroll.height=Math.min(650,Math.max(180,(this._view.stage?.stageHeight||1280)-500));
        scroll.horizontalScrollPolicy='off';scroll.verticalScrollPolicy='on';scroll.horizontalCenter=0;
        parent.addChildAt(scroll,index);scroll.viewport=list;list.scrollV=0;this._supplyChoiceScroller=scroll;
      }
      return showMission.apply(this,args);
    };
    MissionDialog.onHide=function(...args){restoreSupplyMenu(this);return hideMission.apply(this,args);};
    const contentReady=fetch('/api/official-content').then(r=>r.json());
    const BookMdr=req(1150).default;
    for(const name of ['tapItemSelect','tapItemSelect2']){const original=BookMdr.prototype[name];BookMdr.prototype[name]=async function(...args){
      const info=await contentReady,entry=this._list?.source[this._view?.listItem.selectedIndex];
      const detailSupplied=name==='tapItemSelect2'&&Number.isInteger(args[0]?.id);
      if(!detailSupplied&&(!entry||!info.itemIds.includes(entry.info.itemId))){if(name==='tapItemSelect'&&entry)req(1).default.alertMessage('这件道具已恢复目录，详细属性尚未采集。');return;}
      return original.apply(this,args);
    };}
    const Handler=req(18).default,missionReward=Handler.processMissionReward;
    const processDetail=Handler.processDataPlayerDetail;
    Handler.processDataPlayerDetail=function(message,player,...args){
      const result=processDetail.call(this,message,player,...args);
      if(player)baseFaces.set(player,{low:player.icon1.low,high:player.icon1.high});
      return result;
    };
    // Local saves retain the character's base appearance. Rebuild native equipment
    // layers after the complete actor + bag packet, including login/map refreshes.
    // The original equip/unequip handler already performs this on live swaps.
    const processWorld=Handler.processDataBlockFlagMsg;
    Handler.processDataBlockFlagMsg=function(...args){
      const result=processWorld.apply(this,args);
      const player=World.myPlayer;
      if(player?.bag)player.updateAndRefreshIcon();
      return result;
    };
    Handler.processMissionReward=function(player,id,...args){const value=missionReward.call(this,player,id,...args);if(id===42)this.worldReflashType=this.WORLD_REFLASH_ALL;return value;};
    const closePanel=()=>document.getElementById('offline-panel').classList.remove('open');
    document.getElementById('daily-open').onclick=()=>{closePanel();req(1).default.createDailyMission();};
    document.getElementById('official-map').onclick=()=>{closePanel();req(197).default.Instance.doEnterWorldMap();};
    document.getElementById('official-book').onclick=()=>{closePanel();req(1).default.showWin(req(0).ModName.Raiders,req(0).RaidersViewType.BookGroupMain);};
    document.getElementById('official-shop').onclick=()=>{closePanel();World.doBrowseShop(902);};
    // ==== MOD: 我方回合的技能选择时间 60 秒 -> 180 秒 ====
    // 客户端把每回合的"操作时间"存在模块 61 的静态常量里：
    //   battle 模型 updateRoundEndTime() 用 FIRST/NORMAL_ROUND_PLAN_TIME 算 roundEndTime，
    //   getPlanTime() 再据此倒计时。这里直接改常量（战斗模型是每次调用时现读的）。
    try{
      const battleConstants=req(61).default;
      battleConstants.FIRST_ROUND_PLAN_TIME=18e4;
      battleConstants.NORMAL_ROUND_PLAN_TIME=18e4;
      console.log('[offline] 回合操作时间已改为',battleConstants.NORMAL_ROUND_PLAN_TIME/1000,'秒');
    }catch(error){console.error('[offline] 修改回合操作时间失败',error);}
    // ==== /MOD ====
    // ==== MOD: 战斗倍速持久化 ====
    // MOD(battle-speed-persist)
    // 主包里 onTapSpeedBtn 已改成在 [1,3,5] 里循环并回调 __battleSpeedSave（见
    // lib/client-battle-speed-patch.mjs）。这里只负责：
    //   1) 记下玩家选过的档位（存 localStorage，重开游戏也还在）
    //   2) 开局把它应用回去，避免登录/切场景时被别处设回默认
    (() => {
      const KEY='worldol-battle-speed';
      const STEPS=[1,3,5];
      let store=null;
      try{
        // 真实页面里 egret 就是 window.egret；两种写法都认，别因为拿不到就静默失效
        const E=window.egret||((typeof egret!=='undefined')?egret:null);
        if(E&&E.localStorage){E.localStorage.getItem(KEY);store=E.localStorage;}
      }catch(error){}
      if(!store){ try{ window.localStorage.setItem('__wos','1'); window.localStorage.removeItem('__wos'); store=window.localStorage; }catch(error){ store=null; } }
      const read=()=>{ if(!store)return 0; try{ const v=Number(store.getItem(KEY)); return STEPS.includes(v)?v:0; }catch(error){ return 0; } };
      window.__battleSpeedSave=(v)=>{
        if(!STEPS.includes(v))return;
        window.__battleSpeed=v;
        try{ if(store)store.setItem(KEY,String(v)); }catch(error){}
      };
      const saved=read();
      window.__battleSpeed=saved||0;
      if(!saved)return;
      // 开局应用回去；刚登录/切场景时别处可能又设回默认，所以头 20 秒多补几次
      const apply=()=>{ const v=window.__battleSpeed; if(!v)return; try{ if(go.gameSpeed!==v)go.gameSpeed=v; }catch(error){} };
      apply();
      let n=0; const timer=setInterval(()=>{ apply(); if(++n>=40)clearInterval(timer); },500);
      record('[offline] 战斗倍速记忆已启用，上次选的是 ×'+saved);
    })();
    // ==== /MOD ====
    window.installNativeFeatures(req);
    window.installNativeCommerce(req);
    window.installNativePetShop(req);
    go.isShowAgeTips=false; gs.payDisabled=true;
    gs.sdkPay=()=>record('单机版不连接充值服务。',true);
    gs.report=()=>{};
    status.textContent='本地服务已连接，正在初始化原版界面。';
    record('原版消息适配器已就绪');
    setInterval(()=>{
      const player=req(5).default.myPlayer;
      for(const id of ['features-open','city-open','talents-open','artifact-open','daily-open','recorded-open','pet-shop-open','official-map','official-book','official-shop','career-open','equipment-open','composition-open','vip-open','combat-rating-open'])document.getElementById(id).disabled=!player?.id;
      if(player?.id)flushPosition();
      const node=document.getElementById('offline-role');
      if(player?.id)node.textContent=`${player.name} · 等级 ${player.level} · 地图 ${req(5).default.mapId} · 坐标 ${player.getGx()}, ${player.getGy()}`;
      // Readable diagnostics for original canvas UI acceptance; no browser internals required.
      const b=req(54).default.ins;
      const MC=req(12).ModelConst;
      const state={characterFeatures:characterFeatures.snapshot(),appearance:player?[player.icon1,player.icon2,player.icon3].map(i=>({low:i.low,high:i.high})):null,role:player?.id,combatPoint:player?.combatPoint,map:req(5).default.getCurMapID(),x:player?.getGx(),y:player?.getGy(),hp:player?.hp,mp:player?.mp,coins:player?.money3,level:player?.level,exp:player?.exp,expMax:player?.expMax,cp:player?.cp,sp:player?.sp,cityId:player?.cityId,initiativeSkill:player?.autoSkillID_Initiative,autoSkills:player?.autoSkillID,hpMax:player?.get(MC.HPMAX),mpMax:player?.get(MC.MPMAX),attack:player?[player.get(MC.ATK_MIN),player.get(MC.ATK_MAX)]:null,attributes:player?[MC.STR,MC.CON,MC.AGI,MC.ILT,MC.WIS].map(k=>player.get(k)):null,inventory:player?.bag?.store?.filter(Boolean).map(i=>({id:i.id,name:i.name,slot:i.slotPos,quantity:i.quantity,bound:i.isBinded(),icon:i.icon,star:i.star,gemCount:i.attachDone,gemBroken:i.isAttackBroken(),gemPower:i.attachPower,gemValue:i.attachValue,gemCapacity:i.attachCount,enchantment:[i.enchantLevel,i.enchantPower1,i.enchantPowerValue1,i.enchantPower2,i.enchantPowerValue2],affixes:[i.power1,i.powerValue1,i.power2,i.powerValue2,i.bindPower1,i.bindPowerValue1,i.bindPower2,i.bindPowerValue2]})),skills:player?.skillList?.filter(Boolean).map(s=>({id:s.id,name:s.name,level:s.level})),quests:player?.missionList?.filter(Boolean).map(q=>({id:q.id,status:q.status})),pet:player?.getPet()?{name:player.getPet().name,level:player.getPet().level,uid:String(player.getPet().getPetId?.()??player.bag?.store?.[1]?.petId??""),model:player.getPet().modelForPet,hp:player.getPet().hp,mp:player.getPet().mp,hpMax:player.getPet().get(MC.HPMAX),mpMax:player.getPet().get(MC.MPMAX),exp:player.getPet().exp,expMax:player.getPet().expMax,skills:player.getPet().skillList?.map(s=>({id:s.id,name:s.name,level:s.level,addLevel:s.addLevel||0})),growLevel:player.getPet().growLevel}:null,battle:b.isFight?{group:b.groupId,round:b.battle?.round,result:b.battle?.result,settled:b.isGotResult}:null};
      state.skillShop=careerTeachers.snapshot();
      state.legion=legion.snapshot();
      if(document.querySelector('#offline-panel details')?.open)state.legion.audit=legion.audit();
      document.getElementById('legion-open').disabled=!player?.id;
      state.combatRating=combatRating.snapshot();
      const boss=World.getMonster(1985);
      state.localBoss=boss?{id:boss.id,name:boss.name,hpMax:boss.hpMax,mpMax:boss.mpMax,speed:boss.speed,attack:[boss.atkMin,boss.atkMax],attackTimes:boss.get(MC.ATK_TIME),armor:[boss.def_str,boss.def_agi,boss.def_magic],hit:boss.hitrate,magicHit:boss.hitMagic,critical:boss.critical}:null;
      document.getElementById('offline-state').textContent=JSON.stringify(state);
    },1000);
  };
})();
