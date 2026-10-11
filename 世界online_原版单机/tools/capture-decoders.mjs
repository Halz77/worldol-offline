import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {simple} from 'acorn-walk';

export class Reader {
  constructor(bytes) { this.b=Buffer.from(bytes); this.pos=0; }
  take(n) { if(!Number.isInteger(n)||n<0||this.pos+n>this.b.length) throw Error(`Truncated at ${this.pos}, need ${n}, total ${this.b.length}`); const p=this.pos;this.pos+=n;return p; }
  getByte(){return this.b.readInt8(this.take(1));}
  getShort(){return this.b.readInt16BE(this.take(2));}
  getInt(){return this.b.readInt32BE(this.take(4));}
  getBoolean(){return this.getByte()!==0;}
  getLong(){const n=this.b.readBigInt64BE(this.take(8));return {toNumber:()=>Number(n),toJSON:()=>n.toString()};}
  getLength(){return this.b.readUIntBE(this.take(3),3);}
  raw(n){return this.b.subarray(this.take(n),this.pos);}
  getString(){return Buffer.from(this.raw(this.getLength()*2)).swap16().toString('utf16le');}
  readUTF(){return this.raw(this.getShort()&65535).toString('utf8');}
  readByte(){return this.getByte();} readShort(){return this.getShort();} readInt(){return this.getInt();} readBoolean(){return this.getBoolean();}
  getBytes(){return this.raw(this.getLength());}
  getByteArray(){return new Reader(this.getBytes());}
  finish(){if(this.pos!==this.b.length)throw Error(`Unconsumed bytes ${this.b.length-this.pos} at ${this.pos}`);}
}

// Walk player-list records to reach the following public map/NPC blocks.
// Account names, appearance, teams, shops and other personal fields are discarded.
export function skipPlayerList(r){
  const pet=()=>{if(r.getByte()>=0){r.getString();r.take(8+2+8);}};
  const merc=()=>{if(r.getInt()>=0)r.take(24);};
  const count=r.getShort();if(count<0)throw Error('Negative player-list count');
  for(let i=0;i<count;i++){
    r.take(1+4);r.getString();r.getString();r.getString();r.take(2+24+4+4);
    if(r.getByte()===1){r.getString();r.getByte();}
    if(r.getInt()>=0){r.getString();r.getByte();}r.take(3);pet();
    for(let n=r.getByte();n>0;n--){r.getShort();merc();merc();}
    for(let n=r.getByte();n>0;n--){r.take(1+4+24);pet();}
    r.getString();r.take(4+2+1);r.getString();r.getString();r.getBoolean();
  }
  for(let n=r.getShort();n>0;n--){r.getInt();const members=r.getByte();if(members<0)throw Error('Negative team count');r.take(members*4);}
  return count;
}

export function decoders(root) {
  const cache=new Map();
  function module(id){
    if(cache.has(id))return cache.get(id);
    const source=fs.readFileSync(path.join(root,'analysis/modules',String(id).padStart(4,'0')+'.js'),'utf8'),methods=new Map(),constants={};
    simple(parse(source,{ecmaVersion:'latest'}),{AssignmentExpression(n){
      if(n.left.type!=='MemberExpression')return;
      const name=n.left.computed?n.left.property.value:n.left.property.name;
      if(n.right.type==='FunctionExpression')methods.set(name,source.slice(n.right.start,n.right.end));
      if(/^[A-Z][A-Z_0-9]+$/.test(name)&&n.right.type==='Literal')constants[name]=n.right.value;
    }});
    const result={methods,constants};cache.set(id,result);return result;
  }
  const strictConsole={error(e){throw e;}};
  // These specific byte-reading methods have been reviewed. No full game module,
  // browser APIs, network APIs, timers, or application startup code are executed.
  function native(id,name,scope={}){
    const code=module(id).methods.get(name);if(!code)throw Error(`Missing ${id}:${name}`);
    return new vm.Script('('+code+')').runInNewContext({console:strictConsole,...scope},{timeout:1000});
  }
  const constants=module(4).constants;
  class Skill{}
  const skillScope={d:{default:constants}};
  Skill.fromBaseBytes=native(57,'fromBaseBytes',skillScope);
  Skill.fromBaseBytesForItem=native(57,'fromBaseBytesForItem',skillScope);
  Skill.fromBytes=r=>{const start=r.pos,value=Skill.fromBaseBytes(r,new Skill());value.wireBase64=r.b.subarray(start,r.pos).toString('base64');return value;};
  Skill.fromShopBytes=r=>{const s=Skill.fromBytes(r);s.sp=r.getShort()&65535;s.money1=r.getShort()&65535;s.money2=r.getShort()&65535;s.money3=r.getInt();s.reqJob=r.getByte();s.reqLevel=r.getByte();return s;};
  class Item{constructor(){this.illusion=[];}}
  Object.assign(Item,module(32).constants);
  const itemScope={e:Item,a:{default:constants},y:{default:Skill},n:{default:{myPlayer:{putIllusion:{}}}},v:{TimeUtil:{isTimeNo:()=>false}},o:{default:{timer:{serverTime:0}}}};
  for(const name of ['getItemClass','getIsItemPetEquip','setCombinUpSkill'])Item.prototype[name]=native(32,name,itemScope);
  for(const name of ['fromBytesAtts2','fromItemAscensionStarInfo','fromCssInfoBytes','class_seal','fromMissionBytes'])Item[name]=native(32,name,itemScope);
  class Mission{constructor(id){this.id=id;}init(){}}
  Object.assign(Mission,module(64).constants);
  const conditionNames=Object.fromEntries(Object.entries(module(231).constants).filter(([n])=>n.startsWith('CONDITION_')).map(([n,id])=>[id,n]));
  function condition(r){const type=r.getByte(),not=r.getByte(),bytes=r.raw(r.getByte()&255);const c={type,typeName:conditionNames[type],not,rawHex:bytes.toString('hex')};const d=new Reader(bytes);
    try{switch(c.typeName){
      case 'CONDITION_LEVEL':c.minimum=d.getByte();break;
      case 'CONDITION_KILL_MONSTER':c.monsterId=d.getShort();c.name=d.readUTF();c.required=d.getByte();c.current=d.getByte();break;
      case 'CONDITION_HAVE_ITEM':c.itemId=d.getInt();c.name=d.readUTF();c.required=d.getByte();break;
      case 'CONDITION_EQUIP_ITEM':c.itemId=d.getInt();c.name=d.readUTF();break;
      case 'CONDITION_MISSION_DONE':case 'CONDITION_MISSION_DOING':c.missionId=d.getShort();c.name=d.readUTF();break;
      case 'CONDITION_SCHOOL':case 'CONDITION_JOB':c.value=d.getByte();break;
      case 'CONDITION_IN_MAP':c.mapId=d.getShort();c.name=d.readUTF();break;
      default:return c;
    }d.finish();}catch(e){c.decodeError=e.message;}return c;
  }
  const missionScope={t:Mission,v:{default:Item},g:{default:{fromBytes:condition}}};
  for(const name of ['isHaveSpecailReward','isHaveSpecailReward2','isHaveSpecailExecute','isEscort'])Mission.prototype[name]=native(64,name,missionScope);
  Mission.fromBytes=native(64,'fromBytes',missionScope);
  class Npc{readNPCSign(r){this.sign=r.getByte();}setDir(v){this.direction=v;}setPosition(x,y){this.x=x;this.y=y;}}
  Object.assign(Npc,module(74).constants);
  const npcScope={t:Npc};
  Npc.prototype.isUseMissionData=native(74,'isUseMissionData',npcScope);
  Npc.readPowerNPCData=native(74,'readPowerNPCData',npcScope);Npc.fromBytes=native(74,'fromBytes',npcScope);
  class Monster{}
  Monster.fromBytes=native(91,'fromBytes',{t:Monster});
  class Group{constructor(){this.monsters=[];this.npcs=[];}isFlag(v){return (this.flag&v)!==0;}}
  Object.assign(Group,module(228).constants);Group.fromBytes=native(228,'fromBytes',{e:Group});
  class AI{}
  AI.fromBytes=native(178,'fromBytes',{e:AI,o:{default:{getSkillById:(skills,id,level)=>({id,level,definitionFound:skills.some(s=>s.id===id&&s.level===level)})}}});
  for(const cls of [Mission,Npc,Monster,Group,AI]){const decode=cls.fromBytes;cls.fromBytes=function(r,...args){const start=r.pos,value=decode.call(cls,r,...args);if(value)value.wireBase64=r.b.subarray(start,r.pos).toString('base64');return value;};}
  function monsters(r){const result={groups:[],monsters:[],skills:[],ai:[]};for(let n=r.getByte();n>0;n--)result.groups.push(Group.fromBytes(r));const count=r.getByte();for(let n=count;n>0;n--)result.monsters.push(Monster.fromBytes(r));if(count>0){for(let n=r.getByte();n>0;n--)result.skills.push(Skill.fromBytes(r));for(let n=r.getByte();n>0;n--)result.ai.push(AI.fromBytes(r,result.skills));}return result;}
  const allocate=['isAllocateMirrorMap','isAllocateCountryMap','isAllocateCityMap'].map(name=>native(4,name,{e:constants}));
  return {Reader,Skill,Item,Mission,Npc,Monster,Group,AI,monsters,constants,module,native,isAllocated:id=>allocate.some(fn=>fn(id))};
}

// Protobuf schemas are extracted as data from generated switch statements.
// The generated bundle itself is never executed.
export function protobufSchemas(source){
  const schemas={};
  simple(parse(source,{ecmaVersion:'latest'}),{AssignmentExpression(n){
    if(n.left.type!=='MemberExpression'||n.left.property.value!=='decode'||n.right.type!=='FunctionExpression')return;
    const code=source.slice(n.right.start,n.right.end),type=code.match(/new u\["([^"]+)"\]/)?.[1];if(!type)return;
    const fields={};simple(n.right,{SwitchStatement(sw){for(const c of sw.cases){if(!c.test||typeof c.test.value!=='number')continue;const part=source.slice(c.start,c.end);
      const primitive=part.match(/a\["([^"]+)"\]\s*=\s*n\["([^"]+)"\]\(\)/);
      const nested=part.match(/a\["([^"]+)"\]\s*=\s*u\["([^"]+)"\]\["decode"\]/);
      const repeated=part.match(/a\["([^"]+)"\]\["push"\]\(\s*u\["([^"]+)"\]\["decode"\]/);
      const repeatedPrimitive=part.match(/a\["([^"]+)"\]\["push"\]\(n\["([^"]+)"\]\(\)\)/);
      const m=primitive||nested||repeated||repeatedPrimitive;fields[c.test.value]=m?{name:m[1],type:m[2],message:!!(nested||repeated),repeated:!!(repeated||repeatedPrimitive)}:{unsupported:true};
    }}});schemas[type]=fields;
  }});
  // This generated decoder has a single conditional instead of a switch.
  schemas.s2c_HandBookGroupList={1:{name:'infos',type:'handBookGroupInfo',message:true,repeated:true}};
  return schemas;
}
export function protobuf(bytes,type,schemas){
  const r=new Reader(bytes),out={};const schema=schemas[type];if(!schema)throw Error('Unknown protobuf type '+type);
  function varint(){let v=0n;for(let i=0;i<10;i++){const b=r.getByte()&255;v|=BigInt(b&127)<<BigInt(i*7);if(!(b&128))return v;}throw Error('Varint overflow');}
  function value(f,wire){
    if(f.message){if(wire!==2)throw Error('Wrong message wire type');return protobuf(r.raw(Number(varint())),f.type,schemas);}
    if(['int32','uint32','sint32','int64','uint64','sint64','bool'].includes(f.type)){
      if(wire!==0)throw Error('Wrong integer wire type');let n=varint();if(f.type.startsWith('sint'))n=(n>>1n)^-(n&1n);
      if(f.type==='bool')return n!==0n;if(f.type==='int32')return Number(BigInt.asIntN(32,n));if(f.type.endsWith('64'))return (f.type==='int64'?BigInt.asIntN(64,n):n).toString();return Number(n);
    }
    if(f.type==='string'||f.type==='bytes'){if(wire!==2)throw Error('Wrong string wire type');const b=r.raw(Number(varint()));return b.toString(f.type==='string'?'utf8':'base64');}
    throw Error('Unsupported primitive '+f.type);
  }
  while(r.pos<r.b.length){const tag=Number(varint()),id=tag>>>3,wire=tag&7,f=schema[id];if(!id)throw Error('Zero protobuf tag');if(!f||f.unsupported)throw Error(`Unsupported ${type} field ${id}`);
    if(f.repeated&&!f.message&&!['string','bytes'].includes(f.type)&&wire===2){const len=Number(varint()),end=r.pos+len;out[f.name]??=[];while(r.pos<end)out[f.name].push(value(f,0));if(r.pos!==end)throw Error('Packed field overrun');}
    else{const v=value(f,wire);if(f.repeated)(out[f.name]??=[]).push(v);else out[f.name]=v;}
  }r.finish();return out;
}
