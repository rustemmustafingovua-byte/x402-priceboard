# Contributing

Thanks for helping make the price board accurate.

## Ground rules

- plain JavaScript, ESM, no build step
- no runtime dependencies unless the tool genuinely needs them
- every behaviour change comes with a test
- comments explain **why**, not **what**
- do not put a receiving wallet, facilitator token, or `.env` in a commit

## Getting set up

```bash
git clone https://github.com/rustemmustafingovua-byte/x402-priceboard.git
cd x402-priceboard
npm install
npm test
```

## Where things live

| Piece | File |
|---|---|
| Probe, rows, markdown | `src/index.js` |
| CLI | `src/cli.js`, `bin/x402-priceboard.js` |
| HTTP board and paid routes | `src/server.js` |
| x402 challenge, verify, settle | `src/payment.js` |
| Public-URL check | `src/ssrf.js` |
| Featured listings | `src/store.js` |
| Free catalog | `data/catalog.json` |

The free board only lists the catalog plus listings someone paid to feature.
A new public endpoint belongs in the catalog, not in a code change, unless
the network label table in `src/index.js` needs a name for it.

## Pull requests

1. open an issue first for anything larger than a fix
2. keep the diff focused
3. make sure `npm test` and `npm run lint` pass
4. describe what changes for the user, not how the code works

## Bounties

Issues labelled 💰 Reward can be funded by anyone with `/reward <amount>` (Opire) or
via [Algora](https://algora.io). The money is paid to the person whose PR gets
merged — never to the repo owner. That is the point: it buys contributors,
reviews and attention.
