#!/usr/bin/env node
'use strict';

/**
 * Unified Test Harness & Syntax Verification Suite for Stock Search App.
 * Executes:
 * 1. Syntax verification (node --check) across all root & script JS files.
 * 2. All 4 unit test suites: test_indicators, test_dmasetup, test_plan, test_sim.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const SCRIPTS_DIR = __dirname;

console.log('====================================================');
console.log('🚀 Stock Search App — Unified Test & Syntax Harness');
console.log('====================================================');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;

// 1. Syntax Check
console.log('\n[Phase 1/2] Verifying JavaScript Syntax (node --check)...');

function getJsFiles(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.js') && !f.startsWith('.'))
      .map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

const rootFiles = getJsFiles(ROOT_DIR);
const scriptFiles = getJsFiles(SCRIPTS_DIR);
const allFiles = [...rootFiles, ...scriptFiles];

for (const file of allFiles) {
  const relPath = path.relative(ROOT_DIR, file).replace(/\\/g, '/');
  totalChecks++;
  try {
    execSync(`node --check "${file}"`, { stdio: 'pipe' });
    passedChecks++;
    console.log(`  ✔ syntax ok: ${relPath}`);
  } catch (err) {
    failedChecks++;
    console.error(`  ✘ SYNTAX ERROR in ${relPath}:\n${err.stderr ? err.stderr.toString() : err.message}`);
  }
}

// 2. Unit Test Suites
console.log('\n[Phase 2/2] Running Automated Unit Test Suites...');

const testSuites = [
  'test_indicators.js',
  'test_dmasetup.js',
  'test_plan.js',
  'test_sim.js'
];

for (const suite of testSuites) {
  const suitePath = path.join(SCRIPTS_DIR, suite);
  totalChecks++;
  if (!fs.existsSync(suitePath)) {
    failedChecks++;
    console.error(`  ✘ Missing test suite: scripts/${suite}`);
    continue;
  }

  const startTime = Date.now();
  try {
    const out = execSync(`node "${suitePath}"`, { cwd: ROOT_DIR, stdio: 'pipe' });
    const elapsed = Date.now() - startTime;
    passedChecks++;
    console.log(`  ✔ ${suite} passed (${elapsed} ms)`);
  } catch (err) {
    failedChecks++;
    const elapsed = Date.now() - startTime;
    console.error(`  ✘ FAILED: ${suite} (${elapsed} ms)`);
    if (err.stdout) console.error(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
  }
}

console.log('\n====================================================');
console.log(`Summary: ${passedChecks}/${totalChecks} checks passed. (${failedChecks} failed)`);
console.log('====================================================');

if (failedChecks > 0) {
  process.exit(1);
} else {
  console.log('✅ ALL TESTS AND SYNTAX CHECKS PASSED SUCCESSFULLY!\n');
  process.exit(0);
}
