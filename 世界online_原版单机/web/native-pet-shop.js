(() => {
 'use strict';
 window.installNativePetShop=req=>{
  const Shop=req(67).ShopItem,Item=req(32).default,World=req(5).default,UI=req(1).default;
  const Network=req(35).default,Message=req(22).Message,Facade=req(3).default,Events=req(2);
  const constants=req(4).default,vipShops=new Set([constants.SHOP_VIP_1,constants.SHOP_VIP_2_4,constants.SHOP_VIP_5_7,constants.SHOP_VIP_8_9]);
  const parse=Shop.fromBytesShopItem,buy=Shop.doItemShopBuyMsg;
  Shop.fromBytesShopItem=function(message,shopId){
   const item=parse.call(this,message,shopId),id=Number(item.petId?.toString());
   if(vipShops.has(shopId)&&item.getItemClass()===Item.ITEM_CLASS_PET&&Number.isInteger(id)&&id<0){
    item.offlinePetSampleId=id;item.id=id;item.stackNum=1;
   }
   return item;
  };
  let purchasing=false;
  Shop.doItemShopBuyMsg=async function(player,item,quantity){
   if(!Number.isInteger(item?.offlinePetSampleId))return buy.call(this,player,item,quantity);
   if(purchasing)return false;
   if(player!==World.myPlayer||!vipShops.has(World.shopID)||quantity!==1){UI.alertMessage('请在VIP商店逐只购买宠物。');return false;}
   purchasing=true;
   try{
    const message=new Message(90004);message.putInt(item.offlinePetSampleId);
    const reply=await Network.sendProtoAsync(message);if(!reply)throw Error('本地服务没有返回结果。');
    if(reply.getByte()<0)throw Error(reply.getString());
    const petItem=Item.fromBytes(reply);if(!petItem)throw Error('宠物已保存，请重新打开背包。');
    if(World.myPlayer!==player)return false;
    player.bag.setItem(petItem,petItem.slotPos);
    Facade.sendNt(Events.BagEvent.BAG_EQUIPMENT_UPDATE);Facade.sendNt(Events.ShopEvent.SHOP_BUY_SUCCESS);
    req(15).Tips.show('宠物已加入背包，可选择出战。');return true;
   }catch(error){UI.alertMessage(error.message||String(error));return false;}
   finally{purchasing=false;}
  };
  const Renderer=req(206).ListShopNewItem.prototype,help=Renderer.tapHelp;
  Renderer.tapHelp=async function(...args){
   if(!Number.isInteger(this.data?.offlinePetSampleId))return help.apply(this,args);
   try{const pet=await req(42).default.doSeeRaidersPet(this.data.offlinePetSampleId);if(pet)UI.checkPet(null,null,4,pet);}
   catch(error){UI.alertMessage(error.message||String(error));}
  };
 };
})();
