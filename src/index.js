/**
 * x402-priceboard — what does an x402 endpoint actually cost?
 *
 * Every x402 server answers the first request with a `payment-required` header
 * that carries the price, the network and the payee. This asks a list of
 * endpoints for those terms, normalises them and prints a price board — no
 * payment, no wallet, no key.
 */
export function parseRequirements(header) {
  if (!header) return null
  const raw = header.includes("{") ? header : Buffer.from(header, "base64").toString("utf8")
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const NETWORKS = {
  "eip155:8453": "Base",
  "eip155:1": "Ethereum",
  "solana:5eykt4UsFv8P8NJdTREY1vzqKqZKvdp": "Solana",
}

/** Turn payment terms into a row. */
export function toRow(url, requirements) {
  if (!requirements?.accepts?.length) return null
  const rows = requirements.accepts.map((a) => ({
    url,
    network: a.network,
    networkName: NETWORKS[a.network] || a.network,
    asset: a.asset,
    payTo: a.payTo,
    amountRaw: String(a.amount ?? a.maxAmountRequired ?? "0"),
    amountUsd: Number(a.amount ?? a.maxAmountRequired ?? 0) / 1e6,
    scheme: a.scheme,
  }))
  return rows
}

/** Cheapest option per endpoint. */
export function cheapest(rows) {
  const byUrl = new Map()
  for (const r of rows) {
    const cur = byUrl.get(r.url)
    if (!cur || r.amountUsd < cur.amountUsd) byUrl.set(r.url, r)
  }
  return [...byUrl.values()].sort((a, b) => a.amountUsd - b.amountUsd)
}

/** Probe one endpoint for its payment terms (no payment). */
export async function probe(url, { method = "GET", body, timeoutMs = 20000, fetchImpl } = {}) {
  const doFetch = fetchImpl || fetch
  const started = Date.now()
  try {
    const res = await doFetch(url, {
      method,
      headers: { "content-type": "application/json", ...(body ? {} : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const requirements = parseRequirements(res.headers.get?.("payment-required"))
    const text = res.status !== 402 ? await res.text().catch(() => "") : ""
    return {
      url,
      status: res.status,
      free: res.status !== 402,
      requirements,
      latencyMs: Date.now() - started,
      note: res.status !== 402 ? text.slice(0, 200) : undefined,
    }
  } catch (err) {
    return { url, status: 0, free: false, error: String(err?.message ?? err), latencyMs: Date.now() - started }
  }
}

/** Probe many endpoints. */
export async function board(urls, opts = {}) {
  const results = await Promise.all(urls.map((u) => probe(u, opts)))
  const rows = results.flatMap((r) => toRow(r.url, r.requirements) || [])
  return { results, rows, cheapest: cheapest(rows), free: results.filter((r) => r.free) }
}

/** Render the board as Markdown. */
export function toMarkdown(data) {
  const lines = ["| Endpoint | Network | Price | Payee |", "|---|---|---|---|"]
  for (const r of data.cheapest) {
    lines.push(`| ${r.url} | ${r.networkName} | $${r.amountUsd} USDC | \`${r.payTo}\` |`)
  }
  if (data.free.length) {
    lines.push("", "Free (no payment required):", "")
    for (const f of data.free) lines.push(`- ${f.url} (HTTP ${f.status})`)
  }
  return lines.join("\n")
}
