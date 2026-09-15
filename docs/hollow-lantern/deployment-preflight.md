# Hollow Lantern deployment checkpoint

Prepared on 2026-09-09. This procedure does not itself deploy the game. The preflight script never stops, restarts, recreates, or logs in a service, and never sends Discord messages.

Checkpoint root: `C:\Users\Hermes\LocalFiles\hollow-lantern\deployment-checkpoint-20260909`. Each `online-*` directory contains its own manifest and encrypted payloads. Use the newest manifest whose status is `backups-verified-deployment-not-changed`; incomplete attempts remain as evidence.

Final checkpoint after the Davy writers were drained: `online-2026-09-09T21-18-52-904Z`, 473 entries totaling 25,749,306 plaintext bytes. Verification passed. The earlier online checkpoint remains at `online-2026-09-09T20-40-04-352Z` (450 entries). The manifest records exact image IDs and encrypted configuration; do not substitute a similarly named image tag.

## Recovery coverage

- PostgreSQL: transactionally consistent `pg_dump -Fc` of the existing `davy_jones` database, archive TOC verification, complete `pg_restore --file=/dev/null` parse, and migration names/checksums. No restore database was created.
- Redis: authenticated replication RDB snapshot of all databases, verified by `redis-check-rdb`. No keys or Redis configuration were changed.
- SQLite: online backup API, followed by `PRAGMA integrity_check` on each copy. Includes existing AppData Raphael game, platform, character, and three Chronicle stores, corresponding project runtime stores, dedicated Hollow AI stores, and the new live Chronicle store when present. WAL/SHM files are not copied as independent database backups.
- Unity: checksum-verified atomic campaign save and recovery backup, fixture projections/screenshots, bridge secret, and dedicated live configuration when present.
- Assets/source: original Hollow Lantern cover/portraits/local SD texture, selected current app/Davy/Unity integration source, portable bundles, host artifacts, encrypted environment files, Compose overlay, and three repository HEAD/status/diff records. No resets or source substitutions occur.

Every payload uses AES-256-GCM. Its random key is protected with Windows CurrentUser DPAPI. The directory ACL allows the current operator and SYSTEM. `--verify` decrypts in memory and compares plaintext and encrypted checksums. Recovery requires this Windows account's DPAPI keys; copying only the directory to another account or computer is insufficient. Preserve the account's normal recovery material separately. The script does not export or log credentials.

These are consistent **individual online snapshots**, taken at different times. The final checkpoint drained the Davy gateway and its database writers; unrelated legacy SQLite processes were not globally frozen. Object-store media and other unselected external assets are not covered. Actual PostgreSQL and Redis restoration into disposable isolated containers passed; see [restore-drill.md](restore-drill.md).

From the Operator `raphael-council` directory:

```powershell
node hollow-lantern/deployment-preflight.mjs --backup-data --with-source
node hollow-lantern/deployment-preflight.mjs --verify 'C:\Users\Hermes\LocalFiles\hollow-lantern\deployment-checkpoint-20260909\online-TIMESTAMP'
```

To create inspectable recovery copies, use `--extract` with that directory. It writes a new private `restore-copy-*` directory containing numbered `.restored` files; the manifest maps each number to its source. It never writes to production paths or overwrites an existing recovery file. Treat extracted environment/database files as private.

## Verified deployment topology

The native Windows gateway owns port 3010. PostgreSQL and Redis are healthy through loopback ports 15432 and 16379 using the existing named volumes. Admin API, admin web, jobs worker and voice worker were recovered on their original local application image and are healthy. Unity listens on 18791; the local table listens on 18792. Private Obus 38178, core 38173 and local SD 7860 remain available. The live campaign is paused at revision zero; private panels and the public entry have been delivered through the actual Davy Discord client.

Configuration-only checks validate the native environment and render the existing `deployment` Compose project with the optional overlay. The resulting overlay must retain the existing named volumes, expose databases only on loopback, and omit the container gateway unless its profile is explicitly enabled. The rendered environment is encrypted in the checkpoint; never paste raw Compose `config` output into logs or chat.

The live campaign binding is `operation-hollow-lantern`, Unity authority, Davy application `1540006061099188274`, guild `1463393482306486387`, parent channel `1546676505780944979` (actual name `dnd-arcade`), and DM `1230264975533281312`. AI owners remain logical identities. Existing campaign stores are preserved and are not the new mechanics authority.

## Executed cutover and deployment-tool incident

On 2026-09-09 the installed `podman_compose` implementation reacted to the database port configuration change by recursively removing dependent application containers, including the stopped gateway. It retained their images and named data volumes. The helper then stalled because its dependent-service reconstruction list omitted previously stopped services. Its exact verified helper process was stopped; no data volumes were deleted or restored.

Application services were recreated with `--no-build --no-recreate --no-deps` from the retained images. Admin API had an incomplete Discord OAuth configuration and no registered redirect URL, so the existing one-use Discord admin-grant flow was restored with `deployment/compose.native-admin-grants.yaml`. All recovered application services passed health checks. Private incident logs are retained inside the final checkpoint. Never repeat the database configuration-change command below as a routine restart.

The following records the cutover sequence; preflight itself never executes it.

Run from `C:\Users\Hermes\Projects\Davy Jones`. First complete engine/table readiness, scoped authorization, native audio, complete mission/privacy acceptance and a final drained checkpoint. Confirm no second gateway process exists. Review the latest checkpoint manifest and exact image digest.

```powershell
node --env-file=deployment/.env --env-file=deployment/.env.native-gateway scripts/start-native-gateway.js --check
podman stop --time 30 deployment_bot-gateway_1
python -m podman_compose -p deployment -f deployment/compose.yaml -f deployment/compose.windows-native-gateway.yaml up -d postgres redis
podman ps --format '{{.Names}} {{.Status}} {{.Ports}}'
```

The overlay may recreate database containers to publish ports. Keep the same project and volumes. Wait for PostgreSQL/Redis health and verify existing data before continuing. Other workers may briefly reconnect; this maintenance must be coordinated with their writers. Do not use `down -v`, a new project name, the `container-gateway` profile, or a second gateway login.

Start the existing Windows entry point under the chosen supervised lifecycle, with any background process hidden:

```powershell
node --env-file=deployment/.env --env-file=deployment/.env.native-gateway scripts/start-native-gateway.js --start
```

Check `/health/live` and `/health/ready` on 3010, additive command preservation, Davy music/voice, the private DM/player/shop panels, and one committed engine action. Local fixture evidence does not replace actual Discord evidence. Keep the human DM in control of live opportunities and generated-art approval.

## Rollback

Drain and stop the supervised Windows gateway first and confirm 3010 is free. Preserve its latest game/Chronicle data. If database schema remains compatible, recreate the removed gateway from the retained exact image without building or recreating dependencies. Verify `localhost/deployment_bot-gateway:latest` against the checkpoint image ID first. The similarly named hyphenated `deployment-bot-gateway` tag is an older image and must not be substituted.

```powershell
python -m podman_compose -p deployment -f deployment/compose.yaml -f deployment/compose.windows-native-gateway.yaml --profile container-gateway up -d --no-build --no-recreate --no-deps bot-gateway
```

Verify readiness and music before declaring rollback complete. Database ports may remain published on loopback; changing them again is a separate maintenance action. Do not restore old game snapshots merely to roll back a Discord gateway.

If data recovery is necessary, extract into the private recovery directory and restore into separate validation targets first. PostgreSQL custom archives must pass a real isolated restore before any production replacement. Redis currently uses AOF: dropping an RDB beside an existing AOF does not reliably restore that snapshot. Validate RDB loading in an isolated Redis data directory, then regenerate the AOF there before planning a coordinated replacement. Stop the specific SQLite/Unity writers and preserve their newer files before replacing any store; restore matching authority, receipts and records together. The preflight tool never performs these destructive recovery operations.
