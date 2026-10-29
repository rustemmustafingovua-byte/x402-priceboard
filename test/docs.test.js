import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

test("the static page renders its questions instead of a template", () => {
  const html = readFileSync(new URL("../docs/index.html", import.meta.url), "utf8")
  assert.equal(html.includes("rows.map"), false)
  assert.equal(html.includes("([q, a])"), false)
  assert.match(html, /<details>/)
  assert.match(html, /X402_PAY_TO/)
  assert.match(html, /without paying/)
})
