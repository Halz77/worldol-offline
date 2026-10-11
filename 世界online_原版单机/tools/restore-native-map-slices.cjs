// Run with the existing recorder's Electron runtime; no window is created.
const {app,nativeImage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),client=path.join(root,'client');
const digest=(bytes,type='sha256')=>crypto.createHash(type).update(bytes).digest('hex');
app.whenReady().then(()=>{
 const manifestBytes=fs.readFileSync(path.join(client,'v/gd/305.json')),manifest=JSON.parse(manifestBytes),flat=new Map();
 function flatten(node,prefix=''){for(const [key,value]of Object.entries(node))typeof value==='string'?flat.set(prefix+key,value):flatten(value,prefix+key+'/');}
 flatten(manifest.url);
 const assetPath=(logical)=>{const h=flat.get(logical);return h&&path.join(client,'assets',h.startsWith('ad')?'dirad':h.slice(0,2),h+path.extname(logical));};
 const atlases=[];
 for(const logical of manifest.cfg)for(let entry of JSON.parse(fs.readFileSync(assetPath(logical)))){
  if(typeof entry==='string')entry=JSON.parse(entry);
  if(/^assets\/map_merged\//.test(entry.key||'')){const data=typeof entry.value==='string'?JSON.parse(entry.value):entry.value;atlases.push({logical:entry.key,frames:data.frames});}
 }
 const audit=JSON.parse(fs.readFileSync(path.join(root,'analysis/recorded-expansion-import.json'))),restored=[],pending=[],cache=new Map();
 for(const logical of [...new Set(audit.pendingStaticImages.map(x=>x.logical))]){
  const id=path.basename(logical,'.png'),candidates=[];
  for(const atlas of atlases){
   const frame=atlas.frames[id],sourceLogical=atlas.logical.replace(/\.json$/,'.png'),source=assetPath(sourceLogical);
   if(!frame||!source||!fs.existsSync(source))continue;
   if(!cache.has(source)){const bytes=fs.readFileSync(source);assert.ok(digest(bytes,'md5').startsWith(flat.get(sourceLogical)));cache.set(source,{image:nativeImage.createFromBuffer(bytes),sha256:digest(bytes)});}
   const original=cache.get(source),crop=original.image.crop({x:frame.x,y:frame.y,width:frame.w,height:frame.h}),pixels=crop.toBitmap();
   const width=frame.sourceW||frame.w,height=frame.sourceH||frame.h,bitmap=Buffer.alloc(width*height*4);
   assert.ok((frame.offX||0)+frame.w<=width&&(frame.offY||0)+frame.h<=height);
   for(let y=0;y<frame.h;y++)pixels.copy(bitmap,((y+(frame.offY||0))*width+(frame.offX||0))*4,y*frame.w*4,(y+1)*frame.w*4);
   candidates.push({sourceLogical,source:path.relative(root,source).replaceAll('\\','/'),sourceSHA256:original.sha256,frame,width,height,pixelSHA256:digest(bitmap),bitmap});
  }
  if(!candidates.length){pending.push(logical);continue;}
  // Atlas packing can quantize the same named source differently. Retain an
  // actual original crop from the largest identical group; never blend pixels.
  const groups=new Map();for(const c of candidates){const key=c.width+':'+c.height+':'+c.pixelSHA256;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(c);}
  const variants=[...groups.values()].sort((a,b)=>b.length-a.length),selected=variants[0][0];
  const png=nativeImage.createFromBitmap(selected.bitmap,{width:selected.width,height:selected.height}).toPNG(),md5=digest(png,'md5'),relative='client/assets/'+(md5.startsWith('ad')?'dirad':md5.slice(0,2))+'/'+md5+'.png',target=path.join(root,relative);
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,png);
  const {bitmap,...evidence}=selected;
  restored.push({logical,md5,path:relative,sha256:digest(png),...evidence,matchingOriginalAtlases:variants[0].length,originalPixelVariants:variants.map(v=>({pixelSHA256:v[0].pixelSHA256,atlases:v.map(c=>c.sourceLogical)}))});
 }
 const result={revision:'native-map-slices-20260922-v1',officialManifestSHA256:digest(manifestBytes),restored,pending};
 fs.writeFileSync(path.join(root,'data/native-map-slices.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({restored:restored.map(x=>({logical:x.logical,matchingAtlases:x.matchingOriginalAtlases})),pending},null,2));
 app.exit(0);
}).catch(error=>{console.error(error.stack);app.exit(1);});
