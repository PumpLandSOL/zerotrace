// ZeroTrace videos (animated, frame-exact): hype, Fair Window, Vault.  node _studio/videos.cjs [hype|window|vault]
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process'), { open, sleep } = require('./cdp.cjs');
const B = path.join(__dirname, '..', 'brand'), K = path.join(__dirname, 'kit'), FPS = 30, url = (f) => 'file:///' + f.split(path.sep).join('/');
const MARK = (s, c = '#111113') => `<svg width="${40 * s}" height="${40 * s}" viewBox="0 0 40 40" fill="none"><path d="M20 4a16 16 0 1 1-15.4 11.6" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/><circle cx="6.6" cy="10.6" r="1.5" fill="${c}" opacity=".55"/><circle cx="9.6" cy="7" r="1.2" fill="${c}" opacity=".35"/><circle cx="13.6" cy="4.9" r=".9" fill="${c}" opacity=".18"/><path d="M11 30 29 10" stroke="${c}" stroke-width="2.6" stroke-linecap="round"/></svg>`;
const HEAD = `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200;300;400;600&family=Newsreader:ital,opsz,wght@1,6..72,300&display=swap" rel="stylesheet"><style>
*{margin:0;padding:0;box-sizing:border-box}body{width:1920px;height:1080px;background:#f5f5f2;color:#111113;overflow:hidden;position:relative;font:300 32px Manrope}
.s{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;opacity:0}.h{font-weight:200;letter-spacing:-.045em;line-height:.95}
.it{font-family:Newsreader;font-style:italic;font-weight:300}.g{color:#b9b9b3}.i2{color:#55555a}.eb{font-size:26px;letter-spacing:.06em;color:#a2a29c}.mono{font-family:ui-monospace,Menlo,Consolas,monospace}
.box{border:1px solid #e2e2dc;border-radius:8px;padding:30px 36px;text-align:left}.dk{background:#111113;color:#f5f5f2;border-color:#111113}#cv{position:absolute;inset:0}</style></head><body><canvas id="cv" width="1920" height="1080"></canvas>`;
const JS = `const $=(i)=>document.getElementById(i),cl=(x)=>Math.max(0,Math.min(1,x)),e=(x)=>1-Math.pow(1-cl(x),3),win=(t,a,b,f=.4)=>cl(Math.min((t-a)/f,(b-t)/f));
const R=(a)=>{let x=a;return()=>(x=(x*16807)%2147483647)/2147483647};const show=(id,t,a,b,f)=>{const o=win(t,a,b,f);$(id).style.opacity=o;$(id).style.filter='blur('+((1-o)*10).toFixed(1)+'px)';};`;
const END = (h) => `<div class="s" id="z">${MARK(4)}<div class="h" style="font-size:150px;margin-top:40px">${h}</div><div style="font-size:34px;font-weight:600;margin-top:44px;letter-spacing:.04em">$ZERO · ZeroTrace</div></div>`;
async function render(c, name, html, dur) { const FR = path.join(__dirname, 'frames-' + name); fs.rmSync(FR, { recursive: true, force: true }); fs.mkdirSync(FR); fs.mkdirSync(K, { recursive: true });
  const f = path.join(K, name + '.html'); fs.writeFileSync(f, html);
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }); await c.send('Page.navigate', { url: url(f) }); await sleep(3000); await c.ev('document.fonts.ready.then(()=>1)');
  const N = Math.round(dur * FPS); for (let i = 0; i < N; i++) { await c.ev('__seek(' + (i / FPS).toFixed(4) + ')'); await c.shot(path.join(FR, 'f_' + String(i).padStart(4, '0') + '.jpg'), 'jpeg'); }
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(FR, 'f_%04d.jpg'), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', path.join(B, name + '.mp4')]);
  fs.rmSync(FR, { recursive: true, force: true }); console.log('OK', name + '.mp4'); }

// footprints that wear off: dots drift left and fade (drawn on the canvas, deterministic per t)
const TRAIL = `function trail(t,amt,x0){const g=$('cv').getContext('2d');g.clearRect(0,0,1920,1080);if(amt<=0)return;const r=R(11);for(let i=0;i<160;i++){const born=r()*16,y=140+r()*800,sp=60+r()*140,sz=2+r()*5,age=t-born;if(age<0)continue;const x=(x0||1900)-age*sp;const a=Math.max(0,1-age/6)*amt;if(a<=0||x<0)continue;g.globalAlpha=a*.55;g.fillStyle='#111113';g.beginPath();g.arc(x,y,sz,0,7);g.fill();}g.globalAlpha=1;}`;

async function hype(c) {
  const html = HEAD + `<div class="s" id="a"><div class="eb">Solana, today</div><div class="h" style="font-size:150px;margin-top:30px">Every launch<br>is <span class="it">watched.</span></div></div>
  <div class="s" id="b"><div style="display:flex;gap:30px;align-items:center;font-size:34px">${['your wallet', 'deployer', '$COIN', 'snipers'].map((x, i) => `<div class="box ${i === 3 ? 'dk' : ''}" id="b${i}" style="opacity:0">${x}</div>${i < 3 ? `<div class="g" id="ba${i}" style="opacity:0;font-size:46px">→</div>` : ''}`).join('')}</div><div class="i2" style="margin-top:60px;font-size:34px">Tracked. Front-run. Sniped in block zero.</div></div>
  <div class="s" id="c">${MARK(4.5)}<div class="h" style="font-size:180px;margin-top:40px">ZeroTrace</div></div>
  <div class="s" id="d"><div style="display:grid;gap:34px;text-align:left">${[['Unlinked launches', 'launch from a ghost, no wallet attached'], ['The Fair Window', '60 sealed seconds, one price for everyone'], ['The guard', '2% max per holder, 3s between trades'], ['Shielded liquidity', 'fixed-size notes, claimed anywhere']].map(([a, b], i) => `<div id="d${i}" style="opacity:0;display:flex;gap:40px;align-items:baseline"><span class="g" style="font-size:28px;width:50px">0${i + 1}</span><span style="font-size:64px;font-weight:200;letter-spacing:-.03em;width:640px">${a}</span><span class="i2" style="font-size:30px">${b}</span></div>`).join('')}</div></div>
  ${END('Zero Trace.<br><span class="it">Zero Snipe.</span>')}
  <script>${JS}${TRAIL}window.__seek=(t)=>{trail(t,t<11?1:cl((12.5-t)/1.5));show('a',t,0,3);
  show('b',t,3,6.2);for(let i=0;i<4;i++){$('b'+i).style.opacity=cl((t-3.3-i*.45)/.3);if(i<3)$('ba'+i).style.opacity=cl((t-3.5-i*.45)/.3);}
  show('c',t,6.2,8.4);$('c').style.transform='scale('+(1.06-.06*e((t-6.2)/1))+')';
  show('d',t,8.4,12.4);for(let i=0;i<4;i++)$('d'+i).style.opacity=cl((t-8.6-i*.5)/.35);
  $('z').style.opacity=cl((t-12.4)/.5);$('z').style.filter='blur('+((1-cl((t-12.4)/.5))*10).toFixed(1)+'px)';};</script></body></html>`;
  await render(c, 'zerotrace-hype-15s', html, 15); }

async function windowVid(c) {   // a 60s window compressed to 6s: bids land at different times, then all collapse to one price
  const B = [[.04, 2], [.14, .5], [.27, 1.2], [.38, .3], [.52, 2], [.63, .8], [.77, 1.5], [.9, .4], [.97, 1]];
  const html = HEAD + `<div class="s" id="a"><div class="eb">Every launch on ZeroTrace opens with</div><div class="h" style="font-size:170px;margin-top:30px">The <span class="it">Fair Window.</span></div></div>
  <div class="s" id="b" style="justify-content:flex-start;padding-top:150px"><div class="eb">Sealed</div><div class="h" id="clk" style="font-size:200px;margin-top:10px">60s</div>
    <div style="position:relative;width:1500px;height:260px;margin-top:40px"><div style="position:absolute;left:0;right:0;top:130px;height:2px;background:#d9d9d3"></div><div id="bar" style="position:absolute;left:0;top:130px;height:2px;background:#111113;width:0"></div>
    ${B.map(([p, s], i) => `<div id="k${i}" style="position:absolute;left:${p * 100}%;top:${130 - 10 - s * 22}px;width:${20 + s * 44}px;height:${20 + s * 44}px;border-radius:50%;border:2px solid #111113;transform:translate(-50%,0);opacity:0;background:#f5f5f2"></div>`).join('')}
    <div id="one" style="position:absolute;left:0;right:0;top:40px;height:2px;background:#111113;opacity:0"></div></div>
    <div id="cap1" class="i2" style="font-size:34px;margin-top:20px">${B.length} bids · amounts hidden · 2 SOL cap each</div><div id="cap2" style="font-size:40px;margin-top:-44px;opacity:0;font-weight:600">All ${B.length} fill at one price. No first block.</div></div>
  <div class="s" id="c"><div style="display:flex;gap:120px">${[['2%', 'max per holder'], ['3s', 'between trades'], ['10 min', 'guarded']].map(([a, b]) => `<div><div class="h" style="font-size:190px">${a}</div><div class="i2" style="font-size:32px;margin-top:10px">${b}</div></div>`).join('')}</div><div class="eb" style="margin-top:70px">Then the guard goes up</div></div>
  ${END('Snipers get<br><span class="it">the same price.</span>')}
  <script>${JS}window.__seek=(t)=>{show('a',t,0,2.6);show('b',t,2.6,10.4);
  const w=cl((t-3)/5.5);$('clk').textContent=Math.ceil(60*(1-w))+'s';$('bar').style.width=(w*100)+'%';const close=cl((t-8.6)/.9);
  ${JSON.stringify(B)}.forEach(([p,s],i)=>{const k=$('k'+i),on=w>=p;k.style.opacity=on?1:0;const y=(130-10-s*22)*(1-close)+(40-(20+s*44)/2)*close;k.style.top=y+'px';k.style.background=close>0?'#111113':'#f5f5f2';});
  $('one').style.opacity=close;$('cap1').style.opacity=1-close;$('cap2').style.opacity=close;$('clk').textContent=close>0?'One price.':$('clk').textContent;$('clk').style.fontSize=close>0?'150px':'200px';
  show('c',t,10.4,13);$('z').style.opacity=cl((t-13)/.5);$('z').style.filter='blur('+((1-cl((t-13)/.5))*10).toFixed(1)+'px)';};</script></body></html>`;
  await render(c, 'zerotrace-window-16s', html, 16); }

async function vault(c) {
  const html = HEAD + `<div class="s" id="a"><div class="eb">The Vault</div><div class="h" style="font-size:160px;margin-top:30px">Shield it.<br><span class="it">Claim it somewhere else.</span></div></div>
  <div class="s" id="b"><div style="display:flex;gap:40px;align-items:center">
    <div class="box" id="w" style="width:300px"><div style="font-weight:600">Wallet</div><div class="g" style="font-size:24px;margin-top:6px">shields 1 SOL</div></div><div class="g" style="font-size:50px" id="ar1">→</div>
    <div style="border:1px dashed #b9b9b3;border-radius:8px;padding:28px;width:560px;text-align:left"><div style="font-weight:600">Pool</div><div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:16px">${Array.from({ length: 15 }, (_, i) => `<span id="n${i}" style="border:1px solid #d9d9d3;border-radius:99px;padding:5px 14px;font-size:22px;color:#b9b9b3;opacity:0">1 SOL</span>`).join('')}</div></div><div class="g" style="font-size:50px" id="ar2">→</div>
    <div class="box" id="gh" style="width:300px;border-style:dashed;border-color:#111113"><div style="font-weight:600">Ghost</div><div class="g" style="font-size:24px;margin-top:6px">no wallet attached</div></div></div>
    <div class="i2" id="bc" style="margin-top:60px;font-size:32px">Every 1 SOL note looks the same. Which one was yours?</div></div>
  <div class="s" id="c"><div class="box dk" style="width:900px;padding:50px 60px"><div style="font-size:26px;opacity:.55">Stealth launch</div><div class="h" style="font-size:120px;margin-top:14px">$HUSH</div><div style="display:flex;justify-content:space-between;margin-top:30px;font-size:30px"><span style="opacity:.55">creator</span><span>ghost</span></div><div style="display:flex;justify-content:space-between;margin-top:12px;font-size:30px"><span style="opacity:.55">wallet</span><span>none</span></div></div></div>
  ${END('Launch<br>without a <span class="it">trace.</span>')}
  <script>${JS}window.__seek=(t)=>{show('a',t,0,2.8);show('b',t,2.8,10);
  for(let i=0;i<15;i++){const n=$('n'+i);n.style.opacity=cl((t-3.6-i*.22)/.3);const mine=i===6;n.style.borderColor=mine&&t<7.4?'#111113':'#d9d9d3';n.style.color=mine&&t<7.4?'#111113':'#b9b9b3';}
  $('w').style.opacity=1-cl((t-6.6)/.8)*.75;$('gh').style.opacity=.25+cl((t-7.6)/.6)*.75;$('gh').style.background=t>7.8?'#111113':'transparent';$('gh').style.color=t>7.8?'#f5f5f2':'#111113';
  show('c',t,10,13);$('c').style.transform='scale('+(1.05-.05*e((t-10)/1))+')';$('z').style.opacity=cl((t-13)/.5);$('z').style.filter='blur('+((1-cl((t-13)/.5))*10).toFixed(1)+'px)';};</script></body></html>`;
  await render(c, 'zerotrace-vault-16s', html, 16); }

(async () => { const only = process.argv[2]; const c = await open('about:blank', 1920, 1080, 9500 + Math.floor(Math.random() * 90));
  if (!only || only === 'hype') await hype(c); if (!only || only === 'window') await windowVid(c); if (!only || only === 'vault') await vault(c); c.close(); process.exit(0); })();
