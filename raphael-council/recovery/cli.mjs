import { parseArgs } from 'node:util';
import { createRuntimeCheckpoint, restoreRuntimeCheckpoint } from './runtime.mjs';
import { RecoveryError } from './coordinated.mjs';
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { campaign: { type: 'string' }, encounter: { type: 'string' }, source: { type: 'string' }, output: { type: 'string' } } });
  const [operation] = positionals;
  if (operation === 'checkpoint' && values.campaign && values.encounter && values.output && !values.source) console.log(JSON.stringify(createRuntimeCheckpoint({ campaign: values.campaign, encounterId: values.encounter, destinationDirectory: values.output })));
  else if (operation === 'restore' && values.source && values.output) console.log(JSON.stringify(restoreRuntimeCheckpoint({ checkpointDirectory: values.source, destinationDirectory: values.output })));
  else throw new RecoveryError('Use checkpoint --campaign ID --encounter ID --output NEW_DIRECTORY or restore --source CHECKPOINT_DIRECTORY --output NEW_DIRECTORY.');
} catch (error) { console.error(error instanceof RecoveryError ? error.message : 'Runtime recovery operation failed. Existing data was not replaced.'); process.exitCode = 1; }
