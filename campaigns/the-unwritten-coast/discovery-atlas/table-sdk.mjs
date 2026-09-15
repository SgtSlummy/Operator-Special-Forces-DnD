import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const council=new URL('../../../raphael-council/',import.meta.url);
const require=createRequire(new URL('package.json',council));
let bundle;
// Build the installed, lockfile-pinned official SDK locally; no CDN or runtime secrets.
export function discordSdkBundle(){
 if(!bundle)bundle=(async()=>{
  const {build}=require('esbuild');
  const result=await build({stdin:{contents:"export {DiscordSDK} from '@discord/embedded-app-sdk';",resolveDir:fileURLToPath(council),sourcefile:'coast-discord-sdk.mjs'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline',sourcemap:false});
  return result.outputFiles[0].text;
 })().catch(error=>{bundle=null;throw error;});
 return bundle;
}
