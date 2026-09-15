// Private child entry point. The launcher owns this process, never the engine,
// Discord gateway, model workers, or campaign saves.
import {startProdServer} from '../node_modules/vinext/dist/server/prod-server.js';

let running, stopping, cancelled=false;
async function stop() {
  cancelled=true;
  if(!running)return;
  if (stopping) return stopping;
  stopping = (async () => {
    if (running) {
      const timer = setTimeout(() => running.server.closeAllConnections(), 1500);
      try { await new Promise(resolve => running.server.close(resolve)); }
      finally { clearTimeout(timer); }
    }
    process.exitCode ??= 0;
    if (process.connected) process.disconnect();
  })();
  return stopping;
}
process.on('message', message => {if (message?.type === 'stop') void stop();});
process.once('disconnect', () => void stop());
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => void stop());
try {
  if (!process.send || !process.env.HOLLOW_APP_INSTANCE) throw new Error();
  const port = Number(process.env.HOLLOW_APP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
  running = await startProdServer({outDir:process.env.HOLLOW_APP_RELEASE_DIR,host:'127.0.0.1',port,silent:true});
  if(cancelled||!process.connected)await stop();
  else process.send({type:'listening',instance:process.env.HOLLOW_APP_INSTANCE,port:running.port},error=>{if(error){process.exitCode=1;void stop();}});
} catch {
  process.exitCode = 1;
  await stop();
  if (process.connected) {process.send({type:'failed'},()=>{});process.disconnect();}
}
