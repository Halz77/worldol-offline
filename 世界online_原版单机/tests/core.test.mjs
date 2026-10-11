import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import {Writer,Reader,frame,unframe} from '../lib/codec.mjs';
import {SaveStore} from '../lib/store.mjs';
import {playerDetail,enterWorld} from '../lib/world.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('v305 big-endian wire golden sample including UTF-16 surrogate pair',()=>{
  const body=new Writer().byte(-1).short(5000).int(0x12345678).long(4294967298n).string('中😀').done();
  assert.equal(body.toString('hex'),'ff13881234567800000001000000020000034e2dd83dde00');
  const p=unframe(frame(10002,body));assert.equal(p.type,10002);
  const r=new Reader(p.body);assert.equal(r.byte(),-1);assert.equal(r.short(),5000);assert.equal(r.int(),0x12345678);assert.equal(r.long(),4294967298n);assert.equal(r.string(),'中😀');assert.equal(r.pos,r.b.length);
});
test('truncated string and frame are rejected',()=>{
  assert.throws(()=>new Reader(Buffer.from('0000040041','hex')).string(),/Truncated/);
  assert.throws(()=>unframe(Buffer.alloc(3)),/Truncated/);
});
function referenceFunction(name){
  const source=fs.readFileSync(path.join(root,'analysis/modules/0056.js'),'utf8');
  let found;walk.simple(acorn.parse(source,{ecmaVersion:'latest'}),{AssignmentExpression(node){if(node.left.type==='MemberExpression'&&node.left.property.name===name&&node.right.type==='FunctionExpression')found=source.slice(node.right.start,node.right.end);}});
  assert.ok(found,'Original client parser exists');return new vm.Script('('+found+')').runInNewContext({});
}
test('server actor payload passes the actual original v305 actor parser',()=>{
  const input={id:1001,name:'青岚测试',cityUnlocked:true,sex:1,race:1,job:3,level:1,icon1:'2240667',icon2:'0',icon3:'0'};
  const r=new Reader(playerDetail(new Writer(),input).done());
  const message={};for(const [game,local] of Object.entries({getInt:'int',getShort:'short',getByte:'byte',getString:'string',getLong:'long'}))message[game]=r[local].bind(r);
  const value={fromItemSetData:referenceFunction('fromItemSetData')};
  const player=new Proxy(value,{get(target,key){if(key in target)return target[key];if(String(key).startsWith('set'))return v=>{const name=key.slice(3);target[name[0].toLowerCase()+name.slice(1)]=v;};return undefined;}});
  referenceFunction('fromBytes').call(player,message,player);
  assert.equal(player.id,input.id);assert.equal(player.name,input.name);assert.equal(player.job,3);assert.equal(player.icon1,2240667n);assert.equal(player.hp,100);assert.equal(player.money3,1000);
  assert.equal(player.cityId,1000);assert.equal(player.partnerId,-1);assert.deepEqual([...player.itemSetData],[]);assert.equal(player.itemSetData.includes((197<<4)|1),false,'VIP8 bonus is excluded for a non-VIP actor');assert.equal(player.enchantValue,0);
  assert.equal(r.byte(),-1,'no pet');assert.equal(r.byte(),0,'no mercenaries');assert.equal(r.byte(),0,'no legions');assert.equal(r.bool(),false);assert.equal(r.int(),24);assert.equal(r.byte(),0);assert.equal(r.string(),'0');assert.equal(r.string(),'0');assert.equal(r.pos,r.b.length,'all actor fields consumed without trailing garbage');
  const entry=new Reader(enterWorld(input).done());assert.equal(entry.byte(),0);assert.equal(entry.int(),0);
});
test('save reload preserves character icons and position; corrupt saves are not overwritten',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-save-check-'));
  const db=new SaveStore(dir);const account=db.account('test');
  const role=db.create(account,{name:'存档测试',sex:0,race:0,job:1,icon1:'1234',icon2:'0',icon3:'0'});
  role.x=12;role.y=10;role.quests.active[9002]={kills:1};role.quests.completed=[9001];role.coins=1080;role.exp=45;role.battles.wins=1;db.save();
  const reload=new SaveStore(dir);assert.equal(reload.roles(reload.account('test'))[0].x,12);assert.equal(reload.data.characters[0].icon1,'1234');
  const restored=reload.data.characters[0];assert.equal(restored.quests.active[9002].kills,1);assert.deepEqual(restored.quests.completed,[9001]);assert.equal(restored.coins,1080);assert.equal(restored.exp,45);assert.equal(restored.battles.wins,1);
  assert.throws(()=>reload.create(reload.account('test'),{...role,id:999}),/已存在/);
  assert.ok(fs.existsSync(path.join(dir,'world.json.bak')));
  fs.writeFileSync(path.join(dir,'world.json'),'invalid-json');assert.throws(()=>new SaveStore(dir));assert.equal(fs.readFileSync(path.join(dir,'world.json'),'utf8'),'invalid-json');
  const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-save-check-'));fs.rmSync(exact,{recursive:true});
});
