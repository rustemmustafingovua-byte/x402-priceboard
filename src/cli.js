/**
 * CLI for the local price board. Probing from here is free: the payment, if
 * any, is whatever the target endpoint charges, and this tool never sends one.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { board, formatUsd, toMarkdown } from "./index.js"

const root = dirname(fileURLToPath(import.meta.url))
const VERSION = JSON.parse(readFileSync(join(root, "../package.json"), "utf8")).version

const HELP = `x402-priceboard — the price list of x402 endpoints, without paying anything.

USAGE
  x402-priceboard https://api.venice.ai/api/v1/chat/completions
  x402-priceboard --file endpoints.txt --markdown
  x402-priceboard --file endpoints.txt --json

OPTIONS
  --file <path>       read endpoints from a file (one URL per line, # comments allowed)
  --post              send POST instead of GET when probing
  --markdown          render the board as Markdown
  --json              render the board as JSON
  --timeout <ms>      per-endpoint timeout (default 20000)
  --concurrency <n>   how many probes run at once (default 5)
  --help, -h          show this help
  --version, -V       print ${VERSION}

The hosted board and its paid API are a separate process: npm start
`

function flag(args, name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function readList(path, stderr) {
  let text
  try {
    text = readFileSync(path, "utf8")
  } catch (err) {
    if (err?.code === "ENOENT") {
      stderr(`file not found: ${path}`)
      return { error: true, urls: [] }
    }
    throw err
  }
  const urls = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    if (!/^https?:\/\//i.test(trimmed)) {
      stderr(`skipping non-http line: ${trimmed}`)
      continue
    }
    urls.push(trimmed)
  }
  return { error: false, urls }
}

function renderText(data) {
  const listed = data.rows?.length ? data.rows : data.cheapest
  const lines = ["", "  endpoint                                        network   price        payee"]
  for (const row of listed) {
    const url = row.url.length > 46 ? `${row.url.slice(0, 45)}…` : row.url
    lines.push(`  ${url.padEnd(46)}  ${String(row.networkName).padEnd(8)}  ${formatUsd(row.amountUsd).padEnd(11)} ${row.payTo}`)
  }
  if (!listed.length) lines.push("  (no priced endpoints)")
  if (data.free.length) {
    lines.push("", "  free (no payment required):")
    for (const item of data.free) lines.push(`    ${item.url}  HTTP ${item.status}`)
  }
  if (data.misses.length) {
    lines.push("", "  no price:")
    for (const item of data.misses) lines.push(`    ${item.url}  HTTP ${item.status}`)
  }
  if (data.errors.length) {
    lines.push("", "  errors:")
    for (const item of data.errors) lines.push(`    ${item.url}  ${item.error}`)
  }
  lines.push("")
  return lines.join("\n")
}

export async function main(argv = process.argv, opts = {}) {
  const stdout = opts.stdout || ((line) => console.log(line))
  const stderr = opts.stderr || ((line) => console.error(line))
  const args = argv.slice(2)
  if (args.includes("--help") || args.includes("-h")) {
    stdout(HELP)
    return 0
  }
  if (args.includes("--version") || args.includes("-V")) {
    stdout(VERSION)
    return 0
  }

  const urls = args.filter((arg) => /^https?:\/\//i.test(arg))
  const file = flag(args, "--file")
  if (args.includes("--file") && !file) {
    stderr("usage: x402-priceboard --file endpoints.txt")
    return 2
  }
  if (file) {
    const list = readList(file, stderr)
    if (list.error) return 2
    urls.push(...list.urls)
  }
  if (!urls.length) {
    stderr("usage: x402-priceboard <url> [url...] | --file endpoints.txt")
    return 2
  }

  const timeoutRaw = flag(args, "--timeout")
  const timeoutMs = timeoutRaw === undefined ? 20000 : Number(timeoutRaw)
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    stderr("--timeout must be a positive integer of milliseconds")
    return 2
  }
  const concurrencyRaw = flag(args, "--concurrency")
  const concurrency = concurrencyRaw === undefined ? 5 : Number(concurrencyRaw)
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    stderr("--concurrency must be a positive integer")
    return 2
  }

  const data = await board(urls, {
    method: args.includes("--post") ? "POST" : "GET",
    body: args.includes("--post") ? {} : undefined,
    timeoutMs,
    concurrency,
    fetchImpl: opts.fetchImpl,
    // Chat endpoints often price POST and answer GET with 404.
    retryPost: !args.includes("--post"),
  })
  if (args.includes("--json")) stdout(JSON.stringify(data, null, 2))
  else if (args.includes("--markdown")) stdout(toMarkdown(data))
  else stdout(renderText(data))
  return data.errors.length && !data.cheapest.length && !data.free.length ? 1 : 0
}
