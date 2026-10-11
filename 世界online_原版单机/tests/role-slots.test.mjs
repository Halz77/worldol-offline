import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import WebSocket from 'ws';
import {Writer,Reader,frame,unframe} from '../lib/codec.mjs';
import {SaveStore} from '../lib/store.mjs';
import {decoders,Reader as NativeReader} from '../tools/capture-decoders.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
function client(count,lastIndex=count-1){
 const shown=[],tips=[],world={legionSelectId:0},modules={
  0:{ModName:{Login:'login'},LoginViewType:{CreateRole:'create'}},
  3:{default:{showView:(...args)=>shown.push(args)}},6:{default:function Base(){}},
  4:{default:{getSexString:()=> '女',getRaceString:()=> '东方',getJobString:()=> '侠客',RACE_EAST:0}},
  5:{default:world},8:{Tool:{getStyle:()=> 'role-art'}},9:{Layer:{}},
  12:{ModelConst:{}},15:{Tips:{show:message=>tips.push(message)}},29:{default:{getUiPng:s=>s}}
 };
 const req=id=>modules[id]||{};
 const scope={window:{},__extends:(child,parent)=>{child.prototype=Object.create(parent.prototype);child.prototype.constructor=child;Object.setPrototypeOf(child,parent);}};
 const factory=vm.runInNewContext('('+fs.readFileSync(path.join(root,'analysis/modules/0427.js'),'utf8')+')',scope);
 modules[427]={};factory({},modules[427],req);
 vm.runInNewContext(fs.readFileSync(path.join(root,'web/role-slots.js'),'utf8'),scope);scope.window.installOfflineRoleSlots(req);
 const rows=Array.from({length:count},(_,i)=>({id:1001+i,name:'角色'+(i+1),getName(){return this.name;},getSex:()=>1,getRace:()=>0,getJob:()=>1,getLevel:()=>1,getMapName:()=> '世界村',isStatusBit:()=>false}));
 const view=Object.fromEntries(['btnLeft','btnRight','lab_page','btnEnter','btnDelete','lab_name','lab_sex','lab_lv','lab_race','lab_job','lab_map','lab_status','img_empty','img_campBg','img_role'].map(k=>[k,{}]));
 for(let i=0;i<3;i++)view['role_'+i]={img_create:{},role_selected:{},setData(data){this.data=data;}};
 const mdr=Object.assign(Object.create(modules[427].RoleListMdr2.prototype),{_view:view,_proxy:{data:{allPlayerList:rows,lastRoleId:rows[lastIndex]?.id}},curPage:1,maxPage:1,_argId:0,hide(){},removeSpr(){this.removedSprite=true;},updateRole(){this._sp=99;}});
 return {mdr,view,shown,tips,rows};
}
test('native role selector keeps creation reachable for role counts 1 through 5, including the three-role boundary',()=>{
 for(let count=1;count<=5;count++){
  const h=client(count);h.mdr.onGotRoleList();
  assert.equal(h.mdr.maxPage,Math.ceil((count+1)/3));
  if(count===3){assert.equal(h.view.btnRight.visible,true);assert.equal(h.view.lab_page.text,'1/2');h.mdr.tapRight();assert.equal(h.view.btnEnter.label,'创建角色');assert.equal(h.view.btnDelete.visible,false);assert.equal(h.view.img_role.source,null);assert.ok(h.mdr.removedSprite);}
  h.mdr.curPage=Math.ceil((count+1)/3);h.mdr.updatePage();const empty=h.view['role_'+(count%3)];assert.equal(empty.data,undefined);assert.equal(empty.img_create.visible,true);assert.equal(empty.touchEnabled,true);
  h.mdr.onTapRole({target:empty});assert.deepEqual(h.shown,[['login','create']]);
 }
});
test('native selector reselects roles 4 to 6, caps creation at six, and still displays oversized imported saves',()=>{
 for(let selected=3;selected<6;selected++){
  const h=client(6,selected);h.mdr.onGotRoleList();assert.equal(h.mdr.curPage,2);assert.equal(h.mdr.curItem.data,h.rows[selected]);assert.equal(h.view.lab_name.text,h.rows[selected].name);assert.equal(h.view.btnRight.visible,false);
  assert.ok([0,1,2].every(i=>!h.view['role_'+i].img_create.visible));h.mdr.createRole();assert.equal(h.shown.length,0);assert.match(h.tips[0],/6 个角色/);
  h.mdr.tapLeft();h.mdr.tapLeft();assert.equal(h.mdr.curPage,1);
 }
 const imported=client(7);imported.mdr.onGotRoleList();assert.equal(imported.mdr.curPage,3);assert.equal(imported.mdr.curItem.data.id,1007);assert.equal(imported.view.role_1.touchEnabled,false);
});
test('isolated native protocol creates six roles, returns and enters roles 4 to 6, rejects a seventh, and preserves them on reload',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'worldol-role-slots-'));
 const allocator=net.createServer();allocator.listen(0,'127.0.0.1');await once(allocator,'listening');const port=allocator.address().port;await new Promise(resolve=>allocator.close(resolve));
 const proc=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,WORLDOL_PORT:String(port),WORLDOL_SAVES:dir,WORLDOL_LOGS:path.join(dir,'logs')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let output='',ws;proc.stdout.on('data',b=>output+=b);proc.stderr.on('data',b=>output+=b);
 try{
  const base='http://127.0.0.1:'+port;let status;
  for(let i=0;i<60;i++){if(proc.exitCode!==null)throw Error(output);try{status=await(await fetch(base+'/api/status',{signal:AbortSignal.timeout(300)})).json();break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(status?.pid,proc.pid);
  const html=await(await fetch(base+'/')).text();assert.ok(html.indexOf('/role-slots.js')<html.indexOf('/offline.js'));assert.match(await(await fetch(base+'/role-slots.js')).text(),/installOfflineRoleSlots/);
  ws=new WebSocket('ws://127.0.0.1:'+port+'/game');await once(ws,'open');
  const call=(type,w=new Writer())=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',handler);reject(Error('Reply timed out: '+type));},5000);function handler(bytes){const p=unframe(bytes);if(p.type!==type)return;clearTimeout(timer);ws.off('message',handler);resolve(new Reader(p.body));}ws.on('message',handler);ws.send(frame(type,w));});
  const login=await call(5002,new Writer().string('six-role-qa'));assert.equal(login.byte(),0);const accountId=login.long(),session=login.int();assert.equal((await call(1,new Writer().long(accountId).int(session))).byte(),0);
  const ids=[];for(let i=1;i<=6;i++){const r=await call(10002,new Writer().byte(1).byte(0).byte(1).long(2240667).long(0).long(0).string('角色'+i));assert.equal(r.byte(),0);ids.push(r.int());}
  // Let the normal request hook initialize the last role's daily counters
  // before checking that a rejected seventh creation leaves the save intact.
  await call(10001);
  const saveFile=path.join(dir,'world.json'),before=fs.readFileSync(saveFile,'utf8'),extra=await call(10002,new Writer().byte(1).byte(0).byte(1).long(2240667).long(0).long(0).string('角色7'));assert.equal(extra.byte(),-1);assert.match(extra.string(),/6 个角色/);assert.equal(fs.readFileSync(saveFile,'utf8'),before);
  const list=await call(10001);list.string();assert.equal(list.short(),6);for(const id of ids){assert.equal(list.int(),id);list.string();for(let i=0;i<5;i++)list.byte();list.string();for(let i=0;i<3;i++)list.long();list.int();}assert.equal(list.int(),ids[5]);assert.equal(list.pos,list.b.length);
  const native=decoders(root),returned=[];
  const onLogout=native.native(360,'onRoleLogout',{
    console:{info(){}},
    g:{default:{alertMessage(){assert.fail('logout was rejected');}}},
    E:{default:{setMsgTag(type){assert.equal(type,3);}}},
    p:{default:{CG_LOGIN_ACTORLEAVE:3}},
    m:{default:{doLogOutMsg(type,request){returned.push({type,request});}}}
  });
  for(const id of ids.slice(3)){
    assert.equal((await call(2,new Writer().int(id))).byte(),0);
    const response=await call(3,new Writer().byte(1)),body=new NativeReader(response.b);onLogout({body});body.finish();
    const roles=await call(10001);roles.string();assert.equal(roles.short(),6);
  }
  assert.deepEqual(returned,Array.from({length:3},()=>({type:1,request:false})));
  const restored=new SaveStore(dir);assert.deepEqual(restored.data.characters.map(p=>p.id),ids);assert.equal(restored.data.accounts[0].lastRoleId,ids[5]);
 }finally{
  ws?.close();if(proc.exitCode===null){const controlFile=path.join(dir,'logs/control.json');if(fs.existsSync(controlFile)){const control=JSON.parse(fs.readFileSync(controlFile));assert.equal(control.pid,proc.pid);const exited=once(proc,'exit');await fetch('http://127.0.0.1:'+port+'/api/shutdown',{method:'POST',headers:{'X-Worldol-Control':control.token}});await exited;}else proc.kill();}
  const exact=fs.realpathSync(dir);assert.ok(exact.startsWith(fs.realpathSync(os.tmpdir())+path.sep+'worldol-role-slots-'));fs.rmSync(exact,{recursive:true});
 }
});
