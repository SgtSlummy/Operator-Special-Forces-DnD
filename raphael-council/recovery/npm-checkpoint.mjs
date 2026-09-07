import { createRuntimeCheckpoint } from './runtime.mjs';
const campaign = process.env.npm_config_campaign, encounterId = process.env.npm_config_encounter, destinationDirectory = process.env.npm_config_output;
if (!campaign || !encounterId || !destinationDirectory) throw new Error('Set npm_config_campaign, npm_config_encounter and npm_config_output.');
console.log(JSON.stringify(createRuntimeCheckpoint({ campaign, encounterId, destinationDirectory })));
