import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {startCoastHttp} from './table-http.mjs';
const publicOrigin='https://coast.example';
function send(server,{path='/',host='coast.example',method='GET',body,headers={}}={}) {
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:server.port,path,method,headers:{host,...headers}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });req.on('error',reject);req.end(body);
  });
}
test('loopback transport preserves OAuth cookies and trusted origin without forwarding spoofed hosts',async t=>{
  let seen;
  const server=await startCoastHttp({port:0,publicOrigin,web:{async handle(req){seen=req;return new Response('signed in',{headers:[['set-cookie','first=one; Secure; Path=/api'],['set-cookie','second=two; Secure; Path=/api']]});}}});
  t.after(()=>server.close());
  assert.equal(server.host,'127.0.0.1');
  const response=await send(server,{path:'/api/auth/discord/callback?code=example',headers:{'x-forwarded-host':'evil.example','forwarded':'host=evil.example'}});
  assert.equal(response.status,200);assert.equal(response.headers['set-cookie'].length,2);
  assert.equal(seen.url,'https://coast.example/api/auth/discord/callback?code=example');
  assert.equal(seen.headers.get('x-forwarded-host'),null);assert.equal(seen.headers.get('forwarded'),null);
  for(const options of [{host:'evil.example'},{path:'//evil.example/api/view'},{path:'https://evil.example/api/view'}]) assert.equal((await send(server,options)).status,403);
});
test('real HTTP body handling is bounded and errors do not disclose internals',async t=>{
  let calls=0;
  const server=await startCoastHttp({port:0,publicOrigin,web:{async handle(req){calls++;if(req.url.endsWith('/fail'))throw Error('private state');return new Response(await req.text());}}});
  t.after(()=>server.close());
  assert.equal((await send(server,{method:'POST',body:'{"action":"view"}'})).body,'{"action":"view"}');
  assert.equal((await send(server,{method:'POST',body:'x'.repeat(16385)})).status,413);
  assert.equal(calls,1);
  const failure=await send(server,{path:'/fail'});assert.equal(failure.status,500);assert.doesNotMatch(failure.body,/private/);
});
test('close waits for the current handler and does not close shared web authority',async()=>{
  let release,entered;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let webClosed=false;
  const server=await startCoastHttp({port:0,publicOrigin,web:{async handle(){entered();await gate;return new Response('finished');},close(){webClosed=true;}}});
  const flight=send(server);await started;let settled=false;const closing=server.close().then(()=>settled=true);
  await new Promise(r=>setTimeout(r,20));assert.equal(settled,false);
  release();assert.equal((await flight).body,'finished');await closing;await server.close();assert.equal(webClosed,false);
  await assert.rejects(send(server));
});
test('configuration refuses insecure public origin and invalid port',async()=>{
  for(const config of [{publicOrigin:'http://coast.example',port:0},{publicOrigin:'https://coast.example/path',port:0},{publicOrigin,port:-1}]) await assert.rejects(startCoastHttp({...config,web:{handle(){}}}));
});
