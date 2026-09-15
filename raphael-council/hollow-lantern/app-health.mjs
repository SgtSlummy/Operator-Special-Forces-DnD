/** Liveness only. Does not construct OAuth, open stores, or grant game access. */
export function appHealth(env=process.env) {
  const campaignId=env.HOLLOW_LANTERN_CAMPAIGN_ID;
  const configured=typeof campaignId==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(campaignId)&&campaignId===env.RAPHAEL_CAMPAIGN_ID&&/^\d{17,20}$/.test(env.DISCORD_CLIENT_ID??'');
  return Response.json(configured?{
    service:'hollow-lantern-web',version:1,status:'listening',campaignId,clientId:env.DISCORD_CLIENT_ID,
    instance:/^[a-f0-9-]{36}$/.test(env.HOLLOW_APP_INSTANCE??'')?env.HOLLOW_APP_INSTANCE:null,
  }:{service:'hollow-lantern-web',version:1,status:'unconfigured'},
  {status:configured?200:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
