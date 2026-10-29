<div align="center">

# X402 Priceboard

[![CI](https://github.com/rustemmustafingovua-byte/x402-priceboard/actions/workflows/ci.yml/badge.svg)](https://github.com/rustemmustafingovua-byte/x402-priceboard/actions/workflows/ci.yml) [![license](https://img.shields.io/badge/license-MIT-8b949e?logo=opensourceinitiative)](./LICENSE)

</div>

**Every x402 server answers the first request with its price, network and payee. x402-priceboard asks a list of endpoints for those terms and shows a price board. Browsing the board does not pay anyone.**

The hosted server adds two paid routes on top of that free board. Agents pay per fresh probe. Sellers pay to be featured. USDC is settled by a facilitator into the wallet in `X402_PAY_TO`. This process never holds a key.

## Quick start

```bash
git clone https://github.com/rustemmustafingovua-byte/x402-priceboard
cd x402-priceboard && npm install
npx x402-priceboard https://api.venice.ai/api/v1/chat/completions
npx x402-priceboard --file endpoints.txt --markdown
npx x402-priceboard --file endpoints.txt --json
```

`endpoints.txt` is one URL per line. Blank lines and `#` comments are ignored.

```bash
npm test
npm start          # free board at http://127.0.0.1:8080/
```

`npm start` with no payment env vars still serves `/` and `GET /api/prices`. Paid routes return 503 until you configure them.

## Free and paid

| Route | Payment | What you get |
|---|---|---|
| `GET /` | Free | HTML board for `data/catalog.json`, plus active featured listings |
| `GET /api/prices` | Free | The same board as JSON |
| `GET /health` | Free | Whether payments are configured, and the payee if they are |
| `GET /discovery/resources` | Free | x402 discovery document for the paid routes |
| `GET /api/v1/probe?url=` | x402 | A fresh probe of one public http(s) URL |
| `POST /api/v1/featured` | x402 | Pin `{ "url", "title" }` on the free board |

Default prices are atomic units of a 6-decimal stablecoin: `10000` is $0.01 for a probe, `1000000` is $1.00 for a featured listing, which stays up for 168 hours. A probe that cannot reach the upstream is not settled. A featured listing is removed again if settlement fails.

The first paid call, with no `PAYMENT-SIGNATURE` header, is HTTP 402. The `PAYMENT-REQUIRED` header is base64 JSON (`x402Version` 2) whose `accepts[0].payTo` is `X402_PAY_TO`. The buyer retries the same request with `PAYMENT-SIGNATURE`. This server checks that the signed quote matches the payee, amount, asset and network, then `POST`s the facilitator `/verify` and, only after the work succeeds, `/settle`. The success response carries `PAYMENT-RESPONSE`.

`/api/v1/probe` refuses loopback, private, link-local and metadata addresses, and refuses a redirect that lands on one. It is not a general HTTP proxy.

## Configure

Copy `.env.example`. The variables that decide whether you can charge:

| Variable | Required to charge | Default |
|---|---|---|
| `X402_PAY_TO` | Yes | none |
| `X402_FACILITATOR_URL` | Yes | none |
| `X402_FACILITATOR_TOKEN` | Only if that facilitator demands a bearer token | none |
| `X402_NETWORK` | No | `eip155:8453` (Base) |
| `X402_ASSET` | Only for a network without a built-in USDC address | Base USDC, or Base Sepolia USDC when the network is `eip155:84532` |
| `X402_PROBE_AMOUNT` | No | `10000` |
| `X402_FEATURED_AMOUNT` | No | `1000000` |
| `X402_FEATURED_HOURS` | No | `168` |
| `X402_PUBLIC_URL` | No, but set it in production | the request's own host |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy | off |
| `CATALOG_PATH` | No | `data/catalog.json` |
| `FEATURED_PATH` | No | `data/featured.json` (Docker uses `/data/featured.json`) |

An invalid wallet, price or facilitator URL stops the process at startup. An empty wallet does not: the free board stays up and paid routes answer 503.

Edit `data/catalog.json` to choose which endpoints the free board polls. An entry is a URL string or `{"url":"https://…","method":"POST"}`. The Venice chat route is POST: GET returns 404 and POST returns the price. When a GET has no terms, the probe tries POST once. Featured listings are added only through the paid route.

## Start earning

Nothing in this repository moves funds. Revenue starts when a buyer settles into your wallet. Do this yourself:

1. Use a wallet you control on Base. Put its address in `X402_PAY_TO`. Do not commit it if you would rather keep the address out of shell history; it is public once the server is up, because buyers have to see the payee.
2. Pick a facilitator that can settle USDC on `eip155:8453`. Confirm with `GET {X402_FACILITATOR_URL}/supported` (or that facilitator's docs) that Base mainnet is listed. `https://x402.org/facilitator` is the public **testnet** facilitator (Base Sepolia and Solana devnet). It will not settle mainnet USDC, so it will not earn.
3. For a dry run with testnet USDC, and only a dry run: set `X402_NETWORK=eip155:84532`, `X402_FACILITATOR_URL=https://x402.org/facilitator`, and leave `X402_ASSET` unset (the server selects Sepolia USDC). Fund the buyer from a faucet. `/health` should report `"payments": true`. This does not produce revenue.
4. For mainnet, set `X402_FACILITATOR_URL` to a production facilitator that supports `eip155:8453` and the Base USDC asset `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. The [facilitator list](https://docs.x402.org/dev-tools/facilitators) is the index. If that facilitator authenticates resource servers, put the token in `X402_FACILITATOR_TOKEN` on the host, not in git.
5. Set `X402_PUBLIC_URL` to the origin buyers will call, with no trailing slash. Set prices with `X402_PROBE_AMOUNT` and `X402_FEATURED_AMOUNT` before the first buyer, if $0.01 and $1.00 are not the prices you want.
6. Deploy the image (below). Then:
   ```bash
   curl https://YOUR_HOST/health
   curl https://YOUR_HOST/discovery/resources
   ```
   `payments` must be `true` and `payTo` must be your wallet. Discovery must list `/api/v1/probe` at `10000` (or your amount) and `/api/v1/featured` at `1000000` (or your amount).
7. Pay once yourself with any x402 v2 client, against `GET /api/v1/probe?url=https://api.venice.ai/api/v1/chat/completions`. A 200 response includes `PAYMENT-RESPONSE`. The facilitator's transaction hash is the USDC transfer into `X402_PAY_TO`. This app never sees the USDC.
8. Point agents at `GET /discovery/resources`, or register that document with an x402 bazaar, so buyers can find the routes. Sellers who want the top of the free board call `POST /api/v1/featured` with `{"url":"https://their-endpoint","title":"Their name"}`.

Featured listings are stored in `FEATURED_PATH`. Mount a volume there (the Docker image uses `/data`) or a redeploy forgets them. The catalog file is in the image; change it by editing `data/catalog.json` and redeploying.

## Deploy

The container listens on `PORT` (8080). It does not deploy itself.

```bash
docker build -t x402-priceboard .
docker run --rm -p 8080:8080 --env-file .env -v x402-data:/data x402-priceboard
```

- **Fly**: `fly launch --no-deploy` (this uses `fly.toml`), `fly volumes create priceboard_data --size 1 --region iad`, `fly secrets set X402_PAY_TO=... X402_FACILITATOR_URL=... X402_PUBLIC_URL=https://...`, then `fly deploy`.
- **Render**: `render.yaml` is a Docker web service. Fill the secrets it marks `sync: false` in the dashboard, including `X402_PUBLIC_URL`.
- **GitHub Pages** (`.github/workflows/pages.yml`) publishes the static `docs/` site only. The live board is the container.

Give the host no cloud metadata role. The probe refuses private addresses, and a host that can read instance credentials is a worse place to run a URL fetcher.

## Development

Node 20 or newer. No runtime dependencies.

```bash
npm test
npm run lint
```

`LIVE=1 npm test` also probes `https://api.venice.ai/api/v1/chat/completions`. CI does not set `LIVE`.

GitHub Actions (`.github/workflows/ci.yml`) runs lint and the tests on Node 20, 22 and 24 for every push to `main` and every pull request. A `v*` tag runs the tests again and attaches an `npm pack` tarball to a GitHub release. Publishing to npmjs is not wired; that needs a token you add yourself.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). MIT © rustemmustafingovua-byte.
