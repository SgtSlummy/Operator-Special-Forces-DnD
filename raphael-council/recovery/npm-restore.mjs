import { restoreRuntimeCheckpoint } from './runtime.mjs';
const checkpointDirectory = process.env.npm_config_source, destinationDirectory = process.env.npm_config_output;
if (!checkpointDirectory || !destinationDirectory) throw new Error('Set npm_config_source and npm_config_output.');
console.log(JSON.stringify(restoreRuntimeCheckpoint({ checkpointDirectory, destinationDirectory })));
