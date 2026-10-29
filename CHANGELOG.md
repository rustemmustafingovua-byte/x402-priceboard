# Changelog

All notable changes to this project follow
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-10-29

### Added
- HTTP server: free HTML and JSON board, x402 v2 paid probe, paid featured listings, `/health` and `/discovery/resources`
- Receiving wallet and facilitator come from `X402_PAY_TO` and `X402_FACILITATOR_URL`. Paid routes stay off until both are set
- Dockerfile, Fly config and Render config
- CLI `--json`, `--timeout` and `--concurrency`

### Fixed
- Solana mainnet CAIP-2 id. The truncated id still maps to the Solana label
- Probes no longer treat HTTP 500 as a free endpoint, and no longer follow a redirect onto a private address
- Static docs page rendered its questions as source instead of HTML
- `--file` now fails when the file is missing

## [0.1.0] - 2026-10-20

### Added
- first release of `x402-priceboard`
- MIT licensed, CI on Node 20/22/24
