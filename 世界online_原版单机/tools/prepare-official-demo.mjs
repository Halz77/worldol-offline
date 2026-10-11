import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SaveStore} from '../lib/store.mjs';
import {equip} from '../lib/restoration.mjs';
import {hpMax,mpMax} from '../lib/content.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
let status;
try{status=await fetch('http://127.0.0.1:8776/api/status',{signal:AbortSignal.timeout(1000)});}catch{}
if(status?.ok)throw Error('Prepare only while port 8776 is stopped, to avoid changing a live save.');
const store=new SaveStore(path.join(root,'test-saves')),account=store.account('original-v04');
if(!store.roles(account).length){
 const p=store.create(account,{sex:1,race:1,job:3,icon1:'2240667',icon2:'0',icon3:'0',name:'原版试游'});
 p.level=20;p.expMax=2000;equip(p,30);p.hp=hpMax(p);p.mp=mpMax(p);
 p.restoration.demoNote='独立的 20 级单机试游角色；原角色未更改。';store.save();
 console.log('Created separate 20-level demo save: original-v04');
}else console.log('Existing original-v04 demo retained without changes.');
