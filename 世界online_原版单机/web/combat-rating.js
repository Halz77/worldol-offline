(() => {
 'use strict';
 window.installCombatRating=req=>{
  // Fit the complete score inside the native 188 px badge (digits start at 77 px).
  // Wrap the label's renderer so asynchronous bitmap-font loading is covered too.
  const fittedLabels=new WeakSet(),powerView=req(606).CombatPointView.prototype,updatePower=powerView.updatePower;
  powerView.updatePower=function(...args){
   const label=this.bmp_power;
   if(label&&!fittedLabels.has(label)){
    const render=label.updateTextDisplay;
    label.updateTextDisplay=function(...values){const result=render.apply(this,values);this.scaleX=Math.min(1,105/Math.max(1,this.width));return result;};
    fittedLabels.add(label);
   }
   return updatePower.apply(this,args);
  };
  // The original energy button starts at x=292, overlapping the score badge.
  const mainView=req(604).MainMdr.prototype,updateEnergy=mainView.onBloodBottle;
  mainView.onBloodBottle=function(...args){
   const result=updateEnergy.apply(this,args);
   if(this._view?.btnBlood)this._view.btnBlood.x=332;
   return result;
  };
  const dialog=document.getElementById('combat-rating-dialog'),content=document.getElementById('combat-rating-content'),World=req(5).default;
  let report,pending=false;
  const element=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
  async function refresh(){
   const id=World.myPlayer?.id;if(!id||pending)return;pending=true;
   try{
    const response=await fetch('/api/combat-rating?role='+id);if(!response.ok)throw Error('战力明细读取失败');
    const value=await response.json();if(World.myPlayer?.id!==id)return;report=value;
    content.replaceChildren(element('h3',`${report.name} · 战力 ${report.total.toLocaleString('zh-CN')}`));
    for(const part of report.parts){const section=element('section','');section.append(element('h4',`${part.name}　${part.score.toLocaleString('zh-CN')}`),element('p','基础分：'+part.formula));content.append(section);}
    content.append(element('p',`每部分基础分向下取整后乘以 ${report.multiplier||1}，再相加。强制命中按最高100%计分；评分最高2,147,483,647。`));
   }catch(error){content.replaceChildren(element('p',error.message));}finally{pending=false;}
  }
  document.getElementById('combat-rating-open').onclick=()=>{content.replaceChildren(element('p','正在读取战力明细…'));dialog.showModal();refresh();};
  document.getElementById('combat-rating-close').onclick=()=>dialog.close();
  setInterval(()=>{if(dialog.open)refresh();},2000);
  return {snapshot(){const p=World.myPlayer;if(!p||report?.role!==p.id)return null;const M=req(12).ModelConst;return {revision:report.revision,serverTotal:report.total,stats:Object.fromEntries(Object.keys(report.stats).map(key=>[key,p.get(M[key])]))};}};
 };
})();
