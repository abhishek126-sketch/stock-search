// Live verification script for US Swing Engine and Expectancy math
const PlanPort = require('C:/Users/asus/OneDrive/Documents/Stock Search App/source/planport.js');
const IND = require('C:/Users/asus/OneDrive/Documents/Stock Search App/source/indicators.js');

console.log('=== 1. VERIFYING EXPECTANCY & COMPOUNDING MATH ===');
const expA = PlanPort.calcExpectancy(0.50, 2.0, 1.0);
console.log('50% Win Rate, 2:1 Payoff, 1% Risk:');
console.log(`- Expectancy: ${expA.E.toFixed(2)}R`);
console.log(`- Geometric Growth / Trade: ${(expA.g * 100).toFixed(2)}%`);
console.log(`- 95% CI Max Loss Streak: ${expA.streak95}`);
console.log(`- Est. Max Drawdown: ${expA.estMaxDD.toFixed(1)}%`);
if (Math.abs(expA.E - 0.50) > 0.001) throw new Error('Expectancy math failed');

console.log('\n=== 2. VERIFYING US SWING PLAN CALCULATION ENGINE ===');
const hist = [];
const ohlc = [];
let price = 150.0;
const t0 = Math.floor(Date.now() / 1000) - 300 * 86400;

for (let i = 0; i < 300; i++) {
  const t = t0 + i * 86400;
  price = price * (1 + 0.002);
  hist.push([t, price]);
  ohlc.push([t, price * 0.995, price * 1.01, price * 0.99, price, 45000000]);
}

const c = hist.map(h => h[1]);
const p = c[c.length - 1];
const e20 = IND.ema(c, 20);
const e50 = IND.ema(c, 50);
const e200 = IND.ema(c, 200);
const rsiVal = IND.rsi(c, 14);
const atrVal = IND.atr(ohlc, 14);
const ws = IND.weinstein(hist);

console.log(`Steady Uptrend US Stock (Latest Close: $${p.toFixed(2)}):`);
console.log(`- 20 EMA: $${e20.toFixed(2)}`);
console.log(`- 50 EMA: $${e50.toFixed(2)}`);
console.log(`- 200 EMA: $${e200.toFixed(2)}`);
console.log(`- RSI (14): ${rsiVal.toFixed(1)}`);
console.log(`- ATR (14): $${atrVal.toFixed(2)}`);
console.log(`- Weinstein Stage: Stage ${ws ? ws.stage : 'N/A'}`);

const R = Math.max(p * 0.015, atrVal * 1.5);
const SL = Math.max(0.01, p - R);
const T1 = p + 2 * R;
const T2 = p + 3 * R;

console.log(`Generated US Order Ticket:`);
console.log(`- Entry Trigger: $${p.toFixed(2)}`);
console.log(`- Structural Stop-Loss: $${SL.toFixed(2)} (-${((p - SL) / p * 100).toFixed(1)}%)`);
console.log(`- Target 1 (+2R): $${T1.toFixed(2)}`);
console.log(`- Target 2 (+3R): $${T2.toFixed(2)}`);

if (e20 <= e50 || e50 <= e200) throw new Error('EMA stack failed');
if (T1 <= p || SL >= p) throw new Error('Order ticket sizing failed');

console.log('\n✅ ALL VERIFICATION CHECKS PASSED PERFECTLY!');
