# Production runtime and backup handover

## Current implementation status

The production launcher, supervised ownership, component verification, offline backup contracts, SQLite online backup, canonical database exporters, and startup-task script are implemented. These are not deployment or acceptance records. No task was installed, service started, private worker launched, live save changed, or real database dump/restore performed by this implementation.

The private Obus worker at `http://127.0.0.1:38178` must already pass the game capability contract. Its earlier launch was rejected with **“blocked by policy.”** Neither the launcher nor startup task launches it or substitutes another endpoint. The check fails before starting storage or the game when the worker is unavailable.

## Start and stop

Run `raphael-council/hollow-lantern/production-launch.mjs` with Node and explicit absolute local values for `--descriptor`, `--engine`, `--output-root`, and `--davy-root`. `--check` is the default and performs no runtime startup; `--start` owns new game processes. It reads existing infrastructure credentials without printing them.

The launcher binds loopback port 18806 exclusively for ownership. An occupied ownership port, engine port or application port is a blocker; existing processes are preserved. Once permitted, startup may reuse/start only `podman-machine-default`, `davy-postgres`, `davy-redis`, and `ops-dnd-storage-proxy`. Running `deployment_postgres_1`, `deployment_redis_1`, or `davy-bot-gateway` blocks startup to prevent competing writers/logins.

The engine starts with its production recovery gate held. Davy and the browser are composed from the production descriptor. Gateway availability alone cannot release authority: actual storage, authentication, membership, AI, voice, Chronicle, publication and uncertain-command checks must pass. The launcher releases the signed recovery gate at the verified revision and authority epoch, preserving the saved human pause state. Two successive component failures stop owned processes. A runtime `ready` report deliberately includes `releaseAccepted:false`; complete mission, external access, backup/restore and capacity acceptance remain separate requirements.

Ctrl+C or SIGTERM closes the public edge, browser, native gateway and engine in ownership order. A child that cannot be confirmed stopped leaves shutdown blocked; no foreign process or lock is cleared. Do not run a second launcher to repair blocked ownership.

## After-sign-in startup

`production-startup.ps1` accepts the same paths plus an explicit `-Node` executable. Without `-Install` it only validates. Installation first requires successful production preflight and reconciliation of the legacy automatic `DavyJonesGateway` service. The script preserves tasks belonging to another identity or without the expected production description.

The resulting `OPS-DnD-Production` task uses the current interactive user, limited privileges, one instance and at most three restarts one minute apart. It triggers after Windows sign-in. It does not start immediately when installed and does not alter shared Obus services or machine power policy. Actual reboot/sign-in recovery has not been rehearsed.

## Backup and restore integration

`createOfflineProductionBackup` requires a `verifyStopped()` callback that inspects the actual engine, browser OAuth, native Davy, Chronicle/director/admission, queue/database and other campaign writer owners. It must return campaign identity, revision, authority epoch, `allWritersStopped:true` and `writersDrained:true`, with kind `ops-dnd-offline-writers-proof`. Evidence is checked again after capture. An assertion without actual process/database inspection is not an acceptable production proof.

Supply every relevant SQLite source (OAuth, admission, director recovery, Chronicle and character state), protected configuration, draft/presentation/cursor stores and assets. The canonical database exporters create a PostgreSQL custom dump and Redis RDB from the named containers. SQLite uses the online backup API and integrity checks rather than copying a live database and hoping its WAL matches. Campaign capture includes its journal/archive segments and predecessor data.

Only a fully captured, hash-checked, stable-cut backup receives the top-level completed manifest. Failed/incomplete directories are retained for diagnosis and are never restore candidates. `validateProductionBackup` verifies file inventory, hashes and SQLite integrity; its report explicitly does not claim a database or application restore rehearsal. Restore first into isolated stores with no public gateway, validate PostgreSQL/Redis imports, campaign receipts, owner bindings and NPC continuity, then record a complete restore report before release.

`createBackupSchedule` provides the 15-minute schedule, with explicit predeployment and mission-completion methods. **Live scheduling is not integrated yet:** the missing piece is a real coordinator that holds game writes and drains every process, including browser OAuth and the database/queue producers, at one consistent cut. Without that coordinator, use only a proven offline capture. `selectBackupRetention` computes seven daily/four weekly retention decisions while keeping the latest day's frequent points; it never deletes files automatically. Incomplete or other-campaign directories are excluded from deletion candidates.

Local backups under `C:/Users/Hermes/LocalFiles/DnDOps` do not establish recovery from loss of the PC. Existing campaign data must never be overwritten to make a restore test pass.
