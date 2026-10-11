import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Reader,decoders} from './capture-decoders.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),folder=path.resolve(process.argv[2]||'');
if(!process.argv[2])throw Error('Supply a capture folder');
const d=decoders(root),rows=fs.readdirSync(path.join(folder,'events')).filter(f=>/^\d+\.ndjson$/.test(f)).sort().flatMap(f=>fs.readFileSync(path.join(folder,'events',f),'utf8').split('\n').filter(Boolean).map(JSON.parse));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const version=rows.find(e=>e.method==='recorder.httpBody'&&new URL(e.params.url).pathname.endsWith('/v/gd/305.json'));
if(!version||hash(fs.readFileSync(path.join(root,'client/v/gd/305.json')))!==version.params.body.sha256)throw Error('Client 305 manifest not matched');
const checks=Object.fromEntries(['isEnchantShop','isEnchantCountryShop','isAdvancedShop'].map(name=>[name,d.native(4,name,{e:d.constants})]));
const pending=new Map(),found=[];
for(const row of rows){
 if(!/^Network.webSocketFrame(Sent|Received)$/.test(row.method))continue;
 const ref=row.params.response.payload,b=fs.readFileSync(path.join(folder,ref.file));if(b.length<4||b.readUInt16BE(2)!==11503)continue;
 if(b.readUInt16BE(0)!==b.length||hash(b)!==ref.sha256)throw Error('Invalid captured shop packet');
 const r=new Reader(b.subarray(4)),key=row.target+':'+row.params.requestId;
 if(row.method.endsWith('Sent')){pending.set(key,r.getShort());r.finish();continue;}
 const shop=pending.get(key);if(!shop)throw Error('Shop response has no request');
 if(r.getByte()<0){r.getString();r.finish();continue;}
 for(let n=r.getShort();n>0;n--){
  const start=r.pos,item=new d.Item();d.Item.fromBytesAtts2(item,r);const end=r.pos;
  const moneyType=r.getByte(),price=r.getInt(),materials=[];
  for(let count=r.getByte();count>0;count--)materials.push({name:r.getString(),grade:r.getByte(),quantity:r.getInt(),id:r.getInt()});
  for(let count=r.getByte();count>0;count--)if(r.getBoolean())d.Skill.fromBaseBytesForItem(r,new d.Skill());
  const combineItemId=r.getInt();let enchantType,enchantNeed;
  if(checks.isEnchantShop(shop)||checks.isEnchantCountryShop(shop)){enchantType=r.getByte();enchantNeed=r.getInt();}
  r.getByte();r.getByte();if(checks.isAdvancedShop(shop))r.take(17);
  if(item.name==='7级力量附魔'){
   const wire=r.b.subarray(start,end),check=new Reader(wire),parsed=new d.Item();d.Item.fromBytesAtts2(parsed,check);check.finish();
   found.push({...parsed,definitionBase64:wire.toString('base64'),shop,moneyType,price,materials,combineItemId,enchantType,enchantNeed,source:{capture:path.basename(folder),seq:row.seq,protocol:11503,sha256:ref.sha256,blob:ref.file}});
  }
 }
 r.finish();
}
if(!found.length)throw Error('No complete level 7 strength enchant found');
fs.writeFileSync(path.join(root,'data/manual-item-grants.json'),JSON.stringify({schema:1,enchantments:found,gems:{strength4:{name:'加4力量宝石（单机直装）',power1:1,powerValue1:4,origin:'user-request'}}},null,2)+'\n');
console.log(JSON.stringify(found.map(e=>({id:e.id,name:e.name,info:e.info,powers:[[e.power2,e.powerValue2],[e.power3,e.powerValue3]],enchantNeed:e.enchantNeed}))));
