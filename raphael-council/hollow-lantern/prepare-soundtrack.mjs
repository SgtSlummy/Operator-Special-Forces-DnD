import {join} from 'node:path';
const {prepareLicensedCampaignAudio}=await import(new URL('../../../Davy Jones/src/music/licensed-campaign-audio.js',import.meta.url));
const cacheRoot=process.env.HOLLOW_LICENSED_AUDIO_CACHE??join(process.env.USERPROFILE,'LocalFiles','hollow-lantern','licensed-audio');
const manifest=await prepareLicensedCampaignAudio({cacheRoot,ffprobePath:process.env.FFPROBE_PATH??'ffprobe'});
console.log(JSON.stringify({cacheRoot,verifiedAt:manifest.verifiedAt,tracks:manifest.tracks.map(({isrc,title,sizeBytes,sha256,durationSeconds,license})=>({isrc,title,sizeBytes,sha256,durationSeconds,license}))},null,2));
