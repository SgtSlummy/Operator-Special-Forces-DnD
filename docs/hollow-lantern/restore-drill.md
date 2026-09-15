# Database restore acceptance

The 9 September 2026 encrypted checkpoint passed a real, isolated PostgreSQL and Redis restore at 21:08 UTC. This verifies database recovery, not Discord delivery or the complete release.

Evidence: `C:\Users\Hermes\LocalFiles\hollow-lantern\deployment-checkpoint-20260909\online-2026-09-09T20-40-04-352Z\restore-drill-7a8c8845-27bd-4150-ab0d-a4fa8be244be\report.json`.

## Results

- PostgreSQL: the custom dump restored with `pg_restore --exit-on-error` into a fresh PostgreSQL 16 database. All 39 public base tables matched the archive table count. The migration ledger matched the encrypted checkpoint exactly; no invalid indexes remained. Private table contents were not printed.
- Redis: `redis-check-rdb` accepted the saved RDB. A fresh Redis 7 process loaded that RDB from disk and completed loading. Database 0 contained one key with expiration. No key names or values were printed. Expiration continues to follow the saved absolute timestamps.
- Both images came from the existing local image IDs. Containers had no network, host ports, host binds, or production volumes. Temporary database directories used container tmpfs. Only disposable database initialization settings were supplied; production credentials were unnecessary.
- Both containers were removed only after rechecking their exact immutable container IDs, unique drill labels, and isolation settings. Production services were not stopped, restarted, recreated, or modified.

## Repeating the drill

From the canonical `raphael-council` directory, run `node hollow-lantern/restore-drill.mjs CHECKPOINT_DIRECTORY`. The script invokes the existing private extraction mechanism, verifies the extracted PostgreSQL/Redis hashes against the manifest, and writes a new report below the private checkpoint directory. An optional second argument may select an existing `restore-copy-*` directory directly beneath that checkpoint.

Successful runs remove only their own verified disposable containers. Failed runs preserve their report and containers for investigation. The extraction directory remains private under the checkpoint ACL. The script does not restore over production, fetch images, use host ports, or execute application startup jobs.

The PostgreSQL drill intentionally restores without archived ownership/ACL commands into the matching disposable application database owner. A real migration to a different owner must separately prepare and verify its roles and privileges. This checkpoint was captured online; coordinated cutover still needs the final drained delta described in the deployment preflight runbook.
