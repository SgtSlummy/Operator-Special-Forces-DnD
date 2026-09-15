# Start the local rehearsal

Double-click `Start-Rehearsal.cmd` in this folder. Keep its window open while playing. Once it reports ready, open http://127.0.0.1:18796 on this computer. Type `stop` and press Enter in the launcher window to close the services it started.

This entry uses the existing isolated rehearsal binding at `.runtime/hollow-lantern/rehearsal-native-20260910/binding.json`. It requires Node.js, the existing rehearsal engine on port 18810, PostgreSQL on port 15432, Redis on port 16379, and the configured Discord credentials and command. It does not install or start those prerequisites. It refuses occupied service ports and does not take over a session that is already running.

The launcher runs directly from this local project folder and does not require Gortex. Keep this project outside OneDrive. This is a local rehearsal entry; remote phone access, final artwork, and the complete game are separate unfinished work.

For a read-only setup check, run from this folder:

```powershell
node hollow-lantern/rehearsal-launch.mjs --check --binding "$PWD/.runtime/hollow-lantern/rehearsal-native-20260910/binding.json"
```

A failed or incomplete stop must be investigated before another start. Do not delete an active draft-store lock or forcibly stop another session to make the launcher proceed.
