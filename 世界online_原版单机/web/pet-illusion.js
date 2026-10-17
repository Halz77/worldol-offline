(() => {
 'use strict';
 // 宠物幻化：参照装备幻化（web 侧没有装备幻化入口，原生 btnIllusion 在主包里），
 // 这里在宠物详情界面 PetInfoMdr 的按钮组末尾补一个「幻化」按钮，点开 DOM 面板选择外观。
 //
 // 与装备幻化的分工一致：
 //   · 服务端 lib/pet-illusion-service.mjs 负责规则、候选和存档（只换外观，不动属性）；
 //   · 客户端不做渲染改动 —— 服务端下发宠物的 icon/headIcon/model 已经是幻化后的值，
 //     原生界面/背包/场景照旧画，这里只负责「选哪个外观」「选完把数据取回来」和「让场景与界面重画」。
 //     注意：**必须显式通知场景**（resyncScenePet → setPet(vo,true)），
 //     场景里的宠物实体不会自己跟着宠物数据变（原因见 resyncScenePet 的注释）。
 window.installPetIllusion=req=>{
  // PetInfoMdr 在主包模块 288（含 tapBtnEquip / tapBtnSeal / levelOpenButton）。
  // 拿不到就静默退出：附加功能不能把整个离线启动链带崩。
  let PetInfoMdr=null;
  try{PetInfoMdr=req(288)?.PetInfoMdr||null;}catch(error){PetInfoMdr=null;}
  if(!PetInfoMdr?.prototype)return {open(){},revision:null};
  const World=req(5).default,UI=req(1).default,Network=req(35).default,Message=req(22).Message;
  // 主包 module 42 是宠物数据类，静态 fromBytesDetail(reader,vo) 就是原生解析宠物详情的那段代码。
  // 幻化之后要靠它把服务端的新外观写回本地 VO，界面才看得到变化。
  let PetModel=null;
  try{PetModel=req(42)?.default||null;}catch(error){PetModel=null;}
  // 单机扩展协议，沿用 home-features 的「JSON 进 / JSON 出」约定（90019/90020 那套）。
  const LIST=90023,APPLY=90024;
  // 宠物详情协议，以及原生 doPetSeeMsg 用的「已加载」标志位
  // （ModelConst.PET_INFO=32；setTabStatus/isTabStatus 就是 intValue1 上的位运算）。
  const PET_SEE=15502,PET_INFO_BIT=32;

  const dialog=document.createElement('dialog');
  dialog.id='pet-illusion-dialog';
  dialog.setAttribute('aria-label','宠物幻化');
  const header=document.createElement('header'),title=document.createElement('h2'),close=document.createElement('button');
  title.textContent='宠物幻化';close.type='button';close.textContent='关闭';
  header.append(title,close);
  const note=document.createElement('p');
  note.className='pet-illusion-note';
  note.textContent='只改变外观 —— 场景造型、头像和模型会换成所选宠物的样子，名字、等级、品质、属性与技能全部保持不变，也可以随时恢复原本外观。候选取自传说级别宠物。';
  const current=document.createElement('p');
  current.className='pet-illusion-current';current.setAttribute('role','status');
  const filters=document.createElement('div');
  filters.className='pet-illusion-filters';
  const search=document.createElement('input');
  search.type='search';search.placeholder='搜索宠物外观名称';search.setAttribute('aria-label','搜索宠物外观名称');
  filters.append(search);
  const list=document.createElement('div');
  list.className='pet-illusion-list';list.setAttribute('role','listbox');list.setAttribute('aria-label','传说宠物外观');
  const status=document.createElement('p');
  status.className='pet-illusion-status';status.setAttribute('role','status');
  dialog.append(header,note,current,filters,list,status);
  document.body.append(dialog);
  close.onclick=()=>dialog.close();

  let state=null,slot=null,mdr=null,busy=false,generation=0;

  async function wire(type,value){
   const p=World.myPlayer;if(!p?.id)throw Error('请先进入角色。');
   const m=new Message(type);m.putString(JSON.stringify({...value,role:p.id}));
   const reply=await Network.sendProtoAsync(m);
   if(!reply)throw Error('本地服务未响应，请刷新后重试。');
   if(reply.getByte()<0)throw Error(reply.getString());
   const data=JSON.parse(reply.getString());
   if(World.myPlayer?.id!==p.id)throw Error('角色已切换，请重新打开。');
   return data;
  }

  function render(){
   list.replaceChildren();
   if(!state)return;
   const keyword=search.value.trim();
   const items=state.candidates.filter(item=>!keyword||item.name.includes(keyword));
   status.textContent=`候选 ${state.candidates.length} 种传说外观${keyword?`，名称匹配 ${items.length} 种`:''}。点击即幻化。`;
   for(const item of items){
    const row=document.createElement('button');
    row.type='button';row.className='pet-illusion-row';row.setAttribute('role','option');
    row.textContent=item.name;
    const active=!!state.current&&state.current.key===item.key;
    row.setAttribute('aria-selected',active?'true':'false');
    if(active)row.dataset.current='1';
    row.disabled=busy;
    row.onclick=()=>submit(item.key);
    list.append(row);
   }
  }

  function selectedPet(source){
   try{return source?._proxy?.data?.getSelectedPet?.()||null;}catch(error){return null;}
  }

  // 幻化之后让界面显示新外观。
  //
  // 这里**不能**只调 mdr.onBagEquipemntUpdate()：它内部走 doPetSeeMsg，而 doPetSeeMsg 开头有两道
  // 「跳过」判断 —— 宠物就是出战宠物、或者 pet.isTabStatus(ModelConst.PET_INFO) 表示已经加载过详情，
  // 命中任意一条就直接 return true，压根不会重新向服务端要数据。宠物界面的详情早就加载过了，
  // 所以幻化完界面一直画的是旧外观，看着就像「点了没反应」。
  //
  // 办法：自己发一次宠物详情协议（和原生 createPetSeeMsg 完全一样），拿到官方格式的 petDetail，
  // 用客户端自带的 fromBytesDetail 写回本地 VO，再让相关界面重画。
  async function pullPetDetail(){
   const vo=selectedPet(mdr);
   if(!vo||!PetModel?.fromBytesDetail)return null;
   const petSlot=vo.petItem?.slotPos??vo.petItem?.slot??slot;
   if(!Number.isInteger(petSlot))return null;
   const m=new Message(PET_SEE);m.putShort(petSlot);
   const reply=await Network.sendProtoAsync(m);
   // 与原生 doPetSeeMsg 一致：先读状态字节，剩下的整段交给官方解析器。
   if(!reply||reply.getByte()<0)return null;
   PetModel.fromBytesDetail(reply,vo);
   try{vo.setTabStatus?.(true,PET_INFO_BIT);}catch(error){/* 标志位只是缓存开关，失败无所谓 */}
   return vo;
  }

  // 把新外观再落到「背包里那只宠物的道具」上。
  //
  // 宠物列表（PetListMdr → PetItem 格子）和背包格子读的是 **petItem.icon / petItem.petHeadIcon**，
  // 而宠物对象上的是 icon1 / PetHeadIcon —— 两边是分开存的，只改后者列表不会变。
  // 好在 SelfPetsLsit 里每一项的 petItem 就是这只宠物在背包里的那个道具对象本身（itemChangePet
  // 里是 `i.petItem = e`，同一个引用），所以改一个就够；列表每次打开都会按它重建。
  function applyAppearanceToItem(vo){
   const item=vo?.petItem;
   if(!item)return false;
   const icon=Number(vo.icon1?.toNumber?.()??vo.icon1);
   if(Number.isFinite(icon))item.icon=icon;
   if(Number.isFinite(vo.PetHeadIcon))item.petHeadIcon=vo.PetHeadIcon;
   return true;
  }

  // 把「场景里那只随行宠物」重新绑到当前的宠物数据上。
  //
  // 为什么光刷新界面不够：场景里的宠物实体只在**玩家模型进场景那一次**拿到数据 ——
  // SceneController.addObj 里是一句 `p.vo = t.pet`（t 是玩家 VO），之后只有
  // Player.setPet(x, true) 发出的 ON_PET_ADD 会把它换成新对象（onPetAdd 里 `o.vo=t; o.onAdded()`）。
  // 服务端每次下发 playerDetail 都会造一个**新的**宠物 VO 并 setPet（不带通知），
  // 于是 myPlayer.pet 早就换过对象了，实体还拿着旧的 —— 宠物详情/头像跟着新对象走、
  // 场景贴图跟着旧对象走，表现就是「幻化完界面变了、地上那只没变」。
  //
  // 原生「宠物出战」走的就是这条路（doEquipAction → setPet(vo, true)），照抄它最稳：
  // 实体重新绑定 + onAdded 重算贴图。只对**正在出战的这只**做，换别的宠物的外观不该把它召出来。
  function resyncScenePet(vo){
   try{
    const player=World.myPlayer,active=player?.getPet?.()||player?.pet||null;
    if(!vo||!active)return false;
    // 判定「正在被幻化的是不是地上这只」：**按槽位判，不能只按对象引用判**。
    // 服务端每次下发 playerDetail 都会造一个新的宠物 VO，myPlayer.pet 可能已经换过对象，
    // 这时它与界面里 selectedPet(mdr) 拿到的已经不是同一个引用了 —— 只比引用会漏判，
    // 场景就永远不刷新（玩家看到的正是不刷新的那个版本）。槽位是宠物在背包里的位置，
    // 不受 VO 重建影响；两者都认，任一条命中就算同一只。
    const slotOf=target=>target?.petItem?.slotPos??target?.petItem?.slot;
    const mine=Number.isInteger(slot)?slot:slotOf(vo);
    const activeSlot=slotOf(active);
    const samePet=active===vo
     ||(vo.petItem&&active.petItem===vo.petItem)
     ||(Number.isInteger(mine)&&Number.isInteger(activeSlot)&&mine===activeSlot);
    if(!samePet)return false;           // 幻化的不是出战宠物 → 场景不该动
    if(typeof player.setPet!=='function')return false;
    player.setPet(active,true);         // → ON_PET_ADD → 实体 o.vo=active; o.onAdded()
    return true;
   }catch(error){return false;}
  }

  // 通知各处重画。三条都走原生入口：
  //   · BAG_ITEM_UPDATE      —— 背包/宠物格按本地道具重画（道具刚刚已经改好了）
  //   · ON_PET_ATTR_UPDATE   —— 宠物头像等小组件
  //   · refreshWorldSprite() —— 场景里的玩家贴图；玩家 setSpriteSrc 里自带
  //                             `getPetByOwnerId(自己).updateSprite()`，随行宠物的贴图会跟着一起重建
  //     （光发 ON_PET_ADD 不行：它只调 onAdded()，不会重算贴图）
  function notifyAppearanceChanged(){
   try{
    const service=req(3).default,events=req(2);
    service.sendNt(events.BagEvent.BAG_ITEM_UPDATE);
    service.sendNt(events.MainEvent.ON_PET_ATTR_UPDATE);
   }catch(error){/* 通知失败不影响幻化本身 */}
   try{
    const player=World.myPlayer;
    if(player?.refreshWorldSprite)player.refreshWorldSprite();
    else player?.updateAndRefreshIcon?.();
   }catch(error){/* 不在场景里就跳过 */}
  }

  // 宠物列表页（宠物窗口里的「宠物」页签）只在 onShow 时重建数据源，
  // 幻化是在它上面的宠物详情窗口里做的，回去时它并不会重新 onShow —— 于是列表还是旧造型。
  // 这里顺着同一个 Pet 模块的实例表把列表页找出来，直接让它重建一次（找不到就算了，
  // 不动任何窗口层级，也不影响别的页签）。
  function refreshPetListPage(){
   try{
    const instances=mdr?._owner?.__mdrIns;
    if(!instances)return false;
    for(const key of Object.keys(instances)){
     const view=instances[key];
     if(!view||view===mdr)continue;
     // 列表页的皮肤上有 listPets，而且它就是靠自己的 initView() 组装列表的
     if(view._view?.listPets&&typeof view.initView==='function'){view.initView();return true;}
    }
   }catch(error){/* 页面还没建好/没有这个页签都无所谓 */}
   return false;
  }

  function refreshPet(){
   // 不 await：网络慢的时候别把「正在保存」的提示卡住，界面先给反馈、晚一拍再重画。
   return pullPetDetail().then(vo=>{
    if(vo)try{applyAppearanceToItem(vo);}catch(error){}
    // 顺序：先让场景把这套新外观拿过去（重算贴图），再通知各处重画界面。
    resyncScenePet(vo);
    notifyAppearanceChanged();
    refreshPetListPage();
    try{mdr?.updateView?.();}catch(error){/* 界面已关掉就算了 */}
   }).catch(()=>{});
  }

  async function submit(key){
   if(busy||!state)return;
   busy=true;render();status.textContent='正在保存…';
   // 提示文案单独存一份：finally 里的 render() 会把 status 重置成候选数量，
   // 直接写 status 会被它盖掉（表现为「点了没反应」）。
   let message='';
   try{
    const data=await wire(APPLY,{slot,key:key||''});
    state.current=data.current||null;
    message=data.current?`已幻化成「${data.current.name}」。`:'已恢复宠物原本外观。';
    refreshPet();
   }catch(error){message=error.message;}
   finally{busy=false;render();status.textContent=message;}
  }

  async function open(source){
   if(busy)return;
   if(source?._showArgs?.type){UI.alertMessage('只能幻化自己的宠物。');return;}
   const vo=selectedPet(source);
   const petSlot=vo?.petItem?.slotPos??vo?.petItem?.slot;
   if(!Number.isInteger(petSlot)){UI.alertMessage('请先选择一只自己的宠物。');return;}
   mdr=source;slot=petSlot;state=null;
   const token=++generation;
   list.replaceChildren();current.textContent='';status.textContent='正在读取宠物外观…';
   if(!dialog.open){try{dialog.showModal();}catch(error){/* 已经开着就直接复用 */}}
   try{
    const data=await wire(LIST,{slot});
    if(token!==generation)return;
    state=data;
    current.textContent=data.current
      ?`当前外观：${data.current.name}　·　原本是：${data.name}`
      :`当前外观：宠物本身（${data.name}）`;
    render();
    status.textContent='';
   }catch(error){if(token===generation)status.textContent=error.message;}
  }

  // 宠物详情界面的按钮组 groupPetO 用的是 tile 布局，按钮皮肤统一是 CancelBtnSkin，
  // 直接往里加一个新按钮就能自动排版、跟上原有样式。
  function installButton(source){
   const view=source?._view;
   if(!view||!view.groupPetO)return;
   let button=view.__petIllusionBtn;
   if(!button){
    if(typeof eui==='undefined'||!eui.Button)return;
    const group=view.groupPetO;
    button=new eui.Button();
    button.name='btnPetIllusion';
    button.label='幻化';
    button.skinName='CancelBtnSkin';
    // 跟同组按钮对齐尺寸，免得 tile 布局算出大小不一的一行。
    const sample=group.getChildAt(0);
    const sampleWidth=sample?.width,sampleHeight=sample?.height;
    if(Number.isFinite(sampleWidth)&&sampleWidth>0)button.width=sampleWidth;
    if(Number.isFinite(sampleHeight)&&sampleHeight>0)button.height=sampleHeight;
    group.addChild(button);
    // 多一个按钮可能要多排一行，把按钮组高度放宽，别被它自己的高度裁掉。
    if(Number.isFinite(sampleHeight)&&sampleHeight>0){
     const gap=group.layout?.verticalGap??15;
     const needed=sampleHeight*3+gap*2;
     if(group.height<needed)group.height=needed;
    }
    view.__petIllusionBtn=button;
   }
   // ★ 这里是「关一次界面后幻化按钮就再也点不动」的根因：
   //   按钮的点击原来是走 source.onEgret(...) 注册的，而 Mdr 的 doHide 会把 __egretHandler
   //   里登记的监听**全部摘掉**；同时 Owner.showView 用的是 __mdrIns 里缓存的同一个 Mdr 实例
   //   （视图不会重建），于是第二次打开时 __petIllusionBtn 还在、监听却已经没了。
   //   所以改成用 button.addEventListener 直接挂（不进 __egretHandler，不会被 doHide 摘掉），
   //   监听函数存在视图上，只挂一次。
   if(!view.__petIllusionTap){
    view.__petIllusionTap=()=>open(view.__mdr__||source);
    button.addEventListener(egret.TouchEvent.TOUCH_TAP,view.__petIllusionTap,view);
   }
  }
  function syncButton(source){
   const button=source?._view?.__petIllusionBtn;
   if(!button)return;
   // 看别人的宠物（图鉴/邮件/摊位）时没有幻化这件事，按钮一并藏掉。
   const own=!(source?._showArgs?.type);
   button.visible=own;button.includeInLayout=own;button.enabled=own;
  }

  const onShow=PetInfoMdr.prototype.onShow;
  PetInfoMdr.prototype.onShow=function(...args){
   const result=onShow.apply(this,args);
   try{installButton(this);syncButton(this);}catch(error){/* 按钮是附加功能，别影响原界面 */}
   return result;
  };
  const addListeners=PetInfoMdr.prototype.addListeners;
  PetInfoMdr.prototype.addListeners=function(...args){
   const result=addListeners.apply(this,args);
   try{installButton(this);syncButton(this);}catch(error){}
   return result;
  };

  const api={open,revision:'pet-illusion-v4'};
  window.offlinePetIllusion=api;
  return api;
 };
})();
