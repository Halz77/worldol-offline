(() => {
  'use strict';
  window.installEquipmentWorkshop=req=>{
    const World=req(5).default,UI=req(1).default,Item=req(32).default,Handler=req(18).default,modules=req(0),events=req(2).BagEvent;
    const rules=window.worldolEquipmentRules,starLimit=window.worldolStarLimit;
    const advancedIds=new Set(rules.advanced.identifyItemIds),canAdvance=i=>advancedIds.has(i?.id);
    // Single-player has no commercial activation switch for advanced powers.
    Object.defineProperty(Item,'isUpgradeItemOpen',{configurable:true,get:()=>true,set(){}});
    const identifyView=req(473).BagItemIdentifyMdr.prototype,identifyInit=identifyView.initView;
    identifyView.initView=function(){identifyInit.call(this);if(canAdvance(this._showArgs.item)&&!this._showArgs.item.isUpgradeItem)this._listBtnData.source=[...this._listBtnData.source,{type:UI.EVENT_UPGRADE_IDENTIFY,name:'进阶鉴定'}];};
    const dialog=document.getElementById('equipment-dialog'),select=document.getElementById('equipment-target'),kind=document.getElementById('equipment-operation'),note=document.getElementById('equipment-materials'),status=document.getElementById('equipment-status'),proceed=document.getElementById('equipment-continue');
    const gear=i=>i&&((i.type>=0&&i.type<=24)||(i.type>=34&&i.type<=39));
    const inventory=()=>{const bag=World.myPlayer?.bag,items=[];if(bag)for(let slot=0;slot<=bag.bagEnd;slot++){const i=slot<30?bag.getItem(slot):bag.getBagItemBySlotPos(slot);if(i)items.push(i);}return items;};
    const findItem=(slot,id)=>inventory().find(i=>i.slotPos===slot&&(id===undefined||i.id===id));
    const countMaterial=ids=>inventory().filter(i=>i.slotPos>=30&&ids.includes(i.id)).reduce((n,i)=>n+i.quantity,0);
    // 一键到满星复用原来的逐次操作，只是由这里代点。
    //upgrade=false 走普通强化（装备强化卷），true 走进阶强化（进阶强化卷轴）。
    const quickStar={group:mode=>mode==='quick-upgrade-star'?'upgrade-star':mode==='quick-star'?'star':mode,
      is:m=>m==='quick-star'||m==='quick-upgrade-star',upgrade:m=>m==='quick-upgrade-star',
      scrolls:upgrade=>upgrade?rules.advanced.starScrolls:[rules.star.scroll],
      label:upgrade=>upgrade?'进阶强化卷轴':'装备强化卷',
      at:(item,upgrade)=>upgrade?(item?.upgradeStar||0):(item?.star||0)};
    function refresh(){
      const items=inventory(),mode=quickStar.group(kind.value),previous=select.value;select.replaceChildren();
      for(const item of items.filter(i=>gear(i)&&(mode==='upgrade-identify'?i.slotPos>=30&&canAdvance(i):mode==='upgrade-star'?i.isUpgradeItem&&i.upgradeAscensionStar>0:mode==='identify'?i.slotPos>=30&&i.isIdentifyItem():mode==='star'?i.ascensionStar>0:i.attachCount>i.attachDone))){
        const option=document.createElement('option');option.value=item.slotPos;option.textContent=`${item.slotPos<30?'已穿戴':'背包'} · ${item.name} · ${item.star||0}/${starLimit(item)}星${item.isUpgradeItem?` · 进阶${item.upgradeStar||0}/${rules.advanced.max}星`:''} · 宝石${item.attachDone||0}/${item.attachCount||0}${item.isAttackBroken()?'（破碎，重镶从零开始）':''}`;select.append(option);
      }
      if([...select.options].some(o=>o.value===previous))select.value=previous;
      const count=countMaterial;
      note.textContent=`鉴定卷轴 ${count([40000,40001])} · 装备强化卷 ${count([40021])} · 进阶鉴定卷轴 ${count(rules.advanced.identifyScrolls)} · 进阶强化卷轴 ${count(rules.advanced.starScrolls)} · 宝石 ${items.filter(i=>i.slotPos>=30&&i.type===30).reduce((n,i)=>n+i.quantity,0)}。材料可从商店对应的卷轴分类领取。`;
      proceed.disabled=!select.options.length;
      planQuickStar();
    }
    // 一键之前先把代价摆出来：差几星、手上有几张卷、最多会烧掉多少张。
    function planQuickStar(){
      const mode=kind.value;if(!quickStar.is(mode)){status.textContent='';proceed.textContent='进入原版操作界面';return;}
      const upgrade=quickStar.upgrade(mode),item=select.options.length?findItem(Number(select.value)):undefined;
      const limit=item?(upgrade?rules.advanced.max:starLimit(item)):0,star=item?quickStar.at(item,upgrade):0,stock=countMaterial(quickStar.scrolls(upgrade));
      const missing=Math.max(0,limit-star);
      status.textContent=item?`${quickStar.label(upgrade)} ${stock} 张 · 距离${upgrade?'进阶':''}满星还差 ${missing} 星${missing?`（成功率 ${upgrade?rules.advanced.successRate:rules.star.successRate}%，失败不掉星但照样消耗卷轴）`:''}`:'先选一件装备。';
      proceed.textContent=item&&missing?`一键强化到 ${limit} 星（最多消耗 ${stock} 张卷轴）`:'已是满星';
      proceed.disabled=!select.options.length||!missing;
    }
    // 一键到满星：把玩家原本要一遍遍点的「强化」按钮由这里代点。
    // 装备工坊和装备详情里的「一键到满」共用这一条，report 让各自的界面显示进度。
    // upgrade=false 走普通强化（装备强化卷），true 走进阶强化（进阶强化卷轴）。
    async function quickStarToLimit(target,upgrade,report){
      const operation=(item,mode)=>upgrade?World.doItemUpgradeStarMenu(item,mode):World.doItemStarMenu(item,mode);
      const label=quickStar.label(upgrade),limit=upgrade?rules.advanced.max:starLimit(target),at=i=>quickStar.at(i,upgrade);
      const stock=()=>countMaterial(quickStar.scrolls(upgrade));
      let raised=0,failed=0,spent=0,stopped='';
      while(!stopped){
        const item=findItem(target.slotPos,target.id);
        if(!item){stopped='装备已经不在原地了，请重新选择。';break;}
        if(at(item)>=limit)break;
        if(spent>=200){stopped='这一轮已经点了200次，先停一下，确认卷轴数量后再继续。';break;}
        if(stock()<=0){stopped=`${label}用完了。`;break;}
        // 服务端按指纹校验：每次强化前必须重新取一次预览，直接连点会被拒。
        if(!await operation(item,World.ITEM_STAR_TYPE1)){stopped='取不到强化信息，按上面的提示处理后再来。';break;}
        const before=at(item),remaining=stock();
        await operation(findItem(target.slotPos,target.id)||item,World.ITEM_STAR_TYPE2);
        // 每次操作固定烧一张卷轴；数量没变说明请求被服务端拒了，再点也只会被拒。
        if(stock()===remaining){stopped='这次强化被拒绝，按上面的提示处理后再来。';break;}
        spent++;if(at(findItem(target.slotPos,target.id))>before)raised++;else failed++;
        if(report)report({star:at(findItem(target.slotPos,target.id)),limit,raised,failed,spent,label});
        await new Promise(done=>setTimeout(done,0));
      }
      const item=findItem(target.slotPos,target.id);
      return {label,star:item?at(item):0,limit,raised,failed,spent,stopped};
    }
    const summarize=r=>`当前 ${r.star}/${r.limit} 星。${r.raised?`成功 ${r.raised} 次`:'没有成功升星'}，失败 ${r.failed} 次，共用 ${r.label} ${r.spent} 张。${r.stopped?`\n${r.stopped}`:''}`;
    function open(mode='identify'){
      if(!World.myPlayer?.id)return;
      document.getElementById('offline-panel').classList.remove('open');kind.value=mode;refresh();if(!dialog.open)dialog.showModal();
    }
    document.getElementById('equipment-open').onclick=()=>open();
    document.getElementById('equipment-close').onclick=()=>dialog.close();kind.onchange=refresh;select.onchange=planQuickStar;
    proceed.onclick=async()=>{
      const item=inventory().find(i=>i.slotPos===Number(select.value));if(!item){refresh();return;}
      const mode=kind.value;dialog.close();
      if(quickStar.is(mode)){proceed.disabled=true;try{
        const result=await quickStarToLimit(item,quickStar.upgrade(mode),p=>{status.textContent=`强化中 ${p.star}/${p.limit} 星 · 成功 ${p.raised} 失败 ${p.failed} · 已用 ${p.spent} 张`;});
        UI.alertMessage(summarize(result));
      }finally{proceed.disabled=false;refresh();}return;}
      if(mode==='identify')World.doWorldIdentifyItemSelect(World.myPlayer,item);
      if(mode==='star')World.doItemStarSelectMenu(item);
      if(mode==='upgrade-identify')World.doWorldIdentifyItemAction(World.myPlayer,item,true);
      if(mode==='upgrade-star')UI.showModal(modules.ModName.Bag,modules.BagViewType.ItemUpStarInfo,{type:UI.EVENT_UPGRADE_STAR,item});
      if(mode==='gem')World.doWorldAttachItemMenu(World.myPlayer,item);
    };
    // Native item-use actions now choose a target instead of consuming a scroll
    // through the medicine path. Actual spending stays in the server protocols.
    const use=World.doWorldUseItemAction;
    World.doWorldUseItemAction=function(player,item,...args){if(item?.id===40021)return open('star');if(rules.advanced.identifyScrolls.includes(item?.id))return open('upgrade-identify');if(rules.advanced.starScrolls.includes(item?.id))return open('upgrade-star');if(item?.type===30)return open('gem');return use.call(this,player,item,...args);};
    const material=i=>i?.id===40021||rules.advanced.identifyScrolls.includes(i?.id)||rules.advanced.starScrolls.includes(i?.id)||i?.type===30;
    const canUse=Item.prototype.isCanUse;
    Item.prototype.isCanUse=function(mode){if(mode===Item.CAN_USE_WORLD&&material(this))return true;return canUse.call(this,mode);};
    const action=req(63).UIAction,menu=action.updatePlayerEquipPopMenu;
    action.updatePlayerEquipPopMenu=function(item,...args){
      // These materials are originally classified as special items/gems, whose
      // detail menu omitted Use. Only menu construction gets a use-item view;
      // the stored item type and native byte parser remain untouched.
      if(material(item)){const view=Object.create(item);view.getItemClass=()=>Item.ITEM_CLASS_USE_ITEM;return menu.call(this,view,...args);}
      return menu.call(this,item,...args);
    };
    const attachMenu=World.doWorldAttachItemMenu;
    World.doWorldAttachItemMenu=function(player,item){return item?.type===30?open('gem'):attachMenu.call(this,player,item);};
    Item.prototype.getAttachRateDesc=function(){return this.isAttackBroken()?'（重新镶嵌从第1颗开始，成功率100%）':`（下颗镶嵌成功率${this.attachDone<rules.gem.guaranteed?100:rules.gem.successRate}%）`;};
    Item.prototype.getAttackTwoSureInfo=function(){return `当前镶嵌已破碎，已有${this.attachDone}颗宝石的属性仍然生效。\n继续镶嵌会清除这些宝石及其属性，消耗1颗新宝石，从第1颗重新开始。是否继续？`;};
    const starMenu=World.doItemStarMenu;
    World.doItemStarMenu=async function(item,mode,...args){
      const max=starLimit(item);
      if((mode===World.ITEM_STAR_TYPE1||mode===World.ITEM_STAR_TYPE2)&&item.star>=max){UI.alertMessage(`这件装备已达到${max}星上限。`);return '';}
      const result=await starMenu.call(this,item,mode,...args);
      return mode===World.ITEM_STAR_TYPE1&&result?`需求${item.reqLv}级 · 强化上限${max}星 · 成功率${rules.star.successRate}%\n${result}`:result;
    };
    const upgradeStarMenu=World.doItemUpgradeStarMenu;
    World.doItemUpgradeStarMenu=async function(item,mode,...args){
      if((mode===World.ITEM_STAR_TYPE1||mode===World.ITEM_STAR_TYPE2)&&item.upgradeStar>=rules.advanced.max){UI.alertMessage(`这件装备已达到进阶${rules.advanced.max}星上限。`);return '';}
      const result=await upgradeStarMenu.call(this,item,mode,...args);
      return mode===World.ITEM_STAR_TYPE1&&result?`进阶上限${rules.advanced.max}星 · 成功率${rules.advanced.successRate}% · 每次1张进阶强化卷轴\n${result}`:result;
    };
    // Original confirmation code ignored the server's reply. Rejecting a stale
    // result must not put that candidate into the client bag.
    req(506).default.prototype.createIdentifyAsk=async function(mode,item,player,candidate,upgrade){
      await this.sendIdentifyAskMsg(Handler.createIdentifyAsk(mode,item.slotPos,item.id,true,upgrade));
      const reply=Handler.getReceiveMsg();if(!reply)return;
      if(reply.getByte()<0){UI.alertMessage(reply.getString());return;}
      const message='鉴定结果已保存。\n'+Item.getEquipCompareDesc(candidate,item,upgrade?Item.COMPARE_IDENTIFY_G:Item.COMPARE_IDENTIFY);
      if(mode===1){Object.assign(item,candidate);if(item.type!==41||item.slotPos>=30)player.bag.setItem(item,item.slotPos);}else candidate.setItemPowerDataTo(item);
      UI.updateIdentifyMessageUI(item,player,candidate,2,message,upgrade);
      this.sendNt(events.BAG_EQUIPMENT_UPDATE);
    };
    // A validation error is a rejected operation, never a failed socket attempt.
    World.doWorldAttachItemAction=async function(player,item,gem,output){
      const proxy=req(3).default.getProxy(modules.ModName.Bag,modules.ProxyType.Bag);
      await proxy.sendProtoAsync(Handler.createPlayerBagMessage(6,6,item,gem.slotPos));
      const reply=Handler.getReceiveMsg();if(!reply)return false;
      const status=reply.getByte();if(status<0){UI.alertMessage(reply.getString());return false;}if(status!==6)return false;
      const success=reply.getBoolean();item.setAttackBroken(!success);item.attachDone=reply.getByte();item.attachPower=reply.getShort();item.attachValue=reply.getShort();
      const count=reply.getByte();if(count){const slot=reply.getShort();reply.getInt();player.bag.removeBagItemByPos(slot,count);}
      player.updateAndRefreshIcon();player.checkHPMP();UI.updateWorldPlayerInfoUI();proxy.sendNt(events.BAG_EQUIPMENT_UPDATE);proxy.sendNt(events.BAG_ITEM_ATTACH);
      const message=success?`镶嵌成功，已镶嵌 ${item.attachDone}/${item.attachCount} 颗宝石。`:`镶嵌失败，镶嵌已破碎。\n此前成功的${item.attachDone}颗宝石属性保留。继续镶嵌将清除原宝石，从第1颗重新开始。`;
      // 一次一颗时照原生那样当场弹结果；一键镶嵌传静默收集器，跑完统一给一句汇总。
      if(output)output.append(message);if(!output?.silent)UI.alertMessage(message);return success;
    };
    // ---- 装备详情里的「镶嵌」也能一键到满 --------------------------------
    // 原生路径：点装备 → 镶嵌 → 选一颗宝石 → 点「镶嵌」按钮，一次只镶一颗。
    // 这里给镶嵌面板多列一条「一键镶嵌」，替玩家把按钮点到宝石孔满。
    // 原来一次一颗的入口原样留着，想慢慢点就还点原来那条。
    const attachPanel=req(462).BagItemAttachMdr.prototype,ATTACH_GEM=UI.EVENT_ATTACH_TYPE_ATTCH;
    const listAttach=attachPanel.initView,refreshAttach=attachPanel.updateView,tapAttachList=attachPanel.onTapList;
    // 面板每镶完一颗就会重建按钮列表（updateView），两条入口都要补，免得按钮中途消失。
    function addQuickGem(panel){
      const source=panel._listBtnData?.source;
      if(!source||source.some(entry=>entry?.quickGem))return;
      panel._listBtnData.source=[...source,{type:ATTACH_GEM,name:'一键镶嵌到满',quickGem:true}];
    }
    attachPanel.initView=function(){listAttach.call(this);addQuickGem(this);};
    attachPanel.updateView=function(){refreshAttach.call(this);addQuickGem(this);};
    attachPanel.onTapList=function(event){
      if(!event?.item?.quickGem)return tapAttachList.call(this,event);
      this._view.listBtn.selectedIndex=-1;
      runQuickGem(this);
    };
    const gemStock=()=>inventory().filter(i=>i.slotPos>=30&&i.type===30).reduce((n,gem)=>n+(gem.quantity||0),0);
    // 一键镶嵌：和一键强化同一套办法，反复调用原生的镶嵌动作，直到宝石孔满。
    // 破碎后继续镶嵌等于清掉已有宝石从头再来，原版本来会问一次，一键按已同意处理，
    // 最后会把重新开始的次数告诉玩家。
    async function runQuickGem(panel){
      const item=panel._showArgs?.attachItem,player=panel._showArgs?.player;
      if(!item||!player)return;
      panel._gemRunning=true;
      try{
        const view=panel._view,capacity=item.attachCount||0;
        if(capacity<=0){UI.alertMessage('这件装备没有可以镶嵌的宝石孔。');return;}
        if(!gemStock()){UI.alertMessage('背包里没有可以继续镶嵌的宝石了，商店可以领取。');return;}
        let raised=0,failed=0,restarted=0,spent=0,stopped='';
        while(!stopped){
          if((item.attachDone||0)>=capacity)break;
          const gems=player.bag.getAttachGemItemList(item)||[];
          if(!gems.length){stopped='背包里没有可以继续镶嵌的宝石了。';break;}
          if(raised+failed>=300){stopped='这一轮已经镶嵌300次，先停一下，确认宝石数量后再继续。';break;}
          // 同一个属性位上可能同时有 +1～+4 几档宝石（例如背包里 98 颗 +3、刚领了 60 颗 +4）。
          // 先挑每颗属性最高的那一档，只有同档之间才比数量：否则那堆 +3 永远被先用掉，
          // 玩家刚补的 +4 宝石反而镶不上去。
          const gem=gems.reduce((best,candidate)=>{
            const a=candidate.powerValue1||0,b=best.powerValue1||0;
            if(a!==b)return a>b?candidate:best;
            return (candidate.quantity||1)>(best.quantity||1)?candidate:best;
          });
          if(item.isAttackBroken())restarted++;
          panel._gemItem=gem;if(panel.updateTapItem)panel.updateTapItem(gem);
          const before=gemStock();
          const success=await World.doWorldAttachItemAction(player,item,gem,{silent:true,append(){}});
          // 每次固定烧一颗宝石；库存没变说明请求被服务端拒了，再点也只会被拒。
          if(gemStock()===before){stopped=success?'这次镶嵌没有生效，按上面的提示处理后再来。':'这次镶嵌被拒绝，按上面的提示处理后再来。';break;}
          spent+=before-gemStock();if(success)raised++;else failed++;
          if(view?.textDes)view.textDes.text=`镶嵌中 ${item.attachDone||0}/${capacity} 颗 · 成功 ${raised} 次，失败 ${failed} 次 · 已用宝石 ${spent} 颗`;
          await new Promise(resolve=>setTimeout(resolve,0));
        }
        UI.alertMessage(`当前 ${item.attachDone||0}/${capacity} 颗宝石。${raised?`成功 ${raised} 次`:'没有成功镶嵌'}，失败 ${failed} 次，共用宝石 ${spent} 颗。${restarted?`\n镶嵌破碎并重新开始 ${restarted} 次，破碎前保留的属性已被新的宝石替换。`:''}${stopped?`\n${stopped}`:''}`);
      }catch(error){UI.alertMessage('一键镶嵌中断了，按上面的提示处理后再来。');console.error(error);}
      finally{panel._gemRunning=false;}
    }
    // ---- 装备详情里的「强化」也能一键到满 --------------------------------
    // 原生路径：点装备 → 强化 → 选一个操作 → 结果面板一下一下点按钮。
    // 这里给选择面板多列两条「一键到满」，点进去替玩家把按钮点到头。
    // 原来一次一星的入口原样留着，想慢慢点就还点原来那条。
    const upStarPanel=req(485).BagItemUpStarMdr.prototype,starPanel=req(483).BagItemUpStarInfoMdr.prototype;
    const listUpStar=upStarPanel.initView;
    upStarPanel.initView=function(){
      listUpStar.call(this);
      const source=this._listBtnData?.source;
      if(!source?.length||source.some(entry=>entry?.quick))return;
      const extra=[];
      // 名字贴着原生的「强化升星/进阶强化」写，按钮宽度有限，别用太长的后缀。
      if(source.some(entry=>entry.type===UI.EVENT_COMMON_STAR))extra.push({type:UI.EVENT_COMMON_STAR,name:'一键强化升星',quick:true});
      if(source.some(entry=>entry.type===UI.EVENT_UPGRADE_STAR))extra.push({type:UI.EVENT_UPGRADE_STAR,name:'一键进阶强化',quick:true});
      if(extra.length)this._listBtnData.source=[...source,...extra];
    };
    const chooseUpStar=upStarPanel.onTapList;
    upStarPanel.onTapList=function(event){
      if(!event?.item?.quick)return chooseUpStar.call(this,event);
      UI.showModal(modules.ModName.Bag,modules.BagViewType.ItemUpStarInfo,{type:event.item.type,item:this._showArgs.item,quick:true});
      this.hideView();this._view.listBtn.selectedIndex=-1;
    };
    const openStarPanel=starPanel.onShow,fillStarPanel=starPanel.initView;
    // 每次打开面板都重新允许一键；同一个面板实例会被复用，靠这个标记避免跑完一轮又自动跑第二轮。
    // 原生 onShow 的最后一项是 this.initView()，本来就返回 Promise，这里继续还回去，
    // 好让调用方能等到一键跑完。
    starPanel.onShow=function(){this._quickDone=false;return openStarPanel.call(this);};
    starPanel.initView=async function(){
      await fillStarPanel.call(this);
      if(!this._showArgs?.quick||this._quickDone)return;
      this._quickDone=true;
      const upgrade=this._showArgs.type===UI.EVENT_UPGRADE_STAR,item=this._showArgs.item,view=this._view;
      this._canUp=false;   // 一键在跑时别让「强化」按钮插进来
      try{
        const result=await quickStarToLimit(item,upgrade,p=>{if(view?.textDes)view.textDes.text=`强化中 ${p.star}/${p.limit} 星\n成功 ${p.raised} 次，失败 ${p.failed} 次\n已用${p.label} ${p.spent} 张`;});
        UI.alertMessage(summarize(result));
      }catch(error){UI.alertMessage('一键强化中断了，按上面的提示处理后再来。');console.error(error);}
      finally{this._canUp=true;}
      await fillStarPanel.call(this);
    };
    return {open};
  };
})();

(() => {
 'use strict';
 window.installPetEquipment=req=>{
  const PetProxy=req(768).default,Pet=req(42).default,World=req(5).default,events=req(2),model=req(12).ModelConst;
  const Item=req(32).default,skillDesc=Item.prototype.getSkillDesc;
  Item.prototype.getSkillDesc=function(){
   return this.type===41&&this.skillDesc?`${this.skillDesc}+${this.petEquipSkillLevel||0}级`:skillDesc.call(this);
  };
  // Native upGradeClick silently returns when the commercial pay switch is off.
  // Offline upgrading uses owned materials and needs no payment feature.
  req(517).BagPetItemUpGradeMgr.prototype.upGradeClick=function(){
   const data=this._proxy.petEquipData;if(data.isInAnim)return;
   if(data.checkIsMax()){req(15).Tips.show('宠物装备已达到100级');return;}
   if(data.getSelectSumEx()<=0){req(15).Tips.show('请选择宠物装备经验素材');return;}
   this._proxy.sendPetEquipUp();
  };
  PetProxy.prototype.getPetItem=function(uid){
   const pet=this.data.getSelectedPet?.()||this.data.getPet?.()||World.myPlayer?.pet;
   return pet?.bag?.store.find(item=>item?.petUid?.eq(uid))||null;
  };
  PetProxy.prototype.upPetUpdate=function(message){
   const body=message.body;if(!body)return false;
   const slot=body.getShort(),pets=[];
   if(slot===1&&World.myPlayer?.pet)pets.push(World.myPlayer.pet);
   const list=this.data.SelfPetsLsit;for(let i=0;i<(list?.length||0);i++){const pet=list.elementAt(i);if(pet.petItem?.slotPos===slot&&!pets.includes(pet))pets.push(pet);}
   const selected=this.data.getPet?.();if(selected?.petItem?.slotPos===slot&&!pets.includes(selected))pets.push(selected);
   if(!pets.length)return false;
   // Read into the actual selected pet, including resting pets and current HP/MP.
   // Additional cached copies are refreshed on their next detail request.
   const pet=pets.includes(selected)?selected:pets[0];Pet.fromBytesDetail(body,pet,true);pet.setTabStatus(true,model.PET_INFO);
   this.sendNt(events.MainEvent.ON_PET_ATTR_UPDATE);this.sendNt(events.PetEvent.PET_UP_EQUIP);
   this.sendNt(events.BagEvent.BAG_EQUIPMENT_UPDATE);
   if(window.offlinePetSnapshotProfiles&&Object.keys(window.offlinePetSnapshotProfiles).length)fetch('/api/pet-snapshot-vitals').then(r=>r.json()).then(profiles=>{Object.assign(window.offlinePetSnapshotProfiles,profiles);this.sendNt(events.MainEvent.ON_PET_ATTR_UPDATE);}).catch(()=>{});
   return true;
  };
 };
})();

(() => {
 'use strict';
 window.installSpiritSeals=req=>{
  const World=req(5).default,UI=req(1).default,modules=req(0),View=req(1484).default.prototype;
  const rules=window.worldolEquipmentRules?.spirit;
  const eligible=i=>i&&i.type>=0&&i.type<=10;
  const Entry=req(1487).default.prototype,entryChanged=Entry.dataChanged;
  Entry.onSelectList=function(){if(eligible(this.data))req(3).default.getProxy(modules.ModName.ChiselSeal,modules.ProxyType.ChiselSeal).sendNt(req(2).ChiselSealEvent.SelectItem,this.data);};
  Entry.dataChanged=function(){entryChanged.call(this);if(this.data)this.itemName.text=this.data.name;};
  const help='人物防具、首饰均可赋灵，无等级、附魔或绑定门槛。\n装入每枚赋灵符需100万铜币，刻印与取下免费。左槽增加3%基础护甲，右槽增加5%。\nVIP商店“装备”页出售力量、敏捷、智力、感知四系灵符箱，每箱10万铜币。只开本系1–12级灵符，黄阶、玄阶共24种概率相同。\n保留本系主属性，4/8/12级分别增加1/2/3条随机附加属性，数值随机。力量走劈砍，敏捷走穿刺，智力和感知走法系。开出后固定，取下原样返还。';
  View.onTypeSelectList=function(){
   const bag=World.myPlayer.bag;this._selectType=this._typeList[this._view.selectType.selectedIndex];
   const items=(this._selectType<0?bag.getItemByTypeList(this._typeList):bag.getItemByType(this._selectType)).filter(eligible);
   this.listConform.replaceAll(items);this.listInconform.replaceAll([]);
   this._view.txtSelect.text=this._view.selectType.selectedItem;this.updateSelectIndex();this.closeSelect();
  };
  View.onLockItem=function(e){
   if(!eligible(this._selectItem))return;
   this._selectSetUpType=e.currentTarget===this._view.css1.lockImg?1:2;
   this._proxy.sendChiselSeal(this._selectItem,this._selectSetUpType);
  };
  View.onDelItem=function(e){
   if(!eligible(this._selectItem))return;
   this._selectSetUpType=e.currentTarget===this._view.css1.delImg?1:2;
   this._proxy.sendSealTakeOff(this._selectItem,this._selectSetUpType);
  };
  View.setUpCSS=function(e){
   const rune=e.body;if(!eligible(this._selectItem)||!rune)return;
   if(!rules)return UI.alertMessage('附灵收费规则尚未加载，请重启单机服务并刷新游戏。');
   const item=this._selectItem,side=this._selectSetUpType;
   const confirmed=req(11).default.alloc(this,()=>{
    const current=World.myPlayer.bag.getItem(item.slotPos);
    if(!current||current.id!==item.id||this._selectItem?.slotPos!==item.slotPos||this._selectItem?.id!==item.id)return UI.alertMessage('装备已变化，请重新选择。');
    if(World.myPlayer.get(req(12).ModelConst.MONEY3)<rules.installCoins)return UI.alertMessage('铜币不足，装入一枚赋灵符需要100万铜币。');
    this._proxy.sendSealSetUp(current,side,rune.id,rune.slotPos);this.closeSelect();
   });
   req(27).default.confirm('装入“'+rune.name+'”将收取100万铜币。是否继续？',confirmed,'装备赋灵');
  };
  const update=View.updateItemInfo;
  View.updateItemInfo=function(){
   // Full server item pushes replace bag objects. Resolve the selected instance
   // again so both sockets and their attributes refresh after each operation.
   const selected=this._selectItem;
   if(selected){const current=World.myPlayer.bag.getItem(selected.slotPos);this._selectItem=current?.id===selected.id?current:null;}
   update.call(this);this._view.itemLv.text=this._selectItem?'装入每枚100万铜币 · 刻印、取下免费':'';
   this.onTypeSelectList();
  };
  View.onHintBtn=function(){UI.alertMessage(help);};
  // Finished runes come from the shop chest; unsupported synthesis requests
  // would leave the native dialog waiting forever.
  View.onCSSynBtn=function(){UI.alertMessage('VIP商店 → 装备，选择力量、敏捷、智力或感知灵符箱，每箱10万铜币。只开本系十二级玄阶赋灵符1枚。');};
  const init=View.onInit;View.onInit=function(){
   init.call(this);this._view.btnCompound.label='灵符获取';this._view.comMoney_1.setType(req(12).ModelConst.MONEY3);
   const labels=node=>{if(node.text==='附魔未达到5级')node.text='';if(node.text==='最高可强化至12级赋灵符')node.text='装入每枚100万铜币 · 刻印、取下免费';for(let i=0;i<(node.numChildren||0);i++)labels(node.getChildAt(i));};labels(this._view);
  };
  document.getElementById('workshop-spirit').onclick=()=>{
   document.getElementById('equipment-dialog').close();
   UI.createChiselSealUI();
  };
 };
})();
