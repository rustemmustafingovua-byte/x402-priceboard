# Contributing

Thanks for helping make agent setups work.

## Ground rules

- plain JavaScript, ESM, no build step
- no runtime dependencies unless the tool genuinely needs them
- every behaviour change comes with a test
- comments explain **why**, not **what**

## Getting set up

```bash
git clone https://github.com/rustemmustafingovua-byte/x402-priceboard.git
cd x402-priceboard
npm install
npm test
```

## Adding a provider / source / rule

Most of these tools are one declarative file plus a router:

| Tool | Where the data lives |
|---|---|
| opencode-free-stack | `src/providers.js` |
| free-web-mcp | `src/index.js` (one function per source) |
| agent-x402 | `src/x402.js` (protocol) + `src/policy.js` (limits) |
| prompt-injection-guard | `PATTERNS` in `src/index.js` |
| readme-doctor | `CHECKS` in `src/index.js` |

Adding an entry should not require touching any other file.

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
