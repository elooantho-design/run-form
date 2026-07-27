/* global Buffer, process */
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { PORTAL_SUPPORT_CONFIG, normalizeSupportType } from "../src/lib/portalSupportConfig.js";
import { sendPortalJson } from "./_portal-auth.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_portal_webhook_verification");

export const config = {
  api: {
    bodyParser: false,
  },
};

class StripeWebhookConfigError extends Error {}
class StripeWebhookVerificationError extends Error {}

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function logWebhookDiagnostic(stage, details = {}) {
  console.log(
    "[portal-support-webhook]",
    JSON.stringify({
      stage,
      runtime: "vercel-node-stream",
      ...details,
    }),
  );
}

function getStripeWebhookSecret() {
  const endpointSecret = cleanText(process.env.STRIPE_WEBHOOK_SECRET, 500);
  if (!endpointSecret) {
    throw new StripeWebhookConfigError("STRIPE_WEBHOOK_SECRET manquante cote serveur.");
  }
  if (!endpointSecret.startsWith("whsec_")) {
    throw new StripeWebhookConfigError("STRIPE_WEBHOOK_SECRET invalide cote serveur.");
  }
  return endpointSecret;
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks);
  if (!rawBody.length) {
    throw new StripeWebhookVerificationError("Payload Stripe vide.");
  }
  return rawBody;
}

export function constructStripeWebhookEvent(rawBody, signatureHeader) {
  const endpointSecret = getStripeWebhookSecret();
  if (!signatureHeader) {
    throw new StripeWebhookVerificationError("Header stripe-signature manquant.");
  }

  try {
    return stripe.webhooks.constructEvent(rawBody, signatureHeader, endpointSecret);
  } catch (error) {
    throw new StripeWebhookVerificationError(error?.message || "Signature Stripe refusee.");
  }
}

function getHeader(req, name) {
  const lower = name.toLowerCase();
  return req.headers?.[lower] || req.headers?.[name] || "";
}

function isLocalSignatureTest(req) {
  return process.env.NODE_ENV === "test" && getHeader(req, "x-portal-webhook-test-mode") === "1";
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
    livemode: Boolean(event.livemode),
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
  const oneTimePaid = session.payment_status === "paid";
  const status = supportType === "monthly" ? "active" : oneTimePaid ? "confirmed" : "pending";
  const paidAt = supportType === "monthly" || !oneTimePaid ? null : stripeTimestampToIso(session.created);

  await updatePaymentByMetadataOrSession(session, {
    status,
    amount_cents: Number(session.amount_total || session.amount_subtotal || 0),
    currency: cleanText(session.currency || PORTAL_SUPPORT_CONFIG.currency).toLowerCase(),
    livemode: Boolean(session.livemode),
    stripe_checkout_session_id: session.id || null,
    stripe_payment_intent_id: session.payment_intent || null,
    stripe_subscription_id: session.subscription || null,
    stripe_customer_id: session.customer || null,
    paid_at: paidAt,
    metadata: {
      stripe_payment_status: session.payment_status || "",
      checkout_mode: session.mode || "",
      livemode: Boolean(session.livemode),
      completed_at: new Date().toISOString(),
    },
  });
}

async function handleCheckoutSessionAsyncFailed(session) {
  await updatePaymentByMetadataOrSession(session, {
    status: "failed",
    livemode: Boolean(session.livemode),
    stripe_checkout_session_id: session.id || null,
    stripe_payment_intent_id: session.payment_intent || null,
    stripe_customer_id: session.customer || null,
    metadata: {
      stripe_payment_status: session.payment_status || "",
      livemode: Boolean(session.livemode),
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
    livemode: Boolean(invoice.livemode),
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
      livemode: Boolean(invoice.livemode),
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
    livemode: Boolean(invoice.livemode),
    member_id: context?.member_id || null,
    stripe_invoice_id: invoiceId,
    stripe_subscription_id: cleanText(subscriptionId, 120) || null,
    stripe_customer_id: cleanText(customerId, 120) || null,
    metadata: {
      invoice_number: invoice.number || "",
      billing_reason: invoice.billing_reason || "",
      livemode: Boolean(invoice.livemode),
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
      livemode: Boolean(subscription.livemode),
      stripe_customer_id: subscription.customer || null,
      metadata: {
        stripe_subscription_status: subscription.status || "",
        current_period_end: subscription.current_period_end || null,
        livemode: Boolean(subscription.livemode),
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

  const amountRefundedCents = Math.max(0, Number(charge.amount_refunded || 0));
  const existing = await supabase
    .from("portal_support_payments")
    .select("id, amount_cents")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (existing.error) throw existing.error;

  const amountCents = Number(existing.data?.amount_cents || charge.amount || 0);
  const fullyRefunded = Boolean(charge.refunded) || (amountCents > 0 && amountRefundedCents >= amountCents);

  const { error } = await supabase
    .from("portal_support_payments")
    .update({
      status: fullyRefunded ? "refunded" : "confirmed",
      livemode: Boolean(charge.livemode),
      amount_refunded_cents: amountRefundedCents,
      metadata: {
        refunded: Boolean(charge.refunded),
        amount_refunded: amountRefundedCents,
        livemode: Boolean(charge.livemode),
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
    const stripeSignature = getHeader(req, "stripe-signature");
    const rawBody = await readRawBody(req);

    logWebhookDiagnostic("raw_body_read", {
      hasStripeSignature: Boolean(stripeSignature),
      parsedBodyType: typeof req.body,
      parsedBodyIsBuffer: Buffer.isBuffer(req.body),
      rawBodyType: typeof rawBody,
      isBuffer: Buffer.isBuffer(rawBody),
      reqReadable: Boolean(req.readable),
      rawBodyLength: rawBody.length,
    });

    event = constructStripeWebhookEvent(rawBody, stripeSignature);

    logWebhookDiagnostic("signature_verified", {
      eventType: event.type || "",
      hasEventId: Boolean(event.id),
    });
  } catch (error) {
    const isConfigError = error instanceof StripeWebhookConfigError;
    const status = isConfigError ? 500 : 400;
    logWebhookDiagnostic(isConfigError ? "config_error" : "signature_failed", {
      errorType: error?.constructor?.name || "Error",
      message: error?.message || "Webhook Stripe refuse.",
    });
    sendPortalJson(res, status, { error: error?.message || "Webhook Stripe refuse." });
    return;
  }

  if (isLocalSignatureTest(req)) {
    sendPortalJson(res, 200, {
      received: true,
      testMode: true,
      eventId: event.id,
      eventType: event.type,
    });
    return;
  }

  try {
    const insertResult = await insertWebhookEvent(event);
    if (insertResult.duplicate) {
      logWebhookDiagnostic("duplicate_event", {
        eventType: event.type || "",
        hasEventId: Boolean(event.id),
      });
      sendPortalJson(res, 200, { received: true, duplicate: true });
      return;
    }

    await processStripeEvent(event);
    await markWebhookEvent(event.id, {
      status: "processed",
      processed_at: new Date().toISOString(),
      error: null,
    });

    logWebhookDiagnostic("processed", {
      eventType: event.type || "",
      hasEventId: Boolean(event.id),
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

    logWebhookDiagnostic("processing_failed", {
      eventType: event?.type || "",
      hasEventId: Boolean(event?.id),
      message: error?.message || "Erreur traitement webhook.",
    });
    sendPortalJson(res, 500, { error: error?.message || "Erreur traitement webhook." });
  }
}
