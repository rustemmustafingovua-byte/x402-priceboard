/**
 * x402-priceboard — what does an x402 endpoint actually cost?
 *
 * Every x402 server answers the first request with a `payment-required` header
 * that carries the price, the network and the payee. This asks a list of
 * endpoints for those terms, normalises them and prints a price board — no
 * payment, no wallet, no key.
 */

// CAIP-2 ids from the x402 v2 spec. The second Solana id is a truncated copy
// that showed up in early examples; keep labelling it so those boards still read.
export const NETWORKS = {
  "eip155:8453": "Base",
  "eip155:84532": "Base Sepolia",
  "eip155:1": "Ethereum",
  "eip155:137": "Polygon",
  "eip155:42161": "Arbitrum",
  "eip155:43114": "Avalanche",
  "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp": "Solana",
  // Early examples dropped a letter. Some live servers send the bare name.
  "solana:5eykt4UsFv8P8NJdTREY1vzqKqZKvdp": "Solana",
  solana: "Solana",
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1": "Solana Devnet",
}

export function parseRequirements(header) {
  if (!header || typeof header !== "string") return null
  const trimmed = header.trim()
  const raw = trimmed.includes("{")
    ? trimmed
    : Buffer.from(trimmed.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function decimalsOf(accept) {
  if (accept?.extra?.decimals === undefined || accept?.extra?.decimals === null || accept?.extra?.decimals === "") {
    return 6
  }
  const decimals = Number(accept.extra.decimals)
  if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 18) return decimals
  return 6
}

/** USDC-style atomic units to a decimal number. Unknown assets still default to 6. */
export function atomicToDecimal(amount, decimals = 6) {
  const raw = String(amount ?? "").trim()
  if (!/^-?\d+$/.test(raw)) return Number.NaN
  const negative = raw.startsWith("-")
  const digits = negative ? raw.slice(1) : raw
  const padded = digits.padStart(decimals + 1, "0")
  const whole = padded.slice(0, padded.length - decimals)
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, "")
  return Number(`${negative ? "-" : ""}${whole}.${frac || "0"}`)
}

export function formatUsd(amount) {
  if (!Number.isFinite(amount)) return "n/a"
  const abs = Math.abs(amount)
  const digits = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6
  const text = amount.toFixed(digits).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")
  return `$${text}`
}

/** Turn payment terms into rows, one per accepted option. */
export function toRow(url, requirements) {
  if (!requirements?.accepts?.length) return null
  return requirements.accepts.map((accept) => {
    const decimals = decimalsOf(accept)
    const amountRaw = String(accept.amount ?? accept.maxAmountRequired ?? "0")
    return {
      url,
      network: accept.network,
      networkName: NETWORKS[accept.network] || accept.network,
      asset: accept.asset,
      payTo: accept.payTo,
      amountRaw,
      amountUsd: atomicToDecimal(amountRaw, decimals),
      scheme: accept.scheme,
    }
  })
}

/** Cheapest option per endpoint. Non-numeric prices sort last. */
export function cheapest(rows) {
  const byUrl = new Map()
  for (const row of rows) {
    const current = byUrl.get(row.url)
    const price = Number.isFinite(row.amountUsd) ? row.amountUsd : Number.POSITIVE_INFINITY
    const currentPrice = current && Number.isFinite(current.amountUsd) ? current.amountUsd : Number.POSITIVE_INFINITY
    if (!current || price < currentPrice) byUrl.set(row.url, row)
  }
  return [...byUrl.values()].sort((a, b) => {
    const left = Number.isFinite(a.amountUsd) ? a.amountUsd : Number.POSITIVE_INFINITY
    const right = Number.isFinite(b.amountUsd) ? b.amountUsd : Number.POSITIVE_INFINITY
    return left - right
  })
}

async function mapPool(items, limit, fn) {
  if (!items.length) return []
  const results = new Array(items.length)
  let next = 0
  const workers = Math.max(1, Math.min(limit, items.length))
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index], index)
    }
  }))
  return results
}

/**
 * Probe one endpoint for its payment terms (no payment).
 * Redirects are followed one hop at a time so a `guard` can reject a
 * Location that points at a private address. The reported `url` stays the
 * one the caller asked about.
 */
async function probeOnce(url, { method = "GET", body, timeoutMs = 20000, fetchImpl, guard } = {}) {
  const doFetch = fetchImpl || fetch
  const started = Date.now()
  let current = url
  const seen = new Set()
  for (let hop = 0; hop < 4; hop++) {
    if (seen.has(current)) {
      return { url, status: 0, free: false, error: "redirect_loop", latencyMs: Date.now() - started }
    }
    seen.add(current)
    if (guard) {
      const checked = await guard(current)
      if (!checked?.ok) {
        return { url, status: 0, free: false, error: checked?.error || "blocked_address", latencyMs: Date.now() - started }
      }
    }
    const headers = {}
    // A GET with no body should not claim to be JSON; some servers reject that.
    if (hop === 0 && body !== undefined) headers["content-type"] = "application/json"
    const res = await doFetch(current, {
      method: hop === 0 ? method : "GET",
      headers,
      body: hop === 0 && body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get?.("location")
      await res.body?.cancel?.().catch(() => {})
      if (!location) {
        return { url, status: res.status, free: false, note: "redirect without location", latencyMs: Date.now() - started }
      }
      current = new URL(location, current).href
      continue
    }
    let requirements = parseRequirements(res.headers.get?.("payment-required"))
    const readText = async () => (typeof res.text === "function" ? res.text().catch(() => "") : "")
    let note
    if (res.status === 402) {
      if (!requirements) {
        // Some servers put the same document in the body and omit the header.
        const text = await readText()
        requirements = parseRequirements(String(text).slice(0, 100_000))
        if (!requirements) note = "402 without a readable payment-required header"
      } else {
        await res.body?.cancel?.().catch(() => {})
      }
    } else {
      note = String(await readText()).slice(0, 200)
    }
    return {
      url,
      finalUrl: current,
      status: res.status,
      method,
      free: res.status >= 200 && res.status < 400,
      requirements,
      latencyMs: Date.now() - started,
      note: note || undefined,
    }
  }
  return { url, status: 0, free: false, error: "too_many_redirects", latencyMs: Date.now() - started }
}

/**
 * Probe one endpoint for its payment terms (no payment).
 * Redirects are followed one hop at a time so a `guard` can reject a
 * Location that points at a private address. The reported `url` stays the
 * one the caller asked about.
 * `retryPost` covers chat APIs that answer GET with 404 and POST with 402.
 */
export async function probe(url, opts = {}) {
  try {
    const first = await probeOnce(url, opts)
    const method = opts.method || "GET"
    if (opts.retryPost && method === "GET" && !first.requirements && !first.free && !first.error) {
      const second = await probeOnce(url, { ...opts, method: "POST", body: {} })
      if (second.requirements || second.free) return second
    }
    return first
  } catch (err) {
    return { url, status: 0, free: false, error: String(err?.message ?? err), latencyMs: 0 }
  }
}

function asTarget(entry, fallbackMethod) {
  if (typeof entry === "string") return { url: entry.trim(), method: fallbackMethod }
  if (entry && typeof entry.url === "string") {
    const method = String(entry.method || fallbackMethod || "GET").toUpperCase()
    return { url: entry.url.trim(), method: method === "POST" ? "POST" : "GET" }
  }
  return null
}

/** Probe many endpoints. `concurrency` caps how many are in flight at once. */
export async function board(entries, opts = {}) {
  const fallback = opts.method || "GET"
  const targets = []
  const seen = new Set()
  for (const entry of entries || []) {
    const target = asTarget(entry, fallback)
    if (!target?.url) continue
    const key = `${target.method} ${target.url}`
    if (seen.has(key)) continue
    seen.add(key)
    targets.push(target)
  }
  const concurrency = opts.concurrency ?? 5
  const results = await mapPool(targets, concurrency, (target) => probe(target.url, {
    ...opts,
    method: target.method,
    body: target.method === "POST" ? (opts.body ?? {}) : undefined,
  }))
  const rows = results.flatMap((result) => toRow(result.url, result.requirements) || [])
  rows.sort((a, b) => {
    const left = Number.isFinite(a.amountUsd) ? a.amountUsd : Number.POSITIVE_INFINITY
    const right = Number.isFinite(b.amountUsd) ? b.amountUsd : Number.POSITIVE_INFINITY
    if (left !== right) return left - right
    return String(a.url).localeCompare(String(b.url)) || String(a.network).localeCompare(String(b.network))
  })
  const priced = new Set(rows.map((row) => row.url))
  return {
    results,
    rows,
    cheapest: cheapest(rows),
    free: results.filter((result) => result.free),
    errors: results.filter((result) => result.error),
    misses: results.filter((result) => !result.free && !result.error && !priced.has(result.url)),
  }
}

function cell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function code(value) {
  return `\`${String(value ?? "").replace(/`/g, "")}\``
}

/** Render the board as Markdown. */
export function toMarkdown(data) {
  const lines = ["| Endpoint | Network | Price | Payee |", "|---|---|---|---|"]
  const listed = data.rows?.length ? data.rows : (data.cheapest || [])
  for (const row of listed) {
    lines.push(`| ${cell(row.url)} | ${cell(row.networkName)} | ${formatUsd(row.amountUsd)} USDC | ${code(row.payTo)} |`)
  }
  if (!listed.length) lines.push("| _none_ | | | |")
  if (data.free?.length) {
    lines.push("", "Free (no payment required):", "")
    for (const item of data.free) lines.push(`- ${item.url} (HTTP ${item.status})`)
  }
  if (data.errors?.length) {
    lines.push("", "Errors:", "")
    for (const item of data.errors) lines.push(`- ${item.url}: ${item.error}`)
  }
  if (data.misses?.length) {
    lines.push("", "No price returned:", "")
    for (const item of data.misses) lines.push(`- ${item.url} (HTTP ${item.status}${item.note ? `, ${item.note}` : ""})`)
  }
  return lines.join("\n")
}
