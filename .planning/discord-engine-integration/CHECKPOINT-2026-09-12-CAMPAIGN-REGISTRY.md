# Campaign registry integration checkpoint — 2026-09-12

The full goal remains active. APP-01 is partially implemented, not complete. The live environment has not been switched to a multi-campaign catalog.

## Confirmed changes

The previous Activity path selected one global platform/runtime. New campaign-registry.mjs and connected activity-runtime.mjs now support an immutable campaign catalog and keyed runtime construction. The HTTP boundary selects a configured campaign, authenticates its session and current membership before constructing the gameplay runtime, and strips the selector before forwarding scoped route handling. Legacy single-campaign use remains available when no catalog file is configured.

The engine client already rejected foreign campaign and receipt identifiers. New tests prove those checks and nested projection campaign validation. A newly reproduced defensive privacy gap was fixed: public projections reject GM-only aiDirectorId and nonempty characterId. This was malformed-upstream hardening, not evidence that the current C# engine emitted those fields.

## Current catalog contract

HOLLOW_LANTERN_CAMPAIGNS_FILE points to an absolute local JSON file containing defaultCampaignId and a campaigns array. Each configured entry supplies campaignId, guildId, channelId, gmUserId, storeFile, activityDataDir, engineUrl, secretFile and artRoot; materialsFile is optional. The implementation validates independent paths and local engine endpoints, freezes configuration, and rejects ambiguous bindings. This is not yet an operator-ready setup guide: finish the login/browser seams and validate two real isolated engine hosts before enabling it.

## Current verification

Root independently ran:

- 96 Node tests, exit 0: engine-client, ai-director-runtime, service and davy-host suites. This includes the privacy regression that failed before its fix.
- 27 Node tests, exit 0: campaign-registry, activity-runtime and activity-transient-auth suites. These exercise HTTP selection before runtime construction, control-token isolation, immutable configuration, membership/campaign mismatch, unsafe paths and existing authorization behavior.
- Full C# integration executable, exit 0: 45 director-mode checks, director projections, 100 Lantern assertions, armor/inspiration/Preserve Life and existing combat/map/event checks, plus 16 integration tests. Saves were disposable fixtures.

These counts refer to separate test commands and do not establish a full live multiplayer campaign rehearsal.

## Unfinished connected seams

1. Auth code is unchanged. auth/http.mjs must pass a request-aware selection to getServices; auth/runtime.mjs must select the configured platform. Campaign-specific session and OAuth-state cookie names require narrow auth/discord.mjs support. Agreed design: wrap outbound state as hl.<base64url campaignId>.<original 64-hex state>, keep the registered callback URI unchanged, then validate the original state against the selected campaign's database. Reject duplicate, malformed and conflicting selectors. Preserve legacy cookie behavior without a configured catalog.
2. Browser forwarding is unchanged. Root reproduced an assertion failure: apiPath('/api/hollow-lantern/view', {hostname:'localhost', search:'?campaignId=second-table'}) currently returns the path without campaignId. client/api.mjs is the central request helper. Forward a validated selector only to campaign auth/game endpoints while preserving Discord /.proxy behavior and an explicit request selector.
3. In app/hollow-lantern/page.tsx, action/receipt recovery must explicitly route with request.campaignId from the saved pending action, not the currently displayed page. Include campaign selection in the shared view query so stale-response comparison distinguishes campaigns. Verify the entry/login component separately.
4. The trusted direct getActivityRuntime catalog path and configuration cache need additional acceptance checks; HTTP gating alone does not prove every exported entry point is authenticated.
5. Two actual C# stores, simultaneous campaign sessions, process restart, logout/revocation and recovery across the full browser/auth/engine chain remain unverified. Existing unit fixtures are not a substitute.

## Tool and ownership state

Root engine privacy write committed through receipt 251; registry/runtime writes through 275. Gortex graph impact and postchecks are incomplete: the global freshness gate refused further auth/UI mutations while indexing concurrent discovery-atlas and Activity changes. A scoped reindex request timed out with unknown background completion; no daemon restart or source-read fallback was used. Auth and UI edits were not performed after refused impacts. Engine-client guard inspection found no configured guards; graph test mapping was weaker than the actual executable tests, and contract analysis timed out.

Coordinator claim revision 14 retains the full goal and adds only the registry/activity/auth/client/page files and tests needed for this slice. Auth source backups exist beneath C:/Users/Hermes/LocalFiles/DND-Engine-Integration/2026-09-12/auth-campaign-before. Other active discovery-atlas work is outside this slice; preserve it.

Previous durable recovery limitation still applies: safe terminal cancellation must survive engine .bak fallback; unknown outcomes remain receipt-only. Figma, Unity migration, full 45-state walkthrough, public beta and the remaining implementation ledger requirements remain open.

Canonical project: C:/Users/Hermes/Projects/Operator Special Forces Dungeon and Dragons. No live campaign, Discord post, environment configuration, public deployment or paid service changed in this slice.
