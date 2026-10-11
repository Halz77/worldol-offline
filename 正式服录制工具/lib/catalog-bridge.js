// Installed only in this recorder's own game view, before the game starts.
// Uses its existing authenticated connection. No credentials are exported.
(() => {
  // Shared with the archive indexer. This is a scene identity checksum, not an
  // integrity hash; archived sources retain their separate SHA-256 hashes.
  const scenes=[2,10503,10506,10510,10523];
  const sceneToken=b=>{let h=2166136261;for(const v of b)h=Math.imul(h^v,16777619);return b.length+':'+(h>>>0);};
  function sceneHeader(b){
    const v=new DataView(b.buffer,b.byteOffset,b.byteLength),type=v.getUint16(2);
    if(v.getUint16(0)!==b.length||!scenes.includes(type)||v.getInt8(4)<0)return null;
    let pos=5;if(type===2)pos+=31;if(type===10523&&v.getInt8(pos++)===1)pos+=6;
    const instanceId=v.getInt32(pos);pos+=4;
    const allocated=instanceId>=10000&&instanceId<=31999;
    const mapId=allocated?v.getInt16(pos):instanceId;if(allocated)pos+=2;
    pos+=2;const flags=v.getInt32(pos);pos+=4;
    return {instanceId,mapId,flags,offset:pos,token:sceneToken(b)};
  }
  if(typeof module==='object'&&module.exports){module.exports={sceneHeader,sceneToken,scenes};return;}
  if(globalThis.__worldolCatalogBridge)return;
  const Native=globalThis.WebSocket,send=Native.prototype.send;
  let game=null,pending=null,poisoned=false,locked=false;
  let scene=null,epoch=0,inBattle=false,npcScope=null,nativeNpcPending=[];
  let remoteScope=null,nativeRemotePending=[];
  const remoteReplies=new Map([[32001,32002],[30001,30002],[13121,13121],[13101,13101]]);
  const allowed=new Map([[32101,32102],[16051,16051],[12060,12060],[14001,14001],[16005,16005],
    [11501,11501],[11053,11053],[11055,11055],[11160,11160],[12052,12052],[11026,11026],
    [15514,15514],[16009,16009]]);
  const bytes=data=>data instanceof ArrayBuffer?new Uint8Array(data):ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):null;
  const parse=data=>{const b=bytes(data);if(!b||b.length<4)return null;const v=new DataView(b.buffer,b.byteOffset,b.byteLength);return v.getUint16(0)===b.length?{b,type:v.getUint16(2)}:null;};
  const readServerError=(p,type)=>{
    // This captured v305 business rejection uses protobuf 25003, not protocol 5.
    // It carries no request ID: associate only the exact observed Boss-directory
    // rejection, while our exclusive query owns that otherwise idle connection.
    if(type===32001&&p.type===25003&&p.b.length<=1024){
      try{
        let pos=4,code=null,message=null;const b=p.b;
        const varint=()=>{let n=0n;for(let i=0;i<10;i++){if(pos>=b.length)throw Error('truncated');const v=b[pos++];n|=BigInt(v&127)<<BigInt(i*7);if(!(v&128))return n;}throw Error('varint');};
        while(pos<b.length){const tag=Number(varint());if(tag===8&&code===null)code=Number(BigInt.asIntN(32,varint()));else if(tag===18&&message===null){const n=Number(varint());if(n<0||pos+n>b.length)throw Error('length');message=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(pos,pos+n));pos+=n;}else throw Error('field');}
        if(code===-2&&message==='不在活动时间内')return message;
      }catch{/* Unrecognized notices continue to the original client. */}
    }
    // v305 protocol 5: signed status, a three-byte UTF-16BE character count,
    // then text. Only an error explicitly naming our in-flight read is ours.
    if(p.type!==5||p.b.length<8||p.b[4]!==253)return null;
    const b=p.b,n=b[5]*65536+b[6]*256+b[7];if(n>4096||8+n*2!==b.length)return null;
    let message='';for(let i=8;i<b.length;i+=2)message+=String.fromCharCode(b[i]*256+b[i+1]);
    return new RegExp('消息类型\\s*[:：]\\s*'+type+'\\b').test(message)?message:null;
  };
  const reject=message=>{if(pending){clearTimeout(pending.timer);pending.reject(Error(message));pending=null;}};
  const invalidate=reason=>{epoch++;npcScope=null;remoteScope=null;if(pending?.npcId!==undefined||pending?.remote)pending.cancelled=reason;};
  Native.prototype.send=function(data){
    const p=parse(data);
    if(this===game&&p){
      if(remoteReplies.has(p.type)){
        if(pending?.remote){(pending.deferred??=[]).push({ws:this,data});pending.cancelled='游戏正在读取活动资料，免跑图采集已暂停。';return;}
        const v=new DataView(p.b.buffer,p.b.byteOffset,p.b.byteLength);
        nativeRemotePending.push({type:p.type,reply:remoteReplies.get(p.type),kind:p.type===13121&&p.b.length>=10?v.getInt16(4):null,id:p.type===13121&&p.b.length>=10?v.getInt32(6):null});
      }
      if(p.type===14501){
        // A native auto-navigation query can outlive the input overlay. Delay
        // it until our response is consumed so it cannot receive our reply.
        if(pending?.npcId!==undefined){(pending.deferred??=[]).push({ws:this,data});pending.cancelled='游戏正在打开 NPC，自动采集已暂停。';return;}
        if(p.b.length>=8)nativeNpcPending.push(new DataView(p.b.buffer,p.b.byteOffset).getInt16(4));
      }
      if([12501,12503,12504,12508,30003,30005,32003,32005].includes(p.type)){inBattle=true;invalidate('已进入战斗或活动操作，怪物采集暂停。');}
      if([10503,10506,10510,10523].includes(p.type)){scene=null;invalidate('正在切换地图，请稍后补齐。');}
      if([14502,14503,14504].includes(p.type))invalidate('任务状态已变化，请重新补齐当前地图。');
    }
    return send.call(this,data);
  };
  for(const name of ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','keydown','keyup','click'])globalThis.addEventListener(name,event=>{if(locked){event.preventDefault();event.stopImmediatePropagation();}},{capture:true,passive:false});
  globalThis.WebSocket=new Proxy(Native,{construct(target,args){
    const ws=Reflect.construct(target,args);let trusted=false;try{const u=new URL(args[0]);trusted=u.protocol==='wss:'&&/(^|\.)good321\.net$/.test(u.hostname);}catch{}
    if(trusted){ws.addEventListener('message',event=>{
      const p=parse(event.data);if(!p)return;
      if(p.type===2&&p.b[4]===0){if(game&&game!==ws)reject('游戏连接已切换。');game=ws;poisoned=false;nativeNpcPending=[];nativeRemotePending=[];scene=null;inBattle=false;invalidate('角色已重新登录。');}
      if(ws===game){
        if(scenes.includes(p.type)&&p.b[4]<128){invalidate('场景已变化，请重新补齐当前地图。');try{scene=sceneHeader(p.b);}catch{scene=null;}inBattle=false;}
        if([12501,12503,12504,12508].includes(p.type)&&p.b[4]===0){inBattle=true;invalidate('已进入战斗，怪物采集暂停。');}
        if(p.type===12502){inBattle=false;invalidate('战斗结束，请重新补齐当前地图。');}
        if([14502,14503,14504,14591].includes(p.type))invalidate('任务状态已变化，请重新补齐当前地图。');
      }
      if((pending?.npcId!==undefined||pending?.remote)&&pending.ws===ws){
        const message=p.type===25003&&(pending.cancelled||pending.deferred?.length)?null:readServerError(p,pending.remote?pending.requestType:14501);
        if(message){
          event.stopImmediatePropagation();const task=pending;pending=null;clearTimeout(task.timer);
          const error=Error((task.remote?'活动':'NPC')+'查询失败：'+message);if(task.remote)error.code='REMOTE_UNAVAILABLE';task.reject(error);
          for(const next of task.deferred||[])Native.prototype.send.call(next.ws,next.data);return;
        }
      }
      if(pending&&pending.ws===ws&&p.type===pending.reply){
        if(pending.npcId!==undefined&&(p.b.length<7||new DataView(p.b.buffer,p.b.byteOffset).getInt16(4)!==pending.npcId))return;
        if(pending.remote&&p.type===13121&&(p.b.length<10||new DataView(p.b.buffer,p.b.byteOffset).getInt16(4)!==2||new DataView(p.b.buffer,p.b.byteOffset).getInt32(6)!==pending.entryId))return;
        event.stopImmediatePropagation();const task=pending;pending=null;clearTimeout(task.timer);
        if(task.cancelled)task.reject(Error(task.cancelled));else task.resolve(Array.from(p.b,x=>x.toString(16).padStart(2,'0')).join(''));
        for(const next of task.deferred||[])Native.prototype.send.call(next.ws,next.data);return;
      }
      if(ws===game&&p.type===14501&&p.b.length>=7){const id=new DataView(p.b.buffer,p.b.byteOffset).getInt16(4),i=nativeNpcPending.indexOf(id);if(i>=0)nativeNpcPending.splice(i,1);}
      if(ws===game){
        const i=nativeRemotePending.findIndex(q=>q.reply===p.type&&(p.type!==13121||p.b.length>=10&&new DataView(p.b.buffer,p.b.byteOffset).getInt16(4)===q.kind&&new DataView(p.b.buffer,p.b.byteOffset).getInt32(6)===q.id));
        if(i>=0)nativeRemotePending.splice(i,1);
        if(p.type===5)nativeRemotePending=nativeRemotePending.filter(q=>!readServerError(p,q.type));
        if(p.type===25003&&nativeRemotePending.length===1&&readServerError(p,nativeRemotePending[0].type))nativeRemotePending=[];
      }
    });ws.addEventListener('close',()=>{if(game===ws){game=null;poisoned=false;scene=null;npcScope=null;remoteScope=null;nativeNpcPending=[];nativeRemotePending=[];reject('游戏连接已断开，请重新登录后续采。');}});}
    return ws;
  }});
  globalThis.__worldolCatalogBridge={
    lock:value=>{locked=!!value;let note=document.getElementById('worldol-catalog-overlay');if(!note){note=document.createElement('div');note.id='worldol-catalog-overlay';note.textContent='正在查询游戏资料，可在上方暂停后继续游玩。';note.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#10203099;color:white;display:flex;align-items:center;justify-content:center;font:18px sans-serif;pointer-events:auto';document.documentElement.appendChild(note);}note.style.display=locked?'flex':'none';},
    status:()=>({ready:!!game&&game.readyState===Native.OPEN&&!poisoned,busy:!!pending,poisoned}),
    monsterStatus:()=>({scene:scene&&{mapId:scene.mapId,instanceId:scene.instanceId,token:scene.token},epoch,inBattle,nativePending:nativeNpcPending.length}),
    remoteStatus:()=>({epoch,inBattle,nativePending:nativeRemotePending.length}),
    beginRemote:()=>{
      if(!locked||!game||game.readyState!==Native.OPEN||poisoned||inBattle||pending||nativeRemotePending.length)throw Error('请先登录并等待战斗或活动查询结束。');
      remoteScope={epoch,ids:new Map()};return epoch;
    },
    armRemoteDirectory:q=>{
      if(!locked||!remoteScope||q.epoch!==epoch||remoteScope.epoch!==epoch||pending)throw Error('免跑图采集状态已变化，请重新开始。');
      if(!['boss-directory','tower-directory'].includes(q.kind)||q.kind==='tower-directory'&&![1,2].includes(q.mode)||!Array.isArray(q.ids)||q.ids.length>4096||q.ids.some(id=>!Number.isInteger(id)||id<=0||id>2147483647))throw Error('Invalid activity directory');
      remoteScope.ids.set(q.kind+':'+(q.kind==='boss-directory'?0:q.mode),new Set(q.ids));
    },
    queryRemoteResult:async q=>{
      // Electron executeJavaScript replaces rejected renderer promises with a
      // generic error. Return the original reason explicitly to the collector.
      try{return {ok:true,hex:await globalThis.__worldolCatalogBridge.queryRemote(q)};}
      catch(error){return {ok:false,error:String(error.message||error)};}
    },
    queryRemote:async q=>{
      if(!locked||!remoteScope||q.epoch!==epoch||remoteScope.epoch!==epoch)throw Error('免跑图采集状态已变化，请重新开始。');
      if(!game||game.readyState!==Native.OPEN||poisoned||inBattle||pending||nativeRemotePending.length)throw Error('连接、战斗或活动查询状态已变化，采集暂停。');
      let type,length;
      if(q.kind==='boss-directory'){type=32001;length=4;}
      else if(q.kind==='tower-directory'&&[1,2].includes(q.mode)){type=30001;length=6;}
      else if(q.kind==='boss-preview'&&remoteScope.ids.get('boss-directory:0')?.has(q.id)){type=13121;length=10;}
      else if(q.kind==='tower-preview'&&[1,2].includes(q.mode)&&remoteScope.ids.get('tower-directory:'+q.mode)?.has(q.id)){type=13101;length=8;}
      else throw Error('活动编号不在已下发目录中。');
      const b=new Uint8Array(length),v=new DataView(b.buffer);v.setUint16(0,length);v.setUint16(2,type);
      if(type===30001){b[4]=8;b[5]=q.mode;}else if(type===13121){v.setInt16(4,2);v.setInt32(6,q.id);}else if(type===13101)v.setInt32(4,q.id);
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending=null;poisoned=true;remoteScope=null;reject(Error('活动查询超时，已暂停。请刷新并重新登录后继续。'));},10000);
        pending={ws:game,reply:remoteReplies.get(type),requestType:type,remote:true,entryId:q.id,resolve,reject,timer};
        try{send.call(game,b.buffer);}catch(error){clearTimeout(timer);pending=null;reject(error);}
      });
    },
    armNpcs:scope=>{
      if(!locked||!game||game.readyState!==Native.OPEN||poisoned)throw Error('请先登录并暂停游戏操作。');
      if(inBattle||pending||nativeNpcPending.length)throw Error('游戏正在战斗或读取 NPC，请稍后再补齐。');
      if(!scene||scope.token!==scene.token||scope.mapId!==scene.mapId||scope.instanceId!==scene.instanceId)throw Error('地图资料尚未同步，请稍后重试。');
      if(!Array.isArray(scope.npcIds)||scope.npcIds.length>127||scope.npcIds.some(id=>!Number.isInteger(id)||id<0||id>127))throw Error('Invalid current NPC scope');
      npcScope={epoch,ids:new Set(scope.npcIds)};return epoch;
    },
    queryNpc:async q=>{
      if(!locked||!npcScope||q.epoch!==epoch||npcScope.epoch!==epoch||!npcScope.ids.has(q.npcId))throw Error('当前地图 NPC 范围已失效，请重新补齐。');
      if(!game||game.readyState!==Native.OPEN||poisoned||inBattle||pending||nativeNpcPending.length)throw Error('连接、战斗或 NPC 查询状态已变化，采集暂停。');
      // Native Scene.createGetMissionDataMsg writes NPC id, cached group count
      // and IDs, then cached monster count and IDs. Our index is separate from
      // the game's cache: two zero counts request definitions for this NPC.
      const b=new Uint8Array(8),v=new DataView(b.buffer);v.setUint16(0,8);v.setUint16(2,14501);v.setInt16(4,q.npcId);
      b[6]=0;b[7]=0;
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending=null;poisoned=true;npcScope=null;reject(Error('NPC 查询超时，已暂停。请刷新并重新登录后继续。'));},10000);
        pending={ws:game,reply:14501,npcId:q.npcId,resolve,reject,timer};
        try{send.call(game,b.buffer);}catch(error){clearTimeout(timer);pending=null;reject(error);}
      });
    },
    query:async hex=>{
      if(!game||game.readyState!==Native.OPEN||poisoned)throw Error('请先登录正式服并进入角色地图。');
      if(pending)throw Error('上一条预览还未完成。');
      if(typeof hex!=='string'||!/^[0-9a-f]+$/.test(hex)||hex.length>24||hex.length%2)throw Error('Invalid preview request');
      const b=Uint8Array.from(hex.match(/../g),x=>parseInt(x,16)),p=parse(b);if(!p||!allowed.has(p.type))throw Error('Read-only request rejected');
      if([16051,12060,16005].includes(p.type)&&b.length!==8||p.type===14001&&b.length!==6||p.type===32101&&(b.length!==8||b[4]!==8||b[6]!==16))throw Error('Invalid preview format');
      if(p.type===16005&&new DataView(b.buffer).getInt32(4)<0)throw Error('Invalid guide page');
      if(p.type===11501&&(b.length!==6||b[4]!==1||b[5]===0))throw Error('Invalid set preview');
      if(p.type===11053&&(b.length!==5||b[4]!==0))throw Error('Invalid VIP offer preview');
      if([11055,11160,12052,11026].includes(p.type)&&b.length!==4)throw Error('Invalid empty detail preview');
      if(p.type===15514&&(b.length!==8||new DataView(b.buffer).getInt32(4)<=0))throw Error('Invalid pet template preview');
      if(p.type===16009&&(b.length!==11||hex!=='000b3e89007f0000007fff'))throw Error('Invalid pet directory preview');
      return new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{pending=null;poisoned=true;reject(Error('查询超时，已暂停。请刷新并重新登录后继续，避免串包。'));},10000);
        pending={ws:game,reply:allowed.get(p.type),resolve,reject,timer};send.call(game,b.buffer);
      });
    }
  };
})();
