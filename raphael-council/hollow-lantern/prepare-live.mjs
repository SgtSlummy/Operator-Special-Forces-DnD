import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
import {ChronicleStore} from '../chronicle/store.mjs';
import {CharacterStore} from '../characters/store.mjs';
const app='C:/Users/Hermes/Projects/Operator Special Forces Dungeon and Dragons/raphael-council';
const root=join(app,'.runtime/hollow-lantern/live');
const spaces=JSON.parse(await readFile(join(root,'discord-spaces.json'),'utf8'));
if(spaces.campaign!=='operation-hollow-lantern'||spaces.dmUserId!=='1230264975533281312'||spaces.spaces.dm?.type!==12||!spaces.spaces.dm.dmAdded)throw new Error('Verified private Discord spaces are required.');
await mkdir(join(root,'art'),{recursive:true});await mkdir(join(root,'chronicle/records'),{recursive:true});
const secret=join(root,'bridge-secret');
try{await writeFile(secret,randomBytes(32).toString('hex'),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
if(!/^[a-f0-9]{64}$/.test((await readFile(secret,'utf8')).trim()))throw new Error('Existing dedicated bridge secret is invalid.');
const chronicle=new ChronicleStore(join(root,'chronicle/chronicle.sqlite'));chronicle.close();
const characters=new CharacterStore(join(root,'characters.sqlite'));characters.close();
const soundtrack=JSON.parse(await readFile('C:/Users/Hermes/LocalFiles/hollow-lantern/licensed-audio/manifest.json','utf8'));
const moodIds={drama:'USUAN1400020',exploration:'USUAN1400022',tension:'USUAN1100783',battle:'USUAN1100875',sanctuary:'USUAN1400023',aftermath:'USUAN1400020'};
const musicCatalog={tracks:Object.fromEntries(Object.entries(moodIds).map(([mood,id])=>[mood,{id,approval:'royalty-cleared'}])),approvedTracks:Object.fromEntries(soundtrack.tracks.map(track=>[track.isrc,{approval:'royalty-cleared',track:{title:track.title,artist:track.artist,licensedTrackId:track.isrc,sourceUrl:track.url}}]))};
const musicFile=join(root,'music-catalog.json');
try{await writeFile(musicFile,JSON.stringify(musicCatalog,null,2),{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(await readFile(musicFile,'utf8')!==JSON.stringify(musicCatalog,null,2))throw new Error('Existing soundtrack choices differ; review before replacing.');}
const env={
 RAPHAEL_GATEWAY_DEPLOYMENT:'windows-native',RAPHAEL_CHRONICLE_ENABLED:'true',RAPHAEL_CHRONICLE_AUTHORITY:'unity',
 RAPHAEL_GUILD_ID:spaces.guildId,RAPHAEL_CAMPAIGN_ID:spaces.campaign,RAPHAEL_DM_IDS:spaces.dmUserId,RAPHAEL_DM_ROLE_ID:'',RAPHAEL_PLAYER_IDS:'',RAPHAEL_PLAYER_ROLE_ID:'',
 RAPHAEL_CHRONICLE_CAMPAIGN_ID:spaces.campaign,RAPHAEL_CHRONICLE_APPLICATION_ID:spaces.botId,RAPHAEL_CHRONICLE_GUILD_ID:spaces.guildId,RAPHAEL_CHRONICLE_CHANNEL_ID:spaces.parentId,RAPHAEL_CHRONICLE_JOURNAL_CHANNEL_ID:spaces.spaces.dm.id,
 RAPHAEL_CHRONICLE_RUNTIME_ROOT:app,RAPHAEL_CHRONICLE_DB_FILE:join(root,'chronicle/chronicle.sqlite'),RAPHAEL_CHRONICLE_DATA_DIR:join(root,'chronicle/records'),
 RAPHAEL_OBUS_URL:'http://127.0.0.1:38178',RAPHAEL_OBUS_TOKEN_FILE:join(app,'.runtime/hollow-lantern/ai-live/service-token'),RAPHAEL_OBUS_HOST_CONTROL_TOKEN_FILE:join(app,'.runtime/hollow-lantern/ai-live/host-control-token'),
 HOLLOW_LANTERN_ENABLED:'true',HOLLOW_LANTERN_AI_ENABLED:'true',HOLLOW_LANTERN_PUBLISH_ON_START:'true',HOLLOW_LANTERN_VOICE_CHANNEL_ID:'1528053493192065085',HOLLOW_LANTERN_CAMPAIGN_ID:spaces.campaign,HOLLOW_LANTERN_GUILD_ID:spaces.guildId,HOLLOW_LANTERN_CHANNEL_ID:spaces.parentId,HOLLOW_LANTERN_GM_ID:spaces.dmUserId,
 HOLLOW_LANTERN_RUNTIME_ROOT:app,HOLLOW_LANTERN_ART_ROOT:join(app,'../campaign-art/hollow-lantern'),HOLLOW_LANTERN_SECRET_FILE:secret,HOLLOW_LANTERN_STORE_FILE:join(root,'campaign.json'),HOLLOW_LANTERN_ENGINE_URL:'http://127.0.0.1:18791',HOLLOW_LANTERN_WEB_PORT:'18792',HOLLOW_LANTERN_GENERATED_ART_DIR:join(root,'art'),HOLLOW_LANTERN_SPACES_FILE:join(root,'discord-spaces.json'),
 HOLLOW_LANTERN_ENROLLMENT_ENABLED:'true',HOLLOW_LANTERN_CHARACTER_STORE_FILE:join(root,'characters.sqlite'),HOLLOW_LANTERN_COMMIT_EVENTS_ENABLED:'true',
 HOLLOW_LANTERN_LICENSED_AUDIO_CACHE:'C:/Users/Hermes/LocalFiles/hollow-lantern/licensed-audio',HOLLOW_LANTERN_MUSIC_CATALOG_FILE:musicFile,HOLLOW_LANTERN_ACTIVITY_DATA_DIR:join(root,'activity-auth'),DISCORD_CLIENT_ID:spaces.botId,
};
const body='# Dedicated Hollow Lantern native gateway. Existing music credentials stay in deployment/.env.\n'+Object.entries(env).map(([key,value])=>`${key}=${JSON.stringify(value.replaceAll('\\','/'))}`).join('\n')+'\n';
const native='C:/Users/Hermes/Projects/Davy Jones/deployment/.env.native-gateway';
try{await writeFile(native,body,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;if(await readFile(native,'utf8')!==body)throw new Error('Existing native settings differ; preserve and review them before changing.');}
console.log(JSON.stringify({prepared:true,campaign:spaces.campaign,dmUserId:spaces.dmUserId,chronicle:join(root,'chronicle/chronicle.sqlite'),nativeConfiguration:native,engineStoreCreated:false,servicesChanged:false,credentialsPrinted:false}));
