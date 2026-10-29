/**
 * Featured listings live in one JSON file so a single instance survives restarts
 * without a database. Writes are serialized and swapped into place with rename.
 */
import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export function createStore(filePath) {
  let chain = Promise.resolve()
  let listings = []
  let loaded = false

  function queue(fn) {
    const run = chain.then(fn, fn)
    chain = run.then(() => {}, () => {})
    return run
  }

  async function load() {
    if (loaded) return
    loaded = true
    if (!filePath) return
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"))
      listings = Array.isArray(parsed.listings) ? parsed.listings : []
    } catch (err) {
      if (err?.code !== "ENOENT") throw err
      listings = []
    }
  }

  async function persist() {
    if (!filePath) return
    await mkdir(dirname(filePath), { recursive: true })
    const tmp = `${filePath}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify({ listings }, null, 2))
    await rename(tmp, filePath)
  }

  return {
    add(input) {
      return queue(async () => {
        await load()
        const created = input.now ?? Date.now()
        const listing = {
          id: randomUUID(),
          url: input.url,
          title: input.title,
          payer: input.payer || null,
          createdAt: new Date(created).toISOString(),
          expiresAt: new Date(created + input.hours * 60 * 60 * 1000).toISOString(),
        }
        listings.push(listing)
        await persist()
        return listing
      })
    },
    remove(id) {
      return queue(async () => {
        await load()
        listings = listings.filter((listing) => listing.id !== id)
        await persist()
      })
    },
    list(now = Date.now()) {
      return queue(async () => {
        await load()
        return listings
          .filter((listing) => Date.parse(listing.expiresAt) > now)
          .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
      })
    },
  }
}
