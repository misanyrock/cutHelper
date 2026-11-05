import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {serveMediaFile} from '../electron/media-protocol.js';
test('本地视频分段读取支持定位、后缀、HEAD 和无效范围',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'cuthelper-range-')),file=path.join(root,'sample.mp4');
 try{await writeFile(file,Buffer.from('0123456789'));
  const get=(range?:string,method='GET')=>serveMediaFile(file,new Request('https://local/media',{method,headers:range?{Range:range}:{}}));
  const all=await get();assert.equal(all.status,200);assert.equal(all.headers.get('Accept-Ranges'),'bytes');assert.equal(all.headers.get('Content-Length'),'10');assert.equal(await all.text(),'0123456789');
  const part=await get('bytes=3-6');assert.equal(part.status,206);assert.equal(part.headers.get('Content-Range'),'bytes 3-6/10');assert.equal(await part.text(),'3456');
  assert.equal(await (await get('bytes=8-')).text(),'89');assert.equal(await (await get('bytes=-3')).text(),'789');assert.equal(await(await get('bytes=8-99')).text(),'89');
  const head=await get('bytes=3-6','HEAD');assert.equal(head.headers.get('Content-Length'),'4');assert.equal(await head.text(),'');
  for(const range of ['bytes=10-','bytes=4-2','bytes=-0','bytes=1-2,4-6','garbage'])assert.equal((await get(range)).status,416);
 }finally{await rm(root,{recursive:true,force:true});}
});
