// ZeroTrace end-to-end against a running dev server (DEV_FAUCET=1, short windows):
//   PORT=8265 DEV_FAUCET=1 ANON_DELAY=3 WINDOW_SEC=6 GUARD_SEC=60 DATA_PATH=/tmp/zt.json node server/index.js
//   API=http://localhost:8265 node _studio/e2e.cjs
'use strict';
const crypto = require('crypto'); const B = process.env.API || 'http://localhost:8265';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58 = (buf) => { let n = BigInt('0x' + Buffer.from(buf).toString('hex')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const x of buf) { if (x === 0) s = '1' + s; else break; } return s; };
const sh = (s) => crypto.createHash('sha256').update(s).digest('hex');
const get = async (p) => (await fetch(B + p)).json();
const post = async (p, b) => (await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', m); };
async function mkWallet() { const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519'); const pk = publicKey.export({ format: 'der', type: 'spki' }).subarray(12); const w = b58(pk);
  const s = await get('/api/session?wallet=' + w); const sig = crypto.sign(null, Buffer.from(s.message, 'utf8'), privateKey); return { w, auth: { exp: s.exp, sig: b58(sig) } }; }
(async () => {
  const st = await get('/api/state'); const P = st.params; ok(st.notes && P.WINDOW_SEC > 0, 'state loads (window ' + P.WINDOW_SEC + 's, mixing ' + P.ANON_DELAY + 's)');
  ok(!JSON.stringify(st).includes('TREASURY') && !('treasury' in st), 'public state never exposes the treasury');
  const A = await mkWallet(), Bw = await mkWallet(), C = await mkWallet();
  for (const x of [A, Bw, C]) await post('/api/dev/faucet', { wallet: x.w, amount: 20 });
  // auth
  let r = await post('/api/launch', { wallet: A.w, name: 'No Auth', ticker: 'NOAUTH' }); ok(r.auth, 'launch without a signed session is refused');
  r = await post('/api/launch', { wallet: A.w, auth: { exp: A.auth.exp, sig: Bw.auth.sig }, name: 'Forged', ticker: 'FORGE' }); ok(r.error && /signature/.test(r.error), 'forged session signature is refused');
  // wallet launch + fair window
  r = await post('/api/launch', { wallet: A.w, auth: A.auth, name: 'Fair Coin', ticker: 'FAIR', desc: 'test' }); ok(r.ok && r.coin.window.open, 'wallet launch opens a sealed Fair Window');
  const id = r.coin.id;
  r = await post('/api/buy', { wallet: Bw.w, auth: Bw.auth, id, amount: 1.5 }); ok(r.sealed, 'buy inside the window is a sealed bid');
  r = await post('/api/buy', { wallet: Bw.w, auth: Bw.auth, id, amount: 1 }); ok(r.error && /cap/.test(r.error), 'window cap per buyer enforced (' + P.WINDOW_CAP + ' SOL)');
  r = await post('/api/buy', { wallet: C.w, auth: C.auth, id, amount: 0.5 }); ok(r.sealed, 'second buyer seals a bid');
  r = await get('/api/coin/' + id); ok(r.window.open && r.window.n === 2 && r.window.total === null, 'window shows bid count but hides amounts');
  r = await post('/api/sell', { wallet: Bw.w, auth: Bw.auth, id, amount: 1 }); ok(r.error && /sealed/.test(r.error), 'no selling while the window is sealed');
  await sleep(P.WINDOW_SEC * 1000 + 2000);
  r = await get('/api/coin/' + id); ok(!r.window.open && r.window.n === 2 && r.window.price > 0, 'window closed: 2 buyers filled at one price ' + (r.window.price || 0).toExponential(3));
  const ab = await post('/api/account', { wallet: Bw.w }), ac = await post('/api/account', { wallet: C.w });
  const qb = ab.coins.find((x) => x.id === id).qty, qc = ac.coins.find((x) => x.id === id).qty;
  ok(Math.abs(qb / qc - 3) < 1e-6, 'fills are pro-rata: 1.5 SOL got exactly 3x the 0.5 SOL fill (same price)');
  // guard
  r = await post('/api/buy', { wallet: C.w, auth: C.auth, id, amount: 0.01 }); ok(r.ok && r.got > 0, 'open trading after window');
  r = await post('/api/buy', { wallet: C.w, auth: C.auth, id, amount: 0.01 }); ok(r.error && /cooldown/.test(r.error), 'guard cooldown blocks back-to-back trades');
  await sleep(P.GUARD_COOLDOWN * 1000 + 300);
  r = await post('/api/buy', { wallet: C.w, auth: C.auth, id, amount: 15 }); ok(r.error && /holding cap/.test(r.error), 'guard holding cap blocks a whale buy');
  r = await post('/api/buy', { wallet: A.w, auth: A.auth, id, amount: 0.05, minOut: 1e15 }); ok(r.error && /limit/.test(r.error), 'price limit (minOut) refuses a bad fill');
  // vault: shield -> claim into ghost -> stealth launch
  const secret = crypto.randomBytes(32).toString('hex'), size = 1, note = 'zt-' + size + '-' + secret, cm = sh('zt|' + size + '|' + secret);
  r = await post('/api/shield', { wallet: A.w, size, commitment: cm }); ok(r.auth, 'shield needs a signed session');
  const before = (await post('/api/account', { wallet: A.w })).sol;
  r = await post('/api/shield', { wallet: A.w, auth: A.auth, size, commitment: cm }); ok(r.ok && Math.abs(before - r.sol - size * (1 + P.SHIELD_FEE)) < 1e-9, 'shield debits note + 0.5% fee');
  r = await post('/api/shield', { wallet: A.w, auth: A.auth, size, commitment: cm }); ok(r.error, 'same commitment cannot enter twice');
  const pool = (await get('/api/state')).pool; ok(pool.sets['1'] >= 1, 'pool shows the 1 SOL anonymity set');
  const dump = JSON.stringify(await get('/api/state')); ok(!dump.includes(A.w) && !dump.includes(cm), 'public state holds no wallet or commitment');
  const gkey = crypto.randomBytes(32).toString('hex');
  r = await post('/api/claim', { note, key: gkey }); ok(r.error && /mixing/.test(r.error), 'note cannot be claimed before the mixing time');
  await sleep(P.ANON_DELAY * 1000 + 500);
  r = await post('/api/claim', { note: 'zt-1-' + crypto.randomBytes(32).toString('hex'), key: gkey }); ok(r.error && /no such note/.test(r.error), 'unknown note refused');
  r = await post('/api/claim', { note, key: gkey }); ok(r.ok && r.sol === 1 && /^zt/.test(r.ghost), 'note claimed into a ghost: 1 SOL');
  r = await post('/api/claim', { note, key: crypto.randomBytes(32).toString('hex') }); ok(r.error && /already/.test(r.error), 'double-claim blocked by nullifier');
  r = await post('/api/g/launch', { key: gkey, name: 'Ghost Coin', ticker: 'GHOST' }); ok(r.ok && r.coin.stealth && r.coin.creator === 'ghost', 'stealth launch from a ghost: creator shows "ghost"');
  const gid = r.ghost; const coinDump = JSON.stringify(await get('/api/coin/' + r.coin.id)); ok(!coinDump.includes(A.w) && !coinDump.includes(gid), 'stealth coin exposes neither wallet nor ghost id');
  r = await post('/api/g/buy', { key: gkey, id: r.coin.id, amount: 0.5 }); ok(r.sealed, 'ghost seals a bid in its own window');
  r = await post('/api/g/withdraw', { key: gkey, to: C.w, amount: 0.1 }); ok(r.ok && r.queued.after - Date.now() >= 9 * 60000, 'ghost withdrawal leaves on a 10–60 min random delay');
  r = await post('/api/g/account', { key: 'f'.repeat(64) }); ok(r.sol === 0 && r.ghost !== gid, 'a different key is a different, empty ghost');
  r = await post('/api/g/launch', { key: 'nope', name: 'x', ticker: 'XX' }); ok(r.error, 'ghost routes need a valid key');
  // trace scanner (real Solana RPC)
  r = await get('/api/trace?addr=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'); ok(r.error ? /RPC/.test(r.error) : (r.score >= 0 && r.txs > 0), 'trace scanner reads a real wallet' + (r.error ? ' (rpc busy)' : ': score ' + r.score + ', ' + r.txs + ' tx'));
  r = await get('/api/trace?addr=bad'); ok(r.error, 'trace rejects a bad address');
  const fin = await get('/api/state'); ok(fin.protocol.blocked >= 3 && fin.protocol.stealth >= 1 && fin.protocol.windowFills >= 2, 'protocol counters: ' + fin.protocol.blocked + ' blocked, ' + fin.protocol.stealth + ' stealth, ' + fin.protocol.windowFills + ' window fills');
  console.log(fail ? fail + ' FAILED, ' + pass + ' passed' : 'ALL PASS (' + pass + ')'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
