import {createServer} from 'node:http';

/** Owns only its loopback listener. The caller retains the web handler and store. */
export async function startCoastHttp({web,publicOrigin,activityOrigin,port}) {
  if(typeof web?.handle!=='function'||!Number.isInteger(port)||port<0||port>65535) throw new Error('COAST_HTTP_CONFIGURATION_INVALID');
  const origins=new Map();
  for(const value of [publicOrigin,activityOrigin].filter(Boolean)) {
    const url=new URL(value);
    if(url.protocol!=='https:'||url.origin!==value||url.username||url.password) throw new Error('COAST_HTTP_CONFIGURATION_INVALID');
    origins.set(url.host,url.origin);
  }
  if(!publicOrigin||!origins.size) throw new Error('COAST_HTTP_CONFIGURATION_INVALID');
  let closing=false,closeFlight;
  const pending=new Set();
  const server=createServer((incoming,outgoing)=>{
    const task=serve(incoming,outgoing);
    pending.add(task);
    void task.finally(()=>pending.delete(task));
  });
  server.requestTimeout=30000;
  server.headersTimeout=15000;
  server.keepAliveTimeout=5000;
  async function serve(incoming,outgoing) {
    const reject=(status)=>{outgoing.writeHead(status,{'cache-control':'no-store','content-type':'text/plain','connection':'close'});outgoing.end('Request unavailable');};
    try {
      if(closing) return reject(503);
      const host=incoming.headers.host;
      const origin=typeof host==='string'?origins.get(host):null;
      if(!origin||!incoming.url?.startsWith('/')||incoming.url.startsWith('//')) return reject(403);
      const url=new URL(incoming.url,origin);
      if(url.origin!==origin) return reject(403);
      const headers=new Headers();
      for(let i=0;i<incoming.rawHeaders.length;i+=2) {
        const key=incoming.rawHeaders[i];
        if(/^(host|connection|transfer-encoding|content-length|forwarded|x-forwarded-.*)$/i.test(key)) continue;
        headers.append(key,incoming.rawHeaders[i+1]);
      }
      const chunks=[];let length=0;
      for await(const chunk of incoming) {
        length+=chunk.length;
        if(length>16384) return reject(413);
        chunks.push(chunk);
      }
      const method=incoming.method||'GET';
      if((method==='GET'||method==='HEAD')&&length) return reject(400);
      const request=new Request(url,{method,headers,...(length?{body:Buffer.concat(chunks)}:{})});
      const response=await web.handle(request);
      if(!(response instanceof Response)) throw new Error('COAST_HTTP_INVALID_RESPONSE');
      const body=Buffer.from(await response.arrayBuffer());
      if(outgoing.destroyed) return;
      const responseHeaders={};
      response.headers.forEach((value,key)=>{if(key!=='set-cookie'&&!/^(connection|transfer-encoding|content-length)$/i.test(key)) responseHeaders[key]=value;});
      const cookies=response.headers.getSetCookie();
      if(cookies.length) responseHeaders['set-cookie']=cookies;
      outgoing.writeHead(response.status,responseHeaders);
      outgoing.end(method==='HEAD'?undefined:body);
    } catch {
      if(!outgoing.destroyed&&!outgoing.headersSent) reject(500);
      else if(!outgoing.destroyed) outgoing.destroy();
    }
  }
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});
  });
  const address=server.address();
  function close() {
    if(!closeFlight) {
      closing=true;
      closeFlight=(async()=>{
        await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
        await Promise.allSettled([...pending]);
      })();
    }
    return closeFlight;
  }
  return Object.freeze({host:'127.0.0.1',port:address.port,close});
}
