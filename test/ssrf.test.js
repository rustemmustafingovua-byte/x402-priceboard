import { test } from "node:test"
import assert from "node:assert/strict"
import { inspectUrl, isBlockedIp } from "../src/ssrf.js"

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }]

test("blocks loopback, link-local, private and mapped addresses", () => {
  assert.equal(isBlockedIp("127.0.0.1"), true)
  assert.equal(isBlockedIp("10.1.2.3"), true)
  assert.equal(isBlockedIp("169.254.169.254"), true)
  assert.equal(isBlockedIp("192.168.1.1"), true)
  assert.equal(isBlockedIp("::1"), true)
  assert.equal(isBlockedIp("::ffff:127.0.0.1"), true)
  assert.equal(isBlockedIp("8.8.8.8"), false)
})

test("rejects metadata addresses and accepts a public hostname", async () => {
  assert.equal((await inspectUrl("http://169.254.169.254/latest", publicLookup)).error, "blocked_address")
  assert.equal((await inspectUrl("http://127.0.0.1/", publicLookup)).error, "blocked_address")
  assert.equal((await inspectUrl("http://localhost/admin", publicLookup)).error, "blocked_host")
  assert.equal((await inspectUrl("file:///etc/passwd", publicLookup)).error, "unsupported_protocol")
  assert.equal((await inspectUrl("https://user:pass@example.com", publicLookup)).error, "credentials_in_url")
  const open = await inspectUrl("https://priced.example/v1", publicLookup)
  assert.equal(open.ok, true)
  assert.equal(open.url.href, "https://priced.example/v1")
})

test("rejects a hostname that resolves to a private address", async () => {
  const checked = await inspectUrl("https://rebind.example/x", async () => [{ address: "10.0.0.5", family: 4 }])
  assert.equal(checked.error, "blocked_address")
  const failed = await inspectUrl("https://missing.example", async () => {
    throw new Error("ENOTFOUND")
  })
  assert.equal(failed.error, "dns_failed")
})
