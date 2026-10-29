/**
 * x402 v2 resource-server side.
 *
 * The payee is whatever X402_PAY_TO says. There is no baked-in wallet:
 * a default address would send other people's USDC somewhere the operator
 * does not control. Settlement is delegated to a facilitator the operator
 * chooses; this process never holds a key and never signs a transaction.
 */
import { parseRequirements } from "./index.js"

const KNOWN_ASSETS = {
  "eip155:8453": {
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    name: "USD Coin",
    version: "2",
  },
  "eip155:84532": {
    asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    name: "USDC",
    version: "2",
  },
  "eip155:1": {
    asset: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    name: "USD Coin",
    version: "2",
  },
}

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

function atomic(name, value, fallback) {
  const raw = value === undefined || value === "" ? fallback : String(value).trim()
  if (!/^[1-9][0-9]{0,17}$/.test(raw)) {
    return { error: `${name} must be a positive integer of atomic token units (for example 10000 for $0.01 USDC)` }
  }
  return { value: raw }
}

function integerIn(name, value, fallback, min, max) {
  const raw = value === undefined || value === "" ? String(fallback) : String(value).trim()
  if (!/^[0-9]+$/.test(raw)) return { error: `${name} must be an integer` }
  const number = Number(raw)
  if (!Number.isInteger(number) || number < min || number > max) {
    return { error: `${name} must be between ${min} and ${max}` }
  }
  return { value: number }
}

function payeeError(payTo) {
  if (!payTo) return null
  if (EVM_ADDRESS.test(payTo) || SOLANA_ADDRESS.test(payTo)) return null
  return "X402_PAY_TO must be an EVM address (0x + 40 hex) or a Solana address"
}

function facilitatorOf(value) {
  if (!value) return { value: "" }
  let url
  try {
    url = new URL(String(value).trim())
  } catch {
    return { error: "X402_FACILITATOR_URL must be an absolute http(s) URL" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { error: "X402_FACILITATOR_URL must be an absolute http(s) URL" }
  }
  return { value: url.href.replace(/\/$/, "") }
}

/** Read payment settings from the environment. `error` is set when a provided value is unusable. */
export function paymentConfig(env = process.env) {
  const errors = []
  const network = (env.X402_NETWORK || "eip155:8453").trim()
  if (!/^[a-z0-9]{2,16}:[A-Za-z0-9]{1,64}$/.test(network)) errors.push("X402_NETWORK must be a CAIP-2 id such as eip155:8453")

  const known = KNOWN_ASSETS[network]
  let asset = (env.X402_ASSET || "").trim()
  if (!asset) {
    if (known) asset = known.asset
    else if (network) errors.push("X402_ASSET is required when X402_NETWORK has no built-in USDC address")
  } else if (network.startsWith("eip155:") && !EVM_ADDRESS.test(asset)) {
    errors.push("X402_ASSET must be an EVM contract address on an eip155 network")
  }

  const payTo = (env.X402_PAY_TO || "").trim()
  if (payTo && network.startsWith("eip155:") && !EVM_ADDRESS.test(payTo)) {
    errors.push("X402_PAY_TO must be an EVM address (0x + 40 hex) on an eip155 network")
  } else if (payTo && network.startsWith("solana:") && !SOLANA_ADDRESS.test(payTo)) {
    errors.push("X402_PAY_TO must be a Solana address on a solana network")
  } else {
    const payee = payeeError(payTo)
    if (payee) errors.push(payee)
  }

  const facilitator = facilitatorOf(env.X402_FACILITATOR_URL)
  if (facilitator.error) errors.push(facilitator.error)

  const probe = atomic("X402_PROBE_AMOUNT", env.X402_PROBE_AMOUNT, "10000")
  const featured = atomic("X402_FEATURED_AMOUNT", env.X402_FEATURED_AMOUNT, "1000000")
  const hours = integerIn("X402_FEATURED_HOURS", env.X402_FEATURED_HOURS, 168, 1, 8760)
  const timeout = integerIn("X402_TIMEOUT_SECONDS", env.X402_TIMEOUT_SECONDS, 300, 15, 3600)
  for (const item of [probe, featured, hours, timeout]) if (item.error) errors.push(item.error)

  const configured = Boolean(payTo) && Boolean(facilitator.value) && errors.length === 0
  return {
    error: errors[0] || null,
    errors,
    payTo,
    network,
    asset,
    assetName: (env.X402_ASSET_NAME || known?.name || "USD Coin").trim(),
    assetVersion: (env.X402_ASSET_VERSION || known?.version || "2").trim(),
    facilitatorUrl: facilitator.value || "",
    facilitatorToken: (env.X402_FACILITATOR_TOKEN || "").trim(),
    probeAmount: probe.value || "10000",
    featuredAmount: featured.value || "1000000",
    featuredHours: hours.value || 168,
    maxTimeoutSeconds: timeout.value || 300,
    serviceName: "x402-priceboard",
    configured,
    missing: [
      payTo ? null : "X402_PAY_TO",
      facilitator.value ? null : "X402_FACILITATOR_URL",
    ].filter(Boolean),
  }
}

export function encodePaymentHeader(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64")
}

export function decodePaymentHeader(value) {
  return parseRequirements(typeof value === "string" ? value : "")
}

export function buildPaymentRequired(config, { url, description, amount }) {
  const extra = { name: config.assetName, version: config.assetVersion }
  // eip3009 is the default exact-scheme pull on EVM USDC. Other networks leave it off
  // so the client is not told to build an EIP-3009 payload for Solana.
  if (config.network.startsWith("eip155:")) extra.assetTransferMethod = "eip3009"
  return {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource: {
      url,
      description,
      mimeType: "application/json",
      serviceName: config.serviceName,
      tags: ["x402", "pricing"],
    },
    accepts: [{
      scheme: "exact",
      network: config.network,
      amount: String(amount),
      asset: config.asset,
      payTo: config.payTo,
      maxTimeoutSeconds: config.maxTimeoutSeconds,
      extra,
    }],
  }
}

function sameAccount(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false
  if (left.startsWith("0x") || left.startsWith("0X") || right.startsWith("0x") || right.startsWith("0X")) {
    return left.toLowerCase() === right.toLowerCase()
  }
  return left === right
}

/**
 * Reject a payload that does not match the quote we issued, before any facilitator call.
 * Cryptographic checks stay with the facilitator; this only stops a swapped payee or amount.
 */
export function payloadMismatch(payload, requirements) {
  if (!payload || typeof payload !== "object") return "invalid_payload"
  if (payload.x402Version !== 2) return "invalid_x402_version"
  const accepted = payload.accepted
  if (!accepted || typeof accepted !== "object") return "invalid_payload"
  if (accepted.scheme !== requirements.scheme) return "invalid_scheme"
  if (accepted.network !== requirements.network) return "invalid_network"
  if (String(accepted.amount) !== String(requirements.amount)) return "invalid_exact_evm_payload_authorization_value_mismatch"
  if (!sameAccount(accepted.asset, requirements.asset)) return "invalid_payload"
  if (!sameAccount(accepted.payTo, requirements.payTo)) return "invalid_exact_evm_payload_recipient_mismatch"
  if (!payload.payload || typeof payload.payload !== "object") return "invalid_payload"
  const authorization = payload.payload.authorization
  if (authorization && typeof authorization === "object") {
    if (authorization.to && !sameAccount(authorization.to, requirements.payTo)) {
      return "invalid_exact_evm_payload_recipient_mismatch"
    }
    if (authorization.value !== undefined && String(authorization.value) !== String(requirements.amount)) {
      return "invalid_exact_evm_payload_authorization_value_mismatch"
    }
  }
  return null
}

export function joinUrl(base, path) {
  const root = base.endsWith("/") ? base : `${base}/`
  return new URL(String(path).replace(/^\//, ""), root).href
}

function facilitatorHeaders(config) {
  const headers = { "content-type": "application/json", accept: "application/json" }
  if (config.facilitatorToken) headers.authorization = `Bearer ${config.facilitatorToken}`
  return headers
}

async function postFacilitator(config, path, body, fetchImpl, timeoutMs) {
  const response = await fetchImpl(joinUrl(config.facilitatorUrl, path), {
    method: "POST",
    headers: facilitatorHeaders(config),
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  })
  const data = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, data }
}

export async function verifyPayment({ config, payload, requirements, fetchImpl = fetch }) {
  const { ok, data } = await postFacilitator(config, "verify", {
    x402Version: 2,
    paymentPayload: payload,
    paymentRequirements: requirements,
  }, fetchImpl, 20_000)
  if (!ok || !data || data.isValid !== true) {
    return { ok: false, reason: data?.invalidReason || "unexpected_verify_error", payer: data?.payer || null }
  }
  return { ok: true, payer: typeof data.payer === "string" ? data.payer : null }
}

export async function settlePayment({ config, payload, requirements, fetchImpl = fetch }) {
  const { ok, data } = await postFacilitator(config, "settle", {
    x402Version: 2,
    paymentPayload: payload,
    paymentRequirements: requirements,
  }, fetchImpl, 45_000)
  if (!ok || !data || data.success !== true) {
    return { ok: false, reason: data?.errorReason || "unexpected_settle_error" }
  }
  if (data.network && data.network !== requirements.network) {
    return { ok: false, reason: "invalid_network" }
  }
  const response = {
    success: true,
    transaction: typeof data.transaction === "string" ? data.transaction : "",
    network: requirements.network,
  }
  if (typeof data.payer === "string") response.payer = data.payer
  if (typeof data.amount === "string") response.amount = data.amount
  return { ok: true, response }
}
