#!/usr/bin/env node
'use strict';
// stdin: [{s, r3m, r6m, r1y, market}] from build_data.py. stdout: {symbol: rank}.
const I = require('../indicators.js');
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { raw += c; });
process.stdin.on('end', () => { process.stdout.write(JSON.stringify(I.rsRanks(JSON.parse(raw || '[]')))); });
