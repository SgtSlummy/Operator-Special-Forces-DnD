import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { gameConfig, getGameStore } from '../game/storage.mjs';
import { DiscordAuth, AuthError } from './discord.mjs';
import { GameAi } from '../ai/service.mjs';
import { ObusTransport } from '../ai/obus.mjs';
import { createLocalObusHostControl } from '../ai/host-config.mjs';
import {usesHollowAuthority,getHollowPlatform,selectActivityCampaign} from '../hollow-lantern/activity-runtime.mjs';

// The selector chooses a store; that store still verifies OAuth state and membership.
export function authCampaignRequest(request) {
 if(!request)return {request,state:null};
 const url=new URL(request.url),ids=url.searchParams.getAll('campaignId');
 if(ids.length>1||ids.length===1&&!/^[A-Za-z0-9_-]{1,64}$/.test(ids[0]))throw new AuthError('Invalid campaign selection.',400);
 let state=url.searchParams.get('state');
 if(url.pathname.endsWith('/api/auth/discord/callback')){
  if(url.searchParams.getAll('state').length>1)throw new AuthError('Invalid sign-in state.',400);
  if(state?.startsWith('hl.')){
   const match=/^hl\.([A-Za-z0-9_-]{2,86})\.([a-f0-9]{64})$/.exec(state);
   if(!match)throw new AuthError('Invalid sign-in state.',400);
   const campaign=Buffer.from(match[1],'base64url').toString('utf8');
   if(!/^[A-Za-z0-9_-]{1,64}$/.test(campaign)||Buffer.from(campaign).toString('base64url')!==match[1]||ids.length&&ids[0]!==campaign)throw new AuthError('Sign-in campaign did not match.',400);
   url.searchParams.set('campaignId',campaign);state=match[2];
  }
 }
 return {request:url.href===request.url?request:new Request(url,request),state};
}
const key = Symbol.for('raph.platform');
export function getPlatform(request = undefined, env = process.env) {
  const selected=authCampaignRequest(request).request;
  if(usesHollowAuthority(env))return getHollowPlatform(env,selected?selectActivityCampaign(selected,env):undefined);
  if(selected&&new URL(selected.url).searchParams.has('campaignId'))throw new AuthError('Campaign is unavailable.',404);
  if (!globalThis[key]) {
    const { dataDir } = gameConfig(); mkdirSync(dataDir, { recursive: true });
    const db = new DatabaseSync(join(dataDir, 'platform.sqlite')); db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000');
    const game = getGameStore(), transport = new ObusTransport();
    let control;
    globalThis[key] = { experience:'legacy', db, auth: new DiscordAuth({ db, game }), ai: new GameAi({ db, transport,
      authorize: scope => game.member(scope),
      configureRuntime: input => (control ??= createLocalObusHostControl({ transport })).configure(input),
    }) }; 
  }
  return globalThis[key];
}
