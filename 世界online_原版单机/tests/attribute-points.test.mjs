import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SaveStore} from '../lib/store.mjs';
import {normalizeRole,gain} from '../lib/content.mjs';
import {initializeNewbie,reconcileAttributePoints} from '../lib/progression.mjs';
import {handleAttributes} from '../lib/newbie-service.mjs';
import {Writer,Reader} from '../lib/codec.mjs';
import {playerDetail} from '../lib/world.mjs';
import {skipPlayerDetail} from '../tools/capture-public-blocks.mjs';
import {Reader as NativeReader} from '../tools/capture-decoders.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const total=p=>p.baseStats.reduce((sum,n)=>sum+n,0)+p.attributePoints;
const role=()=>{const p={id:1001,name:'属性验收',sex:1,race:0,job:1,level:1,icon1:'2240393',icon2:'0',icon3:'0'};initializeNewbie(p);return normalizeRole(p);};

test('level-97 repair includes starting stats and preserves allocated points without repeat grants',()=>{
 const p=role();
 for(let level=1;level<15;level++)gain(p,p.expMax,0);
 assert.equal(total(p),75);assert.equal(p.attributePoints,45);
 p.baseStats=[48,9,9,5,4];p.attributePoints=0;p.level=97;
 const before=structuredClone(p);
 assert.equal(reconcileAttributePoints(p),246);assert.equal(total(p),321);
 assert.deepEqual(p,{...before,attributePoints:246});
 normalizeRole(p);const fixed=structuredClone(p);
 for(let i=0;i<5;i++)normalizeRole(p);
 assert.deepEqual(p,fixed);
 const decoded=skipPlayerDetail(new NativeReader(playerDetail(new Writer(),p).done()));
 assert.equal(decoded.level,97);assert.equal(decoded.attributePoints,246);assert.deepEqual(decoded.attributes,[48,9,9,5,4]);
 p.baseStats[0]+=200;p.attributePoints-=200;
 normalizeRole(p);assert.equal(p.attributePoints,46);assert.equal(total(p),321);
 p.attributePoints+=10;assert.equal(reconcileAttributePoints(p),0);assert.equal(total(p),331,'manual bonuses are retained');
});

test('level repair preserves normal rewards, supports direct level changes and leaves other progression alone',()=>{
 const p=role();assert.equal(total(p),33);
 gain(p,p.expMax,0);normalizeRole(p);assert.equal(total(p),36);assert.equal(p.attributePoints,6);
 p.level=96;normalizeRole(p);assert.equal(total(p),318);
 p.level=97;normalizeRole(p);assert.equal(total(p),321);
 const other={...p,progression:undefined,attributePoints:0};
 const before=structuredClone(other);assert.equal(reconcileAttributePoints(other),0);assert.deepEqual(other,before);
});

test('legacy save migrates to 321; native allocation, refunds and disk reload conserve the budget',()=>{
 const dir=fs.mkdtempSync(path.join(root,'test-attribute-points-'));
 try{
  const oldStore=new SaveStore(dir),account=oldStore.account('attribute-test');
  const oldRole=oldStore.create(account,{name:'属性存档验收',sex:1,race:0,job:1,icon1:'2240393',icon2:'0',icon3:'0'});
  oldRole.level=97;oldRole.baseStats=[48,9,9,5,4];oldRole.attributePoints=0;oldRole.vipLevel2=9;
  oldStore.save();
  const store=new SaveStore(dir),p=store.data.characters[0],before=structuredClone(p),sent=[];
  assert.equal(p.attributePoints,246);assert.equal(total(p),321);
  const context={role:p},env={store,send(type,w){sent.push(w.done());},log(){}};
  const call=entries=>{
   const w=new Writer().byte(entries.length);for(const [key,delta] of entries)w.short(key).int(delta);
   assert.equal(handleAttributes(11003,new Reader(w.done()),context,env),true);
   return new Reader(sent.at(-1));
  };
  const added=call([[6,100],[7,146]]);assert.equal(added.byte(),0);assert.equal(added.short(),0);
  assert.equal(total(p),321);assert.deepEqual(p.baseStats,[148,155,9,5,4]);
  const loaded=new SaveStore(dir).data.characters[0];assert.deepEqual(loaded,p);
  const full=structuredClone(p);assert.equal(call([[6,1]]).byte(),-1);assert.deepEqual(p,full);
  assert.equal(call([[6,-100],[7,-146]]).byte(),0);assert.deepEqual(p,before);
  assert.equal(call([[6,-43],[7,-2]]).byte(),0);assert.deepEqual(p.baseStats,p.initialStats);assert.equal(p.attributePoints,291);assert.equal(total(p),321);
  assert.equal(call([[6,-1]]).byte(),-1);assert.equal(total(p),321);
  assert.deepEqual(new SaveStore(dir).data.characters[0],p);
  assert.deepEqual(p.inventory,before.inventory);assert.deepEqual(p.skills,before.skills);assert.equal(p.coins,before.coins);assert.equal(p.vipLevel2,9);
 }finally{
  const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(root)+path.sep+'test-attribute-points-'));fs.rmSync(exact,{recursive:true});
 }
});
