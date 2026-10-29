import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main } from "../src/cli.js"

const terms = {
  x402Version: 2,
  accepts: [
    { scheme: "exact", network: "eip155:8453", amount: "5000000", asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: "0xabc" },
  ],
}

function fetchImpl() {
  return async () => ({
    status: 402,
    headers: { get: () => Buffer.from(JSON.stringify(terms)).toString("base64") },
    body: { cancel: async () => {} },
    text: async () => "",
  })
}

test("the binary prints its version and refuses to run with no endpoints", () => {
  const version = spawnSync(process.execPath, ["bin/x402-priceboard.js", "--version"], { encoding: "utf8" })
  assert.equal(version.status, 0)
  assert.match(version.stdout, /0\.2\.0/)
  const help = spawnSync(process.execPath, ["bin/x402-priceboard.js", "--help"], { encoding: "utf8" })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /--markdown/)
  const missing = spawnSync(process.execPath, ["bin/x402-priceboard.js"], { encoding: "utf8" })
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /usage/)
})

test("markdown output comes from the payment-required header and a missing file is an error", async () => {
  const lines = []
  const code = await main(["node", "x402-priceboard", "--markdown", "https://priced.example/v1"], {
    stdout: (line) => lines.push(line),
    stderr: () => {},
    fetchImpl: fetchImpl(),
  })
  assert.equal(code, 0)
  assert.match(lines.join("\n"), /\$5 USDC/)
  assert.match(lines.join("\n"), /Base/)

  const errors = []
  const missing = await main(["node", "x402-priceboard", "--file", "test/does-not-exist.txt"], {
    stdout: () => {},
    stderr: (line) => errors.push(line),
    fetchImpl: fetchImpl(),
  })
  assert.equal(missing, 2)
  assert.match(errors.join("\n"), /file not found/)
})

test("reads a file, skips comments, and can print JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "x402-cli-"))
  const file = join(dir, "endpoints.txt")
  await writeFile(file, "# comment\n\nhttps://priced.example/v1\nnot a url\n")
  const lines = []
  const warnings = []
  const code = await main(["node", "x402-priceboard", "--json", "--file", file], {
    stdout: (line) => lines.push(line),
    stderr: (line) => warnings.push(line),
    fetchImpl: fetchImpl(),
  })
  assert.equal(code, 0)
  assert.match(warnings.join("\n"), /skipping/)
  const data = JSON.parse(lines.join("\n"))
  assert.equal(data.cheapest[0].amountUsd, 5)
  assert.equal(data.cheapest[0].payTo, "0xabc")
})
