import {createServer as httpServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
import {AREAS} from './model.mjs';
const directory=dirname(fileURLToPath(import.meta.url));
const artRoot=resolve(directory,'../../../campaign-art/unwritten-coast');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.md':'text/plain; charset=utf-8','.png':'image/png'};
export function createMapServer(){
  const routes=new Map(['/','/index.html','/style.css','/app.mjs','/model.mjs','/README.md'].map(route=>[route,resolve(directory,route==='/'?'index.html':route.slice(1))]));
  for(const area of Object.values(AREAS))for(const image of[area.overview,...area.layers.map(layer=>layer.image)])routes.set(image,resolve(artRoot,image.slice('/art/'.length)));
  return httpServer(async(req,res)=>{
    const security={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'none'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
    if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host||'')){res.writeHead(403,security);res.end('Local access only');return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{...security,Allow:'GET, HEAD'});res.end();return;}
    let path;try{path=new URL(req.url,'http://127.0.0.1').pathname;}catch{res.writeHead(400,security);res.end();return;}
    if(path==='/health'){res.writeHead(200,{...security,'Content-Type':'application/json'});res.end(JSON.stringify({app:'unwritten-coast-layered-atlas',version:1}));return;}
    const file=routes.get(path);
    if(!file){res.writeHead(404,security);res.end('Map-table file not found');return;}
    try{const info=await stat(file);const ext=file.slice(file.lastIndexOf('.'));res.writeHead(200,{...security,'Content-Type':mime[ext]||'application/octet-stream','Content-Length':info.size});if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);}catch{res.writeHead(404,security);res.end('Map file is missing. Restore its artwork folder.');}
  });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const port=Number(process.env.UNWRITTEN_MAP_PORT||51931);
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Choose a map-table port from 1024 to 65535.');
  const server=createMapServer();server.on('error',error=>{console.error('Map table could not start: '+error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log('The Unwritten Coast map table: http://127.0.0.1:'+port+'/'));
}
