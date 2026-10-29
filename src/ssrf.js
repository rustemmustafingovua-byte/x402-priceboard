/**
 * Reject probe targets that point at the machine running the board.
 * The paid API takes a URL from the caller, so a private or link-local
 * address would let them read cloud metadata through us.
 */
import { lookup as dnsLookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

const blocked = new BlockList()
blocked.addSubnet("0.0.0.0", 8, "ipv4")
blocked.addSubnet("10.0.0.0", 8, "ipv4")
blocked.addSubnet("100.64.0.0", 10, "ipv4")
blocked.addSubnet("127.0.0.0", 8, "ipv4")
blocked.addSubnet("169.254.0.0", 16, "ipv4")
blocked.addSubnet("172.16.0.0", 12, "ipv4")
blocked.addSubnet("192.168.0.0", 16, "ipv4")
blocked.addSubnet("224.0.0.0", 4, "ipv4")
blocked.addAddress("::", "ipv6")
blocked.addAddress("::1", "ipv6")
blocked.addSubnet("fc00::", 7, "ipv6")
blocked.addSubnet("fe80::", 10, "ipv6")
blocked.addSubnet("ff00::", 8, "ipv6")

const BLOCKED_NAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "metadata.google.com",
])

export function isBlockedIp(address) {
  if (typeof address !== "string" || !address) return true
  let ip = address.trim().toLowerCase()
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) ip = mapped[1]
  const family = isIP(ip)
  if (family === 0) return true
  return blocked.check(ip, family === 6 ? "ipv6" : "ipv4")
}

export async function defaultLookup(hostname) {
  return dnsLookup(hostname, { all: true, verbatim: true })
}

/**
 * @returns {{ok: true, url: URL} | {ok: false, error: string}}
 */
export async function inspectUrl(raw, lookup = defaultLookup) {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "invalid_url" }
  if (raw.length > 2000) return { ok: false, error: "invalid_url" }
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, error: "invalid_url" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "unsupported_protocol" }
  if (url.username || url.password) return { ok: false, error: "credentials_in_url" }
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase()
  if (!host || BLOCKED_NAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".local")) {
    return { ok: false, error: "blocked_host" }
  }
  if (isIP(host)) {
    if (isBlockedIp(host)) return { ok: false, error: "blocked_address" }
    return { ok: true, url }
  }
  let records
  try {
    records = await lookup(host)
  } catch {
    return { ok: false, error: "dns_failed" }
  }
  const list = Array.isArray(records) ? records : [records]
  if (!list.length) return { ok: false, error: "dns_failed" }
  for (const record of list) {
    const address = typeof record === "string" ? record : record?.address
    if (isBlockedIp(address)) return { ok: false, error: "blocked_address" }
  }
  return { ok: true, url }
}
