import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {planStrengthLoadout} from '../lib/equipment-direct-grants.mjs';
import {nativeCharacterStats} from '../lib/native-character-stats.mjs';
import {attributes} from '../lib/restoration.mjs';
import {Writer} from '../lib/codec.mjs';
import {itemPacket} from '../lib/restoration-packets.mjs';
import {decoders,Reader} from './capture-decoders.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),file=path.join(root,'qa-v05-saves/world.json');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const apply=process.argv.includes('--apply'),bytes=fs.readFileSync(file),hash=crypto.createHash('sha256').update(bytes).digest('hex'),data=JSON.parse(bytes),before=structuredClone(data);
if(apply){let online=false;try{online=(await fetch('http://127.0.0.1:8779/api/status',{signal:AbortSignal.timeout(1500)})).ok;}catch{}if(online)throw Error('Stop the local service before modifying its save');}
if(apply&&hash!==arg('--expected-sha')?.toLowerCase())throw Error('Save changed since guarded backup');
const role=data.characters.find(p=>p.id===1001),account=data.accounts.find(a=>a.id===role?.accountId);
if(role?.level!==97||account?.name!=='xia-v05-qa')throw Error('Expected 97-level main account missing');
const planned=planStrengthLoadout(role),d=decoders(root),read=d.native(32,'fromBytesAtts1',{e:d.Item,a:{default:d.constants}});
d.Item.prototype.isTimeItem=d.native(32,'isTimeItem',{e:d.Item,a:{default:d.constants}});
for(const row of planned.items){
 const i=planned.next.inventory.find(i=>i.slot===row.slot),r=new Reader(itemPacket(new Writer(),i).done()),out=new d.Item();read(out,r);d.Item.fromBytesAtts2(out,r);r.finish();
 assert.equal(out.attachDone,30);assert.equal(out.attachValue,120);assert.equal(out.attachPower,1);assert.ok(out.attachCount>=30);assert.equal(out.enchantPowerValue1,50);assert.equal(out.enchantPowerValue2,100);
}
const stats=p=>({attributes:attributes(p).base,native:nativeCharacterStats(p).stats});
const receipt={at:new Date().toISOString(),mode:apply?'applied':'preview',account:account.name,role:role.id,beforeHash:hash,...planned.summary,items:planned.items,beforeStats:stats(role),afterStats:stats(planned.next)};
data.characters[data.characters.indexOf(role)]=planned.next;
assert.deepEqual(data.characters.filter(p=>p.id!==1001),before.characters.filter(p=>p.id!==1001));
assert.deepEqual(data.accounts,before.accounts);
assert.deepEqual(planned.next.inventory.filter(i=>i.pet||i.slot>=30),role.inventory.filter(i=>i.pet||i.slot>=30));
if(apply){
 if(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw Error('Save changed during grant validation');
 const output=Buffer.from(JSON.stringify(data,null,2)+'\n');fs.writeFileSync(file+'.grant-tmp',output);fs.renameSync(file+'.grant-tmp',file);receipt.afterHash=crypto.createHash('sha256').update(output).digest('hex');
 assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')),data);
}
fs.writeFileSync(path.join(root,apply?'analysis/strength-loadout-grant.json':'analysis/strength-loadout-preview.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({mode:receipt.mode,role:role.id,...planned.summary,before:receipt.beforeStats.attributes,after:receipt.afterStats.attributes,ignoreBack:[receipt.beforeStats.native.IGNORE_BACK,receipt.afterStats.native.IGNORE_BACK]}));
