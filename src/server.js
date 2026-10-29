#!/usr/bin/env node
/**
 * Free price board plus two paid routes:
 *   GET  /api/v1/probe?url=     fresh terms for one public endpoint
 *   POST /api/v1/featured       pin a listing on the free board
 *
 * Payment is x402 v2. The receiving wallet is X402_PAY_TO. Nothing is charged
 * when that variable, or the facilitator URL, is missing.
 */
import { createServer as createHttpServer } from "node:http"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { board, cheapest, formatUsd, probe, toRow } from "./index.js"
import { renderBoard } from "./html.js"
import {
  buildPaymentRequired,
  decodePaymentHeader,
  encodePaymentHeader,
  payloadMismatch,
  paymentConfig,
  settlePayment,
  verifyPayment,
} from "./payment.js"
import { defaultLookup, inspectUrl } from "./ssrf.js"
import { createStore } from "./store.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const DEFAULT_CATALOG = [
  { url: "https://api.venice.ai/api/v1/chat/completions", method: "POST" },
]

export function loadCatalog(filePath) {
  const parsed = JSON.parse(readFileSync(filePath, "utf8"))
  if (!Array.isArray(parsed)) throw new Error(`${filePath} must be a JSON array`)
  return parsed.map((entry, index) => {
    if (typeof entry === "string") return entry
    if (entry && typeof entry.url === "string") {
      const method = String(entry.method || "GET").toUpperCase()
      if (method !== "GET" && method !== "POST") {
        throw new Error(`${filePath}[${index}].method must be GET or POST`)
      }
      return { url: entry.url, method }
    }
    throw new Error(`${filePath}[${index}] must be a URL or {"url","method"}`)
  })
}

function catalogFrom(options, env) {
  if (options.catalog) return options.catalog
  const filePath = options.catalogPath || env.CATALOG_PATH || join(root, "data", "catalog.json")
  try {
    return loadCatalog(filePath)
  } catch (err) {
    if (err?.code === "ENOENT") return DEFAULT_CATALOG
    throw err
  }
}

const securityHeaders = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "Content-Type, PAYMENT-SIGNATURE",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-expose-headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE",
  }
}

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" ? body : JSON.stringify(body)
  res.writeHead(status, {
    "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8",
    ...securityHeaders,
    ...corsHeaders(),
    ...headers,
  })
  res.end(payload)
}

function sendPaymentRequired(res, required) {
  send(res, 402, required, { "payment-required": encodePaymentHeader(required) })
}

function clientIp(req, env) {
  if (env.TRUST_PROXY === "1") {
    const forwarded = req.headers["x-forwarded-for"]
    if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim()
  }
  return req.socket?.remoteAddress || "unknown"
}

function publicBase(req, env) {
  if (env.X402_PUBLIC_URL) return String(env.X402_PUBLIC_URL).replace(/\/$/, "")
  const host = req.headers.host || "localhost"
  const forwarded = env.TRUST_PROXY === "1" ? req.headers["x-forwarded-proto"] : ""
  const proto = typeof forwarded === "string" && forwarded ? forwarded.split(",")[0].trim() : "http"
  return `${proto}://${host}`
}

function normalizeTitle(title) {
  if (title === undefined || title === null || title === "") return ""
  if (typeof title !== "string") return null
  const clean = title.replace(/\s+/g, " ").trim()
  if (!clean) return ""
  if (clean.length > 80) return null
  if (/[\u0000-\u001F\u007F]/.test(clean)) return null
  return clean
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 16_384) {
      const error = new Error("body_too_large")
      error.status = 413
      throw error
    }
    chunks.push(chunk)
  }
  if (!size) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    const error = new Error("invalid_json")
    error.status = 400
    throw error
  }
}

export function createServer(options = {}) {
  const env = options.env || process.env
  const config = options.config || paymentConfig(env)
  const fetchImpl = options.fetchImpl || fetch
  const facilitatorFetch = options.facilitatorFetch || fetch
  const lookup = options.lookup || defaultLookup
  const now = options.now || (() => Date.now())
  const catalog = catalogFrom(options, env)
  const featuredPath = options.featuredPath === undefined
    ? (env.FEATURED_PATH || join(root, "data", "featured.json"))
    : options.featuredPath
  const store = options.store || createStore(featuredPath || null)
  const ttl = options.cacheTtlMs ?? (Number(env.CACHE_TTL_MS) || 300_000)
  const rateLimit = options.rateLimit ?? (Number(env.FREE_RATE_LIMIT) || 60)
  const hits = new Map()
  let snapshot = null
  let snapshotAt = 0
  let inflight = null

  function allow(req) {
    const ip = clientIp(req, env)
    const at = now()
    const recent = (hits.get(ip) || []).filter((stamp) => at - stamp < 60_000)
    if (recent.length >= rateLimit) {
      hits.set(ip, recent)
      return false
    }
    recent.push(at)
    hits.set(ip, recent)
    if (hits.size > 10_000) {
      for (const [key, stamps] of hits) {
        if (stamps.every((stamp) => at - stamp >= 60_000)) hits.delete(key)
      }
    }
    return true
  }

  async function currentBoard() {
    const at = now()
    if (snapshot && at - snapshotAt < ttl) return snapshot
    if (inflight) return inflight
    inflight = refresh(at).finally(() => {
      inflight = null
    })
    return inflight
  }

  async function refresh(at) {
    const featured = await store.list(at)
    const urls = [...new Set([...featured.map((listing) => listing.url), ...catalog])]
    const guard = (target) => inspectUrl(target, lookup)
    const data = urls.length
      ? await board(urls, { fetchImpl, concurrency: 5, timeoutMs: 20_000, guard, retryPost: true })
      : { cheapest: [], free: [], errors: [], misses: [], rows: [], results: [] }
    const featuredUrls = new Set(featured.map((listing) => listing.url))
    const byPrice = (a, b) => {
      if (featuredUrls.has(a.url) !== featuredUrls.has(b.url)) return featuredUrls.has(a.url) ? -1 : 1
      const left = Number.isFinite(a.amountUsd) ? a.amountUsd : Number.POSITIVE_INFINITY
      const right = Number.isFinite(b.amountUsd) ? b.amountUsd : Number.POSITIVE_INFINITY
      if (left !== right) return left - right
      return String(a.network).localeCompare(String(b.network))
    }
    for (const row of data.rows) row.featured = featuredUrls.has(row.url)
    for (const row of data.cheapest) row.featured = featuredUrls.has(row.url)
    data.rows.sort(byPrice)
    data.cheapest.sort(byPrice)
    snapshot = { ...data, featured, updatedAt: new Date(at).toISOString() }
    snapshotAt = at
    return snapshot
  }

  function notConfigured(res) {
    send(res, 503, {
      error: "payments_not_configured",
      missing: config.missing,
      hint: "Set X402_PAY_TO to the wallet that should receive USDC and X402_FACILITATOR_URL to a facilitator that can settle the chosen network. Browsing / and /api/prices stays free.",
    })
  }

  async function takePayment(req, res, { amount, description, resourcePath }) {
    if (config.error || !config.configured) {
      notConfigured(res)
      return null
    }
    const resourceUrl = `${publicBase(req, env)}${resourcePath}`
    const required = buildPaymentRequired(config, { url: resourceUrl, description, amount })
    const signature = req.headers["payment-signature"]
    if (!signature || Array.isArray(signature)) {
      sendPaymentRequired(res, required)
      return null
    }
    const payload = decodePaymentHeader(signature)
    const reason = payloadMismatch(payload, required.accepts[0])
    if (reason) {
      sendPaymentRequired(res, { ...required, error: reason })
      return null
    }
    let verified
    try {
      verified = await verifyPayment({
        config,
        payload,
        requirements: required.accepts[0],
        fetchImpl: facilitatorFetch,
      })
    } catch {
      send(res, 502, { error: "facilitator_unreachable" })
      return null
    }
    if (!verified.ok) {
      sendPaymentRequired(res, { ...required, error: verified.reason || "payment_invalid" })
      return null
    }
    return {
      payer: verified.payer,
      async settle() {
        try {
          return await settlePayment({
            config,
            payload,
            requirements: required.accepts[0],
            fetchImpl: facilitatorFetch,
          })
        } catch {
          return { ok: false, reason: "facilitator_unreachable" }
        }
      },
      fail(settlement) {
        sendPaymentRequired(res, { ...required, error: settlement.reason || "unexpected_settle_error" })
      },
    }
  }

  async function handle(req, res) {
    if (req.method === "OPTIONS") {
      send(res, 204, "")
      return
    }
    const url = new URL(req.url || "/", "http://localhost")
    if (url.pathname === "/health") {
      send(res, 200, {
        ok: true,
        payments: config.configured,
        missing: config.configured ? [] : config.missing,
        network: config.network,
        payTo: config.payTo || null,
        probeAmount: config.probeAmount,
        featuredAmount: config.featuredAmount,
        featuredHours: config.featuredHours,
        configError: config.error,
      })
      return
    }
    if (!allow(req)) {
      send(res, 429, { error: "rate_limited" }, { "retry-after": "60" })
      return
    }

    if (req.method === "GET" && url.pathname === "/discovery/resources") {
      const base = publicBase(req, env)
      const updated = new Date(now()).toISOString()
      const items = config.configured
        ? [
          ["probe", "/api/v1/probe", "Fresh x402 price probe for one endpoint", config.probeAmount],
          ["featured", "/api/v1/featured", "Featured placement on the x402 priceboard", config.featuredAmount],
        ].map(([, path, description, amount]) => ({
          resource: `${base}${path}`,
          type: "http",
          x402Version: 2,
          accepts: buildPaymentRequired(config, { url: `${base}${path}`, description, amount }).accepts,
          lastUpdated: updated,
        }))
        : []
      send(res, 200, {
        x402Version: 2,
        items,
        pagination: { limit: 20, offset: 0, total: items.length },
      })
      return
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/api/prices")) {
      const data = await currentBoard()
      if (url.pathname === "/api/prices") {
        send(res, 200, {
          updatedAt: data.updatedAt,
          cheapest: data.cheapest,
          rows: data.rows,
          featured: data.featured,
          free: data.free,
          errors: data.errors,
          misses: data.misses,
        })
        return
      }
      send(res, 200, renderBoard({
        cheapest: data.cheapest,
        rows: data.rows,
        free: data.free,
        errors: data.errors,
        misses: data.misses,
        featured: data.featured,
        updatedAt: data.updatedAt,
        payments: config,
        formatUsd,
      }))
      return
    }

    if (url.pathname === "/api/v1/probe") {
      if (req.method !== "GET") {
        send(res, 405, { error: "method_not_allowed" })
        return
      }
      const target = url.searchParams.get("url")
      const methodParam = url.searchParams.get("method")
      const method = (methodParam || "GET").toUpperCase()
      if (method !== "GET" && method !== "POST") {
        send(res, 400, { error: "invalid_method" })
        return
      }
      const checked = await inspectUrl(target || "", lookup)
      if (!checked.ok) {
        send(res, 400, { error: checked.error })
        return
      }
      const payment = await takePayment(req, res, {
        amount: config.probeAmount,
        description: "Fresh x402 price probe for one endpoint",
        resourcePath: `${url.pathname}${url.search}`,
      })
      if (!payment) return
      const probed = await probe(checked.url.href, {
        fetchImpl,
        method,
        body: method === "POST" ? {} : undefined,
        timeoutMs: 20_000,
        guard: (targetUrl) => inspectUrl(targetUrl, lookup),
        retryPost: !methodParam,
      })
      if (probed.error) {
        send(res, 502, { error: "probe_failed", url: checked.url.href, detail: probed.error })
        return
      }
      const rows = toRow(probed.url, probed.requirements) || []
      const settlement = await payment.settle()
      if (!settlement.ok) {
        payment.fail(settlement)
        return
      }
      send(res, 200, {
        url: probed.url,
        status: probed.status,
        free: probed.free,
        latencyMs: probed.latencyMs,
        note: probed.note,
        rows,
        cheapest: rows.length ? cheapest(rows)[0] : null,
      }, { "payment-response": encodePaymentHeader(settlement.response) })
      return
    }

    if (url.pathname === "/api/v1/featured") {
      if (req.method === "GET") {
        send(res, 200, { featured: await store.list(now()) })
        return
      }
      if (req.method !== "POST") {
        send(res, 405, { error: "method_not_allowed" })
        return
      }
      let body
      try {
        body = await readJson(req)
      } catch (err) {
        send(res, err.status || 400, { error: err.message || "invalid_json" })
        return
      }
      const checked = await inspectUrl(body?.url || "", lookup)
      if (!checked.ok) {
        send(res, 400, { error: checked.error })
        return
      }
      const title = normalizeTitle(body?.title)
      if (title === null) {
        send(res, 400, { error: "invalid_title" })
        return
      }
      const payment = await takePayment(req, res, {
        amount: config.featuredAmount,
        description: "Featured placement on the x402 priceboard",
        resourcePath: url.pathname,
      })
      if (!payment) return
      const listing = await store.add({
        url: checked.url.href,
        title: title || checked.url.hostname,
        payer: payment.payer,
        hours: config.featuredHours,
        now: now(),
      })
      snapshot = null
      const settlement = await payment.settle()
      if (!settlement.ok) {
        await store.remove(listing.id)
        snapshot = null
        payment.fail(settlement)
        return
      }
      send(res, 201, { listing }, { "payment-response": encodePaymentHeader(settlement.response) })
      return
    }

    send(res, 404, { error: "not_found" })
  }

  return createHttpServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err?.message || "request failed")
      if (!res.headersSent) send(res, 500, { error: "internal_error" })
    })
  })
}

function invokedDirectly() {
  const entry = process.argv[1]
  if (!entry) return false
  return import.meta.url === pathToFileURL(entry).href
}

if (invokedDirectly()) {
  const config = paymentConfig()
  if (config.error) {
    console.error(config.error)
    process.exit(1)
  }
  const port = Number(process.env.PORT || 8080)
  const server = createServer({ config })
  server.listen(port, () => {
    console.log(`x402-priceboard listening on :${port}`)
    if (config.configured) {
      console.log(`payments: ${config.probeAmount} atomic / probe, ${config.featuredAmount} atomic / featured listing → ${config.payTo} on ${config.network}`)
      console.log(`facilitator: ${config.facilitatorUrl}`)
    } else {
      console.log(`payments: off (missing ${config.missing.join(", ")}). The board at / is free.`)
    }
  })
}
