import { test } from "node:test"
import assert from "node:assert/strict"
import { rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { recordHistory, loadHistory, formatHistory } from "../src/index.js"

test("prices are stored per endpoint per day", () => {
  const tmpFile = join(tmpdir(), `x402-history-test-${Date.now()}.json`)
  try {
    const rowsDay1 = [
      { url: "https://api.example.com/v1", amountUsd: 0.05, networkName: "Base", payTo: "0x123" },
      { url: "https://api.example.com/v2", amountUsd: 0.10, networkName: "Solana", payTo: "Sol999" },
    ]

    // Day 1 recording
    const store1 = recordHistory(rowsDay1, { filePath: tmpFile, date: "2026-10-01" })
    assert.equal(store1["https://api.example.com/v1"]["2026-10-01"].amountUsd, 0.05)
    assert.equal(store1["https://api.example.com/v2"]["2026-10-01"].amountUsd, 0.10)

    // Day 2 recording (same endpoint, price change 10x)
    const rowsDay2 = [
      { url: "https://api.example.com/v1", amountUsd: 0.50, networkName: "Base", payTo: "0x123" },
    ]
    const store2 = recordHistory(rowsDay2, { filePath: tmpFile, date: "2026-10-02" })
    assert.equal(store2["https://api.example.com/v1"]["2026-10-01"].amountUsd, 0.05)
    assert.equal(store2["https://api.example.com/v1"]["2026-10-02"].amountUsd, 0.50)

    // Verify persisted state from disk
    const diskStore = loadHistory(tmpFile)
    assert.equal(Object.keys(diskStore["https://api.example.com/v1"]).length, 2)
  } finally {
    if (existsSync(tmpFile)) rmSync(tmpFile, { force: true })
  }
})

test("formatHistory prints the chronological series", () => {
  const store = {
    "https://api.example.com/v1": {
      "2026-10-01": { date: "2026-10-01", amountUsd: 0.05, network: "Base" },
      "2026-10-02": { date: "2026-10-02", amountUsd: 0.50, network: "Base" },
    },
  }

  const output = formatHistory(store, ["https://api.example.com/v1"])
  assert.match(output, /History for https:\/\/api\.example\.com\/v1:/)
  assert.match(output, /2026-10-01\s+\$0\.05 USDC \(Base\)/)
  assert.match(output, /2026-10-02\s+\$0\.5 USDC \(Base\)/)
})

test("loadHistory returns empty object for nonexistent file", () => {
  const nonExistent = join(tmpdir(), "nonexistent-x402-history.json")
  const store = loadHistory(nonExistent)
  assert.deepEqual(store, {})
})
