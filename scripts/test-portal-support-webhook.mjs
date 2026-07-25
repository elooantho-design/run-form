import assert from "node:assert/strict";
import { Readable } from "node:stream";
import Stripe from "stripe";

process.env.NODE_ENV = "test";
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "sk_test_portal_webhook_unit";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_portal_webhook_unit";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature";

const { default: webhook } = await import("../api/portal-support-webhook.js");
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function buildPayload(overrides = {}) {
  return JSON.stringify({
    id: "evt_portal_support_unit",
    object: "event",
    api_version: "2024-06-20",
    created: Math.floor(Date.now() / 1000),
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_portal_support_unit",
        object: "checkout.session",
        amount_total: 500,
        currency: "eur",
        payment_status: "paid",
        mode: "payment",
        created: Math.floor(Date.now() / 1000),
        metadata: {
          portal_support_payment_id: "00000000-0000-0000-0000-000000000000",
          support_type: "one_time",
        },
      },
    },
    ...overrides,
  });
}

function signPayload(payload, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  return stripe.webhooks.generateTestHeaderString({
    payload,
    secret,
  });
}

async function callWebhook(payload, signature) {
  const req = Readable.from([Buffer.from(payload, "utf8")]);
  req.method = "POST";
  req.headers = {
    "content-type": "application/json",
    "stripe-signature": signature,
    "x-portal-webhook-test-mode": "1",
  };

  return new Promise((resolve, reject) => {
    const chunks = [];
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(chunk = "") {
        if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
        resolve({
          status: this.statusCode,
          headers,
          text: async () => Buffer.concat(chunks).toString("utf8"),
        });
      },
    };

    Promise.resolve(webhook(req, res)).catch(reject);
  });
}

const validPayload = buildPayload();
const validSignature = signPayload(validPayload);
const validResponse = await callWebhook(validPayload, validSignature);
const validResponseText = await validResponse.text();
assert.equal(validResponse.status, 200, validResponseText);

const validBody = JSON.parse(validResponseText);
assert.equal(validBody.received, true);
assert.equal(validBody.testMode, true);
assert.equal(validBody.eventType, "checkout.session.completed");

const modifiedPayload = buildPayload({ id: "evt_portal_support_tampered" });
const modifiedResponse = await callWebhook(modifiedPayload, validSignature);
assert.equal(modifiedResponse.status, 400, await modifiedResponse.text());

const wrongSignature = signPayload(validPayload, "whsec_wrong_secret");
const wrongSignatureResponse = await callWebhook(validPayload, wrongSignature);
assert.equal(wrongSignatureResponse.status, 400, await wrongSignatureResponse.text());

console.log("portal-support-webhook signature tests passed");
