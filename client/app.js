'use strict';
const $ = (id) => document.getElementById(id);
const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
async function api(u, b) {
  if (!b) return fetch(u).then((r) => r.json());
  const withAuth = () => (b.wallet && b.wallet === wallet ? Object.assign({}, b, { auth: getAuth() }) : b);
  let r = await post(u, withAuth());
  if (r && r.auth) { const ok = await signIn(); if (ok) r = await post(u, withAuth()); }
  return r;
}
const fmt = (n, d = 2) => (n == null || !isFinite(n)) ? '—' : (+n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const S4 = (n) => (n == null || !isFinite(n)) ? '—' : (Math.abs(n) >= 100 ? fmt(n, 2) : Math.abs(n) >= 1 ? fmt(n, 3) : fmt(n, 4)) + ' SOL';
const big = (n) => Math.abs(n) >= 1e6 ? fmt(n / 1e6, 2) + 'M' : Math.abs(n) >= 1e3 ? fmt(n / 1e3, 1) + 'K' : fmt(n, Math.abs(n) < 10 ? 2 : 0);
const ago = (ts) => { const s = Math.max(0, (Date.now() - ts) / 1000); return s < 60 ? Math.floor(s) + 's' : s < 3600 ? Math.floor(s / 60) + 'm' : s < 86400 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd'; };
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const short = (a) => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
function toast(m, err) { const t = $('toast'); t.textContent = m; t.className = 'toast on' + (err ? ' err' : ''); clearTimeout(toast._t); toast._t = setTimeout(() => t.className = 'toast', 2800); }
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, del: (k) => { try { localStorage.removeItem(k); } catch (e) {} } };

let S = null, A = null, GH = null, coin = null, coinId = '', side = 'buy', asWho = 'w', slip = 0.03, launchAs = 'g', noteSize = 0.5;
let wallet = ls.get('zt_w') || '';

// ---------- Solana wallet (Phantom / Solflare / Backpack via window.solana) ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58dec(s) { let n = 0n; for (const ch of s) { const i = B58.indexOf(ch); if (i < 0) throw new Error('b58'); n = n * 58n + BigInt(i); } const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; } for (const ch of s) { if (ch === '1') out.unshift(0); else break; } return new Uint8Array(out); }
function b58enc(bytes) { let n = 0n; for (const x of bytes) n = n * 256n + BigInt(x); let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; } for (const x of bytes) { if (x === 0) s = '1' + s; else break; } return s; }
const isSolAddr = (v) => { if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v)) return false; try { return b58dec(v).length === 32; } catch (e) { return false; } };
const sol = () => (window.phantom && window.phantom.solana) || window.solana || null;
const errText = (e) => { const m = (e && (e.message || (e.error && e.error.message))) || String(e || ''); if ((e && e.code === 4001) || /reject|denied|cancel/i.test(m)) return 'request rejected in your wallet'; return m.slice(0, 120) || 'wallet error'; };
function setConnected() { $('connect').textContent = wallet ? short(wallet) : 'Connect'; }
const AKEY = () => 'zt_auth_' + wallet;
function getAuth() { try { const x = JSON.parse(ls.get(AKEY()) || 'null'); return x && x.exp > Date.now() + 6e4 ? x : null; } catch (e) { return null; } }
async function signIn() {
  if (!wallet) return false; if (getAuth()) return true; const p = sol();
  if (!p || !p.signMessage) { toast('connect Phantom to sign in', true); return false; }
  try { const m = await (await fetch('/api/session?wallet=' + wallet)).json(); if (m.error) throw new Error(m.error);
    toast('sign the message in your wallet (free, no transaction)');
    const r = await p.signMessage(new TextEncoder().encode(m.message), 'utf8'); const sig = r && (r.signature || r);
    ls.set(AKEY(), JSON.stringify({ exp: m.exp, sig: b58enc(new Uint8Array(sig)) })); return true;
  } catch (e) { toast(errText(e), true); return false; }
}
async function connect() { const p = sol(); if (!p) { $('phLink').href = 'https://phantom.app/ul/browse/' + encodeURIComponent(location.href) + '?ref=' + encodeURIComponent(location.origin); $('wmodal').classList.add('on'); return; }
  try { const r = await p.connect(); const pk = (r && r.publicKey ? r.publicKey : p.publicKey).toString(); if (!isSolAddr(pk)) throw new Error('wallet returned no Solana address'); wallet = pk; ls.set('zt_w', wallet); setConnected(); await signIn(); toast('connected'); await loadAccount(); } catch (e) { toast(errText(e), true); } }
$('connect').onclick = () => { if (wallet) { ls.del(AKEY()); wallet = ''; ls.del('zt_w'); A = null; setConnected(); renderAll(); try { const p = sol(); if (p && p.disconnect) p.disconnect(); } catch (e) {} toast('disconnected'); } else connect(); };
$('wmodal').onclick = (e) => { if (e.target.id === 'wmodal') $('wmodal').classList.remove('on'); };
function transferMessage(from, to, blockhash, lamports) {   // legacy SystemProgram.transfer message, built by hand
  const F = b58dec(from), T = b58dec(to), P = b58dec('11111111111111111111111111111111'), H = b58dec(blockhash);
  const data = new Uint8Array(12); new DataView(data.buffer).setUint32(0, 2, true); let v = BigInt(lamports); for (let i = 0; i < 8; i++) { data[4 + i] = Number(v & 255n); v >>= 8n; }
  return new Uint8Array([1, 0, 1, 3, ...F, ...T, ...P, ...H, 1, 2, 2, 0, 1, data.length, ...data]);
}
const needWallet = () => { if (!wallet) { connect(); return true; } return false; };

// ---------- ghost: a 32-byte key in this browser is the whole ghost ----------
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const rand32 = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const sha256hex = async (s) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
let gkey = ls.get('zt_ghost'); if (!/^[0-9a-f]{64}$/.test(gkey || '')) { gkey = rand32(); ls.set('zt_ghost', gkey); }
const gpost = (u, b) => post(u, Object.assign({ key: gkey }, b));

// ---------- router ----------
const VIEWS = ['home', 'coins', 'launch', 'vault', 'trace'];
function go(v, id, push = true) {
  if (v === 'coin') { coinId = id; loadCoin(); }
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.dataset.view === v));
  document.querySelectorAll('#links a[data-go]').forEach((a) => a.classList.toggle('on', a.dataset.go === v));
  if (push) history.pushState(null, '', v === 'coin' ? '/c/' + id : v === 'home' ? '/' : '/' + v); window.scrollTo(0, 0); $('links').classList.remove('open');
  if (v === 'vault') loadGhost(); if (v === 'launch') renderLaunch();
}
document.addEventListener('click', (e) => { const a = e.target.closest('[data-go]'); if (a) { e.preventDefault(); go(a.dataset.go); } });
function route() { const p = location.pathname; const m = /^\/c\/([A-Za-z0-9]+)$/.exec(p); if (m) return go('coin', m[1], false); const v = p.slice(1); go(VIEWS.includes(v) ? v : 'home', null, false); }
window.onpopstate = route;

// ---------- hero: dots that drift and fade, like footprints wearing off ----------
(function () { const cv = $('dots'), g = cv.getContext('2d'); let P = [], W = 0, H = 0; const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function size() { const r = devicePixelRatio || 1; W = cv.clientWidth; H = cv.clientHeight; cv.width = W * r; cv.height = H * r; g.setTransform(r, 0, 0, r, 0, 0); }
  size(); addEventListener('resize', size);
  function step() { if (P.length < 70 && Math.random() < .5) { const y = H * (.15 + Math.random() * .75); P.push({ x: W * (.55 + Math.random() * .4), y, vx: -.25 - Math.random() * .5, a: 1, r: 1 + Math.random() * 2.2 }); }
    g.clearRect(0, 0, W, H); const ink = getComputedStyle(document.body).color;
    for (const p of P) { p.x += p.vx; p.a -= .004; g.globalAlpha = Math.max(0, p.a) * .5; g.fillStyle = ink; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill(); }
    P = P.filter((p) => p.a > 0); g.globalAlpha = 1; if (!reduce) requestAnimationFrame(step); }
  step(); })();

// ---------- state ----------
async function loadState() { try { S = await api('/api/state'); } catch (e) { return; } renderAll(); }
async function loadAccount() { if (!wallet) return; const r = await api('/api/account', { wallet }); if (!r.error) A = r; renderAll(); }
async function loadGhost() { const r = await gpost('/api/g/account', {}); if (!r.error) GH = r; renderVault(); }
function renderAll() { if (!S) return; renderHome(); renderBoard(); renderVault(); renderLaunch(); if (coin) renderCoin(); }
function renderHome() { const p = S.protocol, P = S.params;
  $('fLaunch').textContent = p.launches; $('fStealth').textContent = p.stealth; $('fBlocked').textContent = p.blocked; $('fPool').textContent = big(S.pool.in); $('fFills').textContent = p.windowFills; $('fNotes').textContent = S.pool.notes - S.pool.spent; $('fVol').textContent = big(p.volume);
  $('pWin').textContent = P.WINDOW_SEC; $('pCap').textContent = P.WINDOW_CAP; $('pGuard').textContent = P.GUARD_SEC / 60; $('pMax').textContent = P.GUARD_MAX * 100; $('pCool').textContent = P.GUARD_COOLDOWN; $('pPass').textContent = P.PASS_MIN.toLocaleString('en-US');
  if (S.zeroMint) $('ca').textContent = S.zeroMint; }
$('cabar').onclick = () => { if (!S || !S.zeroMint) return; navigator.clipboard.writeText(S.zeroMint).then(() => toast('$ZERO address copied')); };
function stateOf(c) { if (c.window.open) return '<span class="pill live">sealed · ' + Math.max(0, Math.ceil((c.window.until - Date.now()) / 1000)) + 's</span>'; if (c.guarded) return '<span class="pill">guarded</span>'; return '<span class="pill" style="border-color:transparent">open</span>'; }
function renderBoard() {
  $('board').innerHTML = S.coins.length ? S.coins.map((c) => `<div class="li" data-coin="${c.id}"><span class="t"><b>$${esc(c.ticker)}</b> ${esc(c.name)}<span>${c.stealth ? 'stealth launch · ghost' : 'by ' + esc(c.creator)} · ${ago(c.ts)} ago</span></span><span class="r">${big(c.mcap)}</span><span class="r">${stateOf(c)}</span><span class="r hm">${big(c.volume)}</span><span class="r hm">${c.holders}</span></div>`).join('') : '<p class="note" style="padding:22px 0">No launches yet. <a href="/launch" data-go="launch" style="text-decoration:underline">Be the first, and leave no trace.</a></p>';
  document.querySelectorAll('[data-coin]').forEach((x) => x.onclick = () => go('coin', x.dataset.coin));
  const F = { launch: (e) => [`$${e.coin} launched`, e.stealth ? 'stealth' : 'wallet'], window: (e) => [`$${e.coin} window filled`, e.n + ' buyers, one price'], shield: (e) => [`${e.size} SOL note shielded`, 'vault'], claim: (e) => [`${e.size} SOL note claimed`, 'ghost'] };
  $('feed').innerHTML = S.feed.map((e) => { const f = F[e.type]; if (!f) return ''; const [a, b] = f(e); return `<div><span>${esc(a)}</span><i>${esc(b)} · ${ago(e.ts)}</i></div>`; }).join('') || '<p class="note">Quiet.</p>';
}

// ---------- coin ----------
async function loadCoin() { const r = await api('/api/coin/' + coinId); if (r.error) { $('cName').textContent = 'Not found'; return; } coin = r; renderCoin(); }
function chart(cv, pts) { const r = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return; cv.width = W * r; cv.height = H * r; const g = cv.getContext('2d'); g.scale(r, r); g.clearRect(0, 0, W, H);
  if (pts.length < 2) pts = pts.length ? [pts[0], [pts[0][0] + 1, pts[0][1]]] : []; if (!pts.length) return;
  let lo = Math.min(...pts.map((p) => p[1])), hi = Math.max(...pts.map((p) => p[1])); if (hi - lo < hi * 1e-6) { hi *= 1.01; lo *= .99; } const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
  const ink = getComputedStyle(document.body).color; g.strokeStyle = ink; g.lineWidth = 1.4; g.beginPath(); pts.forEach((p, i) => { const x = (p[0] - t0) / (t1 - t0 || 1) * (W - 4) + 2, y = H - 8 - (p[1] - lo) / (hi - lo) * (H - 16); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
function renderCoin() { const c = coin; if (!c) return;
  $('cMeta').textContent = (c.stealth ? 'Stealth launch · creator: ghost' : 'Launched by ' + c.creator) + ' · ' + ago(c.ts) + ' ago'; $('cName').innerHTML = '$' + esc(c.ticker) + ' <span class="it g">' + esc(c.name) + '</span>'; $('cDesc').textContent = c.desc || '';
  const w = c.window; let wb = '';
  if (w.open) wb = `<div class="box"><div class="eyebrow">Fair Window · sealed</div><div class="clock" id="wClock">${Math.max(0, Math.ceil((w.until - Date.now()) / 1000))}s</div><div class="meter"><i id="wMeter" style="width:0"></i></div><p class="note" style="margin-top:14px">${w.n} sealed bid${w.n === 1 ? '' : 's'}. Amounts stay hidden until close, then every bid fills at the same price. Cap ${S ? S.params.WINDOW_CAP : 2} SOL a buyer.</p></div>`;
  else if (w.price) wb = `<div class="box"><div class="eyebrow">Fair Window · closed</div><p style="margin-top:8px;font-size:18px">${w.n} buyers filled together at <b>${w.price.toExponential(3)}</b> SOL each. Same price, no first block.</p></div>`;
  else wb = '<div class="box"><div class="eyebrow">Fair Window · closed</div><p class="note" style="margin-top:8px">The window closed with no bids. Trading is open.</p></div>';
  $('winBox').innerHTML = wb + (c.guarded && !w.open ? `<p class="note" style="margin-top:12px">Guarded for ${Math.ceil((c.guardUntil - Date.now()) / 60000)} more min: ${S ? S.params.GUARD_MAX * 100 : 2}% max per holder, ${S ? S.params.GUARD_COOLDOWN : 3}s between trades.</p>` : '');
  $('cMcap').textContent = big(c.mcap); $('cVol').textContent = big(c.volume); $('cHold').textContent = c.holders;
  chart($('cChart'), c.curve || []);
  $('cTrades').innerHTML = (c.trades || []).map((t) => `<div><span>${t.side === 'window' ? 'window fill · ' + t.n + ' buyers' : t.side + ' · ' + (t.who || '').slice(0, 6)}</span><i class="${t.side === 'sell' ? 'dn' : 'up'}">${S4(t.sol)} · ${ago(t.ts)}</i></div>`).join('') || '<p class="note">No trades yet.</p>';
  const o = asWho === 'g' ? GH : A; const held = o && (o.coins.find((x) => x.id === c.id) || {}).qty;
  $('myBal').textContent = o ? S4(o.sol) : (asWho === 'w' ? 'connect' : '—'); $('myHold').textContent = held ? big(held) + ' $' + c.ticker : '—';
  $('amtLbl').textContent = side === 'buy' ? 'SOL' : '$' + c.ticker; $('trade').textContent = (side === 'buy' ? (w.open ? 'Place sealed bid' : 'Buy') : 'Sell') + (asWho === 'g' ? ' as ghost' : '');
  $('tradeNote').textContent = w.open && side === 'buy' ? 'Your SOL is escrowed now and fills at the window price.' : '';
}
setInterval(() => { if (!coin || !coin.window.open) return; const left = coin.window.until - Date.now(); if ($('wClock')) $('wClock').textContent = Math.max(0, Math.ceil(left / 1000)) + 's'; if ($('wMeter')) $('wMeter').style.width = (100 - Math.max(0, left) / ((S ? S.params.WINDOW_SEC : 60) * 10)) + '%'; if (left < -1500) { coin.window.open = false; Promise.all([loadGhost(), loadAccount()]).then(loadCoin); } }, 250);
document.querySelectorAll('#asWho button').forEach((b) => b.onclick = () => { asWho = b.dataset.as; document.querySelectorAll('#asWho button').forEach((x) => x.classList.toggle('on', x === b)); if (asWho === 'g') loadGhost().then(renderCoin); else renderCoin(); });
document.querySelectorAll('#side button').forEach((b) => b.onclick = () => { side = b.dataset.s; document.querySelectorAll('#side button').forEach((x) => x.classList.toggle('on', x === b)); renderCoin(); });
document.querySelectorAll('#slip button').forEach((b) => b.onclick = () => { slip = +b.dataset.v; document.querySelectorAll('#slip button').forEach((x) => x.classList.toggle('on', x === b)); });
$('trade').onclick = async () => { const c = coin; if (!c) return; const amt = +$('amt').value; if (!(amt > 0)) return toast('enter an amount', true);
  let minOut = 0; if (!c.window.open) { if (side === 'buy') { minOut = amt * (1 - S.params.TRADE_FEE) / c.price * (1 - slip) * .97; } else minOut = amt * c.price * (1 - S.params.TRADE_FEE) * (1 - slip) * .97; }
  const b = { id: c.id, amount: amt, minOut }; let r;
  if (asWho === 'g') r = await gpost('/api/g/' + side, b); else { if (needWallet()) return; r = await api('/api/' + side, Object.assign({ wallet }, b)); }
  if (r.error) return toast(r.error, true);
  toast(r.sealed ? 'sealed bid placed · fills when the window closes' : side === 'buy' ? 'bought ' + big(r.got) + ' $' + c.ticker : 'sold for ' + S4(r.sol));
  if (asWho === 'g') GH = r; else A = r; $('amt').value = ''; await loadCoin(); };

// ---------- launch ----------
document.querySelectorAll('#lFrom button').forEach((b) => b.onclick = () => { launchAs = b.dataset.as; document.querySelectorAll('#lFrom button').forEach((x) => x.classList.toggle('on', x === b)); renderLaunch(); });
function renderLaunch() { if (!S) return; const P = S.params; const fee = launchAs === 'w' && A && A.pass ? P.LAUNCH_FEE / 2 : P.LAUNCH_FEE;
  $('lFee').textContent = fee + ' SOL'; $('lShown').textContent = launchAs === 'g' ? 'ghost (no wallet)' : wallet ? short(wallet) : 'your wallet';
  $('lWin').textContent = P.WINDOW_SEC + 's sealed, one price'; $('lCap').textContent = P.WINDOW_CAP + ' SOL per buyer'; $('lGuard').textContent = P.GUARD_SEC / 60 + ' min · ' + P.GUARD_MAX * 100 + '% max · ' + P.GUARD_COOLDOWN + 's cooldown';
  const bal = launchAs === 'g' ? GH && GH.sol : A && A.sol; $('lNote').textContent = (launchAs === 'g' ? 'Ghost balance: ' : 'Wallet balance: ') + (bal == null ? '—' : S4(bal)); }
$('lGo').onclick = async () => { const b = { name: $('lName').value, ticker: $('lTicker').value, desc: $('lDesc').value }; let r;
  if (launchAs === 'g') r = await gpost('/api/g/launch', b); else { if (needWallet()) return; r = await api('/api/launch', Object.assign({ wallet }, b)); }
  if (r.error) return toast(r.error, true); toast('$' + r.coin.ticker + ' is live · Fair Window open'); $('lName').value = $('lTicker').value = $('lDesc').value = ''; await loadState(); go('coin', r.coin.id); };

// ---------- vault ----------
function renderVault() { if (!S) return; const P = S.params;
  $('vWal').textContent = A ? S4(A.sol) : wallet ? '…' : 'connect a wallet'; $('vPass').textContent = !S.zeroMint ? 'opens when $ZERO is live' : A ? (A.pass ? 'active · ' + big(A.zero) + ' $ZERO' : big(A.zero || 0) + ' / ' + big(P.PASS_MIN) + ' $ZERO') : '—';
  $('sizes').innerHTML = S.notes.map((n) => `<button data-n="${n}" class="${n === noteSize ? 'on' : ''}">${n} SOL</button>`).join(''); document.querySelectorAll('#sizes button').forEach((b) => b.onclick = () => { noteSize = +b.dataset.n; renderVault(); });
  const fee = A && A.pass ? 0 : noteSize * P.SHIELD_FEE; $('shieldInfo').textContent = `Costs ${+(noteSize + fee).toFixed(4)} SOL (${fee ? P.SHIELD_FEE * 100 + '% Vault fee' : 'no fee with your pass'}). Claimable after ${P.ANON_DELAY >= 60 ? P.ANON_DELAY / 60 + ' min' : P.ANON_DELAY + 's'} in the pool. ${S.pool.sets[noteSize]} unspent ${noteSize} SOL notes are in the pool right now.`;
  $('sets').innerHTML = S.notes.map((n) => `<div class="kv"><span>${n} SOL notes</span><span>${S.pool.sets[n]} unspent</span></div>`).join('');
  if (GH) { $('gId').textContent = GH.ghost; $('gBal').textContent = S4(GH.sol); $('gHold').innerHTML = GH.coins.map((x) => `<div class="kv"><span>$${esc(x.ticker)}</span><span>${big(x.qty)} · ${S4(x.value)}</span></div>`).join('') + (GH.queue || []).map((q) => `<div class="kv"><span>withdraw ${S4(q.amt)}</span><span>${q.status === 'paid' ? 'sent' : 'leaves ' + new Date(q.after).toLocaleTimeString()}</span></div>`).join(''); }
  $('gKey').textContent = gkey;
}
$('depGo').onclick = async () => { if (needWallet()) return; const amt = +$('depAmt').value; if (!(amt > 0)) return toast('enter SOL to deposit', true); if (!S.depositsOpen) return toast('deposits open at launch', true);
  const p = sol(); if (!p) return toast('connect Phantom', true);
  try { const it = await api('/api/deposit/intent', { wallet }); if (it.error) throw new Error(it.error); const msg = transferMessage(wallet, it.to, it.blockhash, Math.round(amt * 1e9));
    const r = await p.request({ method: 'signAndSendTransaction', params: { message: b58enc(msg) } }); const sig = r.signature; $('depNote').textContent = 'Sent. Waiting for Solana to confirm ' + sig.slice(0, 10) + '…';
    for (let i = 0; i < 20; i++) { await new Promise((z) => setTimeout(z, 3000)); const d = await api('/api/deposit', { wallet, tx: sig }); if (d.ok) { A = d; $('depNote').textContent = 'Credited ' + S4(d.amt) + '.'; toast('deposit credited'); return renderAll(); } if (!/not found/.test(d.error || '')) throw new Error(d.error); }
  } catch (e) { toast(errText(e), true); } };
$('shieldGo').onclick = async () => { if (needWallet()) return; const secret = rand32(); const note = 'zt-' + noteSize + '-' + secret; const commitment = await sha256hex('zt|' + noteSize + '|' + secret);
  const r = await api('/api/shield', { wallet, size: noteSize, commitment }); if (r.error) return toast(r.error, true); A = r;
  $('noteOut').innerHTML = `<div class="ghostbox" style="margin-top:20px"><div class="eyebrow">Your note · save it now</div><div class="secret">${note}</div><p class="note">This is the only copy. It isn't stored anywhere, not even by ZeroTrace. Claim it into any ghost after ${new Date(r.claimableAt).toLocaleTimeString()}.</p><div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn thin" id="nCopy">Copy note</button><button class="btn thin" id="nUse">Put it in the claim box</button></div></div>`;
  $('nCopy').onclick = () => navigator.clipboard.writeText(note).then(() => toast('note copied')); $('nUse').onclick = () => { $('noteIn').value = note; toast('pasted · claim it once it has mixed'); };
  toast('shielded ' + noteSize + ' SOL'); loadState(); };
$('claimGo').onclick = async () => { const r = await gpost('/api/claim', { note: $('noteIn').value }); if (r.error) return toast(r.error, true); GH = r; $('noteIn').value = ''; toast(r.size + ' SOL is in your ghost'); renderVault(); loadState(); };
$('wGo').onclick = async () => { const r = await gpost('/api/g/withdraw', { to: $('wTo').value.trim(), amount: +$('wAmt').value }); if (r.error) return toast(r.error, true); GH = r; toast('queued · leaves at ' + new Date(r.queued.after).toLocaleTimeString()); renderVault(); };
$('gCopy').onclick = () => navigator.clipboard.writeText(gkey).then(() => toast('ghost key copied'));
$('gImport').onclick = () => { const k = (prompt('Paste a ghost key (64 hex characters)') || '').trim().toLowerCase(); if (!/^[0-9a-f]{64}$/.test(k)) return toast('that is not a ghost key', true); gkey = k; ls.set('zt_ghost', k); loadGhost(); toast('ghost imported'); };
$('gNew').onclick = () => { if (GH && (GH.sol > 0 || GH.coins.length) && !confirm('This ghost still holds funds. Copy its key first. Start a new ghost?')) return; gkey = rand32(); ls.set('zt_ghost', gkey); loadGhost(); toast('new ghost'); };

// ---------- trace ----------
$('tGo').onclick = async () => { const a = $('tAddr').value.trim(); if (!isSolAddr(a)) return toast('paste a Solana address', true);
  $('tOut').innerHTML = '<p class="note">Reading Solana…</p>'; const r = await api('/api/trace?addr=' + a); if (r.error) { $('tOut').innerHTML = `<p class="note">${esc(r.error)}</p>`; return; }
  const d = (t) => t ? new Date(t * 1000).toLocaleDateString() : '—'; const verdict = r.score >= 70 ? 'Fully traced.' : r.score >= 40 ? 'Easy to follow.' : r.score >= 15 ? 'Partly visible.' : 'Barely there.';
  $('tOut').innerHTML = `<div class="two" style="margin-top:0"><div><div class="eyebrow">Exposure</div><div class="score">${r.score}</div><h2 style="font-weight:200;font-size:36px;margin-top:10px">${verdict}</h2>
    <div style="margin-top:26px">${r.signals.map((s) => `<div class="kv"><span>${esc(s.k)}</span><span>${s.v}</span></div>`).join('')}</div></div>
    <div><div class="kv"><span>Transactions</span><span>${r.txsCapped ? '200+' : r.txs}</span></div><div class="kv"><span>Balance</span><span>${S4(r.balance)}</span></div><div class="kv"><span>First seen</span><span>${d(r.first)}</span></div><div class="kv"><span>Last active</span><span>${d(r.last)}</span></div>
    <div class="kv"><span>Funded by</span><span class="mono">${r.funder ? short(r.funder) + ' · ' + S4(r.fundAmt) : r.txsCapped ? 'too deep to read' : 'not found'}</span></div><div class="kv"><span>SOL in / out (recent)</span><span>${fmt(r.inflow, 3)} / ${fmt(r.outflow, 3)}</span></div>
    <div class="eyebrow" style="margin-top:30px">Linked wallets (recent ${r.scanned} tx)</div><div class="peers">${r.peers.map((p) => `<div><span class="mono">${p.addr.slice(0, 6)}…${p.addr.slice(-6)}</span><span>${p.n}×</span></div>`).join('') || '<div><span class="note">none found</span></div>'}</div>
    <p class="note" style="margin-top:22px">Anyone can read all of this. To launch without it, use a ghost.</p></div></div>`; };

// ---------- theme ----------
$('themeBtn').onclick = (e) => { e.preventDefault(); const r = document.documentElement; const dark = r.dataset.theme ? r.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark ? 'light' : 'dark'; ls.set('zt_theme', r.dataset.theme); };
(function () { const t = ls.get('zt_theme'); if (t) document.documentElement.dataset.theme = t; })();

setConnected(); route(); loadState(); loadAccount(); loadGhost(); setInterval(() => { loadState(); if (coin && document.querySelector('[data-view=coin].on')) loadCoin(); }, 4000); setInterval(loadAccount, 20000);
