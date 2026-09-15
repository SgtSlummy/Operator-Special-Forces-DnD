import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runSimulation } from './simulation-acceptance.test.mjs';

const output = process.env.RAPHAEL_SIMULATION_OUTPUT ?? join(process.cwd(), '.runtime', 'acceptance', 'simulation-receipt.json');
const result = runSimulation();
const receipt = { format: 'raphael-simulation-acceptance-v1', generatedAt: new Date().toISOString(), ...result };
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ status: receipt.status, output, receiptCount: receipt.receipts.length, finalHostGeneration: receipt.finalHostGeneration }));
