import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {BLOOD_MIST_BOOK_ID} from '../lib/pet-skill-book-data.mjs';
import {planItemRewards} from '../lib/restoration.mjs';
import {itemPacket} from '../lib/restoration-packets.mjs';
import {Writer} from '../lib/codec.mjs';
import {decoders,Reader} from './capture-decoders.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),file=path.join(root,'qa-v05-saves/world.json'),apply=process.argv.includes('--apply');
const shaIndex=process.argv.indexOf('--expected-sha'),expectedHash=shaIndex>=0?process.argv[shaIndex+1]:null;
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
if(apply){let online=false;try{online=(await fetch('http://127.0.0.1:8779/api/status',{signal:AbortSignal.timeout(1500)})).ok;}catch{}if(online)throw Error('Stop main service before modifying its save');}
const bytes=fs.readFileSync(file),beforeHash=hash(bytes),data=JSON.parse(bytes),before=structuredClone(data);
if(apply&&expectedHash?.toLowerCase()!==beforeHash)throw Error('Save hash differs from guarded backup');
const account=data.accounts.find(a=>a.name==='xia-v05-qa'),role=data.characters.find(p=>p.id===account?.lastRoleId&&p.accountId===account.id);
if(!role)throw Error('Current xia-v05-qa role could not be identified');
const key='blood-mist-seal-book-request-20260922';
const previous=role.restoration?.petSkillBookGrants?.[key];
let slot=previous?.slot;
if(!previous){
 const reward=planItemRewards(role,[{id:BLOOD_MIST_BOOK_ID,quantity:1}]);role.inventory=reward.inventory;slot=reward.added[0].instance.slot;
 role.restoration??={};role.restoration.petSkillBookGrants??={};
 role.restoration.petSkillBookGrants[key]={itemId:BLOOD_MIST_BOOK_ID,quantity:1,slot,at:new Date().toISOString()};
 const d=decoders(root),r=new Reader(itemPacket(new Writer(),role.inventory.find(i=>i.slot===slot)).done()),native=new d.Item();
 d.Item.prototype.isTimeItem=d.native(32,'isTimeItem',{e:d.Item,a:{default:d.constants}});
 d.native(32,'fromBytesAtts1',{e:d.Item})(native,r);d.Item.fromBytesAtts2(native,r);r.finish();
 assert.equal(native.id,BLOOD_MIST_BOOK_ID);assert.equal(native.powerValue1,6079);assert.equal(native.powerValue2,1);
}
const allowed=structuredClone(before),target=allowed.characters.find(p=>p.id===role.id);target.inventory=role.inventory;target.restoration=role.restoration;assert.deepEqual(data,allowed);
const receipt={at:new Date().toISOString(),mode:apply?'applied':'preview',created:!previous,account:account.name,roleId:role.id,roleName:role.name,itemId:BLOOD_MIST_BOOK_ID,name:'血雾的结界（封印书）',quantity:1,slot,beforeHash};
if(apply&&!previous){
 if(hash(fs.readFileSync(file))!==beforeHash)throw Error('Save changed during grant validation');
 const output=Buffer.from(JSON.stringify(data,null,2)+'\n');fs.writeFileSync(file+'.pet-book-grant-tmp',output);fs.renameSync(file+'.pet-book-grant-tmp',file);
 receipt.afterHash=hash(output);assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),data);
}
fs.writeFileSync(path.join(root,apply?'analysis/pet-skill-book-grant.json':'analysis/pet-skill-book-grant-preview.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt));
