// Encrypt / decrypt the price-alert list for the public 'alerts' branch (used by scripts/alerts.py).
//   node scripts/alertbox.js enc   < plain.json   > {"v":2,"iv":"…","ct":"…"}
//   node scripts/alertbox.js dec   < box.json     > plain.json
// Key: env ALERTS_KEY (repo secret, made by the app). AES-256-GCM with key = SHA-256('alerts-enc|' + ALERTS_KEY),
// 12-byte random IV, ct = ciphertext + 16-byte tag, base64 - exactly what alerts.js does with WebCrypto in the app.
'use strict';
const c = require('crypto');
const K = (process.env.ALERTS_KEY || '').trim();
if (!K) { console.error('ALERTS_KEY is not set'); process.exit(2); }
const key = c.createHash('sha256').update('alerts-enc|' + K).digest();
let s = '';
process.stdin.on('data', d => s += d).on('end', () => {
  const j = JSON.parse(s);
  if (process.argv[2] === 'enc') {
    const iv = c.randomBytes(12), ci = c.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([ci.update(JSON.stringify(j), 'utf8'), ci.final(), ci.getAuthTag()]);
    process.stdout.write(JSON.stringify({ v: 2, iv: iv.toString('base64'), ct: ct.toString('base64') }));
  } else if (process.argv[2] === 'dec') {
    if (j.v !== 2 || !j.iv || !j.ct) { console.error('not an encrypted alerts box'); process.exit(3); }
    const b = Buffer.from(j.ct, 'base64'), d = c.createDecipheriv('aes-256-gcm', key, Buffer.from(j.iv, 'base64'));
    d.setAuthTag(b.subarray(b.length - 16));
    process.stdout.write(Buffer.concat([d.update(b.subarray(0, b.length - 16)), d.final()]).toString('utf8'));
  } else { console.error('usage: enc | dec'); process.exit(1); }
});
