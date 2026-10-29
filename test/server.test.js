import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createServer as createHttpServer } from "node:http"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "../src/server.js"
import { paymentConfig } from "../src/payment.js"

const WALLET = "0x1111111111111111111111111111111111111111"
const TERMS = {
  x402Version: 2,
  accepts: [{
    scheme: "exact",
    network: "eip155:8453",
    amount: "5000000",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    payTo: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  }],
}
const TERMS_HEADER = Buffer.from(JSON.stringify(TERMS)).toString("base64")

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject)
      resolve(server.address().port)
    })
  })
}

function close(server) {
  if (!server) return Promise.resolve()
  return new Promise((resolve) => server.close(() => resolve()))
}

function upstream() {
  const seen = []
  const fetchImpl = async (url) => {
    const target = String(url)
    seen.push(target)
    if (target.includes("redirect.example")) {
      return {
        status: 302,
        headers: { get: (name) => (name === "location" ? "http://127.0.0.1/secret" : null) },
        body: { cancel: async () => {} },
        text: async () => "",
      }
    }
    if (target.includes("down.example")) throw new Error("connect ECONNREFUSED")
    if (target.includes("free.example")) {
      return { status: 200, headers: { get: () => null }, text: async () => "ok", body: { cancel: async () => {} } }
    }
    return {
      status: 402,
      headers: { get: (name) => (name === "payment-required" ? TERMS_HEADER : null) },
      text: async () => "",
      body: { cancel: async () => {} },
    }
  }
  return { fetchImpl, seen }
}

function lookupFor(host) {
  if (host === "rebind.example") return [{ address: "10.1.2.3", family: 4 }]
  return [{ address: "93.184.216.34", family: 4 }]
}

async function startFacilitator(behavior = {}) {
  const calls = []
  const server = createHttpServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
    calls.push({ path: req.url, body })
    res.writeHead(200, { "content-type": "application/json" })
    if (req.url.endsWith("/verify")) {
      const valid = body.paymentPayload?.payload?.signature === "valid"
      res.end(JSON.stringify(valid
        ? { isValid: true, payer: "0x2222222222222222222222222222222222222222" }
        : { isValid: false, invalidReason: "invalid_exact_evm_payload_signature" }))
      return
    }
    if (behavior.settleFail) {
      res.end(JSON.stringify({ success: false, errorReason: "insufficient_funds", transaction: "", network: body.paymentRequirements?.network }))
      return
    }
    res.end(JSON.stringify({
      success: true,
      transaction: "0xtx",
      network: body.paymentRequirements?.network,
      payer: "0x2222222222222222222222222222222222222222",
    }))
  })
  const port = await listen(server)
  return { server, calls, url: `http://127.0.0.1:${port}` }
}

async function startApp(extra = {}) {
  const facilitator = extra.facilitator === null ? null : await startFacilitator(extra.facilitator || {})
  const dir = await mkdtemp(join(tmpdir(), "x402-server-"))
  const { fetchImpl, seen } = upstream()
  const env = {
    X402_PAY_TO: extra.payTo === undefined ? WALLET : extra.payTo,
    X402_FACILITATOR_URL: facilitator ? facilitator.url : "",
    X402_PROBE_AMOUNT: "10000",
    X402_FEATURED_AMOUNT: "1000000",
    X402_FEATURED_HOURS: "24",
    X402_PUBLIC_URL: "https://board.example",
  }
  const config = paymentConfig(env)
  const server = createServer({
    env,
    config,
    fetchImpl: extra.fetchImpl || fetchImpl,
    lookup: async (host) => lookupFor(host),
    catalog: extra.catalog || ["https://priced.example/v1", "https://free.example/health"],
    featuredPath: join(dir, "featured.json"),
    rateLimit: extra.rateLimit ?? 1000,
    cacheTtlMs: 0,
  })
  const port = await listen(server)
  return {
    server,
    facilitator,
    seen,
    dir,
    url: `http://127.0.0.1:${port}`,
    config,
    async stop() {
      await close(server)
      await close(facilitator?.server)
    },
  }
}

async function pay(url, init = {}) {
  const first = await fetch(url, init)
  assert.equal(first.status, 402)
  await first.arrayBuffer()
  const required = JSON.parse(Buffer.from(first.headers.get("payment-required"), "base64").toString("utf8"))
  assert.equal(required.accepts[0].payTo, WALLET)
  assert.notEqual(required.accepts[0].payTo.toLowerCase(), "0x8ac6a229f254980ccd3dd35cf5e1b7c08880b40e")
  const payload = {
    x402Version: 2,
    accepted: required.accepts[0],
    payload: {
      signature: "valid",
      authorization: {
        from: "0x2222222222222222222222222222222222222222",
        to: required.accepts[0].payTo,
        value: required.accepts[0].amount,
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"ab".repeat(32)}`,
      },
    },
  }
  const again = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      "payment-signature": Buffer.from(JSON.stringify(payload)).toString("base64"),
    },
  })
  return { required, again }
}

test("the free board is browsable without a payment", async () => {
  const app = await startApp()
  try {
    const page = await fetch(`${app.url}/`)
    const html = await page.text()
    assert.equal(page.status, 200)
    assert.equal(page.headers.get("payment-required"), null)
    assert.match(html, /priced\.example/)
    assert.match(html, /\$5 USDC/)
    assert.match(html, /free\.example/)
    assert.equal(html.includes("<script>"), false)

    const prices = await fetch(`${app.url}/api/prices`)
    const body = await prices.json()
    assert.equal(prices.status, 200)
    assert.equal(body.cheapest[0].amountUsd, 5)
    assert.equal(body.cheapest[0].payTo, "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
    assert.equal(body.free.length, 1)
    assert.equal(app.facilitator.calls.length, 0)

    const health = await (await fetch(`${app.url}/health`)).json()
    assert.equal(health.payments, true)
    assert.equal(health.payTo, WALLET)
  } finally {
    await app.stop()
  }
})

test("a fresh probe is 402 until the facilitator settles it", async () => {
  const app = await startApp()
  try {
    const target = `${app.url}/api/v1/probe?url=${encodeURIComponent("https://other.example/v1")}`
    const { required, again } = await pay(target)
    assert.equal(required.accepts[0].amount, "10000")
    assert.equal(required.resource.url, `https://board.example/api/v1/probe?url=${encodeURIComponent("https://other.example/v1")}`)
    assert.equal(again.status, 200)
    const body = await again.json()
    assert.equal(body.cheapest.amountUsd, 5)
    assert.equal(body.status, 402)
    const settlement = JSON.parse(Buffer.from(again.headers.get("payment-response"), "base64").toString("utf8"))
    assert.equal(settlement.success, true)
    assert.equal(settlement.transaction, "0xtx")
    const paths = app.facilitator.calls.map((call) => call.path)
    assert.deepEqual(paths, ["/verify", "/settle"])
  } finally {
    await app.stop()
  }
})

test("an upstream failure is not settled", async () => {
  const app = await startApp()
  try {
    const target = `${app.url}/api/v1/probe?url=${encodeURIComponent("https://down.example/v1")}`
    const { again } = await pay(target)
    assert.equal(again.status, 502)
    const body = await again.json()
    assert.equal(body.error, "probe_failed")
    assert.equal(again.headers.get("payment-response"), null)
    assert.deepEqual(app.facilitator.calls.map((call) => call.path), ["/verify"])
  } finally {
    await app.stop()
  }
})

test("private and rebinding targets are refused before payment", async () => {
  const app = await startApp()
  try {
    const metadata = await fetch(`${app.url}/api/v1/probe?url=${encodeURIComponent("http://169.254.169.254/latest")}`)
    assert.equal(metadata.status, 400)
    assert.equal((await metadata.json()).error, "blocked_address")
    const rebind = await fetch(`${app.url}/api/v1/probe?url=${encodeURIComponent("https://rebind.example/x")}`)
    assert.equal(rebind.status, 400)
    const redirect = await fetch(`${app.url}/api/v1/probe?url=${encodeURIComponent("https://redirect.example/go")}`)
    // The first hop is public, so the route asks for payment before probing.
    assert.equal(redirect.status, 402)
    const { again } = await pay(`${app.url}/api/v1/probe?url=${encodeURIComponent("https://redirect.example/go")}`)
    assert.equal(again.status, 502)
    assert.ok(app.seen.every((url) => !url.includes("127.0.0.1")))
    assert.equal(app.facilitator.calls.filter((call) => call.path.endsWith("/settle")).length, 0)
  } finally {
    await app.stop()
  }
})

test("a featured listing is paid, escaped, and shown on the free board", async () => {
  const app = await startApp()
  try {
    const title = "<script>alert(1)</script>"
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://seller.example/api", title }),
    }
    const { required, again } = await pay(`${app.url}/api/v1/featured`, init)
    assert.equal(required.accepts[0].amount, "1000000")
    assert.equal(again.status, 201)
    const created = await again.json()
    assert.equal(created.listing.title, title)
    assert.equal(created.listing.payer, "0x2222222222222222222222222222222222222222")

    const page = await (await fetch(`${app.url}/`)).text()
    assert.match(page, /Featured/)
    assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.equal(page.includes("<script>"), false)

    const prices = await (await fetch(`${app.url}/api/prices`)).json()
    assert.equal(prices.cheapest[0].url, "https://seller.example/api")
    assert.equal(prices.cheapest[0].featured, true)

    const saved = await readFile(join(app.dir, "featured.json"), "utf8")
    assert.equal(saved.includes("signature"), false)
    assert.equal(saved.includes(title), true)

    const discovery = await (await fetch(`${app.url}/discovery/resources`)).json()
    assert.equal(discovery.items.length, 2)
    assert.equal(discovery.items[0].accepts[0].payTo, WALLET)
    assert.equal(discovery.items[0].resource, "https://board.example/api/v1/probe")
  } finally {
    await app.stop()
  }
})

test("a failed settlement does not keep the featured listing", async () => {
  const app = await startApp({ facilitator: { settleFail: true } })
  try {
    const init = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://seller.example/api", title: "Seller" }),
    }
    const { again } = await pay(`${app.url}/api/v1/featured`, init)
    assert.equal(again.status, 402)
    const listed = await (await fetch(`${app.url}/api/v1/featured`)).json()
    assert.deepEqual(listed.featured, [])
  } finally {
    await app.stop()
  }
})

test("paid routes stay shut until a wallet and facilitator are configured", async () => {
  const app = await startApp({ payTo: "", facilitator: null })
  try {
    const probe = await fetch(`${app.url}/api/v1/probe?url=${encodeURIComponent("https://priced.example/v1")}`)
    assert.equal(probe.status, 503)
    assert.equal(probe.headers.get("payment-required"), null)
    const body = await probe.json()
    assert.ok(body.missing.includes("X402_PAY_TO"))
    assert.ok(body.missing.includes("X402_FACILITATOR_URL"))
    const page = await (await fetch(`${app.url}/`)).text()
    assert.match(page, /Browsing this board stays free/)
    const discovery = await (await fetch(`${app.url}/discovery/resources`)).json()
    assert.equal(discovery.items.length, 0)
    const health = await (await fetch(`${app.url}/health`)).json()
    assert.equal(health.payments, false)
  } finally {
    await app.stop()
  }
})

test("the free board is rate limited and a bad wallet refuses to boot", async () => {
  const app = await startApp({ rateLimit: 2 })
  try {
    assert.equal((await fetch(`${app.url}/api/prices`)).status, 200)
    assert.equal((await fetch(`${app.url}/api/prices`)).status, 200)
    const limited = await fetch(`${app.url}/api/prices`)
    assert.equal(limited.status, 429)
    assert.equal((await fetch(`${app.url}/health`)).status, 200)
  } finally {
    await app.stop()
  }

  const booted = spawnSync(process.execPath, ["src/server.js"], {
    encoding: "utf8",
    timeout: 5000,
    env: {
      ...process.env,
      PORT: "0",
      X402_PAY_TO: "not-a-wallet",
      X402_FACILITATOR_URL: "https://facilitator.example",
      X402_NETWORK: "eip155:8453",
      X402_PROBE_AMOUNT: "",
      X402_FEATURED_AMOUNT: "",
    },
  })
  assert.equal(booted.status, 1)
  assert.match(booted.stderr, /X402_PAY_TO/)
})
