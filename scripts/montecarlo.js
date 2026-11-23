#!/usr/bin/env node
'use strict';

/**
 * Monte Carlo Simulation & Risk-of-Ruin Engine for Swing Trading.
 * Runs bootstrap resampling on historical trade return multiples (R)
 * to estimate max drawdown confidence intervals, losing streak distributions,
 * and risk-of-ruin probabilities.
 */

const fs = require('fs');
const path = require('path');
const PP = require('../planport.js');

function printReport(mc, kelly) {
  console.log('====================================================');
  console.log('🎲 MONTE CARLO STRESS TEST & RISK-OF-RUIN ANALYSIS');
  console.log('====================================================');
  console.log(`Simulations:     ${mc.simulations.toLocaleString()} bootstrapped runs`);
  console.log(`Trades Sampled:  ${mc.tradesSampled} trades\n`);

  console.log('--- Maximum Drawdown Distribution ---');
  console.log(`  Median (50th percentile):  ${mc.maxDD.median}%`);
  console.log(`  95th Percentile (95% CI):  ≤ ${mc.maxDD.p95}%`);
  console.log(`  99th Percentile (Stress):  ≤ ${mc.maxDD.p99}%`);
  console.log(`  Worst Simulated Drawdown:  ${mc.maxDD.worst}%\n`);

  console.log('--- Losing Streak Distribution ---');
  console.log(`  Median Consecutive Losses: ${mc.maxLossStreak.median} trades`);
  console.log(`  95th Percentile Streak:    ≤ ${mc.maxLossStreak.p95} trades`);
  console.log(`  Worst Simulated Streak:    ${mc.maxLossStreak.worst} trades\n`);

  console.log('--- Risk of Ruin Probabilities ---');
  console.log(`  Probability of ≥ 20% Drawdown: ${mc.riskOfRuin20}%`);
  console.log(`  Probability of ≥ 30% Drawdown: ${mc.riskOfRuin30}%\n`);

  if (kelly && kelly.edge) {
    console.log('--- Kelly Criterion Allocation ---');
    console.log(`  Full Kelly f*:             ${(kelly.kelly * 100).toFixed(1)}%`);
    console.log(`  Half-Kelly (Recommended):  ${(kelly.halfKelly * 100).toFixed(1)}%`);
    console.log(`  Capped Risk Suggestion:    ${kelly.recRiskPct}% risk / trade`);
  }
  console.log('====================================================\n');
}

if (require.main === module) {
  const btPath = path.join(__dirname, '..', 'data', 'backtest.json');
  let trades = [];

  if (fs.existsSync(btPath)) {
    try {
      const bt = JSON.parse(fs.readFileSync(btPath, 'utf8'));
      if (bt.lastTrades && bt.lastTrades.length) {
        trades = bt.lastTrades.map(t => t.R);
      }
    } catch { }
  }

  // If no backtest file found, demonstrate on standard swing trading distribution
  if (!trades.length) {
    console.log('Note: data/backtest.json not found; running on empirical benchmark distribution (42% win, 2.5R avg win, -1R avg loss)...');
    for (let i = 0; i < 100; i++) {
      trades.push(Math.random() < 0.42 ? (1.5 + Math.random() * 2.5) : (-0.7 - Math.random() * 0.4));
    }
  }

  const mc = PP.runMonteCarlo(trades, { simulations: 1000, riskPct: 1, startCapital: 100000 });
  const kelly = PP.calcKelly(0.42, 2.4);
  printReport(mc, kelly);
}

module.exports = { runMonteCarlo: PP.runMonteCarlo, calcKelly: PP.calcKelly };
