// 极简 PNG 编解码：只处理这份工程里真正会遇到的格式。
//
// 解码：非隔行、调色板（colorType 3，位深 4/8）与真彩/真彩+透明（2/6，位深 8）。
// 客户端 client/assets/**/*.png 里的服装/发型/脸型碎片全是调色板图（实测只有 (4,3) 与 (8,3)），
// 所以这里不引第三方依赖，用 node:zlib 手写一遍，构建期够用。
// 编码：统一输出 8 位 RGBA（colorType 6），过滤器恒为 0（None）。
import zlib from 'node:zlib';

const PNG_SIGNATURE=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);

function parseChunks(buffer){
 const chunks=[];let offset=8;
 while(offset+8<=buffer.length){
  const length=buffer.readUInt32BE(offset);
  const type=buffer.toString('ascii',offset+4,offset+8);
  const data=buffer.subarray(offset+8,offset+8+length);
  chunks.push({type,data});
  offset+=12+length;
  if(type==='IEND')break;
 }
 return chunks;
}

function paeth(a,b,c){
 const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
 return pa<=pb&&pa<=pc?a:pb<=pc?b:c;
}

function unfilter(raw,width,height,bytesPerPixel,bytesPerRow){
 const out=Buffer.alloc(bytesPerRow*height);
 let pos=0;
 for(let y=0;y<height;y++){
  const filter=raw[pos++];
  const line=raw.subarray(pos,pos+bytesPerRow);pos+=bytesPerRow;
  const target=out.subarray(y*bytesPerRow,(y+1)*bytesPerRow);
  const prior=y>0?out.subarray((y-1)*bytesPerRow,y*bytesPerRow):null;
  for(let x=0;x<bytesPerRow;x++){
   const a=x>=bytesPerPixel?target[x-bytesPerPixel]:0;
   const b=prior?prior[x]:0;
   const c=prior&&x>=bytesPerPixel?prior[x-bytesPerPixel]:0;
   const value=line[x];
   target[x]=filter===0?value:filter===1?(value+a)&255:filter===2?(value+b)&255:filter===3?(value+((a+b)>>1))&255:filter===4?(value+paeth(a,b,c))&255:(()=>{throw Error('不支持的 PNG 行过滤器 '+filter);})();
  }
 }
 return out;
}

export function decodePng(buffer){
 if(!buffer.subarray(0,8).equals(PNG_SIGNATURE))throw Error('不是 PNG 文件');
 const chunks=parseChunks(buffer);
 let width=0,height=0,bitDepth=0,colorType=0,interlace=0;
 let palette=null,trns=null;const idats=[];
 for(const chunk of chunks){
  if(chunk.type==='IHDR'){
   width=chunk.data.readUInt32BE(0);height=chunk.data.readUInt32BE(4);
   bitDepth=chunk.data[8];colorType=chunk.data[9];interlace=chunk.data[12];
  }else if(chunk.type==='PLTE')palette=chunk.data;
  else if(chunk.type==='tRNS')trns=chunk.data;
  else if(chunk.type==='IDAT')idats.push(chunk.data);
 }
 if(interlace!==0)throw Error('不支持隔行 PNG');
 const raw=zlib.inflateSync(Buffer.concat(idats));
 const rgba=Buffer.alloc(width*height*4);
 if(colorType===3){
  const samplesPerPixel=1;
  const bitsPerPixel=bitDepth*samplesPerPixel;
  const bytesPerRow=Math.ceil(width*bitsPerPixel/8);
  const pixels=unfilter(raw,width,height,samplesPerPixel,bytesPerRow);
  const mask=(1<<bitDepth)-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const bitIndex=x*bitDepth;
   const byte=pixels[y*bytesPerRow+(bitIndex>>3)];
   const shift=8-bitDepth-(bitIndex&7);
   const index=(byte>>shift)&mask;
   const o=(y*width+x)*4;
   rgba[o]=palette[index*3];rgba[o+1]=palette[index*3+1];rgba[o+2]=palette[index*3+2];
   rgba[o+3]=trns&&index<trns.length?trns[index]:255;
  }
 }else if(colorType===2||colorType===6){
  const channels=colorType===6?4:3;
  const bytesPerRow=width*channels;
  const pixels=unfilter(raw,width,height,channels,bytesPerRow);
  for(let i=0;i<width*height;i++){
   rgba[i*4]=pixels[i*channels];rgba[i*4+1]=pixels[i*channels+1];rgba[i*4+2]=pixels[i*channels+2];
   rgba[i*4+3]=channels===4?pixels[i*channels+3]:255;
  }
 }else throw Error('不支持的 PNG 颜色类型 '+colorType);
 return {width,height,rgba};
}

function crc32(buffer){
 let crc=0xffffffff;
 for(let i=0;i<buffer.length;i++){
  crc^=buffer[i];
  for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;
 }
 return (crc^0xffffffff)>>>0;
}

function chunk(type,data){
 const head=Buffer.alloc(8);
 head.writeUInt32BE(data.length,0);
 head.write(type,4,'ascii');
 const crc=Buffer.alloc(4);
 crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4),data])),0);
 return Buffer.concat([head,data,crc]);
}

export function encodePng(width,height,rgba){
 const ihdr=Buffer.alloc(13);
 ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);
 ihdr[8]=8;ihdr[9]=6;ihdr[10]=0;ihdr[11]=0;ihdr[12]=0;
 const stride=width*4;
 const raw=Buffer.alloc((stride+1)*height);
 for(let y=0;y<height;y++){
  raw[y*(stride+1)]=0;
  rgba.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride);
 }
 return Buffer.concat([
  PNG_SIGNATURE,
  chunk('IHDR',ihdr),
  chunk('IDAT',zlib.deflateSync(raw,{level:9})),
  chunk('IEND',Buffer.alloc(0)),
 ]);
}

/** 把一张小图贴到大图的 (dx,dy) 上（源图按 RGBA 逐像素复制）。 */
export function blit(target,targetWidth,source,dx,dy){
 for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
  const from=(y*source.width+x)*4;
  const to=((dy+y)*targetWidth+dx+x)*4;
  target[to]=source.rgba[from];target[to+1]=source.rgba[from+1];
  target[to+2]=source.rgba[from+2];target[to+3]=source.rgba[from+3];
 }
}

/** 按 alpha 把小图叠到大图上：源图全透明处不动底图，半透明边缘做混合。
 *  拼「脸 + 头发」的头像时用它，否则头发碎片外围的透明像素会把脸擦出洞。 */
export function blitOver(target,targetWidth,source,dx,dy){
 for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
  const from=(y*source.width+x)*4;
  const alpha=source.rgba[from+3];
  if(!alpha)continue;
  const to=((dy+y)*targetWidth+dx+x)*4;
  if(alpha===255){
   target[to]=source.rgba[from];target[to+1]=source.rgba[from+1];target[to+2]=source.rgba[from+2];target[to+3]=255;
   continue;
  }
  const sa=alpha/255,inverse=1-sa;
  target[to]=Math.round(source.rgba[from]*sa+target[to]*inverse);
  target[to+1]=Math.round(source.rgba[from+1]*sa+target[to+1]*inverse);
  target[to+2]=Math.round(source.rgba[from+2]*sa+target[to+2]*inverse);
  target[to+3]=Math.max(target[to+3],alpha);
 }
}
