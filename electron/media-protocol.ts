import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {Readable} from 'node:stream';

// Chromium needs explicit HTTP byte-range semantics for seeking through a
// custom streaming scheme. net.fetch(file:) does not provide them reliably.
export async function serveMediaFile(file:string,request:Request):Promise<Response>{
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
  let size:number;try{size=(await stat(file)).size;}catch{return new Response(null,{status:404});}
  const headers=new Headers({'Content-Type':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'no-store'});
  let start=0,end=size-1,status=200;
  const range=request.headers.get('range');
  if(range){
    const invalid=()=>new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`,'Accept-Ranges':'bytes'}});
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match||(!match[1]&&!match[2])||size===0)return invalid();
    if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<=0)return invalid();start=Math.max(0,size-suffix);}
    else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)return invalid();
    status=206;headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
  }
  headers.set('Content-Length',String(Math.max(0,end-start+1)));
  if(request.method==='HEAD'||size===0)return new Response(null,{status,headers});
  const body=Readable.toWeb(createReadStream(file,{start,end})) as unknown as ReadableStream<Uint8Array>;
  return new Response(body,{status,headers});
}
