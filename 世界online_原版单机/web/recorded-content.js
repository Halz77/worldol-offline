(() => {
 'use strict';
 window.installRecordedVitality=req=>{
  // The offline login does not load the online activity-notification list.
  // Seed its native daily-game entry so both restored daily tabs are visible.
  req(45).default.getInstance.setFakeRed();
  const View=req(748).MissionActiveMdr,getItem=View.prototype.getItem,show=View.prototype.doEnterInfo;
  View.prototype.getItem=function(...args){return this._proxy?.vitalityData?.vItemVitality?getItem.apply(this,args):[0,-1];};
  View.prototype.doEnterInfo=function(...args){if(!this._proxy?.vitalityData)return;const result=show.apply(this,args);this._view.desc.text='每日零点刷新，达标可领奖；未接入的项目和VIP加成待定。';return result;};
 };
 window.installRecordedContent=req=>{
  window.installRecordedVitality(req);
  const $=id=>document.getElementById(id),World=req(5).default,Message=req(22).Message,Network=req(35).default,Item=req(32).default,UI=req(1).default;
  const dialog=$('recorded-dialog'),category=$('recorded-category'),search=$('recorded-search'),results=$('recorded-results'),detail=$('recorded-detail'),status=$('recorded-status');
  const names={petProfiles:'宠物全品质资料（含推算）',finishedPets:'成品宠物 · 97级样本',pets:'已录宠物图鉴 · 1级',petSamples:'实际宠物样本',petSkills:'宠物逐级技能（含推算）',petEggs:'宠物蛋',petEquipment:'宠物装备',titles:'称号',sets:'套装 / VIP加成',vip:'VIP原版资料',gems:'宝石',maps:'地图与NPC',missions:'任务',taskRewards:'任务奖励（按等级）',drops:'怪物掉落（按等级）',guides:'原版攻略',items:'道具目录'};
  const grades=['普通','优秀','精良','史诗','传说'];let data,selected,page=0,busy=false,petShop=false;
  const clean=v=>String(v??'').replace(/\/c[0-9a-fA-F]{6}|\/p/g,'');
  const desc=(id,n)=>clean(req(4).default.getPowerDesc(id,n));
  const node=(tag,text,parent=detail)=>{const el=document.createElement(tag);el.textContent=clean(text);parent.append(el);return el;};
  const action=(label,fn)=>{const b=node('button',label);b.type='button';b.onclick=async()=>{if(busy)return;busy=true;b.disabled=true;status.textContent='正在处理…';try{await fn();}catch(e){status.textContent=e.message||String(e);}finally{busy=false;b.disabled=false;}};};
  async function request(type,write){const m=new Message(type);write?.(m);const r=await Network.sendProtoAsync(m);if(!r)throw Error('本地服务没有返回结果。');if(r.getByte()<0)throw Error(r.getString());return r;}
  const powers=p=>[1,2,3].filter(n=>p['power'+n]).map(n=>desc(p['power'+n],p['powerValue'+n]??p['value'+n])).join('；');
  function label(row,index){if(['drops','taskRewards'].includes(category.value))return `${row.level??'未定'}级 · ${row.name}`;if(category.value==='sets')return `套装 ${row.id}`;if(category.value==='vip')return row.description?'VIP特权与赠品':row.offers?(row.protocol===11053?'开通套餐':'升级套餐'):'录制角色的VIP上限';return row.name||row.title||row.caption||`记录 ${row.id??index+1}`;}
  function draw(row){
   selected=row;detail.replaceChildren();node('h3',label(row,0));const kind=category.value;
   if(kind==='petProfiles'){
    const p=row.baseline;node('p',`${grades[row.grade]} · 1级 · 成长 ${p.grow/20}星 · 悟性 ${p.comprehension/20}星`);
    node('p',`力量／体质／敏捷／智力／感知：${p.baseStats.join(' / ')}`);node('p',`基础攻击 ${p.attackMin}～${p.attackMax} · ${p.attackTimes+1}次 · 命中 ${p.hit}`);
    node('p',`天生技能：${p.skills.map(s=>s.name).join('、')}`);
    node('p',row.provenance.origin==='captured'?'初始数值来自抓包；缺失的后续成长和技能等级使用单机推算。':'初始资料含社区资料和单机推算，缺失外观沿用同系已录模型。');
    if(row.grade===4)node('p',`传说宠物蛋可开出，概率 1/${data.petCatalog.legendary}；50万铜币一个，孵化为1级。`);
   }else if(['pets','petSamples','finishedPets'].includes(kind)){
    node('p',`${grades[row.grade]||row.grade} · ${row.level}级 · 成长 ${row.grow} · 悟性 ${row.comprehension}`);
    node('p',`基础五维：力量 ${row.attributes.strength} / 体质 ${row.attributes.constitution} / 敏捷 ${row.attributes.agility} / 智力 ${row.attributes.intelligence} / 感知 ${row.attributes.wisdom}`);
    node('p',`录制时生命 ${row.hp} / 法力 ${row.mp} · 攻击 ${row.attackMin}–${row.attackMax} · 命中 ${row.hit} · 攻击次数 ${row.attackTimes}`);
    node('p',row.description);node('p',data.growthNotice).className='recorded-note';
    action(petShop?'免费购买并放入背包':'免费领取这份宠物到背包',async()=>{const r=await request(90004,m=>m.putInt(row.id)),item=Item.fromBytes(r);World.myPlayer.bag.setItem(item,item.slotPos);req(3).default.sendNt(req(2).BagEvent.BAG_EQUIPMENT_UPDATE);status.textContent='宠物已加入背包并保存，未消耗货币。可在背包里选择出战。';});
    node('h4','已录技能');for(const s of row.skills)node('p',`${s.name} · ${s.level}级${s.addLevel?' +'+s.addLevel:''}\n${powers(s)}${s.info?'\n'+s.info:''}`);
    if(row.equipment.length){node('h4','已装备宠物装备');for(const i of row.equipment)node('p',data.petEquipment.find(e=>e.id===i.itemId)?.name||`道具 ${i.itemId}`);}
   }else if(kind==='titles'){
    node('p',powers(row));action('使用并保存称号',()=>setTitle(row.id));action('取消当前称号',()=>setTitle(-1));
   }else if(kind==='sets'){
    const gear=data.items.filter(i=>(i.itemSet&255)===row.id);node('p',gear.map(i=>i.name).join('、')||'当前目录未收录此套装的装备名称');
    for(const b of row.bonuses)node('p',`${b.pieces}件${b.vipLevel?' · VIP '+b.vipLevel:''}：${desc(b.power,b.value)}`);
    node('p','满足穿戴件数和VIP等级时自动生效。');
   }else if(kind==='vip'){
    node('p',row.description||'');if(row.nextLevelExp!==undefined)node('p',`此录制页面的VIP经验：${row.currentExp} / ${row.nextLevelExp}`);
    for(const i of row.items||[])node('p',`${i.name}：${powers(i)}${i.vipLevelReq?' · 要求 VIP '+i.vipLevelReq:''}`);
    for(const o of row.offers||[])node('p',`原版套餐：${o.description}`);
    if(row.maxVip!==undefined)node('p',`这次返回值为 ${row.maxVip}，仅代表这次录制，不作为本地VIP等级上限。`);
    node('p','本地VIP仍可免费设为0–9级。未录到的各级赠品、每日奖励和充值成长表尚未补造。').className='recorded-note';
    action('设置本地VIP / 查看穿戴加成',async()=>{dialog.close();$('vip-open').click();status.textContent='';});
   }else if(kind==='maps'){
    action('打开原版地图列表',async()=>{dialog.close();req(197).default.Instance.doGetMapList({id:0,name:'单机已恢复地图'});status.textContent='请在原版地图列表选择：'+row.name;});
    for(const n of row.npcs){node('h4',`${n.name||'场景对象'}（${n.x}, ${n.y}）`);node('p',n.welcome||n.talk||'');}
   }else if(kind==='drops'){
    const rates=data.dropInfo.policy.rates[row.tier],multiplier=data.dropInfo.policy.rateMultiplier??1;
    node('p',`${row.map} · ${row.level}级 · ${({normal:'普通',elite:'精英',boss:'Boss'})[row.tier]}`);
    node('p',`每场胜利独立判定：装备 ${rates.equipment*multiplier*100}%、材料 ${rates.material*multiplier*100}%，各最多1件。概率为单机设定。`);
    node('p',`该组录到 ${row.observedWins} 次胜利、${row.observedItemBattles} 次物品结算；样本频次不代表官方爆率。`).className='recorded-note';
    node('h4','装备池');node('p',row.equipment.map(i=>`${i.name}（${i.level}级）`).join('、')||'无已录装备');
    node('h4','材料池');node('p',row.materials.map(i=>i.name).join('、'));
    if(row.extras.length)node('p',`其他已录物品（单机 ${rates.extra*multiplier*100}%）：${row.extras.map(i=>i.name).join('、')}`);
    for(const d of row.taskDrops)node('p',`任务物品：${d.name}，每场最多 ${d.quantity} 件，仅接取相应任务且数量不足时掉落。来源：${d.basis}。`);
    node('p','背包满时掉落会保存。腾出空间后点击背包“整理”补领。');
   }else if(kind==='taskRewards'){
    node('p',`${row.map||'地图待录'} · ${row.level??'未定'}级（${row.levelBasis}）`);
    node('p',`经验 ${row.exp} · 金叶 ${row.silver} · 铜币 ${row.coins}`);
    for(const [key,title] of [['rewardItems','固定奖励'],['selectItems','选一奖励']])for(const r of row[key])node('p',`${title}：${r.name} × ${r.quantity}${r.available?'':'（缺少道具详情，暂不发放）'}`);
    for(const r of row.requirements)node('p',`收集 ${r.name} × ${r.quantity}：${r.sources.map(s=>`${s.map} / ${s.name}（${s.level}级，${s.basis}）`).join('；')||'怪物来源待录，可能来自兑换或其他玩法'}`);
    node('p','等级用于查找任务，不新增接取限制。');
   }else if(kind==='missions'){
    node('p',`${row.map||'交付地图尚未录到'} · ${row.level}级 · 经验 ${row.exp} · 金叶 ${row.money2} · 铜币 ${row.money3}`);
    node('p',row.desc);node('p',row.dialogStartFinish);
    node('p',row.blockers.length?'暂缺：'+row.blockers.join('；'):'已接入接取、条件检查、交付和奖励保存；需到对应NPC完成。').className='recorded-note';
    for(const r of row.rewardItems||[])node('p',`固定奖励：${r.name} × ${r.quantity}`);
    for(const r of row.selectItems||[])node('p',`可选奖励：${r.name} × ${r.quantity}`);
   }else if(kind==='gems'||kind==='petEquipment'||kind==='petEggs'||kind==='petSkills'){
    if(row.grade!==undefined)node('p',`${grades[row.grade]||row.grade}${row.reqLv?' · 要求'+row.reqLv+'级':''}`);
    if(row.level)node('p',`${row.level}级 · ${['','被动','自动','主动'][row.type]||''}`);
    node('p',powers(row));node('p',row.info||'');if(row.skill)node('p',`附带技能：${row.skill.name} ${row.skill.level}级`);
    if(kind==='petSkills')node('p','数据来源：'+({captured:'抓包',community:'社区资料',estimated:'单机推算'}[row.provenance?.origin]||'抓包'));
    if(kind==='petEggs')node('p','VIP商店“宠物”页及补给商人“宠物蛋”分类可购买，50万铜币一个。').className='recorded-note';
    if(kind==='gems')node('p','普通宝石通过装备工坊镶嵌；仍沿用你设置的前30颗100%、后续50%规则。');
   }else if(kind==='guides'){
    for(const e of row.entries||[]){node('h4',e.name||e.title||'');if(e.content||e.info||e.desc||e.text)node('p',e.content||e.info||e.desc||e.text);const page=data.guides.find(p=>p.id===e.id);if(page)action('查看 '+(e.name||page.title),async()=>{draw(page);status.textContent='';});}
   }else node('p',`道具ID ${row.id} · ${grades[row.grade]||row.grade}${row.reqLv?' · 要求'+row.reqLv+'级':''}。可从原版道具图鉴查看完整属性；符合供给规则的物品已加入补给商人。`);
  }
  async function setTitle(id){const r=await request(11027,m=>m.putShort(id)),p=World.myPlayer;p.setTitle(r.getString());p.titlePower1=r.getShort();p.titlePowerValue1=r.getShort();p.titlePower2=r.getShort();p.titlePowerValue2=r.getShort();p.checkHPMP();UI.updateWorldPlayerInfoUI();status.textContent=id===-1?'称号已取消并保存。':'称号已保存，属性立即生效。';}
  function render(){
   if(!data)return;const rows=data[category.value]||[],q=search.value.trim().toLowerCase();
   const filtered=rows.filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q)),pages=Math.max(1,Math.ceil(filtered.length/60));page=Math.min(page,pages-1);results.replaceChildren();
   $('recorded-count').textContent=`${names[category.value]}：${filtered.length} 条 · 第 ${page+1}/${pages} 页`;
   for(const [i,row] of filtered.slice(page*60,page*60+60).entries()){const button=node('button',label(row,i),results);button.type='button';button.onclick=()=>draw(row);}
   $('recorded-prev').disabled=page===0;$('recorded-next').disabled=page>=pages-1;
   if(filtered.length)draw(filtered[page*60]);else detail.replaceChildren();
  }
  for(const [key,title] of Object.entries(names)){const o=document.createElement('option');o.value=key;o.textContent=title;category.append(o);}
  async function open(shop=false){if(!World.myPlayer?.id)return;petShop=shop;category.disabled=false;for(const o of category.options)o.hidden=shop&&!['finishedPets','pets'].includes(o.value);if(shop){category.value='finishedPets';search.value='';page=0;}$('recorded-title').textContent=shop?'宠物商城':'已录内容还原';$('recorded-help').textContent=shop?'成品宠物免费购买，保留成长、技能和已有装备，购买后恢复100天寿命。可切换分类选购1级宠物。':'宠物可按录制模板免费领取，称号可直接使用。套装效果随穿戴和VIP等级自动生效。';$('offline-panel').classList.remove('open');if(!dialog.open)dialog.showModal();status.textContent='';try{data=await fetch('/api/recorded-content',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('读取录制资料失败');return r.json();});render();}catch(e){status.textContent=e.message;}}
  const openPetShop=()=>{if(dialog.open)dialog.close();$('offline-panel').classList.remove('open');return req(67).ShopItem.openItemShop(918);};
  $('recorded-open').onclick=()=>open();$('pet-shop-open').onclick=openPetShop;
  $('recorded-close').onclick=()=>dialog.close();category.onchange=()=>{page=0;render();};search.oninput=()=>{page=0;render();};$('recorded-prev').onclick=()=>{page--;render();};$('recorded-next').onclick=()=>{page++;render();};
  return {open,openPetShop};
 };
})();
