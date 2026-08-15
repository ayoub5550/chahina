/**
 * Chargily Pay v2 (Algeria — CIB / EDAHABIA) integration.
 * Docs: https://dev.chargily.com/pay-v2
 * Env: CHARGILY_SECRET_KEY (test_sk_... or live_sk_...), CHARGILY_MODE=test|live, PUBLIC_URL
 */
const crypto = require("crypto");

const MODE = process.env.CHARGILY_MODE || "test";
const SECRET = process.env.CHARGILY_SECRET_KEY || "";
const BASE = MODE === "live" ? "https://pay.chargily.net/api/v2" : "https://pay.chargily.net/test/api/v2";

const enabled = () => Boolean(SECRET);

async function api(pathname, { method = "GET", body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { Authorization: `Bearer ${SECRET}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(`Chargily ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

/** Creates a hosted checkout and returns { id, url }. amount is in DZD. */
async function createCheckout({ amount, locale = "ar", description, successUrl, failureUrl, webhookUrl, metadata }) {
  const payload = {
    amount: Math.round(Number(amount)),
    currency: "dzd",
    success_url: successUrl,
    failure_url: failureUrl,
    webhook_endpoint: webhookUrl,
    description,
    locale: ["ar", "fr", "en"].includes(locale) ? locale : "ar",
    pass_fees_to_customer: true,
    metadata: metadata ? [metadata] : undefined,
  };
  const out = await api("/checkouts", { method: "POST", body: payload });
  return { id: out.id, url: out.checkout_url || out.url, raw: out };
}

async function retrieveCheckout(id) {
  return api(`/checkouts/${id}`);
}

/** Webhook authenticity: HMAC-SHA256 of the raw body with the API secret key. */
function verifySignature(rawBody, signature) {
  if (!signature || !SECRET) return false;
  const computed = crypto.createHmac("sha256", SECRET).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}

module.exports = { enabled, createCheckout, retrieveCheckout, verifySignature, MODE, BASE };
