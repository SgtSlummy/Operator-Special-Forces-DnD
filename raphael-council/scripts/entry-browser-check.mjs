// Disposable production-build UI verification; all authentication and game
// responses below are explicit fixtures. No live credentials or saves are used.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, isAbsolute, join} from 'node:path';
import {startProdServer} from '../node_modules/vinext/dist/server/prod-server.js';

const [runtimePackage, outputDirectory] = process.argv.slice(2);
if (!runtimePackage || !outputDirectory || !isAbsolute(outputDirectory) || /(?:^|[\\/])OneDrive(?:[\\/]|$)/i.test(outputDirectory)) throw Error('Supply the installed browser runtime package path and a local evidence directory.');
const {chromium} = createRequire(resolve(runtimePackage))('playwright');
await mkdir(outputDirectory, {recursive:true});
const campaignId = 'hollow-lantern-entry-fixture';
process.env.RAPHAEL_CAMPAIGN_ID = campaignId;
process.env.HOLLOW_LANTERN_CAMPAIGN_ID = campaignId;
process.env.HOLLOW_LANTERN_GUILD_ID = '1463393482306486387';
process.env.HOLLOW_LANTERN_CHANNEL_ID = '1546676505780944979';
const server = await startProdServer({outDir:resolve('dist'),host:'127.0.0.1',port:0,silent:true});
let browser;
const origin = `http://127.0.0.1:${server.port}`, results=[];
let activePage,activeViewport,activeErrors=[];
try {
  browser = await chromium.launch({headless:true,channel:'chrome'});
  for (const [name, viewport] of [['desktop',{width:1365,height:1000}],['phone',{width:390,height:844}]]) {
    const context=await browser.newContext({viewport}), page=await context.newPage();
    activePage=page;activeViewport=name;
    let mode='signed-out', failLogout=false, calls=[];
    const errors=[];activeErrors=errors;page.on('pageerror',error=>errors.push(error.stack??error.message));
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      calls.push({method:route.request().method(),path});
      let status=200,body;
      if(path==='/api/auth/config') body={experience:'hollow-lantern',campaignId,clientId:'1540006061099188274'};
      else if(path==='/api/auth/session') {
        if(mode==='signed-out'){body={experience:'hollow-lantern',scope:null};}
        else if(mode==='revoked'){status=403;body={};}
        else body={experience:'hollow-lantern',scope:{campaign:campaignId,owner:'1230264975533281312',role:'host'}};
      } else if(path==='/api/hollow-lantern/view') {
        if(mode==='offline'){status=503;body={error:'fixture private provider detail'};}
        else body={campaignId,revision:42,viewToken:'fixture-view-token',selectedActor:'',title:'Fixture briefing',summary:'Disposable interface check. No live campaign state.',actions:[],dmStatus:{decisionOpen:false,pendingRulings:[]}};
      } else if(path==='/api/auth/logout') {
        status=failLogout?503:200;body={connected:false};if(!failLogout)mode='signed-out';
      } else {status=500;body={error:'Unexpected fixture request'};}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    });
    const heading=text=>page.getByRole('heading',{name:text,exact:true}).waitFor();
    const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.goto(origin);await heading('Sign in to take your seat');
    assert.equal(await page.getByRole('link',{name:'Sign in with Discord'}).getAttribute('href'),'/api/auth/discord/start');
    assert.equal(calls.some(c=>c.path==='/api/game'),false);assert.equal(calls.some(c=>c.path==='/api/hollow-lantern/view'),false);
    await noOverflow();await page.screenshot({path:join(outputDirectory,`${name}-sign-in.png`),fullPage:true});
    mode='ready';await page.getByRole('button',{name:'Check connection',exact:true}).click();await heading('Your table is available');
    assert.equal(await page.getByRole('link',{name:'Open my table'}).getAttribute('href'),'/hollow-lantern');
    await noOverflow();await page.screenshot({path:join(outputDirectory,`${name}-ready.png`),fullPage:true});
    await page.getByRole('link',{name:'Open my table'}).click();await heading('Fixture briefing');
    assert.equal(new URL(page.url()).pathname,'/hollow-lantern');
    await page.goto(origin);await heading('Your table is available');
    failLogout=true;await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByText('Sign-out could not be confirmed.',{exact:false}).waitFor();await heading('Your table is available');
    failLogout=false;await page.getByRole('button',{name:'Sign out',exact:true}).click();await heading('Sign in to take your seat');
    mode='revoked';await page.getByRole('button',{name:'Check connection',exact:true}).click();await heading('Your account needs a campaign seat');
    await page.getByRole('button',{name:'Sign out',exact:true}).click();await heading('Sign in to take your seat');
    mode='offline';await page.getByRole('button',{name:'Check connection',exact:true}).click();await heading('The campaign could not be reached');
    assert.equal((await page.locator('body').innerText()).includes('fixture private provider detail'),false);
    assert.equal(await page.getByRole('link',{name:'Open my table'}).count(),0);
    await page.goto(origin+'/?connection=host_configuration');await heading('The connection needs a host repair');
    assert.equal(await page.getByRole('link',{name:'Sign in with Discord'}).count(),0);
    await noOverflow();await page.screenshot({path:join(outputDirectory,`${name}-host-repair.png`),fullPage:true});
    mode='ready';await page.getByRole('button',{name:'Check connection',exact:true}).click();await heading('Your table is available');
    assert.equal(calls.some(c=>c.method==='POST'&&c.path!=='/api/auth/logout'),false);
    assert.deepEqual(errors,[]);
    results.push({viewport:name,result:'PASS',screenshots:[`${name}-sign-in.png`,`${name}-ready.png`,`${name}-host-repair.png`],checks:['sign-in link','navigation to actual Hollow table','read-only readiness','failed logout retained','revoked account recovery','offline engine','safe OAuth error','manual retry','no horizontal overflow','no browser exceptions']});
    await context.close();
  }
  await writeFile(join(outputDirectory,'browser-results.json'),JSON.stringify({kind:'production build with simulated API responses; not live Discord evidence',timestamp:new Date().toISOString(),results},null,2));
  console.log(JSON.stringify({result:'PASS',surfaces:results.length,outputDirectory}));
} catch (error) {
  const stamp=Date.now();
  if(activePage&&!activePage.isClosed()) {
    await activePage.screenshot({path:join(outputDirectory,`${activeViewport}-failure-${stamp}.png`),fullPage:true});
    await writeFile(join(outputDirectory,`failure-${stamp}.json`),JSON.stringify({kind:'simulated API browser fixture failure',viewport:activeViewport,url:activePage.url(),error:error.message,browserErrors:activeErrors,visibleText:await activePage.locator('body').innerText()},null,2));
  }
  throw error;
} finally {
  await browser?.close();server.server.closeAllConnections();await new Promise(resolve=>server.server.close(resolve));
}
