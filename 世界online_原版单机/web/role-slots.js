(() => {
 'use strict';
 window.installOfflineRoleSlots=req=>{
  const mod427=typeof req==='function'?req(427):null;
  const RoleList=mod427&&mod427.RoleListMdr2&&mod427.RoleListMdr2.prototype;
  if(!RoleList){console.warn('[offline] RoleListMdr2 unavailable; role-slot patch skipped');return;}
  const pageSize=3,limit=6;
  const updateSelected=RoleList.updateSelectedPlayer,createRole=RoleList.createRole;
  // Keep one empty slot reachable until the store's six-role limit is reached.
  // Existing saves above that limit must still expose every recorded role.
  RoleList.updatePage=function(){
   const rows=this._proxy.data.allPlayerList,canCreate=rows.length<limit;
   this.maxPage=Math.max(1,Math.ceil((rows.length+(canCreate?1:0))/pageSize));
   this.curPage=Math.max(1,Math.min(this.curPage,this.maxPage));
   const view=this._view,offset=(this.curPage-1)*pageSize;
   view.btnLeft.visible=this.curPage>1;view.btnRight.visible=this.curPage<this.maxPage;
   view.lab_page.visible=this.maxPage>1;view.lab_page.text=this.curPage+'/'+this.maxPage;
   for(let i=0;i<pageSize;i++){
    const item=view['role_'+i],role=rows[offset+i];item.setData(role);
    item.img_create.visible=!role&&canCreate;item.touchEnabled=!!role||canCreate;
    item.role_selected.visible=!!role&&this.curItem===item;
   }
   this.updateSelectedPlayer();
  };
  RoleList.updateSelectedPlayer=function(){
   if(!this.curItem?.data){
    this._view.btnDelete.visible=false;this._view.img_role.source=null;
    if(this._sp!=null){this.removeSpr(this._sp);this._sp=null;}
   }
   return updateSelected.call(this);
  };
  RoleList.createRole=function(){
   if(this._proxy.data.allPlayerList.length>=limit){req(15).Tips.show('每个本地存档最多保留 6 个角色。');return;}
   return createRole.call(this);
  };
  RoleList.tapLeft=function(){if(this.curPage<=1)return;this.curPage--;this.curItem=this._view.role_2;this.updatePage();};
 };
})();
