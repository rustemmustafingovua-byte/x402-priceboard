# Security policy

## Reporting a vulnerability

Use **Security → Report a vulnerability** on GitHub. Please do not open a public
issue for a suspected flaw in the security-relevant code.

## What this service does with money

The server does not hold a private key, sign a transaction, or take custody of
USDC. A buyer signs an x402 payload. A facilitator you configure
(`X402_FACILITATOR_URL`) verifies it and submits it. Funds land in `X402_PAY_TO`.

- There is no default payee. Until that variable and a facilitator URL are set,
  paid routes return 503 and do not emit `PAYMENT-REQUIRED`.
- A payload whose payee, amount, asset or network differs from the quote is
  rejected before the facilitator is called.
- `/verify` runs before the probe or the listing is committed. `/settle` runs
  only after that work succeeds. A failed settlement deletes the listing it
  just created.
- Payment signatures and facilitator tokens are not written to the featured
  listing file and are not included in error responses. Do not log request
  headers yourself if you wrap the server.

You are trusting the facilitator to settle the quote you sent and not to mark
a payment valid when it is not. Pick one you are willing to rely on.

## What the probe will fetch

`/api/v1/probe` and featured URLs are caller input. The server refuses
non-http(s) URLs, URLs with embedded credentials, localhost names, and
addresses in loopback, private, link-local, CGNAT and metadata ranges. It
resolves hostnames and refuses the URL if any answer is in those ranges.
Redirects are checked the same way, one hop at a time.

`fetch` resolves DNS again when the connection opens. A name that changes
answer between the check and the connection can still be rebound. Run the
host without a cloud role or instance credentials so a rebinding fetch has
nothing useful to read. The CLI has no such guard: it only fetches URLs the
person at the keyboard passed.

Catalog URLs in `data/catalog.json` are the operator's. They are still
checked before a request so a redirect off the catalog cannot reach a
private address.

## Supported versions

| Version | Supported |
|---|---|
| 0.2.x | Yes |
| 0.1.x | No |
