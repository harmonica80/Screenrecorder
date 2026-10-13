const https = require('node:https');
const fs = require('node:fs/promises');
const path = require('node:path');
const {gunzipSync} = require('node:zlib');
const {createHash} = require('node:crypto');
const base = 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';
const hashes = {
  'ffmpeg-win32-x64.gz':'8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77',
  'win32-x64.LICENSE':'8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903',
  'win32-x64.README':'a636a7183c58006351acbaf35303c0ed85c6e1320fd4e80de453ba6157de6311'
};
function download(url, redirects=0) {
  return new Promise((resolve,reject) => {
    if (redirects>6) return reject(new Error('Too many redirects'));
    const request=https.get(url,{headers:{'User-Agent':'Screenrecorder-build'}},response=>{
      if ([301,302,303,307,308].includes(response.statusCode)) {response.resume();return resolve(download(new URL(response.headers.location,url).href,redirects+1));}
      if(response.statusCode!==200){response.resume();return reject(new Error('HTTP '+response.statusCode));}
      const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('error',reject);response.on('end',()=>resolve(Buffer.concat(chunks)));
    });
    request.setTimeout(120000,()=>request.destroy(new Error('Download timed out')));request.on('error',reject);
  });
}
(async()=>{
  const dir=path.resolve(__dirname,'../vendor/ffmpeg');await fs.mkdir(dir,{recursive:true});
  for(const [name,hash] of Object.entries(hashes)){
    const bytes=await download(base+name);
    if(createHash('sha256').update(bytes).digest('hex')!==hash)throw new Error('Checksum mismatch: '+name);
    await fs.writeFile(path.join(dir,name.endsWith('.gz')?'ffmpeg.exe':name.endsWith('LICENSE')?'LICENSE.txt':'README.txt'),name.endsWith('.gz')?gunzipSync(bytes):bytes);
    console.log('Verified '+name);
  }
})().catch(error=>{console.error(error.message);process.exitCode=1});
