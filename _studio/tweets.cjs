// ZeroTrace X kit: tweets checked against X's weighted length (URLs = 23, emoji = 2), written into X-KIT.md
'use strict';
const fs = require('fs'), path = require('path');
const len = (t) => [...t.replace(/https?:\/\/\S+|\b[a-z0-9-]+\.(xyz|fun|com|io)(\/\S*)?/gi, 'x'.repeat(23))].reduce((a, ch) => a + (ch.codePointAt(0) > 0x2fff ? 2 : 1), 0);
const BIO = 'The Privacy Launchpad & Anti-Sniper Suite on Solana. Shielded liquidity. Unlinked launches. Zero Trace. Zero Snipe. 🛡️';
const T = [
  ['Pinned', 'zerotrace-hype-15s.mp4', `Every launch on Solana is watched, tracked, and sniped. ZeroTrace ($ZERO) fixes this.

Stealth tools, anti-MEV protection and private launch infrastructure, so retail wins and bots lose.

$ZERO is your pass to the private side of Solana 👇`],
  ['Fair Window (video)', 'zerotrace-window-16s.mp4', `Snipers win because they're first.

On ZeroTrace there is no first. Every launch opens with a 60 second sealed window: bids are hidden, capped at 2 SOL, and all fill at one price.

Block zero is worth nothing.

$ZERO`],
  ['Vault (video)', 'zerotrace-vault-16s.mp4', `Your deployer wallet is funded from somewhere. That somewhere is public.

ZeroTrace Vault: shield SOL into a fixed-size note, claim it into a ghost, launch from the ghost.

The coin shows "creator: ghost". No wallet attached.

$ZERO`],
  ['Problem', 'zerotrace-g01-watched.png', `Your wallet → your deployer → your coin → the snipers already in.

Anyone can follow that line on Solana in about 30 seconds.

ZeroTrace cuts it.

$ZERO`],
  ['How the Vault works', 'zerotrace-g02-vault.png', `How a $ZERO stealth launch works:

1. Shield 0.1 to 10 SOL into a note
2. It sits in a pool of identical notes
3. Claim it into a ghost with the secret
4. Launch from the ghost

The pool keeps hashes, never wallets.`],
  ['Fair Window', 'zerotrace-g03-window.png', `60 seconds. One price.

Bid in second 1 or second 59, you pay exactly the same. Amounts stay sealed until close, every buyer is capped, nobody can sell.

That's how every ZeroTrace launch starts.

$ZERO`],
  ['Guard', 'zerotrace-g04-guard.png', `After the Fair Window, the guard goes up for 10 minutes:

2% max supply per holder
3 seconds between trades
Every refused snipe counted in public

Bundlers and sniper loops hit a wall. Retail doesn't.

$ZERO`],
  ['Trace scanner', 'zerotrace-g05-trace.png', `What does your wallet give away?

The ZeroTrace scanner reads any Solana address and shows what a sniper sees: who funded it, who it trades with, an exposure score out of 100.

Scan your deployer before you launch from it.

$ZERO`],
  ['vs every launchpad', 'zerotrace-g06-vs.png', `Every other launchpad:
creator public, block 0 sniped, fastest bot gets the best price

ZeroTrace:
creator is a ghost, block 0 sealed, everyone gets one price

$ZERO`],
  ['$ZERO pass', 'zerotrace-g07-pass.png', `What $ZERO does:

Hold 1M and every note you shield skips the Vault fee.
Wallet launches cost you half.
Fees fund the next privacy and anti-MEV tools.

Your pass to the private side of Solana.`],
  ['Keyart', 'zerotrace-keyart.png', `Launch without a trace.

Unlinked launches. Sealed Fair Windows. Anti-snipe guard. Shielded liquidity.

ZeroTrace. Zero Trace. Zero Snipe.

$ZERO`],
];
let out = `# ZeroTrace X kit

**Name:** ZeroTrace | $ZERO

## Display name
\`\`\`
ZeroTrace | $ZERO
\`\`\`

## Bio (${len(BIO)}/160)
\`\`\`
${BIO}
\`\`\`

## Profile images
- Avatar: \`zerotrace-pfp.png\`
- Header: \`zerotrace-banner.png\`

## Tweets (all ≤245, X-weighted)
`;
T.forEach(([title, media, t], i) => { const n = len(t); if (n > 245) throw new Error(title + ' is ' + n); out += `\n### ${i + 1}. ${title} · ${n} chars · media: \`${media}\`\n\`\`\`\n${t}\n\`\`\`\n`; console.log(String(n).padStart(3), title); });
fs.writeFileSync(path.join(__dirname, '..', 'brand', 'X-KIT.md'), out);
