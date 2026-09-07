import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { gameConfig } from './storage.mjs';
import { backupGame, verifyGameBackup, restoreGameBackup, BackupError } from './backup.mjs';

try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { source: { type: 'string' }, output: { type: 'string' } } });
  const [operation] = positionals;
  if (positionals.length !== 1 || !['backup', 'verify', 'restore'].includes(operation) || (operation !== 'verify' && !values.output) || (operation !== 'backup' && !values.source) || (operation === 'verify' && values.output)) throw new BackupError('Use backup --output NEW_DIRECTORY, verify --source BACKUP_DIRECTORY, or restore --source BACKUP_DIRECTORY --output NEW_DATA_DIRECTORY.');
  const result = operation === 'backup' ? backupGame(values.source || join(gameConfig().dataDir, 'game.sqlite'), values.output)
    : operation === 'verify' ? verifyGameBackup(values.source) : restoreGameBackup(values.source, values.output);
  console.log(JSON.stringify({ operation, ...result }));
} catch (error) {
  console.error(error instanceof BackupError ? error.message : 'Game backup operation failed. Check that the source exists and that the output directory is new. Existing data was not replaced.');
  process.exitCode = 1;
}
