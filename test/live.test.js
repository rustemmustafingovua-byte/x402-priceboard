// Integration test against the real service. Skipped unless LIVE=1.
//   LIVE=1 npm test
import { test } from "node:test"
import assert from "node:assert/strict"

const LIVE = process.env.LIVE === "1"
const skip = LIVE ? false : "set LIVE=1 to run the integration test"

import { board } from "../src/index.js"

test("reads the real price of an x402 endpoint", { skip }, async () => {
  const data = await board(
    [{ url: "https://api.venice.ai/api/v1/chat/completions", method: "POST" }],
    { method: "POST", body: {} },
  )
  assert.equal(data.results.length, 1)
  assert.ok(data.rows.length >= 1)
  assert.ok(data.rows.some((row) => row.networkName === "Base"))
  assert.ok(data.rows.some((row) => row.networkName === "Solana"))
  assert.ok(data.cheapest[0].amountUsd > 0)
})
