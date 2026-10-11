const fs=require('node:fs'),path=require('node:path');
const {atomicJson}=require('./archive.cjs');
const count=(n,max=4096)=>{if(!Number.isInteger(n)||n<0||n>max)throw Error('Invalid pet record count '+n);return n;};
const PET_CATEGORIES=[7,8,9];
const PET_PROTOCOLS=[16009,15514,15502,15512,17602,15516,15517,15515];
const BAG_READS=new Set([12003,16051,12004,12060,14001,16005,11501,11026,11053,11055,11160,12052,16009,15514,15502,15512,16001,16021,10504,32102]);
function petRequest(q){
  let type,reply,body;
  if(q.kind==='pet-catalog'&&PET_CATEGORIES.includes(q.id)){type=32101;reply=32102;body=Buffer.from([8,3,16,q.id]);}
  else if(q.kind==='pet-roster'){
    // Raiders.doPetRaidersGetData uses PAGE_SIZE=127, PAGE_NUM=127, job=-1.
    // The first response integer is not a documented total/page count.
    type=reply=16009;body=Buffer.from([0,127,0,0,0,127,255]);
  }else if(['pet-detail','pet-egg'].includes(q.kind)&&Number.isInteger(q.id)&&q.id>0&&q.id<=2147483647){type=reply=q.kind==='pet-detail'?15514:16051;body=Buffer.alloc(4);body.writeInt32BE(q.id);}
  else throw Error('Invalid pet read request');
  const b=Buffer.alloc(4+body.length);b.writeUInt16BE(b.length);b.writeUInt16BE(type,2);body.copy(b,4);return {type,reply,hex:b.toString('hex')};
}
// Audited against v305 Pet.fromBytesDetail. Individual nicknames are omitted;
// public catalogue names are retained only for the template lookup (15514).
function readPetDetail(r,d,blocks,{publicName=false,onItem=()=>{}}={}){
  const index=r.getByte();if(index<0)return null;
  const name=r.getString(),p={level:r.getByte(),icon:r.getLong().toJSON(),hp:r.getInt(),mp:r.getInt(),exp:r.getInt(),expMax:r.getInt(),sp:r.getInt()};
  if(publicName)p.name=name;
  p.attributes={strength:r.getShort(),constitution:r.getShort(),agility:r.getShort(),intelligence:r.getShort(),wisdom:r.getShort()};
  p.grow=r.getByte();p.comprehension=r.getByte();p.cp=r.getByte();p.growLevel=r.getByte();p.lifeMs=r.getLong().toJSON();
  p.hit=r.getShort();p.attackType=r.getByte();p.attackMin=r.getShort();p.attackMax=r.getShort();p.attackTimes=r.getByte();p.job=r.getByte();p.grade=r.getByte();
  p.autoSkills=Array.from({length:count(r.getByte(),127)},()=>r.getShort());p.initiativeSkill=r.getShort();
  p.skills=Array.from({length:count(r.getShort())},()=>d.Skill.fromBytes(r));
  p.vipLevel=r.getByte();p.bornStatus=r.getLong().toJSON();p.headIcon=r.getShort();p.model=r.getInt();p.equipment=[];
  for(let n=count(r.getByte(),127);n>0;n--){const slot=r.getByte(),row=blocks.itemInstance(r,d);if(row.item){onItem(row.item);p.equipment.push({slot,itemId:row.item.id});}}
  p.skillBonuses=[];for(let n=count(r.getShort());n>0;n--){const id=r.getInt(),level=r.getByte();p.skillBonuses.push({id,level});const skill=p.skills.find(s=>s.id===id);if(skill)skill.addLevel=level;}
  return p;
}
function readPetSummary(r,d){
  const p={id:r.getInt(),type:r.getShort(),name:r.getString(),job:r.getByte(),grade:r.getByte(),attackType:r.getByte()};
  p.attributes={strength:r.getShort(),constitution:r.getShort(),agility:r.getShort(),intelligence:r.getShort(),wisdom:r.getShort()};
  p.grow=r.getByte();p.comprehension=r.getByte();p.skills=[d.Skill.fromBytes(r),d.Skill.fromBytes(r)];p.icon=r.getLong().toJSON();p.bornStatus=r.getLong().toJSON();return p;
}
function readInventoryItem(r,d){
  const quantity=r.getShort();r.take(13);const slot=r.getShort(),status=r.getByte();if(status&1)r.getInt();
  const start=r.pos,item=new d.Item();d.Item.fromBytesAtts2(item,r);
  if(item.type===d.constants.ITEM_TYPE_PET)return {quantity,slot,pet:{type:item.type,bagIcon:item.bagIcon,grade:item.grade,autoBinding:item.autoBinding,icon:item.icon,reqLv:item.reqLv,headIcon:item.petHeadIcon,lifeMs:item.petAgeTime}};
  item.definitionBase64=r.b.subarray(start,r.pos).toString('base64');return {quantity,slot,item};
}
class PetCollection{
  constructor(recorder,catalog={}){
    this.recorder=recorder;this.known=new Map();this.eggs=new Map();this.inventories=new Map();this.file=path.join(recorder.root,'collection/pet-known-v305.json');
    for(const k of ['petCatalog','pets','petSnapshots','petSkills','petEquipment','petEggs','petHatches'])recorder.state[k]=[];
    if(fs.existsSync(this.file)){const state=JSON.parse(fs.readFileSync(this.file,'utf8'));if(state.clientVersion===305){for(const p of state.pets||[])this.remember(p);for(const p of state.eggs||[])this.eggs.set(p.id,p);}}
    for(const item of [...(recorder.deps.official.catalog||[]),...(catalog.catalog||[])])if(item.sources?.some(s=>s.group===3&&PET_CATEGORIES.includes(s.type)))this.remember({id:item.itemId,name:item.name});
    for(const item of [...recorder.deps.official.items,...(catalog.items||[])])if(this.isEgg(item))this.eggs.set(item.id,{id:item.id,name:item.name});
  }
  remember(p){if(Number.isInteger(p.id)&&p.id>0&&p.id<=2147483647)this.known.set(p.id,{id:p.id,name:p.name||this.known.get(p.id)?.name||String(p.id)});}
  isEgg(item){return item.power1===this.recorder.deps.d.constants.POWER_PET_EGG;}
  observeItem(item,source){if(item.type===41)this.recorder.put('petEquipment',item.id,item,source);if(this.isEgg(item)){this.eggs.set(item.id,{id:item.id,name:item.name});this.recorder.put('petEggs',item.id,item,source);}}
  observePacket(type,sent,connection){if(!sent&&(type===12003||!BAG_READS.has(type)))this.inventories.delete(connection);}
  setInventory(rows,source){this.inventories.set(source.connection,{seq:source.seq,items:new Map(rows.map(row=>[row.slot,row]))});}
  bagRequest(request,source){
    const inventory=this.inventories.get(source.connection),row=inventory?.items.get(request.slot);
    if(row?.item&&this.isEgg(row.item)){request.itemId=row.item.id;request.inventorySeq=inventory.seq;}
    this.inventories.delete(source.connection);return request;
  }
  skills(p,source){for(const s of p.skills||[])if(Number.isInteger(s.id)&&Number.isInteger(s.level))this.recorder.put('petSkills',`${s.id}:${s.level}`,s,source);}
  snapshot(p,source,slot='active'){
    if(!p)return;this.recorder.put('petSnapshots',`${source.connection||'session'}:${slot}:${p.level}`,{scope:'observed-instance',...p},source);this.skills(p,source);
  }
  tasks(){return [...PET_CATEGORIES.map(id=>({kind:'pet-catalog',id,name:{7:'睿智宠物目录',8:'勇猛宠物目录',9:'迅捷宠物目录'}[id]})),{kind:'pet-roster',name:'官方宠物攻略图鉴'},...[...this.eggs.values()].map(p=>({kind:'pet-egg',id:p.id,name:'宠物蛋 / '+p.name})),...[...this.known.values()].sort((a,b)=>a.id-b.id).map(p=>({kind:'pet-detail',id:p.id,name:'宠物 / '+p.name}))];}
  decode(type,bytes,r,source,request){
    const c=this.recorder,{d,blocks}=c.deps;
    if(type===32102){
      if(request.group!==3||!PET_CATEGORIES.includes(request.type))return false;
      const result=c.deps.catalogCore.decode({kind:'catalog',group:3,type:request.type},bytes,source);
      for(const item of result.items){const p={id:item.itemId,name:item.name,icon:item.icon,bagIcon:item.bagIcon,grade:item.grade,category:request.type,origin:'handbook'};this.remember(p);c.put('petCatalog',p.id,p,source);}return true;
    }
    if(type===16009){
      const serverValue=r.getInt();if(serverValue<0)throw Error('宠物目录：'+r.getString());
      const pets=[];for(let n=count(r.getByte(),127);n>0;n--){const p=readPetSummary(r,d);p.description=r.getString();pets.push(p);}r.finish();
      for(const p of pets){this.remember(p);c.put('petCatalog',p.id,{...p,origin:'pet-raiders'},source);this.skills(p,source);}return true;
    }
    if(type===15514){
      if(request.id===undefined)return false;
      if(r.getByte()<0)throw Error('宠物详情：'+r.getString());
      const items=[],p=readPetDetail(r,d,blocks,{publicName:true,onItem:i=>items.push(i)});if(!p)throw Error('宠物详情为空');p.description=r.getString();r.finish();
      const value={id:request.id,scope:'server-template-preview',...p};this.remember(value);for(const i of items)c.addItem(i,source);c.put('pets',request.id,value,source);this.skills(p,source);return true;
    }
    if([15502,15512,17602].includes(type)){
      let slot=request.slot===undefined?`preview:${source.requestSeq??source.seq}`:`bag:${request.slot}`;
      if(type===17602)slot='bag:'+r.getShort();else if(r.getByte()<0)return false;
      const items=[],p=readPetDetail(r,d,blocks,{onItem:i=>items.push(i)});r.finish();for(const i of items)c.addItem(i,source);this.snapshot(p,source,slot);return true;
    }
    return false;
  }
  decodeBag(r,source,request){
    const c=this.recorder,{d,blocks}=c.deps,wait=r.getByte();
    if(wait===2){const pet=readPetDetail(r,d,blocks,{onItem:i=>c.addItem(i,source)});r.finish();this.snapshot(pet,source,'active');return true;}
    if(wait!==1||request.wait!==1)return false;
    const extraCount=r.getByte(),extra=extraCount?{count:extraCount,slot:r.getShort(),value:r.getInt()}:null,outputs=[],items=[];
    for(let n=count(r.getByte(),127);n>0;n--){const mode=r.getByte(),quantity=r.getByte();
      if(mode===1){const slot=r.getInt(),row=readInventoryItem(r,d);if(row.slot!==slot)throw Error('Pet hatch slot mismatch');outputs.push({slot,quantity,...(row.pet?{pet:row.pet}:{itemId:row.item.id})});if(row.item)items.push(row.item);}
      else if(mode===2)outputs.push({quantity,itemId:r.getInt(),slot:r.getInt()});
      else throw Error('Unknown pet hatch reward mode '+mode);
    }
    r.finish();for(const item of items)c.addItem(item,source);
    c.put('petHatches',source.seq,{inputItemId:request.itemId??null,inputSlot:request.slot,quantity:request.quantity,inventorySeq:request.inventorySeq,association:request.itemId?'fresh-inventory':'unconfirmed-input',outputs,extra,distributionKnown:false},source);return true;
  }
  save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});atomicJson(this.file,{clientVersion:305,pets:[...this.known.values()].sort((a,b)=>a.id-b.id),eggs:[...this.eggs.values()]});}
}
module.exports={PET_CATEGORIES,PET_PROTOCOLS,petRequest,readPetDetail,readPetSummary,readInventoryItem,PetCollection};
