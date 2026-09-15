#!/usr/bin/env node
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const pluginRoot = fs.readFileSync(path.join(__dirname, '..', 'plugin-root.txt'), 'utf8').trim();
const real = path.join(pluginRoot, 'scripts', "codex-install.js");
const r = spawnSync(process.execPath, [real, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
process.exit(r.status ?? 0);
