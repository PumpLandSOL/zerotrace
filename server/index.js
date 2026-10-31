// ZeroTrace — the privacy launchpad & anti-sniper suite on Solana. Dependency-free Node.
//   VAULT     SOL deposits (real transfers to TREASURY, verified on-chain) can be shielded into fixed-size notes. The pool stores
//             only commitments; a note's secret later claims the SOL into a GHOST account that has no link to the wallet.
//   LAUNCH    coins launch on a constant-product curve, from a wallet or from a ghost (a stealth launch: no wallet attached).
//   FAIR      every launch opens with a sealed Fair Window. Buys are escrowed, then all fill together at ONE clearing price,
//             so the first block is worth nothing. After it: per-holder cap and a cooldown while the coin is young.
//   TRACE     a scanner that reads any Solana wallet from RPC and shows what it leaks: funding source, counterparties, activity.
//   $ZERO     holders of the pass shield fee-free and launch at a discount.
'use strict';
const http = require('http'); const fs = require('fs'); const path = require('path');
const { createHash, randomBytes, randomInt } = require('crypto');

const PORT = process.env.PORT || 8264;
const ROOT = path.join(__dirname, '..');
const DATA_PATH = process.env.DATA_PATH || path.join(ROOT, 'data.json');
const ZERO_MINT = process.env.ZERO_MINT || '7fNFob4R3xhk2BEn2KoZGDEc7aHy1Q1sab9koisdpump';          // $ZERO mint on Solana — set at launch
const TREASURY = process.env.TREASURY || '';            // Solana pubkey, env only (never committed, never shown)
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const NOTES = [0.1, 0.5, 1, 5, 10];                     // fixed note sizes: every note of a size looks the same in the pool
const SHIELD_FEE = +(process.env.SHIELD_FEE || 0.005);  // 0.5% to shield; $ZERO pass holders shield free
const ANON_DELAY = +(process.env.ANON_DELAY || 120);    // seconds a note must sit in the pool before it can be claimed
const LAUNCH_FEE = +(process.env.LAUNCH_FEE || 0.02);   // SOL per launch; pass holders pay half
const TRADE_FEE = +(process.env.TRADE_FEE || 0.01);     // 1% on every buy and sell
const CURVE_V = +(process.env.CURVE_V || 30);           // virtual SOL reserve at launch
const CURVE_SUPPLY = 1_000_000_000;
const WINDOW_SEC = +(process.env.WINDOW_SEC || 60);     // sealed Fair Window at every launch
const WINDOW_CAP = +(process.env.WINDOW_CAP || 2);      // SOL max per buyer inside the window
const GUARD_SEC = +(process.env.GUARD_SEC || 600);      // anti-snipe guard after the window
const GUARD_MAX = +(process.env.GUARD_MAX || 0.02);     // max share of supply one holder may hold while guarded
const GUARD_COOLDOWN = +(process.env.GUARD_COOLDOWN || 3); // seconds between trades per holder while guarded
const PASS_MIN = +(process.env.PASS_MIN || 1_000_000);  // $ZERO needed for the pass

const sha = (s) => createHash('sha256').update(s).digest();
const shx = (s) => sha(s).toString('hex');
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(buf) { let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0')), s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } return s || '1'; }
function b58dec(str) { let n = 0n; for (const ch of str) { const i = B58.indexOf(ch); if (i < 0) throw new Error('b58'); n = n * 58n + BigInt(i); } const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; } for (const ch of str) { if (ch === '1') out.unshift(0); else break; } return Buffer.from(out); }
const id8 = () => base58(randomBytes(6));
const isWallet = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '');
const isHex = (s, n) => typeof s === 'string' && new RegExp('^[0-9a-f]{' + n + '}$').test(s);
const num = (v, max) => { const x = Math.floor((+v || 0) * 1e9) / 1e9; return x > 0 ? Math.min(x, max == null ? x : max) : 0; };

// ---------- signed wallet sessions (Phantom signMessage, ed25519) ----------
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const SESSIONS = new Map();
const sessionMsg = (w, exp) => ['ZeroTrace session', 'Wallet: ' + w, 'Expires: ' + exp, 'Signing is free and moves no funds.'].join('\n');
function requireSess(w, auth) {
  if (!auth || !auth.sig || !auth.exp) throw 'sign in with your wallet first';
  const exp = +auth.exp; if (!(exp > Date.now())) throw 'session expired, sign in again'; if (exp > Date.now() + 8 * 864e5) throw 'bad session';
  const key = w + ':' + exp + ':' + auth.sig; if (SESSIONS.get(key)) return true;
  let ok = false; try { const pk = b58dec(w), sig = b58dec(auth.sig); if (pk.length !== 32 || sig.length !== 64) throw 0;
    ok = require('crypto').verify(null, Buffer.from(sessionMsg(w, exp), 'utf8'), require('crypto').createPublicKey({ key: Buffer.concat([SPKI_ED25519, pk]), format: 'der', type: 'spki' }), sig); } catch (e) { throw 'bad signature'; }
  if (!ok) throw 'signature is not from this wallet';
  if (SESSIONS.size > 5000) SESSIONS.clear(); SESSIONS.set(key, 1); return true;
}

// ---------- state (SOL) ----------
let db = { v: 1, wallets: {}, ghosts: {}, pool: { notes: {}, nullifiers: {}, in: 0, out: 0 }, coins: {}, txs: {}, queue: [], protocol: { feesSol: 0, launches: 0, stealth: 0, volume: 0, blocked: 0, windows: 0, windowFills: 0 }, feed: [] };
try { const old = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); if (old.v === 1) db = Object.assign(db, old); } catch (e) {}
let saveT = null; function save() { if (saveT) return; saveT = setTimeout(() => { saveT = null; try { fs.writeFileSync(DATA_PATH, JSON.stringify(db)); } catch (e) {} }, 800); }
const W = (a) => db.wallets[a] || (db.wallets[a] = { sol: 0, coins: {}, deposited: 0, hist: [] });
const G = (g) => db.ghosts[g] || (db.ghosts[g] = { sol: 0, coins: {}, hist: [], created: Date.now() });
const hist = (o, e) => { o.hist.unshift({ ts: Date.now(), ...e }); if (o.hist.length > 100) o.hist.pop(); };
const feed = (e) => { db.feed.unshift({ ts: Date.now(), ...e }); if (db.feed.length > 80) db.feed.pop(); };

// ghosts: a ghost key (64 hex, kept by the browser) is the only thing that controls a ghost. The server keeps its id, never the key.
const ghostId = (key) => 'zt' + base58(sha('ghost|' + key)).slice(0, 22);
// notes: "zt-<size>-<secret>". The pool stores commitment = H(size|secret); claiming reveals nullifier = H(nf|secret), never the commitment.
const commitOf = (size, secret) => shx('zt|' + size + '|' + secret);
const nullOf = (secret) => shx('nf|' + secret);

// ---------- chain: real SOL deposits to TREASURY, verified on-chain; $ZERO balances read from RPC ----------
const RPCS = (process.env.SOL_RPCS || 'https://api.mainnet-beta.solana.com').split(',');
const MIN_DEPOSIT = +(process.env.MIN_DEPOSIT || 0.1);
const CHAIN = { ok: false, slot: 0, lastRead: 0 };
const LAM = 1e9; const isSig = (s) => /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(s || '');
async function rpc(method, params) {
  let err; for (const u of RPCS) { try { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 9000);
    const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ac.signal }); clearTimeout(tm);
    const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result; } catch (e) { err = e; } }
  throw err || new Error('rpc');
}
async function pollChain() { try { CHAIN.slot = await rpc('getSlot', [{ commitment: 'confirmed' }]); CHAIN.ok = true; CHAIN.lastRead = Date.now(); } catch (e) { CHAIN.ok = false; } }
setInterval(pollChain, 30000); pollChain();
async function creditDeposit(w, sig) {
  if (!TREASURY) throw 'deposits are not open yet';
  if (!isSig(sig)) throw 'paste the transaction signature';
  if (db.txs[sig]) throw 'already credited';
  const tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  if (!tx) throw 'tx not found yet — try again in a few seconds'; if (tx.meta && tx.meta.err) throw 'tx failed on-chain';
  const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? { pubkey: k, signer: false } : k));
  if (!keys.some((k) => k.signer && k.pubkey === w)) throw 'tx not signed by your wallet';
  const ti = keys.findIndex((k) => k.pubkey === TREASURY); if (ti < 0) throw 'tx is not a deposit to ZeroTrace';
  const amt = (tx.meta.postBalances[ti] - tx.meta.preBalances[ti]) / LAM;
  if (!(amt > 0)) throw 'no SOL deposited in this tx';
  if (amt < MIN_DEPOSIT) throw 'minimum deposit is ' + MIN_DEPOSIT + ' SOL';
  const u = W(w); u.sol += amt; u.deposited += amt; db.txs[sig] = { w, amt, slot: tx.slot, ts: Date.now() }; hist(u, { type: 'deposit', amt }); save();
  return { amt, tx: sig };
}
async function depositIntent() { if (!TREASURY) throw 'deposits are not open yet'; const bh = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]); return { to: TREASURY, blockhash: bh.value.blockhash }; }
const PASS = new Map();   // wallet -> { bal, at }
async function zeroBalance(w) {
  if (!ZERO_MINT) return 0; const c = PASS.get(w); if (c && Date.now() - c.at < 60000) return c.bal;
  let bal = 0; try { const r = await rpc('getTokenAccountsByOwner', [w, { mint: ZERO_MINT }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    for (const a of r.value) bal += +a.account.data.parsed.info.tokenAmount.uiAmount || 0; } catch (e) { if (c) return c.bal; }
  PASS.set(w, { bal, at: Date.now() }); return bal;
}
const hasPass = async (w) => (await zeroBalance(w)) >= PASS_MIN;

// ---------- trace scanner: what a Solana wallet leaks, read straight from RPC ----------
const TRACE = new Map();
async function trace(addr) {
  const c = TRACE.get(addr); if (c && Date.now() - c.at < 120000) return c.r;
  const sigs = await rpc('getSignaturesForAddress', [addr, { limit: 200, commitment: 'confirmed' }]);
  const bal = (await rpc('getBalance', [addr, { commitment: 'confirmed' }])).value / LAM;
  const peers = {}; let funder = null, fundAmt = 0, fundTs = null, inflow = 0, outflow = 0, seen = 0;
  const scan = sigs.slice(0, 14).concat(sigs.length > 14 ? sigs.slice(-4) : []);
  const getTx = (sig) => rpc('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]).catch(() => null);
  const txs = []; for (let i = 0; i < scan.length; i += 6) txs.push(...await Promise.all(scan.slice(i, i + 6).map((s) => getTx(s.signature))));
  for (const tx of txs) { if (!tx) continue; seen++;
    const ins = (tx.transaction.message.instructions || []).concat(...((tx.meta && tx.meta.innerInstructions) || []).map((x) => x.instructions));
    for (const i of ins) { const p = i.parsed; if (!p || p.type !== 'transfer' || !p.info || p.info.lamports == null) continue; const a = p.info.lamports / LAM;
      if (p.info.destination === addr && p.info.source) { peers[p.info.source] = (peers[p.info.source] || 0) + 1; inflow += a; }
      if (p.info.source === addr && p.info.destination) { peers[p.info.destination] = (peers[p.info.destination] || 0) + 1; outflow += a; } } }
  const oldest = sigs[sigs.length - 1];
  if (oldest && sigs.length < 200) { try { const tx = await rpc('getTransaction', [oldest.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    for (const i of (tx && tx.transaction.message.instructions) || []) { const p = i.parsed; if (p && p.type === 'transfer' && p.info && p.info.destination === addr) { funder = p.info.source; fundAmt = p.info.lamports / LAM; fundTs = tx.blockTime; break; } } } catch (e) {} }
  const top = Object.entries(peers).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([a, n]) => ({ addr: a, n }));
  const first = oldest && oldest.blockTime, last = sigs[0] && sigs[0].blockTime;
  // exposure: every signal an onlooker can use to link this wallet to others, 0 (clean) .. 100 (fully traced)
  const pts = [[sigs.length >= 200 ? 30 : sigs.length / 200 * 30, 'activity'], [Math.min(25, top.length * 3.2), 'counterparties'], [funder ? 25 : 0, 'funding source'], [first && last && last - first > 30 * 86400 ? 10 : 0, 'long history'], [bal > 1 ? 10 : bal * 10, 'visible balance']];
  const score = Math.round(pts.reduce((a, p) => a + p[0], 0));
  const r = { addr, score, txs: sigs.length, txsCapped: sigs.length >= 200, balance: bal, first, last, funder, fundAmt, fundTs, inflow, outflow, scanned: seen, peers: top, signals: pts.map(([v, k]) => ({ k, v: Math.round(v) })) };
  TRACE.set(addr, { at: Date.now(), r }); if (TRACE.size > 500) TRACE.clear(); return r;
}

// ---------- curve + fair window ----------
const curvePrice = (c) => c.r / c.s;
function buyOnCurve(c, sol) { const k = c.r * c.s; const r2 = c.r + sol; const out = c.s - k / r2; c.r = r2; c.s -= out; return out; }
function sellOnCurve(c, q) { const k = c.r * c.s; const s2 = c.s + q; const out = c.r - k / s2; c.s = s2; c.r -= out; return out; }
const mcap = (c) => curvePrice(c) * CURVE_SUPPLY;
const tag = (actor) => shx('t|' + actor.id).slice(0, 10);     // public trade tag: stable per holder, reveals neither wallet nor ghost id
function closeWindow(c) {
  const w = c.window; if (!w || w.closed) return; w.closed = true; const bids = w.bids; const total = bids.reduce((a, b) => a + b.sol, 0);
  if (total > 0) { const f = total * TRADE_FEE; db.protocol.feesSol += f; const p0 = curvePrice(c); const out = buyOnCurve(c, total - f); w.price = (total - f) / out; w.total = total; w.tokens = out; w.p0 = p0;
    for (const b of bids) { const o = b.kind === 'g' ? db.ghosts[b.id] : db.wallets[b.id]; if (!o) continue; const q = out * b.sol / total; o.coins[c.id] = (o.coins[c.id] || 0) + q; hist(o, { type: 'window fill', amt: b.sol, coin: c.ticker }); }
    c.volume += total; db.protocol.volume += total; db.protocol.windowFills += bids.length;
    c.trades.unshift({ ts: Date.now(), side: 'window', sol: total, coins: out, px: w.price, n: bids.length }); }
  w.n = bids.length; w.bids = []; db.protocol.windows++; feed({ type: 'window', coin: c.ticker, n: bids.length, sol: total }); c.curve.push([Date.now(), curvePrice(c)]); save();
}
setInterval(() => { const now = Date.now(); for (const c of Object.values(db.coins)) if (c.window && !c.window.closed && now >= c.window.until) closeWindow(c); }, 1000);
function guard(c, actor, addCoins) {   // anti-snipe guard while a coin is young: holding cap + per-holder cooldown
  if (Date.now() > c.guardUntil) return;
  const last = (c.lastTrade || {})[actor.tag] || 0; if (Date.now() - last < GUARD_COOLDOWN * 1000) { db.protocol.blocked++; throw 'cooldown: ' + GUARD_COOLDOWN + 's between trades while ' + c.ticker + ' is guarded'; }
  if (addCoins && (actor.o.coins[c.id] || 0) + addCoins > CURVE_SUPPLY * GUARD_MAX) { db.protocol.blocked++; throw 'holding cap: max ' + GUARD_MAX * 100 + '% of supply per holder for the first ' + GUARD_SEC / 60 + ' minutes'; }
}
const touch = (c, actor) => { c.lastTrade = c.lastTrade || {}; c.lastTrade[actor.tag] = Date.now(); };

function coinView(c, full) {
  const now = Date.now(), w = c.window || {}; const open = !w.closed && now < w.until;
  const v = { id: c.id, name: c.name, ticker: c.ticker, desc: c.desc, stealth: c.stealth, creator: c.stealth ? 'ghost' : c.creator.slice(0, 4) + '…' + c.creator.slice(-4), ts: c.ts,
    price: curvePrice(c), mcap: mcap(c), volume: c.volume, holders: c.holders || 0, raised: c.r - c.r0,
    window: { open, until: w.until, n: open ? (w.bids || []).length : w.n || 0, total: open ? null : w.total || 0, price: w.price || null, p0: w.p0 || null },
    guarded: now < c.guardUntil, guardUntil: c.guardUntil };
  if (full) { v.trades = c.trades.slice(0, 60).map((t) => ({ ...t })); v.curve = c.curve.slice(-400); }
  return v;
}
function holdersOf(c) { let n = 0; for (const o of Object.values(db.wallets)) if ((o.coins[c.id] || 0) > 1) n++; for (const o of Object.values(db.ghosts)) if ((o.coins[c.id] || 0) > 1) n++; return n; }
function poolView() { const by = {}; for (const s of NOTES) by[s] = 0; for (const n of Object.values(db.pool.notes)) if (!n.spent) by[n.size]++; return { sets: by, in: db.pool.in, out: db.pool.out, notes: Object.keys(db.pool.notes).length, spent: Object.keys(db.pool.nullifiers).length }; }
function state() {
  for (const c of Object.values(db.coins)) c.holders = holdersOf(c);
  const coins = Object.values(db.coins).map((c) => coinView(c)).sort((a, b) => b.ts - a.ts);
  return { coins, pool: poolView(), protocol: db.protocol, feed: db.feed.slice(0, 40), notes: NOTES, chain: { ok: CHAIN.ok, slot: CHAIN.slot }, depositsOpen: !!TREASURY, zeroMint: ZERO_MINT || null,
    params: { SHIELD_FEE, ANON_DELAY, LAUNCH_FEE, TRADE_FEE, CURVE_V, CURVE_SUPPLY, WINDOW_SEC, WINDOW_CAP, GUARD_SEC, GUARD_MAX, GUARD_COOLDOWN, PASS_MIN, MIN_DEPOSIT } };
}
function holdings(o) { return Object.entries(o.coins).filter(([, q]) => q > 1e-6).map(([id, qty]) => { const c = db.coins[id]; return c ? { id, ticker: c.ticker, name: c.name, qty, value: qty * curvePrice(c) } : null; }).filter(Boolean); }
async function account(addr) { const w = W(addr); const z = await zeroBalance(addr); return { wallet: addr, sol: w.sol, deposited: w.deposited, coins: holdings(w), hist: w.hist.slice(0, 40), zero: z, pass: z >= PASS_MIN, queue: db.queue.filter((q) => q.wallet === addr).slice(0, 10) }; }
function ghostView(gid) { const g = G(gid); return { ghost: gid, sol: g.sol, coins: holdings(g), hist: g.hist.slice(0, 40), queue: db.queue.filter((q) => q.ghost === gid).map(({ ghost, ...q }) => q).slice(0, 10) }; }

// ---------- trading core, shared by wallets and ghosts ----------
function doLaunch(actor, d, fee) {
  const name = String(d.name || '').trim().slice(0, 32), ticker = String(d.ticker || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10), desc = String(d.desc || '').trim().slice(0, 200);
  if (name.length < 2) throw 'give it a name'; if (ticker.length < 2) throw 'give it a ticker';
  if (Object.values(db.coins).some((c) => c.ticker === ticker)) throw '$' + ticker + ' is taken';
  if (actor.o.sol < fee) throw 'launching costs ' + fee + ' SOL' + (actor.kind === 'g' ? ' — claim a note into this ghost first' : ' — deposit first');
  actor.o.sol -= fee; db.protocol.feesSol += fee;
  const now = Date.now(); const c = { id: id8(), name, ticker, desc, stealth: actor.kind === 'g', creator: actor.kind === 'g' ? 'ghost' : actor.id, ts: now, r0: CURVE_V, r: CURVE_V, s: CURVE_SUPPLY, volume: 0, trades: [], curve: [[now, CURVE_V / CURVE_SUPPLY]],
    window: { until: now + WINDOW_SEC * 1000, bids: [], closed: false }, guardUntil: now + (WINDOW_SEC + GUARD_SEC) * 1000, lastTrade: {} };
  db.coins[c.id] = c; db.protocol.launches++; if (c.stealth) db.protocol.stealth++; hist(actor.o, { type: c.stealth ? 'stealth launch' : 'launch', amt: fee, coin: ticker });
  feed({ type: 'launch', coin: ticker, stealth: c.stealth }); save(); return c;
}
function doBuy(actor, c, d) {
  const sol = num(d.amount, actor.o.sol); if (sol < 0.005) throw 'minimum 0.005 SOL' + (actor.o.sol < 0.005 ? ' — fund this ' + (actor.kind === 'g' ? 'ghost' : 'wallet') + ' first' : '');
  const w = c.window;
  if (w && !w.closed && Date.now() < w.until) {   // sealed: escrow now, fill at the one clearing price when the window closes
    const mine = w.bids.filter((b) => b.id === actor.id).reduce((a, b) => a + b.sol, 0); if (mine + sol > WINDOW_CAP + 1e-9) { db.protocol.blocked++; throw 'Fair Window cap is ' + WINDOW_CAP + ' SOL per buyer (you have ' + mine + ' in)'; }
    actor.o.sol -= sol; w.bids.push({ id: actor.id, kind: actor.kind, sol, ts: Date.now() }); hist(actor.o, { type: 'window bid', amt: sol, coin: c.ticker }); save();
    return { sealed: true, until: w.until, bids: w.bids.length };
  }
  const f = sol * TRADE_FEE; const k = c.r * c.s; const out = c.s - k / (c.r + sol - f);
  guard(c, actor, out); const minOut = +d.minOut || 0; if (minOut && out < minOut) throw 'price moved past your limit — nothing filled';
  actor.o.sol -= sol; db.protocol.feesSol += f; buyOnCurve(c, sol - f); actor.o.coins[c.id] = (actor.o.coins[c.id] || 0) + out; touch(c, actor);
  c.volume += sol; db.protocol.volume += sol; c.trades.unshift({ ts: Date.now(), side: 'buy', sol, coins: out, px: curvePrice(c), who: actor.tag }); if (c.trades.length > 300) c.trades.pop(); c.curve.push([Date.now(), curvePrice(c)]); if (c.curve.length > 2000) c.curve.shift();
  hist(actor.o, { type: 'buy', amt: sol, coin: c.ticker }); save(); return { got: out };
}
function doSell(actor, c, d) {
  if (c.window && !c.window.closed) throw 'the Fair Window is still sealed';
  const q = num(d.amount, actor.o.coins[c.id] || 0); if (!q) throw 'nothing to sell'; guard(c, actor, 0);
  const gross = c.r - (c.r * c.s) / (c.s + q); const f = gross * TRADE_FEE; const minOut = +d.minOut || 0; if (minOut && gross - f < minOut) throw 'price moved past your limit — nothing filled';
  actor.o.coins[c.id] -= q; sellOnCurve(c, q); db.protocol.feesSol += f; actor.o.sol += gross - f; touch(c, actor);
  c.volume += gross; db.protocol.volume += gross; c.trades.unshift({ ts: Date.now(), side: 'sell', sol: gross, coins: q, px: curvePrice(c), who: actor.tag }); if (c.trades.length > 300) c.trades.pop(); c.curve.push([Date.now(), curvePrice(c)]);
  hist(actor.o, { type: 'sell', amt: gross - f, coin: c.ticker }); save(); return { sol: gross - f };
}

// ---------- http ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp4': 'video/mp4', '.ico': 'image/x-icon' };
function serve(req, res) { let u = decodeURIComponent(req.url.split('?')[0]); if (u === '/' || /^\/c\/[A-Za-z0-9]+$/.test(u) || /^\/(launch|vault|trace|coins)$/.test(u)) u = '/client/index.html'; else if (u === '/docs') u = '/client/docs.html'; else if (!u.startsWith('/client/') && !u.startsWith('/brand/')) u = '/client' + u;
  const f = path.normalize(path.join(ROOT, u)); if (!f.startsWith(ROOT) || /data\.json$/.test(f)) { res.writeHead(403); return res.end('no'); }
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end('not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(b); }); }
const json = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 2e4) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch (e) { r({}); } }); });
const E = (e) => ({ error: String((e && e.message) || e) });

http.createServer(async (req, res) => {
  const u = req.url.split('?')[0], q = new URL(req.url, 'http://x').searchParams;
  try {
    if (req.method === 'GET') {
      if (u === '/api/session') { const w = q.get('wallet') || ''; if (!isWallet(w)) return json(res, 200, { error: 'bad wallet' }); const exp = Date.now() + 7 * 864e5; return json(res, 200, { exp, message: sessionMsg(w, exp) }); }
      if (u === '/api/state') return json(res, 200, state());
      const m = /^\/api\/coin\/([A-Za-z0-9]+)$/.exec(u); if (m) { const c = db.coins[m[1]]; if (c) c.holders = holdersOf(c); return c ? json(res, 200, coinView(c, true)) : json(res, 404, { error: 'no such coin' }); }
      if (u === '/api/trace') { const a = q.get('addr') || ''; if (!isWallet(a)) return json(res, 200, { error: 'paste a Solana address' }); try { return json(res, 200, await trace(a)); } catch (e) { return json(res, 200, { error: 'Solana RPC is busy, try again in a moment' }); } }
      return serve(req, res);
    }
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    const d = await body(req);

    // ---- ghost routes: controlled by the ghost key alone ----
    if (u.startsWith('/api/g/') || u === '/api/claim') {
      if (u === '/api/claim') {   // note -> ghost. The request carries the note secret and a ghost key; no wallet.
        const m = /^zt-([0-9.]+)-([0-9a-f]{64})$/.exec(String(d.note || '').trim()); if (!m) return json(res, 200, { error: 'that is not a ZeroTrace note' });
        const size = +m[1], secret = m[2]; if (!NOTES.includes(size)) return json(res, 200, { error: 'unknown note size' });
        const cm = commitOf(size, secret), nf = nullOf(secret); const n = db.pool.notes[cm];
        if (!n) return json(res, 200, { error: 'no such note in the pool' }); if (db.pool.nullifiers[nf]) return json(res, 200, { error: 'this note was already claimed' });
        const wait = n.ts + ANON_DELAY * 1000 - Date.now(); if (wait > 0) return json(res, 200, { error: 'note is mixing — claimable in ' + Math.ceil(wait / 1000) + 's' });
        if (!isHex(d.key, 64)) return json(res, 200, { error: 'missing ghost key' });
        const gid = ghostId(d.key), g = G(gid); db.pool.nullifiers[nf] = Date.now(); n.spent = true; g.sol += size; db.pool.out += size; hist(g, { type: 'claim', amt: size });
        feed({ type: 'claim', size }); save(); return json(res, 200, { ok: true, size, ...ghostView(gid) });
      }
      if (!isHex(d.key, 64)) return json(res, 200, { error: 'missing ghost key' });
      const gid = ghostId(d.key), actor = { kind: 'g', id: gid, o: G(gid) }; actor.tag = tag(actor);
      if (u === '/api/g/account') return json(res, 200, ghostView(gid));
      if (u === '/api/g/launch') { const c = doLaunch(actor, d, LAUNCH_FEE); return json(res, 200, { ok: true, coin: coinView(c, true), ...ghostView(gid) }); }
      const c = db.coins[d.id];
      if (u === '/api/g/buy') { if (!c) throw 'no such coin'; const r = doBuy(actor, c, d); return json(res, 200, { ok: true, ...r, coin: coinView(c), ...ghostView(gid) }); }
      if (u === '/api/g/sell') { if (!c) throw 'no such coin'; const r = doSell(actor, c, d); return json(res, 200, { ok: true, ...r, coin: coinView(c), ...ghostView(gid) }); }
      if (u === '/api/g/withdraw') { const to = String(d.to || ''); if (!isWallet(to)) throw 'paste the Solana address to send to'; const x = num(d.amount, actor.o.sol); if (x < 0.05) throw 'minimum 0.05 SOL';
        actor.o.sol -= x; const delay = randomInt(10, 61) * 60000; const it = { id: id8(), ghost: gid, to, amt: x, ts: Date.now(), after: Date.now() + delay, status: 'queued', tx: null }; db.queue.unshift(it); if (db.queue.length > 500) db.queue.pop();
        hist(actor.o, { type: 'withdraw', amt: x }); save(); return json(res, 200, { ok: true, queued: { id: it.id, amt: x, after: it.after }, ...ghostView(gid) }); }
      return json(res, 404, { error: 'unknown route' });
    }

    if (u === '/api/admin/queue') { if (!ADMIN_KEY || d.key !== ADMIN_KEY) return json(res, 200, { error: 'no' }); return json(res, 200, { ok: true, queue: db.queue.slice(0, 200) }); }
    if (u === '/api/admin/paid') { if (!ADMIN_KEY || d.key !== ADMIN_KEY) return json(res, 200, { error: 'no' }); const it = db.queue.find((x) => x.id === d.id); if (!it) return json(res, 200, { error: 'no such item' }); it.status = 'paid'; it.tx = d.tx || null; it.paidTs = Date.now(); save(); return json(res, 200, { ok: true, it }); }

    // ---- wallet routes ----
    if (!isWallet(d.wallet || '')) return json(res, 200, { error: 'connect a Solana wallet' });
    const addr = d.wallet, w = W(addr), actor = { kind: 'w', id: addr, o: w }; actor.tag = tag(actor);
    if (['/api/launch', '/api/buy', '/api/sell', '/api/shield', '/api/withdraw'].includes(u)) { try { requireSess(addr, d.auth); } catch (e) { return json(res, 200, { error: String(e), auth: true }); } }
    if (u === '/api/account') return json(res, 200, await account(addr));
    if (u === '/api/deposit/intent') return json(res, 200, await depositIntent());
    if (u === '/api/deposit') { const r = await creditDeposit(addr, d.tx); return json(res, 200, { ok: true, ...r, ...(await account(addr)) }); }
    if (u === '/api/dev/faucet' && process.env.DEV_FAUCET === '1') { w.sol += num(d.amount) || 0; save(); return json(res, 200, { ok: true, ...(await account(addr)) }); }   // LOCAL TESTING ONLY
    if (u === '/api/shield') {   // wallet SOL -> a note. Only the commitment is stored; nothing ties it to this wallet.
      const size = +d.size; if (!NOTES.includes(size)) throw 'pick a note size'; if (!isHex(d.commitment, 64)) throw 'bad commitment';
      if (db.pool.notes[d.commitment]) throw 'commitment already in the pool';
      const fee = (await hasPass(addr)) ? 0 : size * SHIELD_FEE; if (w.sol < size + fee - 1e-12) throw 'you need ' + (size + fee) + ' SOL for this note';
      w.sol -= size + fee; db.protocol.feesSol += fee; db.pool.notes[d.commitment] = { size, ts: Date.now() }; db.pool.in += size; hist(w, { type: 'shield', amt: size + fee });
      feed({ type: 'shield', size }); save(); return json(res, 200, { ok: true, size, fee, claimableAt: Date.now() + ANON_DELAY * 1000, ...(await account(addr)) });
    }
    if (u === '/api/launch') { const fee = (await hasPass(addr)) ? LAUNCH_FEE / 2 : LAUNCH_FEE; const c = doLaunch(actor, d, fee); return json(res, 200, { ok: true, coin: coinView(c, true), ...(await account(addr)) }); }
    const c = db.coins[d.id];
    if (u === '/api/buy') { if (!c) throw 'no such coin'; const r = doBuy(actor, c, d); return json(res, 200, { ok: true, ...r, coin: coinView(c), ...(await account(addr)) }); }
    if (u === '/api/sell') { if (!c) throw 'no such coin'; const r = doSell(actor, c, d); return json(res, 200, { ok: true, ...r, coin: coinView(c), ...(await account(addr)) }); }
    if (u === '/api/withdraw') { const x = num(d.amount, w.sol); if (x < 0.02) throw 'minimum 0.02 SOL'; w.sol -= x; const it = { id: id8(), wallet: addr, to: addr, amt: x, ts: Date.now(), after: Date.now(), status: 'queued', tx: null }; db.queue.unshift(it); hist(w, { type: 'withdraw', amt: x }); save(); return json(res, 200, { ok: true, queued: it, ...(await account(addr)) }); }
    json(res, 404, { error: 'unknown route' });
  } catch (e) { json(res, 200, E(e)); }
}).listen(PORT, () => console.log('ZeroTrace · privacy launchpad · Solana · :' + PORT + (TREASURY ? '' : ' · TREASURY unset, deposits closed')));
