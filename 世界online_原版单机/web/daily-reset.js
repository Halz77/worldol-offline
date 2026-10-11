(() => {
 'use strict';
 window.installDailyTaskReset=req=>{
  const World=req(5).default,Handler=req(18).default,Service=req(43).default.Service;
  const seen=new Map();let pending=null;
  function refresh(){
   if(!pending)return;
   if(pending.role!==World.myPlayer?.id){pending=null;return;}
   // A world refresh also reloads actor data. Wait until the native battle and
   // reward display have finished so a midnight reset cannot interrupt them.
   if(req(54).default.ins.isFight)return;
   Handler.createWorldDataReflashMsg(true);
   seen.set(pending.role,pending.day);pending=null;
   req(15).Tips.show('已到凌晨 00:00，新手任务进度保留，其他任务已重置。');
  }
  Service.onNt(90021,event=>{
   const state=JSON.parse(event.body.getString());
   if(state.role!==World.myPlayer?.id||seen.get(state.role)>=state.day)return;
   pending=state;
  },seen);
  setInterval(refresh,250);
  return {refresh};
 };
})();
