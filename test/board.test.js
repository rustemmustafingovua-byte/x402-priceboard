import { test } from "node:test"
import assert from "node:assert/strict"
import { parseRequirements, toRow, cheapest, probe, toMarkdown } from "../src/index.js"

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
  const md = toMarkdown({ cheapest: toRow("https://x", req), free: [] })
  assert.match(md, /Base/)
  assert.match(md, /\$5 USDC/)
})
