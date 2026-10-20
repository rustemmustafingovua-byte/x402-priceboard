#!/usr/bin/env node
/**
 * x402-priceboard — the price list of x402 endpoints.
 *
 *   x402-priceboard https://api.venice.ai/api/v1/chat/completions https://pool.linkrra.com/v1/chat/completions
 *   x402-priceboard --file endpoints.txt --markdown
 */
import { readFileSync, existsSync } from "node:fs"
import { board, toMarkdown } from "../src/index.js"

const argv = process.argv.slice(2)
const arg = (n, d) => {
  const i = argv.indexOf(n)
  return i >= 0 ? argv[i + 1] : d
}
let urls = argv.filter((a) => a.startsWith("http"))
const f = arg("--file")
if (f && existsSync(f)) urls.push(...readFileSync(f, "utf8").split("\n").map((s) => s.trim()).filter(Boolean))

if (!urls.length) {
  console.error("usage: x402-priceboard <url> [url...] | --file endpoints.txt")
  process.exit(2)
}

const data = await board(urls, { method: argv.includes("--post") ? "POST" : "GET", body: argv.includes("--post") ? {} : undefined })
if (argv.includes("--markdown")) {
  console.log(toMarkdown(data))
} else {
  console.log("\n  endpoint                                        network   price        payee")
  for (const r of data.cheapest) {
    console.log(`  ${r.url.slice(0, 46).padEnd(46)}  ${r.networkName.padEnd(8)}  $${String(r.amountUsd).padEnd(10)} ${r.payTo}`)
  }
  if (data.free.length) {
    console.log("\n  free (no payment required):")
    for (const x of data.free) console.log(`    ${x.url}  HTTP ${x.status}`)
  }
  console.log()
}
