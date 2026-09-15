# Hollow Lantern Discord presentation

This module is mounted in Davy's existing client; it never starts a Discord client or publishes messages itself. The supplied music bot screenshots define the visual direction: gold-accent native containers, concise headings, separated imagery, contextual controls. Navigation, action categories, target choices and inventory operations use dropdowns; immediate entry/back/end-turn choices remain buttons.

## Mounting

Import `createHollowLanternAdapter` from `adapter.mjs`. Pass `{campaignId, engine, authorize, resolveScope, onJoin?, tokenStore?}`. In the existing interaction listener, call `await adapter.handleInteraction(interaction)` before other handlers; a true return means handled. Initial cards come from `await adapter.panel({userId,actorId,audience:'public'|'player'|'gm'})` and are sent by the existing authorized delivery layer. Private cards and all interaction responses are ephemeral. Rendering a private tactical map automatically attaches a flattened PNG; public cards never attach private maps.

`authorize({campaignId,userId,actorId,audience})` must recheck current membership, actor ownership and GM authority. Return false on unresolved player actors. `resolveScope({campaignId,userId,navigation})` returns the authenticated seat `{actorId,audience:'gm'|'player'}`; a GM does not require an actor. The older `resolveActor({campaignId,userId})` injection remains available as a player-only fallback. `onJoin(interaction,{campaignId,userId,navigation:'join'})` owns the real onboarding response after public membership authorization. Without it, Join opens an existing seat or explains that enrollment is needed; it never claims to have created a character.

`engine.project(scope)` returns a normalized view:

- `revision`, `title`, `summary`, `mode` (`exploration`, `combat`, `shop`).
- Public whitelist: `publicTitle`, `publicSummary`, `publicArtUrl`; private title, summary, actor and inventory never enter public cards.
- Private `actor:{name,hp,maxHp,conditions,details,inventory:[{id,name,quantity,description,value,equipped}]}`, `journal:string[]`, `stock:[{id,name,price,quantity}]`, `artUrl`.
- `map:{level,width,height,scaleFeet,cells:[{x,y,terrain,visibility:'visible'|'remembered'}],tokens:[{x,y,displayName,hostile}]}`. Unknown cells should be omitted; only visible tokens render. Tactical defaults are 25×25 at five feet. Overview maps use `{level:'dungeon'|'regional',nodes:[{id,name,x,y,discovered}],edges:[{from,to,discovered}],currentId}`, with normalized coordinates 0–1.
- `actions:[{id,group,label,description,cost,payload,fields?}]`. Groups are `move`, `attack`, `ability`, `item`, `more`, `describe`, `inspect`, `interact`, `talk`, `end-turn`, `buy`, `sell`, `use`, `equip`, `drop`, `rulings`, `reveal`, `scene`, `pause`, `checkpoint`. Each action is a concrete allowed intention/target. Optional fields `{id,label,required,multiline,maxLength}` open a current Label-wrapped modal (up to five fields); required values and length are validated before dispatch. Missing actions display an honest unavailable state; presentation never invents engine capabilities. End Turn dispatches the supplied `end_turn` action directly, or the first `end-turn` group action.

`engine.command({campaignId,userId,actorId,audience,expectedRevision,commandId,action,payload})` must translate normalized action IDs to the authoritative bridge commands and validate again. The engine must enforce revision locking and idempotency. No client supplied damage or costs are accepted as authoritative by this layer.

Tokens are cryptographically random, server-side, scoped to campaign/user/actor/audience/revision and expire after 15 minutes. Private controls cannot be copied to another user. Default in-memory tokens intentionally expire after restart; a persistent store with the same issue/get interface may be injected. A stale action tells the user to reopen the panel. The bot must expose a stable command/entry message for reopening.

## Renderers and validation

`renderTacticalMap(map,options)` produces PNG bytes; approved background artwork can be sampled only for known cells. Remembered cells are dim; unknown pixels never sample background artwork. `renderOverview` shows explicitly discovered nodes/routes. `renderPublicCombatCard` accepts only participants explicitly marked `publiclyVisible:true`; supply approved portraits for the final illustrated version. These bytes can be attached through the existing authorized delivery system.

Optional adapter `renderAssets` is `{portraits:{[characterId]:absoluteLocalPathOrBuffer}, tacticalBackgrounds:{[mapId]:absoluteLocalPathOrBuffer}, publicSceneArt:absoluteLocalPathOrBuffer}`. These values are operator-approved injection only; renderer inputs never fetch URLs, relative paths, or network-share paths. A scene cover is not tactical geometry and must not be used as a tactical background. Portraits are read only after token/participant visibility checks. Public illustrations read `view.publicParticipants:[{characterId,name,publiclyVisible,hostile}]` and ignore participant-supplied portrait paths. Tactical `map.objects:[{x,y,kind:'door'|'stairs'|'chest'}]` are drawn only in visible squares.

Map scale dropdowns carry `mapLevel:'tactical'|'dungeon'|'regional'` through scoped projection requests and subsequent controls, without issuing gameplay commands. `panel` also accepts an initial `mapLevel`. Run `node discord/hollow-lantern/render-samples.mjs <approved-art-directory>` to produce explicitly labeled local visual examples; these are not Discord captures or gameplay evidence.

Run `node --test discord/hollow-lantern/*.test.mjs`. Tests cover native payload layout, public field isolation, token lifetime, copied/stale/revoked controls, authoritative dispatch, fog pixel equivalence, and overview/public participant filtering. Live Discord desktop/mobile captures and complete campaign interaction evidence remain integration acceptance work; unit tests do not claim those passed.
