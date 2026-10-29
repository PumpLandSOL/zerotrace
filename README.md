# ZeroTrace · $ZERO

The privacy launchpad and anti-sniper suite on Solana. Shielded liquidity. Unlinked launches. Zero Trace. Zero Snipe.

- **Vault**: shield SOL into fixed-size notes (0.1 to 10 SOL); the pool keeps only commitments. Claim a note into a ghost with its secret; a nullifier stops double claims.
- **Ghosts**: accounts controlled by a 32-byte key kept in the browser. Launch, trade and withdraw (random 10 to 60 min delay) with no wallet attached.
- **Fair Window**: every launch opens sealed for 60s; bids are escrowed, capped at 2 SOL, and all fill at one clearing price.
- **Guard**: 10 minutes after the window, 2% max per holder and 3s between trades.
- **Trace scanner**: exposure score for any Solana address, read from RPC.
- **$ZERO pass**: 1M $ZERO shields fee-free and launches at half price.

## Run
```
node server/index.js          # PORT (default 8264)
node _studio/dev.js           # local dev: faucet on, short mixing time
```
Environment: `TREASURY` (Solana pubkey for deposits, env only), `ZERO_MINT`, `ADMIN_KEY`, `DATA_PATH`, `SOL_RPCS`.

## Test
```
PORT=8265 DEV_FAUCET=1 ANON_DELAY=3 WINDOW_SEC=6 GUARD_SEC=60 node server/index.js
API=http://localhost:8265 node _studio/e2e.cjs
```
Brand kit in `brand/` (`_studio/kit.cjs`, `_studio/videos.cjs`, `_studio/tweets.cjs`).
