(() => {
 'use strict';
 window.installOfflineSystemSettings=req=>{
  const World=req(5).default,Sound=req(107).default.ins,Handler=req(18).default;
  const System=req(1318).default.prototype,Settings=req(1312).SystemGameSettingMdr.prototype;
  if(System.offlineSettingsInstalled)return;
  System.offlineSettingsInstalled=true;
  const musicOff=req(4).default.SETTING_USIC_BACKGROUND_OFF,states=new WeakMap();
  let queue=Promise.resolve();
  let requestedMusic;
  const playMusic=Sound.playMusic;
  Sound.playMusic=function(name){requestedMusic=name;return playMusic.call(this,name);};
  function apply(player,value){
   player.setSetting(value);
   if(World.myPlayer===player){
    Sound.isMute=!!(value&musicOff);
    // Native playMusic ignores map changes while muted. Remember the latest
    // track so enabling music after a muted login or teleport plays this map.
    if(!Sound.isMute&&requestedMusic!=null)Sound.playMusic(requestedMusic);
    req(3).default.sendNt(req(2).SystemEvent.SYSTEM_SETTING_UPDATE);
   }
  }
  System.processSettingLayer=function(value,showTip=false){
   const player=World.myPlayer;if(!player)return Promise.resolve(false);
   let state=states.get(player);
   if(!state){state={committed:player.getSetting(),sequence:0};states.set(player,state);}
   const sequence=++state.sequence;
   // Sound changes on the tap. Serialize requests because the native transport
   // matches replies by message ID, including when the switch is tapped rapidly.
   apply(player,value);
   const save=async()=>{
    try{
     if(World.myPlayer!==player)return false;
     const reply=await req(35).default.sendProtoAsync(Handler.createChangeSettingMessgae(value));
     if(!reply)throw Error('设置保存失败，请重试。');
     if(reply.getByte()<0)throw Error(reply.getString());
     state.committed=value;
     if(showTip&&sequence===state.sequence&&World.myPlayer===player)req(15).Tips.show('设置成功');
     return true;
    }catch(error){
     if(sequence===state.sequence){
      apply(player,state.committed);
      if(World.myPlayer===player)req(1).default.alertMessage('设置未保存：'+(error.message||error));
     }
     return false;
    }
   };
   queue=queue.then(save,save);return queue;
  };
  const onTap=Settings.onTapCheckBox;
  Settings.onTapCheckBox=function(index){
   const before=this._tempSetting,player=World.myPlayer;
   onTap.call(this,index);
   if((before^this._tempSetting)&musicOff){
    const requested=this._tempSetting;
    this._proxy.processSettingLayer(requested).then(saved=>{
     if(!saved&&World.myPlayer===player&&this._tempSetting===requested){this._tempSetting=player.getSetting();this.initView();}
    });
   }
  };
 };
})();
