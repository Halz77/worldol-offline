const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {detailRequest,taskKey}=require('./details.cjs');
const {monsterTaskKey}=require('./monsters.cjs');
const {remoteKey}=require('./remote-monsters.cjs');
function gameRead(wc,script,timeoutMs=12000){
  return new Promise((resolve,reject)=>{
    let timer;
    const finish=(error,value)=>{clearTimeout(timer);wc.removeListener?.('destroyed',gone);wc.removeListener?.('render-process-gone',gone);error?reject(error):resolve(value);};
    const gone=()=>finish(Error('游戏页面连接已中断，采集暂停。'));
    wc.once?.('destroyed',gone);wc.once?.('render-process-gone',gone);
    timer=setTimeout(()=>finish(Error('游戏页面响应超时，采集暂停。')),timeoutMs);
    try{Promise.resolve(wc.executeJavaScript(script)).then(value=>finish(null,value),error=>finish(error));}catch(error){finish(error);}
  });
}
class CatalogCollector {
  constructor(root,publish){this.root=root;this.publish=publish;this.running=false;this.message='登录角色后可自动采集图鉴、鉴定范围和导师技能。';this.folder=path.join(root,'collection');this.file=path.join(this.folder,'catalog-v305.json');}
  async init(){
    const game=path.join(this.root,'../世界online_原版单机');this.core=await import(pathToFileURL(path.join(game,'tools/catalog-core.mjs')).href);
    this.official=JSON.parse(fs.readFileSync(path.join(game,'data/official-v305.json'),'utf8'));
    this.state=fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):this.core.initialState(this.official);
    if(this.state.clientVersion!==305)throw Error('Collection client version mismatch');
    this.save();
  }
  save(){fs.mkdirSync(this.folder,{recursive:true});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.state,null,2)+'\n');fs.renameSync(tmp,this.file);}
  snapshot(){return {running:this.running,active:!!this.active||!!this.launching,mode:this.mode||'catalog',message:this.message,current:this.current||'',coverage:this.core?this.core.coverage(this.state,this.official):null};}
  launch(wc,archive,mode='catalog',category='all'){if(this.launching||this.active)return;this.stopRequested=false;this.launching=true;this.job=this.start(wc,archive,mode,category).catch(error=>{this.message=error.message;this.publish();}).finally(()=>{this.launching=false;this.publish();});}
  async drain(){this.pause();await this.job;}
  pause(){this.stopRequested=true;this.running=false;this.message='已暂停；当前请求保存后停止，可继续采集。';this.publish();}
  async start(wc,archive,mode='catalog',category='all'){
    if(this.running||this.active)return;
    if(!wc||wc.isDestroyed()||!archive||archive.closed)throw Error('请先开始录制并登录角色。');
    const ready=await gameRead(wc,'globalThis.__worldolCatalogBridge?.status()');if(!ready?.ready)throw Error(ready?.poisoned?'上次请求超时，请刷新并重新登录后继续。':'请先登录正式服并进入角色地图。');
    // Require the actual resource manifest to match the archived client version.
    const version=await gameRead(wc,'String(globalThis.go?.res_version || "")');if(version!=='305')throw Error('当前客户端版本尚未核验：'+version);
    if(this.stopRequested)return;
    const detailMode=['details','monsters','remote-monsters'].includes(mode);
    const details=detailMode?archive.details:null;if(detailMode&&!details)throw Error('细节索引未就绪，请重新开始录制。');
    if(mode==='remote-monsters'){await this.collectRemoteMonsters(wc,archive,details,category);return;}
    if(mode==='monsters'||mode==='details'&&category==='missions'){await this.collectMonsters(wc,archive,details);return;}
    this.mode=mode;this.running=true;this.active=true;this.message='正在逐项采集，每次只发送一个查询；可随时暂停。';this.publish();
    try{
      await gameRead(wc,'globalThis.__worldolCatalogBridge.lock(true)');
      let failures=0;
      while(this.running){
        const q=(details?details.tasks(category):this.core.tasks(this.state,this.official))[0];if(!q){this.message='当前可查询目录已处理；继续打开新的资料页面可补充录制。';break;}
        const key=details?taskKey(q):this.core.key(q);this.current=q.name||key;this.publish();
        try{
          const request=details?detailRequest(q):this.core.request(q);archive.record('recorder.catalogQuery',{mode,key,request:q});
          const hex=await gameRead(wc,`globalThis.__worldolCatalogBridge.query(${JSON.stringify(request.hex)})`);
          if(details)details.acceptQuery(q,Buffer.from(hex,'hex'));
          else {const value=this.core.decode(q,Buffer.from(hex,'hex'),{capture:path.basename(archive.dir),origin:'catalog-collector'});this.core.applyResult(this.state,q,value);}
          failures=0;archive.record('recorder.catalogResult',{mode,key,success:true});
        }catch(error){
          const message=error.message;if(details)details.failQuery(q,message);else this.state.failed[key]={request:q,message,at:new Date().toISOString()};failures++;
          archive.record('recorder.catalogResult',{mode,key,success:false,message});
          if(/超时|登录|连接|version/i.test(message)||failures>=3){this.message='采集已暂停：'+message;this.running=false;}
        }
        if(details)details.save();else this.save();this.publish();if(this.running)await new Promise(resolve=>setTimeout(resolve,800));
      }
    }finally{if(!wc.isDestroyed())await gameRead(wc,'globalThis.__worldolCatalogBridge.lock(false)',1500).catch(()=>{});this.running=false;this.active=false;this.current='';if(details)details.save();else this.save();this.publish();}
  }
  async collectMonsters(wc,archive,details){
    const monsters=details.monsterCollection,scope=monsters.scope();
    if(!scope.npcIds.length)throw Error('当前地图尚未下发任务 NPC；已收到的怪物仍会自动保存。');
    this.mode='monsters';this.running=true;this.active=true;this.message='正在补齐怪物与任务线，包含当前地图已下发但尚未显示的任务 NPC。';this.publish();
    try{
      await gameRead(wc,'globalThis.__worldolCatalogBridge.lock(true)');
      const epoch=await gameRead(wc,`globalThis.__worldolCatalogBridge.armNpcs(${JSON.stringify(scope)})`);
      while(this.running&&!this.stopRequested){
        const q=monsters.tasks(scope)[0];if(!q){this.message='当前地图全部已下发任务 NPC 已处理（含隐藏项）。未返回的资料继续待补。';break;}
        const key=monsterTaskKey(q);this.current=q.name;this.publish();
        archive.record('recorder.catalogQuery',{mode:'monsters',key,request:{npcId:q.npcId,mapId:q.mapId,instanceId:q.instanceId}});
        try{
          const hex=await gameRead(wc,`globalThis.__worldolCatalogBridge.queryNpc(${JSON.stringify({npcId:q.npcId,epoch})})`);
          monsters.acceptQuery(q,Buffer.from(hex,'hex'));
          archive.record('recorder.catalogResult',{mode:'monsters',key,success:true});
        }catch(error){
          monsters.failQuery(q,error.message);archive.record('recorder.catalogResult',{mode:'monsters',key,success:false,message:error.message});
          if(error.code==='NPC_UNAVAILABLE')this.message='该 NPC 未返回资料，保留待补并继续：'+q.name;
          else{this.message='怪物采集已暂停：'+error.message;this.running=false;}
        }
        details.save();this.publish();if(this.running)await new Promise(resolve=>setTimeout(resolve,800));
      }
    }finally{
      if(!wc.isDestroyed())await gameRead(wc,'globalThis.__worldolCatalogBridge.lock(false)',1500).catch(()=>{});
      this.running=false;this.active=false;this.current='';details.save();this.publish();
    }
  }
  async collectRemoteMonsters(wc,archive,details,scope='all'){
    if(!['all','tower'].includes(scope))throw Error('Unknown remote collection scope');
    const remote=details.remoteMonsters;
    this.mode='remote-monsters';this.running=true;this.active=true;
    this.message=scope==='tower'?'正在单独采集永泽塔普通/困难目录和怪物属性预览。':'正在免跑图读取世界 Boss、永泽塔普通/困难目录和怪物属性预览。';this.publish();
    try{
      await gameRead(wc,'globalThis.__worldolCatalogBridge.lock(true)');
      const epoch=await gameRead(wc,'globalThis.__worldolCatalogBridge.beginRemote()');
      let towerMode=null;
      while(this.running&&!this.stopRequested){
        let q=remote.tasks(scope)[0];
        if(!q){this.message='所选目录已处理；失败 '+remote.snapshot().failed+' 项。未下发的属性、技能和 AI 继续待补。';break;}
        // Tower monster replies carry no mode or floor ID. Re-read the mode's
        // directory on resume, then process one floor at a time in that mode.
        if(q.kind==='tower-preview'&&towerMode!==q.mode)q={kind:'tower-directory',mode:q.mode,name:'永泽塔'+(q.mode===2?'困难':'普通')+'目录'};
        this.current=q.name;this.publish();const key=remoteKey(q);
        archive.record('recorder.catalogQuery',{mode:'remote-monsters',key,request:q});
        try{
          if(q.kind.endsWith('-preview'))await gameRead(wc,`globalThis.__worldolCatalogBridge.armRemoteDirectory(${JSON.stringify({...remote.scope(q),epoch})})`);
          const response=await gameRead(wc,`globalThis.__worldolCatalogBridge.queryRemoteResult(${JSON.stringify({...q,epoch})})`);
          if(!response?.ok)throw Error(response?.error||'活动查询没有返回有效结果。');
          remote.acceptQuery(q,Buffer.from(response.hex,'hex'));
          if(q.kind==='tower-directory')towerMode=q.mode;
          archive.record('recorder.catalogResult',{mode:'remote-monsters',key,success:true});
        }catch(error){
          remote.failQuery(q,error.message);archive.record('recorder.catalogResult',{mode:'remote-monsters',key,success:false,message:error.message});
          // Explicit server rejection is attributable to this one read. Other
          // errors stop the session so a late tower reply cannot shift floors.
          if(/活动查询失败/.test(error.message)){
            this.message='该活动未返回资料，保留待补：'+q.name;
            if(q.kind==='tower-directory')remote.directories.delete(key);
          }else{this.message='免跑图采集已暂停：'+error.message;this.running=false;}
        }
        details.save();this.publish();if(this.running)await new Promise(resolve=>setTimeout(resolve,800));
      }
    }finally{
      if(!wc.isDestroyed())await gameRead(wc,'globalThis.__worldolCatalogBridge.lock(false)',1500).catch(()=>{});
      this.running=false;this.active=false;this.current='';details.save();this.publish();
    }
  }
  retry(){if(this.running||this.active||this.launching)throw Error('请先暂停采集。');this.state.failed={};this.save();this.message='失败项已加入待采集队列。';this.publish();}
}
module.exports={CatalogCollector,gameRead};
