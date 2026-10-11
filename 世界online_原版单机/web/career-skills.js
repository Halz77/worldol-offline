(() => {
 'use strict';
 window.installCareerTeachers=req=>{
  const World=req(5).default,UI=req(1).default,types=req(0),constants=req(4).default;
  const dialog=document.getElementById('career-dialog'),results=document.getElementById('career-results'),detail=document.getElementById('career-detail');
  const search=document.getElementById('career-search'),profession=document.getElementById('career-profession'),category=document.getElementById('career-category');
  const teacherIDs=[1301,1302,1303,1304,1305,1310,1306,1311,1312],names=['侠客','修真','战士','法师','贤者','枪王','武圣','锤师','岚舞'];
  const nativeTeachers=new Set([304,305,306,307,308,309,310,311,400,401,402,403,600,601,602,603,607,608,609,610,1100,1101,1102,1103,1104,1105,1106,1110,1111,1112,...teacherIDs]);
  let data,selected,focusSkill=null,focusShop=null,openingSearch=false;
  const worldOpen=World.openShopSkill;
  World.openShopSkill=function(id){if(!openingSearch){focusShop=null;focusSkill=null;}openingSearch=false;return worldOpen.call(this,id);};
  const npcClass=req(74).default,npcFromBytes=npcClass.fromBytes;
  npcClass.fromBytes=function(...args){
   const npc=npcFromBytes.apply(this,args);
   if(npc.npcType===npcClass.NPC_POWER&&npc.teacherId?.some(id=>nativeTeachers.has(id))){
    npc.menuTeacher=names.map(name=>name+'技能');npc.teacherId=[...teacherIDs];npc.teacherReqMissionID=teacherIDs.map(()=>0);npc.teacherReqMissionState=teacherIDs.map(()=>0);
    npc.talkDetail='九职业导师已开放，选择职业学习或升级技能。单机免费学习。';
   }
   return npc;
  };
  // Bypass the remote feature/level gate only for our local career teachers.
  const ShopProxy=req(890).default,openShop=ShopProxy.prototype.doOpenSkillShop;
  ShopProxy.prototype.doOpenSkillShop=function(id){
   if(!nativeTeachers.has(id))return openShop.call(this,id);
   if(focusShop!==id){focusShop=null;focusSkill=null;}
   const service=req(43).default.Service;
   service.onProto(14001,req(11).default.alloc(this,this.onGetSkillShopList,[id]));
   service.sendProto(req(18).default.createBrowseSkillShop(id));
  };
  const ShopMdr=req(887).ShopSkillMdr,skillList=ShopMdr.prototype.getSkillListByType;
  ShopMdr.prototype.getSkillListByType=function(list,type){
   const rows=skillList.call(this,list,type)||[];
   return focusShop===World.shopID&&focusSkill?rows.filter(row=>row.skill.id===focusSkill):rows;
  };
  // ---- 导师处学习技能：点一次直接学到满级 -------------------------------
  // 原生一次只发「当前等级+1」；服务端 14002 支持一次学到目标等级（逐级过一遍），
  // 这里把这次请求的目标等级改成该技能的最高级。人物与宠物同一规则，点一下就满（点
  // 按钮后仍会弹原来那个确认面板，确认才学）。面板本身不新增按钮，也不改它的样子。
  const Learn=req(911).ShopSkillLearnMdr.prototype,SkillItem=req(888).ListShopSkillItem.prototype;
  const openLearn=SkillItem.tapBtnOperating,confirmLearn=Learn.onConfirm,renderLearn=Learn.updateView;
  const PET_SHOP=constants.SKILL_TYPE_PET;
  SkillItem.tapBtnOperating=function(){
   const data=this.data;if(!data?.skill)return;
   // 人物用自己，宠物店用出战宠物；取不到目标或列表没给出最高级时退回原生逐级学习。
   const target=constants.getTypeBySkillShopID(World.shopID)===PET_SHOP?World.myPlayer?.getPet():World.myPlayer;
   if(!target||data.maxLevel===undefined)return openLearn.call(this);
   // 这句是原版「已达最高级」的原话，满级时点按钮仍要原样提示。
   if(target.getSkillLevelByID(data.skill.id)>=data.skill.level)return UI.alertMessage('当前技能所可学习该技能已达最高级。欲学习更高技能可进入他人国家后找到技能所查看。');
   UI.showModal(types.ModName.Shop,types.ShopViewType.ShopSkillLearn,{target,skill:data.skill,maxLevel:data.maxLevel,oneKeyLearned:true});
  };
  // 一键学满只认上面这条路径打的 oneKeyLearned 标记：目标等级直接取最高级，学完自己收尾，
  // 别再弹一次「已达最高级」。其他入口（原生逐级学习）传不进这个标记，行为完全不变。
  Learn.updateView=function(){if(this._oneKeyMax)return;return renderLearn.call(this);};
  Learn.onConfirm=async function(){
   const args=this._showArgs;
   if(!args?.oneKeyLearned||!args?.target||!args?.skill||!(args.maxLevel>args.skill.level))return confirmLearn.call(this);
   const skill=args.skill.getClone?args.skill.getClone():{...args.skill};
   this._oneKeyMax=true;args.skill=skill;skill.level=args.maxLevel;
   try{await confirmLearn.call(this);}finally{this._oneKeyMax=false;}
   this.closeView();
   UI.alertMessage(`${skill.name} 已学到 ${args.maxLevel} 级。`);
  };
  function openTeacher(shop,id=null){
   if(!World.myPlayer?.id)return;
   if(req(54).default.ins.isFight)return UI.alertMessage('请先结束战斗再学习技能。');
   focusShop=shop;focusSkill=id;openingSearch=true;dialog.close();document.getElementById('offline-panel').classList.remove('open');World.openShopSkill(shop);
  }
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  // MOD(country-skill-shop)：国家专属技能只有 20 级，不能用写死的 22 去索引 levels，
  // 否则 levels[21] 是 undefined，整个导师目录一打开就抛错。按技能自身的上限取。
  const cap=s=>s.maxLevel||s.levels.length;
  function showDetail(s){
   selected=s;detail.replaceChildren(el('h3',s.name+' · '+s.profession+' · '+s.category));
   const controls=el('div',undefined,'career-levels'),label=el('label','查看等级 '),level=document.createElement('select');level.id='career-level';level.setAttribute('aria-label','查看技能等级');
   for(let n=1;n<=cap(s);n++)level.add(new Option(n+'级',String(n)));level.value=String(Math.min(cap(s),(World.myPlayer?.getSkillLevelByID(s.id)||0)+1));label.append(level);controls.append(label);
   const learn=el('button','在导师处学习');learn.onclick=()=>openTeacher(s.shop,s.id);controls.append(learn);detail.append(controls);
   const text=el('div');detail.append(text);
   function renderLevel(){
    const l=s.levels[Number(level.value)-1],learned=World.myPlayer?.getSkillLevelByID(s.id)||0;
    text.replaceChildren(el('p',`已学 ${learned}/${cap(s)} · 单机学习免费 · 人物最多同时学习 ${data.maxLearned} 个技能`));
    const ul=el('ul');for(const line of l.effects)ul.append(el('li',line));text.append(ul);
    for(const p of l.parameters)text.append(el('p',p.label+'：'+p.text));
    text.append(el('p',l.reconstructed?'本级使用重建数据，含社区资料与推算；特殊效果仍需实战校准。':'本级战斗定义来自已录原版数据。','career-note'));
    const own=World.myPlayer?.job===data.teachers.find(t=>t.name===s.profession)?.job,cost=l.learning[own?'own':'cross'];
    text.append(el('p',`资料参考费用：技能点 ${cost.sp}，铜币 ${cost.copper}，金叶 ${cost.goldLeaves}，黄金 ${cost.gold}。当前单机不扣费。高级费用为暂定估算。`,'career-note'));
   }
   level.onchange=renderLevel;renderLevel();
  }
  function renderResults(){
   if(!data)return;const term=search.value.trim().toLowerCase();
   const list=data.skills.filter(s=>(!profession.value||s.profession===profession.value)&&(!category.value||s.category===category.value)&&(!term||[s.name,s.profession,s.category,...s.levels[cap(s)-1].effects].join(' ').toLowerCase().includes(term)));
   const country=data.skills.filter(s=>cap(s)<22).length;
   document.getElementById('career-count').textContent=`找到 ${list.length} / ${data.skills.length} 个技能`;
   results.replaceChildren();for(const s of list){const row=el('button',s.name+'　'+s.profession+' · '+s.category,'career-result');row.onclick=()=>showDetail(s);results.append(row);}
   if(!selected||!list.includes(selected)){if(list[0])showDetail(list[0]);else{selected=null;detail.replaceChildren(el('p','没有匹配的技能，请换个关键词。'));}}
  }
  let ready;
  function load(){return ready??=fetch('/api/career-skills').then(r=>{if(!r.ok)throw Error('导师目录加载失败');return r.json();}).then(value=>{
   data=value;for(const t of data.teachers){profession.add(new Option(t.name,t.name));const button=el('button',t.name+'（'+t.count+'）');button.onclick=()=>openTeacher(t.shop);document.getElementById('career-teachers').append(button);}
   renderResults();return data;
  }).catch(error=>{ready=null;document.getElementById('career-count').textContent=error.message;throw error;});}
  search.oninput=profession.onchange=category.onchange=renderResults;
  document.getElementById('career-close').onclick=()=>dialog.close();
  document.getElementById('career-open').onclick=()=>{dialog.showModal();load().catch(()=>{});};
  return {snapshot(){const proxy=req(3).default._moduleMap[types.ModName.Shop]?.getProxy(types.ProxyType.Shop);return {id:World.shopID,focusSkill,skills:(proxy?.data?.ShopSkillAndMaxList||[]).map(row=>({id:row.skill.id,name:row.skill.name,nextLevel:row.skill.level,maxLevel:row.maxLevel}))};}};
 };
})();
