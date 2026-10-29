import { test } from "node:test"
import assert from "node:assert/strict"
import {
  buildPaymentRequired,
  decodePaymentHeader,
  encodePaymentHeader,
  joinUrl,
  payloadMismatch,
  paymentConfig,
  settlePayment,
  verifyPayment,
} from "../src/payment.js"

const WALLET = "0x1111111111111111111111111111111111111111"

function configured(overrides = {}) {
  return paymentConfig({
    X402_PAY_TO: WALLET,
    X402_FACILITATOR_URL: "https://facilitator.example/x402",
    ...overrides,
  })
}

test("there is no default receiving wallet", () => {
  const config = paymentConfig({})
  assert.equal(config.payTo, "")
  assert.equal(config.configured, false)
  assert.deepEqual(config.missing, ["X402_PAY_TO", "X402_FACILITATOR_URL"])
  assert.equal(config.asset, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913")
  assert.equal(config.probeAmount, "10000")
  assert.equal(config.featuredAmount, "1000000")
})

test("Base Sepolia gets the testnet USDC address when the asset is omitted", () => {
  const config = configured({ X402_NETWORK: "eip155:84532" })
  assert.equal(config.error, null)
  assert.equal(config.asset, "0x036CbD53842c5426634e7929541eC2318f3dCF7e")
  assert.equal(config.configured, true)
})

test("rejects a wallet that cannot be paid on the selected network", () => {
  const config = paymentConfig({ X402_PAY_TO: "not-a-wallet", X402_FACILITATOR_URL: "https://facilitator.example" })
  assert.match(config.error, /X402_PAY_TO/)
  assert.equal(config.configured, false)
})

test("rejects a zero or fractional price", () => {
  assert.match(paymentConfig({ X402_PROBE_AMOUNT: "0" }).error, /X402_PROBE_AMOUNT/)
  assert.match(paymentConfig({ X402_FEATURED_AMOUNT: "1.5" }).error, /X402_FEATURED_AMOUNT/)
})

test("quotes the configured wallet and amount", () => {
  const config = configured({ X402_PROBE_AMOUNT: "10000" })
  const required = buildPaymentRequired(config, {
    url: "https://board.example/api/v1/probe?url=https%3A%2F%2Fx",
    description: "Fresh x402 price probe for one endpoint",
    amount: config.probeAmount,
  })
  assert.equal(required.x402Version, 2)
  assert.equal(required.accepts[0].payTo, WALLET)
  assert.equal(required.accepts[0].amount, "10000")
  assert.equal(required.accepts[0].scheme, "exact")
  assert.equal(required.accepts[0].extra.assetTransferMethod, "eip3009")
  const roundTrip = decodePaymentHeader(encodePaymentHeader(required))
  assert.equal(roundTrip.accepts[0].payTo, WALLET)
  assert.equal(joinUrl(config.facilitatorUrl, "/verify"), "https://facilitator.example/x402/verify")
})

test("refuses a payload aimed at a different payee before calling the facilitator", () => {
  const config = configured()
  const required = buildPaymentRequired(config, { url: "https://board.example/p", description: "probe", amount: "10000" })
  const swapped = {
    x402Version: 2,
    accepted: { ...required.accepts[0], payTo: "0x2222222222222222222222222222222222222222" },
    payload: { signature: "valid" },
  }
  assert.equal(payloadMismatch(swapped, required.accepts[0]), "invalid_exact_evm_payload_recipient_mismatch")
  const wrongValue = {
    x402Version: 2,
    accepted: required.accepts[0],
    payload: { signature: "valid", authorization: { to: WALLET, value: "1" } },
  }
  assert.equal(payloadMismatch(wrongValue, required.accepts[0]), "invalid_exact_evm_payload_authorization_value_mismatch")
})

test("verify then settle, and a failed verify never settles", async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, authorization: init.headers.authorization, body: JSON.parse(init.body) })
    if (String(url).endsWith("/verify")) {
      const valid = calls.length === 1
      return {
        ok: true,
        status: 200,
        json: async () => (valid
          ? { isValid: true, payer: "0x2222222222222222222222222222222222222222" }
          : { isValid: false, invalidReason: "invalid_exact_evm_payload_signature" }),
      }
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        transaction: "0xtx",
        network: "eip155:8453",
        payer: "0x2222222222222222222222222222222222222222",
      }),
    }
  }
  const config = paymentConfig({
    X402_PAY_TO: WALLET,
    X402_FACILITATOR_URL: "https://facilitator.example/x402",
    X402_FACILITATOR_TOKEN: "secret-token",
  })
  const requirements = buildPaymentRequired(config, { url: "https://b/p", description: "probe", amount: "10000" }).accepts[0]
  const payload = { x402Version: 2, accepted: requirements, payload: { signature: "valid" } }
  const verified = await verifyPayment({ config, payload, requirements, fetchImpl })
  assert.equal(verified.ok, true)
  const settled = await settlePayment({ config, payload, requirements, fetchImpl })
  assert.equal(settled.response.transaction, "0xtx")
  assert.equal(calls[0].authorization, "Bearer secret-token")
  assert.equal(calls[0].body.paymentRequirements.payTo, WALLET)

  const rejected = await verifyPayment({ config, payload, requirements, fetchImpl })
  assert.equal(rejected.ok, false)
  assert.equal(calls.filter((call) => call.url.endsWith("/settle")).length, 1)
})
