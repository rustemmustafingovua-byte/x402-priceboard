import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createStore } from "../src/store.js"

test("listings expire and a removed listing is gone from disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "x402-store-"))
  const store = createStore(join(dir, "featured.json"))
  const created = await store.add({
    url: "https://seller.example/api",
    title: "Seller",
    payer: "0x2222222222222222222222222222222222222222",
    hours: 24,
    now: Date.parse("2026-10-29T00:00:00Z"),
  })
  assert.equal((await store.list(Date.parse("2026-10-29T12:00:00Z"))).length, 1)
  assert.equal((await store.list(Date.parse("2026-10-31T00:00:00Z"))).length, 0)
  await store.remove(created.id)
  const saved = JSON.parse(await readFile(join(dir, "featured.json"), "utf8"))
  assert.deepEqual(saved.listings, [])
  assert.equal(JSON.stringify(saved).includes("signature"), false)
})
