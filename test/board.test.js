import { test } from "node:test"
import assert from "node:assert/strict"
import { parseRequirements, toRow, cheapest, probe, board, toMarkdown, formatUsd, atomicToDecimal } from "../src/index.js"

const req = {
  x402Version: 2,
  accepts: [
    { scheme: "exact", network: "eip155:8453", amount: "5000000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0xabc" },
    { scheme: "exact", network: "solana:5eykt4UsFv8P8NJdTREY1vzqKqZKvdp", amount: "1000", payTo: "Sol111" },
  ],
}

test("parses the base64 header", () => {
  const b64 = Buffer.from(JSON.stringify(req)).toString("base64")
  assert.equal(parseRequirements(b64).accepts.length, 2)
  assert.equal(parseRequirements(null), null)
})

test("normalises options into rows", () => {
  const rows = toRow("https://x", req)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].amountUsd, 5)
  assert.equal(rows[0].networkName, "Base")
})

test("picks the cheapest option per endpoint", () => {
  const rows = toRow("https://x", req)
  assert.equal(cheapest(rows)[0].amountUsd, 0.001)
})

test("probing a 402 endpoint yields the price without paying", async () => {
  const fake = async () => ({
    status: 402,
    headers: { get: () => Buffer.from(JSON.stringify(req)).toString("base64") },
    text: async () => "",
  })
  const p = await probe("https://x", { fetchImpl: fake })
  assert.equal(p.status, 402)
  assert.equal(p.requirements.accepts.length, 2)
})

test("renders markdown", () => {
  const rows = toRow("https://x", req)
  assert.equal(rows[1].networkName, "Solana")
  const md = toMarkdown({ cheapest: rows, free: [] })
  assert.match(md, /Base/)
  assert.match(md, /\$5 USDC/)
  assert.match(md, /\$0\.001 USDC/)
})

test("parses a raw JSON header and honours decimals", () => {
  const header = JSON.stringify({
    accepts: [{ network: "eip155:1", amount: "1500000000000000000", extra: { decimals: 18 }, payTo: "0xabc", scheme: "exact" }],
  })
  const rows = toRow("https://x", parseRequirements(header))
  assert.equal(rows[0].amountUsd, 1.5)
  assert.equal(rows[0].networkName, "Ethereum")
  assert.equal(atomicToDecimal("2500000", 6), 2.5)
  assert.equal(formatUsd(5), "$5")
})

test("reads v1 maxAmountRequired", () => {
  const rows = toRow("https://x", { accepts: [{ network: "eip155:8453", maxAmountRequired: "2500000", payTo: "0xabc" }] })
  assert.equal(rows[0].amountUsd, 2.5)
})

test("escapes markdown cells", () => {
  const md = toMarkdown({
    cheapest: [{ url: "https://x/a|b", networkName: "Base", amountUsd: 1, payTo: "0x`abc" }],
    free: [],
  })
  assert.match(md, /a\\\|b/)
  assert.doesNotMatch(md, /`0x`abc`/)
})

test("a 200 is free and a 500 is not a price", async () => {
  const fetchImpl = async (url) => ({
    status: String(url).includes("nope") ? 500 : 200,
    headers: { get: () => null },
    text: async () => "no",
    body: { cancel: async () => {} },
  })
  const data = await board(["https://ok.example", "https://nope.example"], { fetchImpl, concurrency: 1 })
  assert.equal(data.free.length, 1)
  assert.equal(data.free[0].url, "https://ok.example")
  assert.equal(data.misses.length, 1)
  assert.equal(data.cheapest.length, 0)
})

test("follows a redirect and stops when the guard rejects the next hop", async () => {
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(String(url))
    if (String(url).includes("start")) {
      return {
        status: 302,
        headers: { get: (name) => (name === "location" ? "https://final.example/secret" : null) },
        body: { cancel: async () => {} },
      }
    }
    return {
      status: 402,
      headers: { get: () => Buffer.from(JSON.stringify(req)).toString("base64") },
      body: { cancel: async () => {} },
    }
  }
  const open = await probe("https://start.example/a", { fetchImpl })
  assert.equal(open.status, 402)
  assert.equal(open.url, "https://start.example/a")
  assert.equal(open.finalUrl, "https://final.example/secret")

  const before = seen.length
  const blocked = await probe("https://start.example/a", {
    fetchImpl,
    guard: async (target) => (String(target).includes("final") ? { ok: false, error: "blocked_address" } : { ok: true }),
  })
  assert.equal(blocked.error, "blocked_address")
  assert.ok(seen.slice(before).every((url) => !url.includes("final")))
})

test("labels the bare solana network name and retries POST when GET has no terms", async () => {
  const calls = []
  const posted = {
    accepts: [{ scheme: "exact", network: "solana", amount: "10000000", payTo: "SolPayee111111111111111111111111111111" }],
  }
  const fetchImpl = async (url, init) => {
    calls.push(init.method)
    if (init.method === "GET") {
      return { status: 404, headers: { get: () => null }, text: async () => "no", body: { cancel: async () => {} } }
    }
    return {
      status: 402,
      headers: { get: (name) => (name === "payment-required" ? Buffer.from(JSON.stringify(posted)).toString("base64") : null) },
      body: { cancel: async () => {} },
    }
  }
  const data = await board(
    [{ url: "https://chat.example/v1", method: "POST" }],
    { fetchImpl },
  )
  assert.deepEqual(calls, ["POST"])
  assert.equal(data.rows[0].networkName, "Solana")
  assert.equal(data.rows[0].amountUsd, 10)

  const retried = await probe("https://chat.example/v1", { fetchImpl, retryPost: true })
  assert.equal(retried.status, 402)
  assert.equal(retried.method, "POST")
  assert.ok(calls.filter((method) => method === "POST").length >= 2)
})

test("a 402 with no terms is a miss, not a free endpoint", async () => {
  const fetchImpl = async () => ({ status: 402, headers: { get: () => "" }, body: { cancel: async () => {} } })
  const data = await board(["https://x"], { fetchImpl })
  assert.equal(data.misses.length, 1)
  assert.match(toMarkdown(data), /No price returned/)
})
