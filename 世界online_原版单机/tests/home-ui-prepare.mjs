import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {SaveStore} from '../lib/store.mjs';import {hpMax,mpMax} from '../lib/content.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),dir=path.join(root,'analysis/home-features-qa/saves');
if(fs.existsSync(path.join(dir,'world.json')))throw Error('QA save already exists; do not overwrite it');
const db=new SaveStore(dir),account=db.account('home-ui-qa'),p=db.create(account,{name:'功能验收',sex:1,race:0,job:1,icon1:'2240667',icon2:'0',icon3:'0'});
Object.assign(p,{level:97,vipLevel2:1,gold:5000,silver:5000,coins:50000,cityUnlocked:true,mapId:1,x:19,y:15});p.hp=hpMax(p);p.mp=mpMax(p);db.save();console.log(JSON.stringify({dir,role:p.id}));
