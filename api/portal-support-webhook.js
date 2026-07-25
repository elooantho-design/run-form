/* global Buffer, process */
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { PORTAL_SUPPORT_CONFIG, normalizeSupportType } from "../src/lib/portalSupportConfig.js";
import { sendPortalJson } from "./_portal-auth.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

async function readRawBody(req) {
  if (req.rawBody) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body, "utf8");
  if (req.body && typeof req.body === "object") {
    throw new Error("Corps brut webhook indisponible. La signature Stripe ne peut pas etre verifiee.");
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseStripeSignature(header) {
  const result = {};
  for (const part of String(header || "").split(",")) {
    const [key, value] = part.split("=");
    if (!key || !value) continue;
    if (!result[key]) result[key] = [];
    result[key].push(value);
  }
  return result;
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const endpointSecret = cleanText(process.env.STRIPE_WEBHOOK_SECRET);
  if (!endpointSecret) throw new Error("STRIPE_WEBHOOK_SECRET manquante cote serveur.");

  const signature = parseStripeSignature(signatureHeader);
  const timestamp = Number(signature.t?.[0] || 0);
  const signatures = signature.v1 || [];
  if (!timestamp || !signatures.length) throw new Error("Signature Stripe invalide.");

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) throw new Error("Signature Stripe expiree.");

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto.createHmac("sha256", endpointSecret).update(signedPayload).digest("hex");
  const expectedBuffer = Buffer.from(expected);

  const valid = signatures.some((providedSignature) => {
    const providedBuffer = Buffer.from(providedSignature);
    return providedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  });

  if (!valid) throw new Error("Signature Stripe refusee.");
}

function stripeTimestampToIso(value) {
  const seconds = Number(value || 0);
  if (!seconds) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

function getStripeMetadata(object) {
  return {
    ...(object?.metadata || {}),
    ...(object?.subscription_details?.metadata || {}),
    ...(object?.parent?.subscription_details?.metadata || {}),
  };
}

async function markWebhookEvent(eventId, payload) {
  if (!eventId) return;
  await supabase.from("portal_support_webhook_events").update(payload).eq("event_id", eventId);
}

async function insertWebhookEvent(event) {
  const { error } = await supabase.from("portal_support_webhook_events").insert({
    provider: "stripe",
    event_id: event.id,
    event_type: event.type,
    status: "processing",
    metadata: {
      api_version: event.api_version || "",
      created: event.created || null,
    },
  });

  if (error?.code === "23505") return { duplicate: true };
  if (error) throw error;
  return { duplicate: false };
}

async function updatePaymentByMetadataOrSession(session, payload) {
  const metadata = getStripeMetadata(session);
  const paymentId = cleanText(metadata.portal_support_payment_id, 80);
  const sessionId = cleanText(session?.id, 100);

  let query = supabase.from("portal_support_payments").update(payload);
  if (paymentId) {
    query = query.eq("id", paymentId);
  } else if (sessionId) {
    query = query.eq("stripe_checkout_session_id", sessionId);
  } else {
    return null;
  }

  const { data, error } = await query.select("*").limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function findSubscriptionContext(subscriptionId, customerId) {
  const cleanSubscriptionId = cleanText(subscriptionId, 120);
  const cleanCustomerId = cleanText(customerId, 120);

  let query = supabase
    .from("portal_support_payments")
    .select("member_id, donor_public_name, donor_message, display_publicly, anonymous, amount_cents, support_type")
    .order("created_at", { ascending: false })
    .limit(1);

  if (cleanSubscriptionId) {
    query = query.eq("stripe_subscription_id", cleanSubscriptionId);
  } else if (cleanCustomerId) {
    query = query.eq("stripe_customer_id", cleanCustomerId);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function handleCheckoutSessionCompleted(session) {
  const supportType = normalizeSupportType(getStripeMetadata(session).support_type);
  const status = supportType === "monthly" ? "active" : "confirmed";
  const paidAt = supportType === "monthly" ? null : stripeTimestampToIso(session.created);

  await updatePaymentByMetadataOrSession(session, {
    status,
    amount_cents: Number(session.amount_total || session.amount_subtotal || 0),
    currency: cleanText(session.currency || PORTAL_SUPPORT_CONFIG.currency).toLowerCase(),
    stripe_checkout_session_id: session.id || null,
    stripe_payment_intent_id: session.payment_intent || null,
    stripe_subscription_id: session.subscription || null,
    stripe_customer_id: session.customer || null,
    paid_at: paidAt,
    metadata: {
      stripe_payment_status: session.payment_status || "",
      checkout_mode: session.mode || "",
      completed_at: new Date().toISOString(),
    },
  });
}

async function handleCheckoutSessionAsyncFailed(session) {
  await updatePaymentByMetadataOrSession(session, {
    status: "failed",
    stripe_checkout_session_id: session.id || null,
    stripe_payment_intent_id: session.payment_intent || null,
    stripe_customer_id: session.customer || null,
    metadata: {
      stripe_payment_status: session.payment_status || "",
      failed_at: new Date().toISOString(),
    },
  });
}

async function handleInvoicePaid(invoice) {
  const invoiceId = cleanText(invoice.id, 120);
  if (!invoiceId) return;

  const subscriptionId = invoice.subscription || invoice.parent?.subscription_details?.subscription || "";
  const customerId = invoice.customer || "";
  const context = await findSubscriptionContext(subscriptionId, customerId);
  const metadata = getStripeMetadata(invoice);
  const paidAt = stripeTimestampToIso(invoice.status_transitions?.paid_at || invoice.created);

  const payload = {
    support_type: "monthly",
    amount_cents: Number(invoice.amount_paid || 0),
    currency: cleanText(invoice.currency || PORTAL_SUPPORT_CONFIG.currency).toLowerCase(),
    status: "confirmed",
    paid_at: paidAt,
    member_id: context?.member_id || cleanText(metadata.portal_member_id, 80) || null,
    donor_public_name: context?.donor_public_name || null,
    donor_message: context?.donor_message || null,
    display_publicly: Boolean(context?.display_publicly),
    anonymous: context ? Boolean(context.anonymous) : true,
    stripe_invoice_id: invoiceId,
    stripe_subscription_id: cleanText(subscriptionId, 120) || null,
    stripe_customer_id: cleanText(customerId, 120) || null,
    metadata: {
      invoice_number: invoice.number || "",
      billing_reason: invoice.billing_reason || "",
      handled_at: new Date().toISOString(),
    },
  };

  const existing = await supabase
    .from("portal_support_payments")
    .select("id")
    .eq("stripe_invoice_id", invoiceId)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const { error } = await supabase
      .from("portal_support_payments")
      .update(payload)
      .eq("id", existing.data.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("portal_support_payments").insert(payload);
  if (error) throw error;
}

async function handleInvoicePaymentFailed(invoice) {
  const invoiceId = cleanText(invoice.id, 120);
  if (!invoiceId) return;

  const subscriptionId = invoice.subscription || invoice.parent?.subscription_details?.subscription || "";
  const customerId = invoice.customer || "";
  const context = await findSubscriptionContext(subscriptionId, customerId);

  const payload = {
    support_type: "monthly",
    amount_cents: Number(invoice.amount_due || invoice.amount_remaining || 0),
    currency: cleanText(invoice.currency || PORTAL_SUPPORT_CONFIG.currency).toLowerCase(),
    status: "failed",
    member_id: context?.member_id || null,
    stripe_invoice_id: invoiceId,
    stripe_subscription_id: cleanText(subscriptionId, 120) || null,
    stripe_customer_id: cleanText(customerId, 120) || null,
    metadata: {
      invoice_number: invoice.number || "",
      billing_reason: invoice.billing_reason || "",
      failed_at: new Date().toISOString(),
    },
  };

  const existing = await supabase
    .from("portal_support_payments")
    .select("id")
    .eq("stripe_invoice_id", invoiceId)
    .maybeSingle();

  if (existing.error) throw existing.error;

  if (existing.data?.id) {
    const { error } = await supabase.from("portal_support_payments").update(payload).eq("id", existing.data.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("portal_support_payments").insert(payload);
  if (error) throw error;
}

async function handleSubscriptionEvent(subscription, eventType) {
  const subscriptionId = cleanText(subscription.id, 120);
  if (!subscriptionId) return;

  const status = eventType === "customer.subscription.deleted" ? "canceled" : "active";
  const { error } = await supabase
    .from("portal_support_payments")
    .update({
      status,
      stripe_customer_id: subscription.customer || null,
      metadata: {
        stripe_subscription_status: subscription.status || "",
        current_period_end: subscription.current_period_end || null,
        handled_event: eventType,
        handled_at: new Date().toISOString(),
      },
    })
    .eq("stripe_subscription_id", subscriptionId)
    .in("status", ["pending", "active", "failed"]);

  if (error) throw error;
}

async function handleChargeRefunded(charge) {
  const paymentIntentId = cleanText(charge.payment_intent, 120);
  if (!paymentIntentId) return;

  const { error } = await supabase
    .from("portal_support_payments")
    .update({
      status: "refunded",
      metadata: {
        refunded: Boolean(charge.refunded),
        amount_refunded: charge.amount_refunded || 0,
        refunded_at: new Date().toISOString(),
      },
    })
    .eq("stripe_payment_intent_id", paymentIntentId);

  if (error) throw error;
}

async function processStripeEvent(event) {
  const object = event.data?.object || {};

  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await handleCheckoutSessionCompleted(object);
    return;
  }

  if (event.type === "checkout.session.async_payment_failed") {
    await handleCheckoutSessionAsyncFailed(object);
    return;
  }

  if (event.type === "invoice.paid") {
    await handleInvoicePaid(object);
    return;
  }

  if (event.type === "invoice.payment_failed") {
    await handleInvoicePaymentFailed(object);
    return;
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    await handleSubscriptionEvent(object, event.type);
    return;
  }

  if (event.type === "charge.refunded") {
    await handleChargeRefunded(object);
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendPortalJson(res, 405, { error: "Method not allowed" });
    return;
  }

  let event;
  try {
    const rawBody = await readRawBody(req);
    verifyStripeSignature(rawBody, req.headers["stripe-signature"]);
    event = JSON.parse(rawBody.toString("utf8"));
  } catch (error) {
    sendPortalJson(res, 400, { error: error?.message || "Webhook Stripe refuse." });
    return;
  }

  try {
    const insertResult = await insertWebhookEvent(event);
    if (insertResult.duplicate) {
      sendPortalJson(res, 200, { received: true, duplicate: true });
      return;
    }

    await processStripeEvent(event);
    await markWebhookEvent(event.id, {
      status: "processed",
      processed_at: new Date().toISOString(),
      error: null,
    });

    sendPortalJson(res, 200, { received: true });
  } catch (error) {
    if (event?.id) {
      await markWebhookEvent(event.id, {
        status: "failed",
        processed_at: new Date().toISOString(),
        error: error?.message || "Erreur traitement webhook.",
      });
    }

    sendPortalJson(res, 500, { error: error?.message || "Erreur traitement webhook." });
  }
}
