/** The free board. Every interpolated value is escaped; featured titles are caller input. */

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]))
}

function safeHref(url) {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href
  } catch {
    // Fall through and render the value as text only.
  }
  return ""
}

function priceCell(row, formatUsd) {
  return `${escapeHtml(formatUsd(row.amountUsd))} USDC`
}

export function renderBoard({ cheapest = [], rows = [], free = [], errors = [], misses = [], featured = [], updatedAt, payments, formatUsd }) {
  const byFeatured = new Map(featured.map((listing) => [listing.url, listing]))
  const listed = rows.length ? rows : cheapest
  const table = listed.map((row) => {
    const href = safeHref(row.url)
    const listing = byFeatured.get(row.url)
    const label = listing?.title || row.url
    const link = href
      ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
      : escapeHtml(label)
    const badge = listing ? ` <span class="badge">Featured</span>` : ""
    const detail = listing?.title ? `<div class="muted">${escapeHtml(row.url)}</div>` : ""
    return `<tr><td>${link}${badge}${detail}</td><td>${escapeHtml(row.networkName || row.network)}</td><td>${priceCell(row, formatUsd)}</td><td><code>${escapeHtml(row.payTo)}</code></td></tr>`
  }).join("")
  const featuredOnly = featured.filter((listing) => !listed.some((row) => row.url === listing.url))
  const featuredHtml = featuredOnly.map((listing) => {
    const href = safeHref(listing.url)
    const link = href ? `<a href="${escapeHtml(href)}">${escapeHtml(listing.title || listing.url)}</a>` : escapeHtml(listing.title || listing.url)
    return `<li>${link} <span class="muted">until ${escapeHtml(listing.expiresAt)}</span></li>`
  }).join("")
  const freeHtml = free.map((item) => `<li>${escapeHtml(item.url)} <span class="muted">HTTP ${escapeHtml(item.status)}</span></li>`).join("")
  const errorHtml = [...errors, ...misses].map((item) => {
    const why = item.error || `HTTP ${item.status}`
    return `<li>${escapeHtml(item.url)} <span class="muted">${escapeHtml(why)}</span></li>`
  }).join("")
  const paid = payments?.configured
    ? `<p>Fresh probes are ${escapeHtml(formatUsd(Number(payments.probeAmount) / 1e6))} USDC each. A featured listing is ${escapeHtml(formatUsd(Number(payments.featuredAmount) / 1e6))} USDC for ${escapeHtml(payments.featuredHours)} hours, paid to <code>${escapeHtml(payments.payTo)}</code> on ${escapeHtml(payments.network)}.</p>`
    : `<p>Paid probe and featured listings are off until <code>X402_PAY_TO</code> and <code>X402_FACILITATOR_URL</code> are set. Browsing this board stays free.</p>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>x402 priceboard</title>
<meta name="description" content="A price list of x402 endpoints you can browse without paying.">
<style>
  :root { color-scheme: dark; --bg:#0d1117; --fg:#e6edf3; --muted:#8b949e; --line:#30363d; --accent:#7ee787; }
  body { margin:0; font:16px/1.5 ui-sans-serif, system-ui, sans-serif; background:var(--bg); color:var(--fg); }
  main { max-width:980px; margin:0 auto; padding:32px 20px 64px; }
  h1 { font-size:1.8rem; margin:0 0 8px; }
  p, li { color:#c9d1d9; }
  a { color:var(--accent); }
  table { width:100%; border-collapse:collapse; margin:16px 0 28px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); vertical-align:top; word-break:break-word; }
  th { color:var(--muted); font-size:0.85rem; font-weight:600; }
  code { font-size:0.85em; }
  .muted { color:var(--muted); }
  .badge { display:inline-block; margin-left:6px; padding:0 6px; border:1px solid var(--accent); border-radius:999px; color:var(--accent); font-size:0.75rem; }
  .empty { color:var(--muted); }
</style>
</head>
<body>
<main>
  <h1>x402 priceboard</h1>
  <p>Prices below come from each endpoint's own <code>402</code> response. Opening this page does not pay anyone.</p>
  ${paid}
  <p class="muted">Updated ${escapeHtml(updatedAt || "just now")}.</p>
  ${featuredHtml ? `<h2>Waiting on a price</h2><ul>${featuredHtml}</ul>` : ""}
  <h2>Prices</h2>
  ${table ? `<table><thead><tr><th>Endpoint</th><th>Network</th><th>Price</th><th>Payee</th></tr></thead><tbody>${table}</tbody></table>` : `<p class="empty">No priced endpoints in the catalog yet.</p>`}
  ${freeHtml ? `<h2>Free</h2><ul>${freeHtml}</ul>` : ""}
  ${errorHtml ? `<h2>No price</h2><ul>${errorHtml}</ul>` : ""}
  <h2>For agents</h2>
  <ul>
    <li><code>GET /api/prices</code> — this board as JSON, no payment.</li>
    <li><code>GET /api/v1/probe?url=https://…</code> — one fresh probe. Responds <code>402</code> with <code>PAYMENT-REQUIRED</code> until a <code>PAYMENT-SIGNATURE</code> is attached.</li>
    <li><code>POST /api/v1/featured</code> — body <code>{"url":"https://…","title":"Name"}</code>. Same payment flow. The listing is pinned on this page.</li>
    <li><code>GET /discovery/resources</code> — the paid routes, in the x402 discovery shape.</li>
  </ul>
</main>
</body>
</html>`
}
