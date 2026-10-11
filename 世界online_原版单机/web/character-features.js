(() => {
 'use strict';
 window.installCharacterFeatures=req=>{
  const World=req(5).default,UI=req(1).default,Player=req(56).default,Proxy=req(261).default,
   Message=req(22).Message,Network=req(35).default,Service=req(43).default.Service,
   Notifier=req(3).default,Names=req(0),profiles=new Map();
  let busy=false;
  const itemDetails=fetch('/api/official-content').then(r=>r.json()).then(data=>new Set(data.itemIds)),itemInfo=UI.alertItemInfo;
  UI.alertItemInfo=async function(id,...args){
   if(id>0&&id<800000&&!(await itemDetails).has(id))return UI.alertMessage('这件道具的完整详情待定；已确认的升级消耗按页面显示执行。');
   return itemInfo.call(this,id,...args);
  };
  const getProxy=()=>Notifier.getProxy(Names.ModName.Role,Names.ProxyType.Role);
  const basePower=Player.prototype.getPower,God=req(113).RoleGodData,playerType=req(31).MODEL_TYPE.TYPE_PLAYER;
  Player.prototype.getPower=function(key){
   const profile=profiles.get(this.id),base=basePower.call(this,key);if(!profile)return base;
   // Native artifact lists also feed getPower. Replace that cache contribution
   // with persisted talent + artifact powers, including weapon-specific paths.
   const nativeArtifact=this.type===playerType?(God.getPower(this.isMyPlayer,key)|0):0;
   return base-nativeArtifact+profile.powers.reduce((n,[id,value])=>n+(id===key?value:0),0);
  };
  const dialog=document.getElementById('features-dialog'),content=document.getElementById('features-content');
  const node=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  const desc=attrs=>(attrs||[]).map(a=>req(4).default.getPowerDesc(a.k,a.v).replace(/\/c[0-9A-Fa-f]{6}|\/p/g,'')).join('；');
  function render(){
   const data=profiles.get(World.myPlayer?.id);content.replaceChildren();if(!data)return;
   const city=data.city;
   content.append(node('h3','个人城市'),node('p',city.unlocked?`${city.name} · ${city.level}级 · 繁荣度 ${city.prosperity} · 军力 ${city.army} · 金库铜币 ${city.coins}`:'完成“获得新的城市”任务后开放。'));
   content.append(node('h3','人物天赋'));
   for(const type of [0,1,2]){
    content.append(node('h4',['攻击','防御','通用'][type]));
    for(const t of data.talents.filter(t=>t.type===type))content.append(node('p',`${t.name}　${t.level}/${t.max}级　${t.pending?'下一等级待定':t.next?`下一级：${desc(t.next.attributes)}；免费学习`:'已满级'}`));
   }
   content.append(node('h3','人物神器'),node('p',`${data.artifact.name} · ${data.artifact.stage}阶 · 免费进阶与升级`));
   for(const kind of ['skills','decorations'])for(const part of data.artifact[kind])content.append(node('p',`${part.name}　${part.lv}级　${desc(part.attribute)||'尚未获得属性'}${part.pending?'；后续等级待定':''}`));
   content.append(node('h3','待定项目'));for(const text of data.pending)content.append(node('p',text));
  }
  // Native Handler treats a missing context as one-shot, even for onNt.
  Service.onNt(90015,event=>{const data=JSON.parse(event.body.getString());profiles.set(data.role,data);if(dialog.open)render();},profiles);
  async function act(action){
   if(busy)return;busy=true;
   try{
    action.role=World.myPlayer.id;
    const state=profiles.get(action.role)?.state;
    if(state&&action.op==='smelt')action.expectedStage=state.artifact.stage;
    if(state&&['skills','decorations'].includes(action.op))action.expectedLevel=state.artifact[action.op][action.id]||0;
    const m=new Message(90016);m.putString(JSON.stringify(action));const response=await Network.sendProtoAsync(m);
    if(!response)throw Error('没有收到养成操作结果，请刷新查看存档。');
    const status=response.getByte(),text=response.getString();if(status<0)throw Error(text);
    if(action.op==='talent')UI.hideView(Names.ModName.Role,Names.RoleViewType.RoleTalenLearn);
    const proxy=getProxy();proxy.doTalentList();proxy.doArtifactAll();req(15).Tips.show(text);if(dialog.open)render();
   }catch(error){UI.alertMessage(error.message);}finally{busy=false;}
  }
  // Use one request/response for failed upgrades too. The original talent
  // callback otherwise remains queued after a rejected request.
  Proxy.prototype.doTalentLearn=function(model){const next=model.dataNext;if(next)act({op:'talent',id:next.rankId,level:next.level});};
  Proxy.prototype.doArtifactLevel=function(){act({op:'smelt'});};
  Proxy.prototype.doArtifactSkillLevel=function(type){act({op:'skills',id:type});};
  Proxy.prototype.doArtifactAccLevel=function(type){act({op:'decorations',id:type});};
  const TalentDialog=req(854)?.default?.prototype;
  if(TalentDialog){const set=TalentDialog.setData;TalentDialog.setData=function(...args){const value=set.apply(this,args);if(!this._showArgs?.isPetSkill){this._view.talenDesc.text='免费学习，无需材料或货币';this._view.btn_Learn.label='免费学习';}return value;};}
  const EnchantView=req(469)?.BagItemEnChantUseMdr?.prototype;
  if(EnchantView)EnchantView.updateEnChantValue=function(){this._view.textEnChantValue.text='免费附魔，无需附魔点';};
  const Artifact=req(843).default.prototype,select=Artifact.selectTypeData;
  Artifact.onBtnLevel=function(){
   if(!this._proxy.data.PlayerVo.isMyPlayer)return;
   const type=this._view.typeList.selectedIndex;
   if(type===0)return this._proxy.doArtifactLevel();
   const row=(type===1?this._eleList:this._accList).getItemAt((type===1?this._view.eleList:this._view.accList).selectedIndex);
   if(row)return type===1?this._proxy.doArtifactSkillLevel(row.data.type):this._proxy.doArtifactAccLevel(row.data.type);
  };
  Artifact.selectTypeData=function(...args){
   if(this._proxy.data.PlayerVo.isMyPlayer)for(const [list,type] of [[this._eleList,29003],[this._accList,29005]]){
    const fresh=req(65).default.ins.getData(type)?.info;
    if(fresh)for(const row of list?.source||[]){const next=fresh.find(v=>v.type===row.data.type);if(next){row.data=next;row.infoLevel=req(65).default.ins.getData(29001)?.info.stage||row.infoLevel;list.itemUpdated(row);}}
   }
   const value=select.apply(this,args),data=profiles.get(World.myPlayer?.id);
   if(data&&this._proxy.data.PlayerVo.isMyPlayer){
    this._view.battleNum.visible=false;
    const kind=this.selectTypeIndex===1?'skills':this.selectTypeIndex===2?'decorations':null;
    const v=this._view;
    v.item.visible=false;v.itemNum.text='';v.itemName.text='免费，无需材料';v.hint.visible=false;
    if(kind){
     const index=kind==='skills'?v.eleList.selectedIndex:v.accList.selectedIndex,part=data.artifact[kind][index],locked=kind==='skills'&&data.artifact.stage<part?.type;
     v.levelGrop.visible=!!part&&part.lv<20&&!locked;v.topDesc.text=part?.lv>=20?'已达到最高等级':locked?'先免费提升神器阶数':'免费升级';v.btnLevel.label='免费升级';
    }else{
     const can=data.artifact.stage<4;v.levelGrop.visible=can;v.desc.visible=can;v.btnLevel.label='免费进阶';v.proBar.maximum=4;v.proBar.value=data.artifact.stage;
     v.exp.text='';v.expTop.text='';v.expLevel.text=can?`提升至${data.artifact.stage+1}阶`:'神器已达到最高阶';v.expDesc.text='无需材料或货币';
    }
   }
   return value;
  };
  const closeMenu=()=>document.getElementById('offline-panel').classList.remove('open');
  document.getElementById('city-open').onclick=()=>{closeMenu();UI.createCityInfoUI(World.myPlayer.id);};
  document.getElementById('talents-open').onclick=()=>{closeMenu();UI.openRole(World.myPlayer,4);};
  document.getElementById('artifact-open').onclick=()=>{closeMenu();getProxy().doArtifactAll();UI.openRole(World.myPlayer,5);};
  document.getElementById('features-open').onclick=()=>{closeMenu();render();dialog.showModal();};
  document.getElementById('features-close').onclick=()=>dialog.close();
  return {snapshot(){const p=profiles.get(World.myPlayer?.id);return p?{revision:p.revision,city:p.city,talents:p.state.talents,artifact:p.state.artifact,powers:p.powers}:null;}};
 };
})();
