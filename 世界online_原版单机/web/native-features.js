(() => {
 'use strict';
 window.installNativeFeatures=req=>{
  const UI=req(1).default,World=req(5).default,Facade=req(3).default,Base=req(6).default,Module=req(76).default;
  const modName='OfflineNativeFeatures',viewType='main',tap=egret.TouchEvent.TOUCH_TAP;
  const dialogs=new Map(),pageSize=24,nodeIds=new WeakMap();let nextNodeId=1;
  const nodeId=node=>{if(!node)return 0;if(!nodeIds.has(node))nodeIds.set(node,nextNodeId++);return nodeIds.get(node);};
  let mdr=null;
  // Existing feature controllers retain their validation, protocol and save
  // handling. Their DOM is now an invisible view model, rendered by Egret.
  const style=document.createElement('style');style.textContent='dialog[data-native-window]{display:none!important}';document.head.append(style);
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const labelFor=el=>el.getAttribute('aria-label')||clean(el.closest('label')?.childNodes[0]?.textContent)||el.placeholder||'输入内容';
  const textRow=(text,bold=false)=>({kind:'text',text:clean(text),bold});
  function rowsFor(node,rows=[]){
   if(node.nodeType===3){const t=clean(node.textContent);if(t)rows.push(textRow(t));return rows;}
   if(node.nodeType!==1||node.hidden||node.style.display==='none'||node.style.visibility==='hidden')return rows;
   const tag=node.tagName;
   if(['HEADER','SCRIPT','STYLE','OPTION'].includes(tag))return rows;
   if(tag==='BUTTON'){
    if(/^(关闭|Close)$/.test(clean(node.textContent)))return rows;
    rows.push({kind:'button',text:clean(node.textContent),el:node,disabled:node.disabled});return rows;
   }
   if(tag==='SELECT'){rows.push({kind:'select',text:labelFor(node)+'：'+(node.selectedOptions[0]?.textContent||'请选择'),el:node,disabled:node.disabled});return rows;}
   if(tag==='INPUT'||tag==='TEXTAREA'){rows.push({kind:'input',text:labelFor(node)+'：'+(node.value||'点击输入'),el:node,disabled:node.disabled});return rows;}
   if(tag==='DETAILS'){
    const summary=node.querySelector(':scope > summary');rows.push({kind:'details',text:(node.open?'▼ ':'▶ ')+clean(summary?.textContent),el:node});
    if(node.open)for(const child of node.children)if(child!==summary)rowsFor(child,rows);return rows;
   }
   if(tag==='DL'){
    for(const term of node.querySelectorAll(':scope > dt'))rows.push(textRow(term.textContent+'：'+(term.nextElementSibling?.textContent||'')));
    return rows;
   }
   if(tag==='TR'){rows.push(textRow([...node.children].map(c=>clean(c.textContent)).join('　｜　'),!!node.querySelector('th')));return rows;}
   if(/^(P|H[1-6]|LI|PRE)$/.test(tag)&&!node.querySelector('button,select,input,a,details')){rows.push(textRow(node.textContent,/^H/.test(tag)));return rows;}
   if(tag==='A'){rows.push(textRow(node.textContent));return rows;}
   for(const child of node.childNodes)rowsFor(child,rows);return rows;
  }
  class NativeView extends eui.Component{constructor(){super();this.skinName='WorldMapListSkin';}}
  class NativeMdr extends Base{
   constructor(){super(req(9).Layer.window);this._view=this.mark('_view',NativeView);this.page=0;this.scope=null;this.selector=null;this.last='';this.rows=[];}
   onInit(){
    super.onInit();const v=this._view;v.width=720;v.top=0;v.bottom=0;v.horizontalCenter=0;
    const oldScroller=v.listInfo.parent;oldScroller.visible=false;oldScroller.includeInLayout=false;
    this.content=new eui.Group();this.content.width=640;
    const layout=new eui.VerticalLayout();layout.gap=14;layout.horizontalAlign='center';layout.paddingTop=8;layout.paddingBottom=22;this.content.layout=layout;
    this.scroll=new eui.Scroller();this.scroll.skinName='ScrollerSkin';this.scroll.left=40;this.scroll.right=40;this.scroll.top=140;this.scroll.bottom=145;this.scroll.scrollPolicyH='off';this.scroll.viewport=this.content;v.addChild(this.scroll);
    this.back=this.button('返回',()=>this.goBack(),150);this.back.x=40;this.back.y=73;v.addChild(this.back);
    this.search=this.button('搜索选项',()=>this.searchOptions(),190);this.search.x=420;this.search.y=73;v.addChild(this.search);
    this.prev=this.button('上一页',()=>this.turn(-1),150);this.prev.x=65;this.prev.bottom=82;v.addChild(this.prev);
    this.next=this.button('下一页',()=>this.turn(1),150);this.next.x=490;this.next.bottom=82;v.addChild(this.next);
    this.pageLabel=new eui.Label();this.pageLabel.size=23;this.pageLabel.width=240;this.pageLabel.textAlign='center';this.pageLabel.x=240;this.pageLabel.bottom=96;v.addChild(this.pageLabel);
   }
   addListeners(){super.addListeners();this.onEgret(this._view.btnClose,tap,()=>UI.hideView(modName,viewType),this);}
   onShow(){super.onShow();mdr=this;this.dialog=dialogs.get(this._showArgs.id);this.dialog.setAttribute('open','');this.scope=null;this.selector=null;this.page=0;this.last='';egret.callLater(()=>this.render(true),this);}
   onHide(){this.dialog?.removeAttribute('open');this.selector=null;super.onHide();}
   button(text,callback,width=630){
    const b=new eui.Button();b.skinName='CancelBtnSkin';b.width=width;b.height=56;b.label=text;
    b.addEventListener(tap,()=>Promise.resolve(callback()).catch(e=>UI.alertMessage(e.message)),this);
    b.addEventListener(eui.UIEvent.CREATION_COMPLETE,()=>{if(b.labelDisplay){b.labelDisplay.size=23;b.labelDisplay.maxWidth=width-32;b.labelDisplay.textAlign='center';}},this);
    return b;
   }
   getRows(){
    if(this.selector){
     this.selector.el=this.liveControl(this.selector.el);
     const s=this.selector,options=[...s.el.options].filter(o=>!o.hidden&&(!s.query||o.textContent.includes(s.query)));
     return [textRow(labelFor(s.el)+' · '+options.length+' 项'),...options.map(o=>({kind:'option',text:(o.selected?'✓ ':'')+o.textContent,option:o,disabled:o.disabled}))];
    }
    return rowsFor(this.scope?this.dialog.querySelector(this.scope):this.dialog).filter(r=>r.text);
   }
   render(force=false){
    if(!this.isOpen||!this.dialog?.open)return;
    const rows=this.getRows(),title=clean(this.dialog.querySelector('h2')?.textContent)||'单机功能';
    const fingerprint=JSON.stringify([title,this.scope,this.selector?.query,this.page,rows.map(r=>[r.kind,r.text,r.disabled,nodeId(r.el||r.option)])]);
    if(!force&&fingerprint===this.last)return;this.last=fingerprint;
    this.rows=rows;this.page=Math.max(0,Math.min(this.page,Math.ceil(rows.length/pageSize)-1));
    this._view.textName.text=this.selector?labelFor(this.selector.el):title;
    this.back.visible=!!this.selector||!!this.scope;this.search.visible=!!this.selector;
    this.scroll.top=this.back.visible?140:85;
    this.prev.enabled=this.page>0;this.next.enabled=(this.page+1)*pageSize<rows.length;
    this.prev.alpha=this.prev.enabled?1:0.45;this.next.alpha=this.next.enabled?1:0.45;
    this.pageLabel.text=`${this.page+1} / ${Math.max(1,Math.ceil(rows.length/pageSize))}`;
    const oldScroll=this.content.scrollV;this.content.removeChildren();
    for(const row of rows.slice(this.page*pageSize,(this.page+1)*pageSize)){
     if(row.kind==='text'){
      const label=new eui.Label();label.width=620;label.size=row.bold?27:23;label.bold=!!row.bold;label.textColor=row.bold?0xf4d473:0xe4edf6;label.lineSpacing=9;label.text=row.text;label.touchEnabled=false;this.content.addChild(label);
     }else{
      const b=this.button(row.text,()=>this.activate(row));b.enabled=!row.disabled;b.alpha=row.disabled?0.45:1;b.height=Math.max(56,Math.ceil(row.text.length/24)*30+16);b.name=row.el?.id||row.kind;b.nativeRow=row;this.content.addChild(b);
     }
    }
    this.content.validateNow();this.content.scrollV=force?0:oldScroll;
   }
   turn(delta){this.page+=delta;this.render(true);}
   liveControl(el){return el.isConnected?el:[...this.dialog.querySelectorAll(el.tagName.toLowerCase())].find(n=>el.id?n.id===el.id:labelFor(n)===labelFor(el))||el;}
   goBack(){if(this.selector){const s=this.selector;this.selector=null;this.page=s.page;}else{this.scope=null;this.page=0;}this.render(true);}
   async searchOptions(){const value=await UI.showInputAsync('搜索选项','输入名称的一部分；留空显示全部。',null,50,70,null,'',null,true);if(value!==null&&this.selector){this.selector.query=String(value).trim();this.page=0;this.render(true);}}
   async activate(row){
    if(row.disabled)return;
    if(row.kind==='select'){this.selector={el:row.el,page:this.page,query:''};this.page=0;this.render(true);return;}
    if(row.kind==='option'){
     const s=this.selector,el=this.liveControl(s.el);el.value=row.option.value;el.dispatchEvent(new Event('change',{bubbles:true}));this.selector=null;this.page=s.page;this.render(true);return;
    }
    if(row.kind==='input'){
     const el=row.el,role=World.myPlayer?.id;
     const value=await UI.showInputAsync(labelFor(el),el.placeholder||'输入新值。',null,100,70,null,el.value?'当前：'+el.value:'',el.type==='number'?'0-9.\-':null,true);
     if(value!==null&&this.dialog.open&&role===World.myPlayer?.id){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));this.page=0;this.render(true);}return;
    }
    if(row.kind==='details'){row.el.open=!row.el.open;this.render();return;}
    if(row.el){
     const detail=row.el.closest('#recorded-results')?'#recorded-detail':row.el.closest('#career-results')?'#career-detail':null;
     row.el.click();if(detail){this.scope=detail;this.page=0;}setTimeout(()=>this.render(!!detail),100);
    }
   }
  }
  class NativeModule extends Module{initView(){this.keepMdr=true;this.regMdr(viewType,NativeMdr);}}
  new NativeModule(modName);
  function attach(dialog){
   dialogs.set(dialog.id,dialog);dialog.dataset.nativeWindow='true';
   dialog.showModal=()=>{if(!World.myPlayer?.id)return;dialog.setAttribute('open','');UI.showWin(modName,viewType,{id:dialog.id});};
   dialog.close=()=>{dialog.removeAttribute('open');if(mdr?.isOpen&&mdr.dialog===dialog)UI.hideView(modName,viewType);};
  }
  for(const dialog of document.querySelectorAll('dialog'))attach(dialog);
  const menu=document.createElement('dialog');menu.id='native-menu-model';menu.innerHTML='<header><h2>单机功能</h2></header>';document.body.append(menu);attach(menu);
  function openMenu(){
   menu.replaceChildren();const header=document.createElement('header'),title=document.createElement('h2');title.textContent='单机功能';header.append(title);menu.append(header);
   for(const source of document.querySelectorAll('#panel-body button')){
    const b=document.createElement('button');b.textContent=source.textContent;b.disabled=source.disabled;b.onclick=()=>{menu.close();source.click();};menu.append(b);
   }
   menu.showModal();
  }
  document.getElementById('panel-toggle').onclick=()=>World.myPlayer?.id?openMenu():document.getElementById('offline-panel').classList.toggle('open');
  const Main=req(604).MainMdr.prototype,show=Main.onShow;
  Main.onShow=function(...args){const result=show.apply(this,args);if(!this._view.offlineMenu){const b=new eui.Button();b.skinName='TabItemSkin_2';b.label='单机功能';b.width=164;b.height=46;b.horizontalCenter=0;b.top=8;b.addEventListener(tap,openMenu,this);this._view.offlineMenu=b;this._view.addChild(b);}document.getElementById('offline-panel').style.display='none';return result;};
  const City=req(654).MainCityMdr.prototype,showCity=City.onShow;
  City.onShow=function(...args){const result=showCity.apply(this,args);for(const key of ['btnRank','btnBook','btnAchievement','btnWarehouse','btnHome','btnSocial']){const b=this._view[key];b.visible=b.includeInLayout=b.enabled=true;}return result;};
  const mapModule=req(197);
  mapModule.default.prototype.fromListBytes=function(message){
   const list=new(req(24).default)(),count=message.getByte()&255;
   for(let i=0;i<count;i++){const item=new mapModule.MapChildItemVo();item.id=message.getShort();item.name=message.getString();item.info=message.getString();item.state=message.getByte();item.isNeedItem=message.getByte();list.addElement(item);}return list;
  };
  const Achievement=req(971).default.prototype;
  Achievement.onShow=function(){this.type.source=req(148).AchievementTypeData;this._view.btnRight.visible=this.type.length>4;this._view.btnList.selectedIndex=0;this.initView();this.updateView();this._proxy.doCreateAchieveLists(this._view.btnList.selectedItem.parameter);};
  const achieveInfo=Achievement.achieveManageMsg;
  Achievement.achieveManageMsg=function(...args){const value=achieveInfo.apply(this,args);this._view.achieveNum.text='待补';this._view.achieveRank.text='待补';return value;};
  const VIPShop=req(913).default.prototype,shopBase=req(36).default.prototype;
  VIPShop.onShow=function(){this.tabListMdr=[req(205).ShopBuyItemNewMdr];this.tabListData=[{lab:'VIP1 · 单机免费'}];return shopBase.onShow.call(this);};
  VIPShop.onChanged=function(){World.doBrowseMainForNew(req(4).default.SHOP_VIP_1);return shopBase.onChanged.call(this);};
  setInterval(()=>{if(mdr?.isOpen)mdr.render();},400);
  const api={openMenu,snapshot:()=>mdr?.isOpen?{id:mdr.dialog.id,title:mdr._view.textName.text,scope:mdr.scope,page:mdr.page,rows:mdr.rows.map(r=>({kind:r.kind,text:r.text,disabled:r.disabled})),native:true}:null};
  window.offlineNativeFeatures=api;return api;
 };
})();
