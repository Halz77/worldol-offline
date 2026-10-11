const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {atomicJson}=require('./archive.cjs');
const {PetCollection,PET_PROTOCOLS,petRequest,readPetDetail,readInventoryItem}=require('./pets.cjs');
const {MonsterCollection}=require('./monsters.cjs');
const {RemoteMonsterCollection,REMOTE_PROTOCOLS,replies:remoteReplies}=require('./remote-monsters.cjs');
const {buildQuestLines,saveQuestLines}=require('./quest-lines.cjs');
const CATEGORY_NAMES={all:'全部细节',sets:'套装',vip:'VIP',titles:'称号',gems:'宝石',pets:'宠物',monsters:'怪物',missions:'任务',other:'其他'};
const protocolCategories=new Map([
  [11501,'sets'],[11053,'vip'],[11055,'vip'],[11160,'vip'],[12052,'vip'],
  [11026,'titles'],[11027,'titles'],[14564,'titles'],[16051,'items'],[12004,'items'],
  [12003,'items'],[12015,'gems'],[12041,'gems'],[14501,'missions'],[14502,'missions'],
  [14503,'missions'],[14504,'missions'],[14591,'missions'],[12502,'missions'],
  [2,'scenes'],[10503,'scenes'],[10506,'scenes'],[10510,'scenes'],[10523,'scenes'],[16005,'guides'],
  ...REMOTE_PROTOCOLS.map(type=>[type,'monsters']),[32101,'catalog'],[32102,'catalog'],[12001,'pets'],...PET_PROTOCOLS.map(type=>[type,'pets'])
]);
const now=()=>new Date().toISOString();
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const plain=v=>JSON.parse(JSON.stringify(v));
const bounded=(n,max=4096)=>{if(n<0||n>max)throw Error('Invalid record count '+n);return n;};
function envelope(type,body=Buffer.alloc(0)) {const b=Buffer.alloc(4+body.length);b.writeUInt16BE(b.length);b.writeUInt16BE(type,2);body.copy(b,4);return {type,reply:type,hex:b.toString('hex')};}
function detailRequest(q){
  if(q.kind.startsWith('pet-'))return petRequest(q);
  if(q.kind==='set'&&Number.isInteger(q.id)&&q.id>0&&q.id<=255)return envelope(11501,Buffer.from([1,q.id]));
  if(q.kind==='vip-info')return envelope(11055);
  if(q.kind==='vip-offers')return envelope(11053,Buffer.from([0]));
  // Native UserVIPProxy.doOpenVIPLevelUp only reads a preview. 11161 performs purchase.
  if(q.kind==='vip-upgrade-preview')return envelope(11160);
  if(q.kind==='vip-limit')return envelope(12052);
  if(q.kind==='titles')return envelope(11026);
  if(['gem','detail-guide'].includes(q.kind)&&Number.isInteger(q.id)&&q.id>=0&&q.id<=2147483647&&(q.kind!=='gem'||q.id>0)){
    const body=Buffer.alloc(4);body.writeInt32BE(q.id);return envelope(q.kind==='gem'?16051:16005,body);
  }
  throw Error('Unsupported detail read');
}
const taskKey=q=>`${q.kind}:${q.id??0}`;
async function loadDetailDependencies(root){
  const game=path.resolve(root,'../世界online_原版单机');
  const [{Reader,decoders,skipPlayerList,protobufSchemas,protobuf},blocks,guide,catalogCore]=await Promise.all([
    import(pathToFileURL(path.join(game,'tools/capture-decoders.mjs')).href),
    import(pathToFileURL(path.join(game,'tools/capture-public-blocks.mjs')).href),
    import(pathToFileURL(path.join(game,'tools/guide-core.mjs')).href),
    import(pathToFileURL(path.join(game,'tools/catalog-core.mjs')).href)
  ]);
  const d=decoders(game),official=JSON.parse(fs.readFileSync(path.join(game,'data/official-v305.json'),'utf8'));
  const schemas=protobufSchemas(fs.readFileSync(path.join(game,'analysis/protobuf.decoded.js'),'utf8'));
  return {Reader,d,skipPlayerList,blocks,guide,catalogCore,official,protobuf,schemas};
}
// v305 player block: discard account/name/currency fields while walking to the
// following mission and inventory definitions. Pet names are discarded too.
function skipCharacter(r,d,blocks,onItem,onPet){
  r.getInt();r.getString();r.getString();r.getString();r.take(5+8+24+8+1);
  if(r.getInt()>=0){r.getString();r.getByte();}
  r.take(16+2+4+10+12+2+21);
  if(r.getInt()>=0)r.getString();r.getString();r.getString();r.take(80+3);
  r.take((r.getByte()&255)*2);r.getShort();r.take((r.getByte()&255)*2);r.take(12+1+4);r.take((r.getByte()&255)*12);
  const pet=readPetDetail(r,d,blocks,{onItem});if(pet)onPet(pet);
  if(r.getByte()!==0)throw Error('Player mercenary detail not supported');
  // Walk the same v305 legion summary block as capture-public-blocks so active
  // missions after the character block are still read when companions exist.
  // Discard individual companion identifiers and names from the public index.
  for(let n=r.getByte()&255;n>0;n--){r.take(1+4+24);if(r.getByte()>=0){r.getString();r.take(8+2+8);}}
  r.getBoolean();r.getInt();r.getByte();r.getString();r.getString();
}
class DetailRecorder {
  constructor(root,archive,deps,catalog={},options={}){
    this.root=root;this.archive=archive;this.deps=deps;this.closed=false;this.dirty=true;
    this.folder=options.detailsFolder||path.join(archive.dir,'details');fs.mkdirSync(this.folder,{recursive:true});
    this.knownFile=path.join(root,'collection/detail-known-v305.json');
    let known={};if(fs.existsSync(this.knownFile))known=JSON.parse(fs.readFileSync(this.knownFile,'utf8'));
    this.setIds=new Set(known.setIds||[]);this.gemIds=new Map((known.gems||[]).map(g=>[g.id,g.name]));
    for(const i of [...deps.official.items,...(catalog.items||[])])this.rememberItem(i);
    this.pending=new Map();this.contexts=new Map();this.focus='all';this.done={};this.failed={};this.version='';
    this.state={schema:'worldol.details.v1',clientVersion:305,capture:archive.id,createdAt:now(),
      scope:'Only definitions and descriptions actually received in this recording. Not a complete server database.',
      sets:[],vip:[],titles:[],gems:[],missions:[],questEvents:[],guides:[],markers:[],
      stats:{packets:0,parsed:0,rawOnly:0,parseErrors:0},warnings:[],protocols:{}};
    this.petCollection=new PetCollection(this,catalog);
    this.monsterCollection=new MonsterCollection(this);
    this.remoteMonsters=new RemoteMonsterCollection(this);
    this.packetLog=fs.openSync(path.join(this.folder,'packets.ndjson'),'a');
    this.onPacket=p=>{try{this.consume(p);}catch(error){this.state.stats.parseErrors++;this.warning(error.message);}};
    archive.on('packet-saved',this.onPacket);
    this.timer=setInterval(()=>{try{this.save();}catch(error){this.warning('细节索引保存失败：'+error.message);}},1500);this.timer.unref();
    this.save();
  }
  rememberItem(item){const id=(item.itemSet||0)&255;if(id)this.setIds.add(id);if([30,47].includes(item.type)&&item.id>0)this.gemIds.set(item.id,item.name||String(item.id));}
  source(bytes,extra={}){const sha256=digest(bytes);return {capture:this.archive.id,protocol:bytes.readUInt16BE(2),sha256,blob:`blobs/${sha256.slice(0,2)}/${sha256}.bin`,...extra};}
  put(table,id,data,source){
    const clean=plain(data),key=String(id),sig=digest(JSON.stringify(clean));
    let row=this.state[table].find(x=>x.key===key);
    if(!row){row={key,data:clean,signature:sig,sources:[]};this.state[table].push(row);}
    else if(row.signature!==sig){row.variants??=[];if(!row.variants.some(x=>x.signature===row.signature))row.variants.push({data:row.data,signature:row.signature,sources:row.sources});row.data=clean;row.signature=sig;row.sources=[];}
    const old=row.sources.find(s=>s.sha256===source.sha256&&s.capture===source.capture);
    if(old)Object.assign(old,source);else row.sources.push(source);
    this.dirty=true;return row;
  }
  addItem(item,source){this.rememberItem(item);if([30,47].includes(item.type))this.put('gems',item.id,item,source);this.petCollection.observeItem(item,source);}
  warning(message,source){this.state.warnings.push({at:now(),message,source});if(this.state.warnings.length>100)this.state.warnings.shift();this.dirty=true;}
  context(connection){if(!this.contexts.has(connection))this.contexts.set(connection,{mapId:null,version:305});return this.contexts.get(connection);}
  requestInfo(type,r){
    if(type===13101){const id=r.getInt();r.finish();return {id};}
    if(type===13121){const activityKind=r.getShort(),id=r.getInt();r.finish();return {activityKind,id};}
    if(type===30001){if(r.getByte()!==8)throw Error('Unknown tower directory request');const mode=r.getByte();r.finish();if(![1,2].includes(mode))throw Error('Unknown tower mode');return {mode};}
    if([16051,16005,15514].includes(type))return {id:r.getInt()};
    if(type===15502)return {slot:r.getShort()};
    if(type===12001)return {wait:r.getByte(),action:r.getByte(),slot:r.getShort(),quantity:r.getInt()};
    if(type===32101){if(r.getByte()!==8)throw Error('Unknown catalogue request');const group=r.getByte();if(r.getByte()!==16)throw Error('Unknown catalogue request');const type=r.getByte();r.finish();return {group,type};}
    if([14501,12004].includes(type))return {npcId:r.getShort()};
    if([14502,14503].includes(type)){const out={npcId:r.getShort(),missionId:r.getShort()};if(type===14503)out.selectedItem=r.getInt();return out;}
    if(type===14504)return {missionId:r.getShort()};
    if(type===11501){const count=bounded(r.getByte()&255,255);return {ids:Array.from({length:count},()=>r.getByte()&255)};}
    return {};
  }
  consume(p){
    if(this.closed||p.opcode!==2||p.bytes.length<4)return;
    const type=p.bytes.readUInt16BE(2),category=protocolCategories.get(type),connection=`${p.target}:${p.requestId}`,sent=p.method.endsWith('Sent');
    this.petCollection.observePacket(type,sent,connection);this.monsterCollection.observe(p);this.remoteMonsters.observe(p);if(!category)return;
    const source=this.source(p.bytes,{seq:p.seq,at:p.at,connection});
    const record={...source,category,direction:sent?'sent':'received',bytes:p.bytes.length,focus:this.focus};
    const stat=this.state.protocols[type]??={category,sent:0,received:0};stat[sent?'sent':'received']++;this.state.stats.packets++;
    try{
      if(p.bytes.readUInt16BE(0)!==p.bytes.length)throw Error('Frame length mismatch');
      const key=`${connection}:${type}`;
      if(this.version!=='305')record.parsed=false;
      else if(sent){
        const request=this.requestInfo(type,new this.deps.Reader(p.bytes.subarray(4)));if(type===12001)this.petCollection.bagRequest(request,source);record.request=request;
        if(type===14501&&this.monsterCollection.current?.connection===connection){const {mapId,instanceId,token}=this.monsterCollection.current;Object.assign(request,{mapId,instanceId,token,connection});}
        if(type===13101)request.mode=this.remoteMonsters.towerModes.get(connection);
        if([16051,16005,14501,14502,14503,14504,12004,11501,15502,15512,15514,32101].includes(type)||remoteReplies[type]||(type===12001&&[1,2].includes(request.wait))){
          // Bag operations share a protocol, but only reply wait 1 is hatching.
          // Other operations may never reply and must not consume its request.
          const queueKey=type===32101?`${connection}:32102`:remoteReplies[type]?`${connection}:${remoteReplies[type]}`:type===12001?`${key}:${request.wait}`:key;
          const queue=this.pending.get(queueKey)||[];queue.push({...request,seq:p.seq});if(queue.length>32){queue.shift();this.warning('未配对请求过多，保留最近32条',source);}this.pending.set(queueKey,queue);
        }
        record.parsed=true;
      }else{
        let request;
        if(type===12001&&p.bytes.length>4){
          const wait=p.bytes.readInt8(4);
          if(wait<0){this.pending.delete(`${key}:1`);this.pending.delete(`${key}:2`);}
          else request=this.pending.get(`${key}:${wait}`)?.shift();
        }else if(type===14501&&p.bytes.length>=7){const queue=this.pending.get(key),index=queue?.findIndex(q=>q.npcId===p.bytes.readInt16BE(4));if(index>=0)request=queue.splice(index,1)[0];}
        else if(type===13121&&p.bytes.length>=10){const queue=this.pending.get(key),index=queue?.findIndex(q=>q.activityKind===p.bytes.readInt16BE(4)&&q.id===p.bytes.readInt32BE(6));if(index>=0)request=queue.splice(index,1)[0];}
        else request=this.pending.get(key)?.shift();
        if(request){source.requestSeq=request.seq;record.requestSeq=request.seq;}
        record.parsed=this.decode(type,p.bytes,source,request||{},this.context(connection));
      }
      this.state.stats[record.parsed?'parsed':'rawOnly']++;
    }catch(error){record.error=error.message;record.parsed=false;this.state.stats.parseErrors++;this.warning(error.message,source);}
    fs.writeSync(this.packetLog,JSON.stringify(record)+'\n');this.dirty=true;
  }
  decode(type,bytes,source,request={},context={}){
    const {Reader,d,guide,blocks}=this.deps,r=new Reader(bytes.subarray(4));
    if([32002,30002,13121,13101].includes(type))return this.remoteMonsters.decode(type,bytes,source,request);
    if(PET_PROTOCOLS.includes(type)||type===32102)return this.petCollection.decode(type,bytes,r,source,request);
    if(type===12001)return this.petCollection.decodeBag(r,source,request);
    const readItem=()=>{const start=r.pos,item=new d.Item();d.Item.fromBytesAtts2(item,r);item.definitionBase64=r.b.subarray(start,r.pos).toString('base64');return item;};
    if(type===11501){
      const sets=[];for(let n=bounded(r.getByte()&255,255);n>0;n--){const id=r.getByte()&255,bonuses=[];for(let m=bounded(r.getByte()&255,255);m>0;m--)bonuses.push({pieces:r.getByte()&255,power:r.getShort(),value:r.getShort(),vipLevel:r.getByte()&255,active:r.getByte()!==0});sets.push({id,bonuses});}
      r.finish();if(request.ids?.some(id=>!sets.some(s=>s.id===id)))throw Error('服务器未返回所请求的套装');
      for(const set of sets){this.setIds.add(set.id);this.put('sets',set.id,set,source);}return true;
    }
    if([11053,11160].includes(type)){
      const status=r.getByte();let result={protocol:type,status,offers:[]};
      if(status<0||type===11053&&status===1)result.message=r.getString();
      else for(let n=bounded(r.getShort(),1024);n>0;n--)result.offers.push({id:r.getShort(),description:r.getString(),moneyType:r.getByte(),price:r.getInt()});
      r.finish();this.put('vip',type,result,source);return true;
    }
    if(type===11055){
      const result={description:r.getString(),currentExp:r.getInt(),nextLevelExp:r.getInt(),items:[]};
      for(let n=bounded(r.getByte(),127);n>0;n--){const item=readItem();if(item.id>=d.Item.VIP_ITEM_SIGN_START&&item.id<=d.Item.VIP_TIEM_ITEM_SIGN_START)r.getInt();result.items.push(item);}
      r.finish();this.put('vip',type,result,source);return true;
    }
    if(type===12052){const maxVip=r.getByte()&255;r.finish();this.put('vip',type,{maxVip},source);return true;}
    if(type===11026){
      const titles=[];for(let n=bounded(r.getShort());n>0;n--)titles.push({id:r.getShort(),name:r.getString(),power1:r.getByte()&255,value1:r.getShort(),power2:r.getByte()&255,value2:r.getShort()});
      r.finish();for(const title of titles)this.put('titles',title.id,title,source);return true;
    }
    if(type===16051){const item=readItem();if(item.type===d.constants.ITEM_TYPE_PET_EQUIP&&r.b.length-r.pos===6)r.take(6);r.finish();if(request.id&&item.id!==request.id)throw Error('Item ID mismatch');this.addItem(item,source);return true;}
    if(type===12004){
      const status=r.getByte();if(status!==0){r.getString();r.finish();return true;}
      const items=[];for(let n=bounded(r.getShort());n>0;n--){const item=readItem();r.take(1+12+1+12+1+2+2+1+1);if(r.getBoolean()){r.getString();r.getString();}items.push(item);}
      r.finish();for(const item of items)this.addItem(item,{...source,shopId:request.npcId});return true;
    }
    if(type===16005){if(request.id===undefined)return false;const page=guide.decodeGuide(request.id,bytes,source);this.put('guides',page.id,page,source);return true;}
    if(type===14501){
      return this.monsterCollection.decodeMission(bytes,source,request,context);
    }
    if(type===14591){const b=r.getByteArray(),m=d.Mission.fromBytes(b);b.finish();r.finish();this.put('missions',m.id,m,source);return true;}
    if([14502,14503,14504,12502].includes(type)){
      const event={protocol:type,missionId:request.missionId,npcId:request.npcId,selectedItem:request.selectedItem,mapId:context.mapId};
      // Keep a linked event even if an optional reward block cannot yet be decoded.
      this.put('questEvents',source.seq??source.sha256,event,source);
      if(type===12502)event.reward=blocks.readBattleReward(r,d,i=>this.addItem(i,source));
      else {event.status=r.getByte();if(event.status<0)event.error=r.getString();else if(type===14503)event.reward=blocks.readQuestReward(r,d,i=>this.addItem(i,source));else {event.remainingBytes=r.b.length-r.pos;this.put('questEvents',source.seq??source.sha256,event,source);return event.remainingBytes===0;}}
      r.finish();this.put('questEvents',source.seq??source.sha256,event,source);return true;
    }
    if(type===12003){if(r.getByte()<0)return false;r.take(6);if(r.getInt()!==16)return false;const rows=[];for(let n=bounded(r.getShort());n>0;n--)rows.push(readInventoryItem(r,d));r.finish();for(const row of rows)if(row.item)this.addItem(row.item,source);this.petCollection.setInventory(rows,source);return true;}
    if([2,10503,10506,10510,10523].includes(type)){
      if(r.getByte()<0)return false;if(type===2)r.take(31);if(type===10523&&r.getByte()===1)r.take(6);
      const instance=r.getInt();context.mapId=d.isAllocated(instance)?r.getShort():instance;r.take(2);const flags=r.getInt();
      // Public definitions preceding optional scene blocks are useful even on partial scenes.
      if(flags&2)skipCharacter(r,d,blocks,i=>this.addItem(i,source),p=>this.petCollection.snapshot(p,source));if(flags&4)r.getBytes();
      if(flags&8)for(let n=bounded(r.getByte(),127);n>0;n--){const b=r.getByteArray(),m=d.Mission.fromBytes(b);b.finish();this.put('missions',m.id,m,{...source,mapId:context.mapId,origin:'active-mission'});}
      if(flags&16){const rows=[];for(let n=bounded(r.getShort());n>0;n--){const row=readInventoryItem(r,d);rows.push(row);if(row.item)this.addItem(row.item,source);}this.petCollection.setInventory(rows,source);}
      return false; // Remaining scene/NPC/dialog blocks stay indexed as raw evidence.
    }
    return false;
  }
  tasks(category='all'){
    if(category==='monsters')return [];
    const list=[];if(category==='all'||category==='vip')list.push(...['vip-info','vip-offers','vip-upgrade-preview','vip-limit'].map(kind=>({kind,name:'VIP说明 / '+kind})));
    if(category==='all'||category==='titles')list.push({kind:'titles',name:'当前角色可见称号'});
    if(category==='all'||category==='pets')list.push(...this.petCollection.tasks());
    if(category==='all'||category==='sets')for(const id of [...this.setIds].sort((a,b)=>a-b))list.push({kind:'set',id,name:'套装 '+id});
    if(category==='all'||category==='gems')for(const [id,name] of this.gemIds)list.push({kind:'gem',id,name:'宝石 / '+name});
    // Follow only actual read-only guide menu links, never guessed IDs or mission actions.
    const byId=new Map(this.state.guides.map(x=>[x.data.id,x.data])),seen=new Set();
    const walk=(id,name)=>{if(seen.has(id)||seen.size>=512)return;seen.add(id);const page=byId.get(id);if(!page){list.push({kind:'detail-guide',id,name});return;}for(const e of page.entries)if(e.type===0&&e.id!==page.parentId&&e.name!=='职业技能')walk(e.id,name+' / '+e.name);};
    if(category!=='pets')walk(0,'官方攻略');
    return list.filter(q=>!this.done[taskKey(q)]&&!this.failed[taskKey(q)]);
  }
  acceptQuery(q,bytes){const req=detailRequest(q);if(bytes.length<4||bytes.readUInt16BE(0)!==bytes.length||bytes.readUInt16BE(2)!==req.reply)throw Error('Detail reply envelope mismatch');
    this.decode(req.reply,bytes,this.source(bytes,{origin:'detail-collector'}),q.kind==='set'?{ids:[q.id]}:q.kind==='pet-catalog'?{group:3,type:q.id}:{id:q.id});
    this.done[taskKey(q)]={at:now()};delete this.failed[taskKey(q)];this.dirty=true;
  }
  failQuery(q,message){this.failed[taskKey(q)]={request:q,message,at:now()};this.dirty=true;}
  retry(){this.failed={};this.monsterCollection.retry();this.remoteMonsters.retry();this.dirty=true;}
  setVersion(version){const value=String(version||'');if(value!==this.version){this.version=value;this.state.actualClientVersion=value;this.dirty=true;if(value&&value!=='305')this.warning('当前版本为'+value+'，仅保存原始数据和截图，暂停v305解析。');}}
  setFocus(category){this.focus=Object.hasOwn(CATEGORY_NAMES,category)?category:'all';this.dirty=true;}
  addScreenshot(png,text){
    if(this.closed||this.archive.closed)throw Error('本次录制已经结束。');
    if(!Buffer.isBuffer(png)||!png.length)throw Error('未取得游戏截图，请稍后重试。');
    const folder=path.join(this.folder,'screenshots');fs.mkdirSync(folder,{recursive:true});
    const name=`${Date.now()}-${crypto.randomBytes(3).toString('hex')}.png`;fs.writeFileSync(path.join(folder,name),png,{flag:'wx'});
    return this.addMarker(text||CATEGORY_NAMES[this.focus]+'页面',{file:'details/screenshots/'+name,sha256:digest(png),bytes:png.length});
  }
  addMarker(text,screenshot){
    const at=now(),seq=this.archive.record('recorder.marker',{text,category:this.focus,screenshot});
    this.state.markers.push({seq,at,category:this.focus,text,screenshot});this.dirty=true;this.save();return seq;
  }
  snapshot(){return {focus:this.focus,counts:Object.fromEntries(['sets','vip','titles','gems','missions','questEvents','guides','markers','petCatalog','pets','petSnapshots','petSkills','petEquipment','petEggs','petHatches'].map(k=>[k,this.state[k].length])),monsters:this.monsterCollection.snapshot(),remoteMonsters:this.remoteMonsters.snapshot(),questLines:buildQuestLines(this.state).coverage,stats:{...this.state.stats},knownSets:this.setIds.size,knownGems:this.gemIds.size,knownPets:this.petCollection.known.size,knownEggs:this.petCollection.eggs.size,petRemaining:this.tasks('pets').length,remaining:this.tasks(this.focus).length,failed:Object.keys(this.failed).length,lastWarning:this.state.warnings.at(-1)?.message||'',folder:this.folder};}
  report(){
    const c=this.snapshot();
    const labels={套装:c.counts.sets,VIP页面:c.counts.vip,称号:c.counts.titles,宝石:c.counts.gems,宠物目录条目:c.counts.petCatalog,宠物详情:c.counts.pets,宠物实际等级记录:c.counts.petSnapshots,宠物技能等级:c.counts.petSkills,宠物装备:c.counts.petEquipment,宠物蛋:c.counts.petEggs,开蛋样本:c.counts.petHatches,任务定义:c.counts.missions,任务与奖励事件:c.counts.questEvents,攻略页面:c.counts.guides,截图与标记:c.counts.markers};
    return '# 世界OL细节录制\n\n本次会话：'+this.archive.id+'\n\n'+Object.entries(labels).map(([k,v])=>'- '+k+'：'+v).join('\n')+
      '\n\n已解析消息：'+c.stats.parsed+'；仅存原文：'+c.stats.rawOnly+'；解析待补：'+c.stats.parseErrors+'。原始消息在上级 events / blobs，packets.ndjson 给出序号和哈希。'+
      '\n\n宠物详情 '+c.counts.pets+' / 已发现 '+c.knownPets+'。目录取自正式服三类宠物图鉴及宠物攻略，不代表全服隐藏宠物。pets保存服务器预览；petSnapshots保存实际查看到的等级、成长和属性，个人改名不导出；petSkills按技能ID和等级计数。尚未下发的等级不能据此视为完整。'+
      '\n\npetEggs保存宠物蛋定义，petHatches记录正常开蛋的实际结果。只有新鲜背包快照能确认输入蛋的编号，否则标记unconfirmed-input。使用前打开背包、使用后打开宠物详情，可补全关联和初始属性。样本不等于完整概率表。'+
      '\n\nVIP说明和称号按当前角色可见范围保存。宝石只查询已有编号，任务过程随正常游玩录制。界面内容可点“截图＋标记”，截图在 screenshots。index.json 保存解析结果、变化版本、来源和待解析说明。\n';
  }
  save(){if(!this.dirty||this.closed)return;fs.fsyncSync(this.packetLog);atomicJson(path.join(this.folder,'index.json'),{...this.state,updatedAt:now(),focus:this.focus,queryDone:this.done,queryFailed:this.failed});fs.writeFileSync(path.join(this.folder,'录制摘要.md'),this.report());fs.mkdirSync(path.dirname(this.knownFile),{recursive:true});atomicJson(this.knownFile,{clientVersion:305,setIds:[...this.setIds].sort((a,b)=>a-b),gems:[...this.gemIds].map(([id,name])=>({id,name}))});this.petCollection.save();this.monsterCollection.save();this.remoteMonsters.save();saveQuestLines(this);this.dirty=false;}
  finish(){if(this.closed)return;clearInterval(this.timer);this.archive.off('packet-saved',this.onPacket);this.save();fs.closeSync(this.packetLog);this.closed=true;}
}
module.exports={DetailRecorder,loadDetailDependencies,detailRequest,taskKey,CATEGORY_NAMES};
