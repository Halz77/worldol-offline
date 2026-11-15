import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Writer,Reader,frame,unframe } from './lib/codec.mjs';
import { SaveStore } from './lib/store.mjs';
// 协议号常量：从 analysis/modules/0019.js 解析（以前是这一行末尾的内联正则）。
import { loadProtocolConstants,protocolLookup } from './lib/protocol-constants.mjs';
// 入站分派链：22 个 service 的顺序在那边唯一确定，本文件不再自己排。
import { createInboundDispatcher } from './lib/protocol-dispatch.mjs';
// HTTP 路由表：27 条路由 + 方法门 + 静态兜底都在那边，本文件只负责起服务。
import { createHttpRouter } from './lib/http-routes.mjs';
import { nextTaskResetAt,resetTaskDays } from './lib/task-reset.mjs';
// 阶段 1：传输层与会话层分离。server.mjs 只负责造 transport、把帧喂给会话。
import { createTransport } from './lib/transport.mjs';
import { createGameSession } from './lib/game-session.mjs';

/**
 * 造一个运行时。默认仍是「HTTP + WebSocket，监听 127.0.0.1」，
 * 设 WORLDOL_TRANSPORT=memory（或 createRuntime({transport:'memory'})）则
 * 完全不创建 net.Server、不监听端口，帧在进程内往返。
 *
 * 只有 `node server.mjs` 直跑时才会自动 start()；被 import 时不产生任何监听副作用，
 * 便于测试、自检以及后续 Electron / WebView 宿主直接调用 connect()。
 */
export function createRuntime({transport:transportMode}={}){
 const root=path.dirname(fileURLToPath(import.meta.url));
 const raw=process.env.WORLDOL_RESOURCES || (fs.existsSync(path.join(root,'client/v/gd/305.json'))?path.join(root,'client'):path.resolve(root,'../H5客户端_v305_20260920/files/resgood'));
 const port=Number(process.env.WORLDOL_PORT || 8775);
 const mode=transportMode || process.env.WORLDOL_TRANSPORT || 'ws';
 if(mode!=='ws'&&mode!=='memory')throw Error('WORLDOL_TRANSPORT 只能是 ws 或 memory，收到：'+mode);
 if(!fs.existsSync(path.join(raw,'v/gd/305.json')))throw Error('未找到 v305 原版资源目录：'+raw);
 const store=new SaveStore(process.env.WORLDOL_SAVES || path.join(root,'saves'));
 const logDir=process.env.WORLDOL_LOGS || path.join(root,'logs');
 fs.mkdirSync(logDir,{recursive:true});
 const controlToken=randomBytes(24).toString('hex');
 let recent=[],requests=0,missing=new Set(),unknown=new Set();
 function log(kind,data){const entry={time:new Date().toISOString(),kind,...data};recent.push(entry);if(recent.length>150)recent.shift();const file=path.join(logDir,'session.jsonl');if(fs.existsSync(file)&&fs.statSync(file).size>512*1024)fs.renameSync(file,file+'.previous');fs.appendFileSync(file,JSON.stringify(entry)+'\n');}

 // 协议号常量表。定义在 analysis/modules/0019.js，服务端只在这里解析一次。
 const P=loadProtocolConstants(root);
 const protoName=protocolLookup(P);
 // 分派链（lib/protocol-dispatch.mjs）里的补推钩子引用的是常量**名字**，
 // 建分派器时会校验名字真实存在，缺一个就直接抛错。
 const dispatchInbound=createInboundDispatcher(P);
 // 这些错误要回一个「状态字节 -1 + 文案」的失败包，客户端才会把提示弹出来。
 const ERROR_NOTIFY_TYPES=[P.CG_LOGIN_CREATEACTOR,P.CG_SCENE_GO_MAP,P.CG_SCENE_FINDPATH_MISSION,P.CG_FIGHT_ENTER_LOCALBATTEL,P.CG_FIGHT_RUN_LOCALBATTLE,P.CG_TASK_ACCEPT,P.CG_TASK_DELIVER,P.CG_TASK_ABANDON];

 const sessions=new Map();
 const taskClients=new Map();
 let taskResetTimer;
 let server=null,transport=null;

 const httpRouter=createHttpRouter({
  root,raw,store,log,controlToken,port,
  stats:()=>({requests,missing:[...missing],unknown:[...unknown],recent}),
  onMissing:pathname=>{missing.add(pathname);log('missing',{path:pathname});},
  onShutdown:()=>{setTimeout(()=>{transport?.closeAll();server?.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref();},100);},
 });

 function resetTasks(){
  const changes=resetTaskDays(store);
  for(const change of changes.filter(c=>c.reset)){
   log('daily-tasks-reset',change);
   for(const {context,send}of taskClients.values())if(context.role?.id===change.role){
    context.taskResetPending=change;context.questTeleport=null;context.storyBattle=null;
    try{send(90021,new Writer().string(JSON.stringify(change)));}catch(error){log('daily-reset-notify-error',{role:change.role,error:String(error)});}
   }
  }
  return changes;
 }
 function scheduleTaskReset(){
  taskResetTimer=setTimeout(()=>{try{resetTasks();}catch(error){log('daily-reset-error',{error:String(error)});}finally{scheduleTaskReset();}},Math.min(60000,Math.max(1,nextTaskResetAt()-Date.now())));
  taskResetTimer.unref();
 }

 // HTTP 处理函数本身就是普通函数，有没有 http.Server 都能调用 —— 这是阶段 1
 // 「HTTP 路由退化为进程内函数调用」的落点。
 const handleRequest=async(req,res)=>{
  requests++;
  res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws://127.0.0.1:${port}; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'`);
  await httpRouter.handle(req,res);
 };

 if(mode==='memory'){
  transport=createTransport({mode:'memory'});
 }else{
  server=http.createServer(handleRequest);
  transport=createTransport({mode:'ws',server,port});
 }

 // 传输层只交付统一 connection；协议处理全在 createGameSession 里，
 // 会话代码不知道帧是从 socket 还是内存来的。
 transport.onConnection(connection=>{
  const session=createGameSession(connection,{
   store,log,P,protoName,dispatchInbound,ERROR_NOTIFY_TYPES,port,sessions,resetTasks,unknown
  });
  taskClients.set(connection,{context:session.context,send:session.send});
  connection.onMessage(data=>session.handleFrame(data));
  connection.onError(e=>log('socket-error',{error:String(e)}));
  connection.onClose(()=>{taskClients.delete(connection);session.handleClose();});
 });

 function start(){
  if(mode==='memory'){
   log('ready',{mode,port:0});
   console.log('世界 online 原版单机：内存传输已就绪（不监听端口，可用 createRuntime().connect() 建立会话）');
   return;
  }
  server.listen(port,'127.0.0.1',()=>{try{resetTasks();fs.writeFileSync(path.join(logDir,'control.json'),JSON.stringify({projectRoot:root,pid:process.pid,port,token:controlToken}));scheduleTaskReset();log('ready',{port,pid:process.pid});console.log(`世界 online 原版单机：http://127.0.0.1:${port}/`);}catch(error){console.error(error);process.exitCode=1;server.close();}});
  server.on('close',()=>clearTimeout(taskResetTimer));
  server.on('error',error=>{console.error(error.message);process.exitCode=1;});
 }
 function close(){
  clearTimeout(taskResetTimer);
  transport?.closeAll();
  server?.close();
 }

 return {
  mode,port,root,store,log,httpRouter,transport,
  handleRequest,start,close,
  /** memory 形态下建立一条进程内会话；ws 形态会抛错。 */
  connect:url=>transport.connect(url),
  /** 供不经过 HTTP 的宿主直接取统计。 */
  stats:()=>({requests,missing:[...missing],unknown:[...unknown],recent})
 };
}

// 直跑（node server.mjs）时自动启动。standalone 没有 Node 的 process.argv：
// entry.mjs 用 `await import('worldol-server')` 依赖顶层副作用建存档 / 注册内存 WS，
// 所以这里必须把 WebView 形态也认作「自动启动」，否则 APK 会起不来。
const standalone=process.platform==='browser' || !!globalThis.__worldolStandalone;
const invokedDirectly=!!process.argv?.[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(standalone||invokedDirectly)createRuntime().start();
