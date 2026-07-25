/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  PORTAL_SUPPORT_CONFIG,
  centsToEuros,
  getSupportTypeLabel,
  getSupportAmountLimitsCents,
  normalizeSupportType,
  validateSupportAmountCents,
} from "../src/lib/portalSupportConfig.js";
import {
  applyPortalCorsHeaders,
  getPortalSession,
  readJsonBody,
  requirePortalSession,
  sendPortalJson,
  verifyPortalRequestOrigin,
} from "./_portal-auth.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function isMissingSupportTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "42P01" || error?.code === "PGRST205" || message.includes("portal_support_payments");
}

function getMonthlyTargetCents() {
  const envValue = Number(process.env.PORTAL_SUPPORT_MONTHLY_TARGET_EUR);
  const targetEuros = Number.isFinite(envValue) && envValue > 0 ? envValue : PORTAL_SUPPORT_CONFIG.monthlyTargetEuros;
  return Math.round(targetEuros * 100);
}

function getCurrentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, end };
}

function getRequestOrigin(req) {
  const configured = cleanText(process.env.PORTAL_PUBLIC_URL || process.env.FORM_BASE_URL);
  if (configured) return configured.replace(/\/+$/, "");

  const protocol = cleanText(req.headers?.["x-forwarded-proto"]) || "https";
  const host = cleanText(req.headers?.["x-forwarded-host"] || req.headers?.host);
  return host ? `${protocol}://${host}` : "http://localhost:5174";
}

async function getOptionalPortalSession(req) {
  const result = await getPortalSession(req, supabase);
  if (!result?.error) return result;
  return { member: null, session: null };
}

function appendFormValue(form, key, value) {
  if (value === undefined || value === null || value === "") return;
  form.append(key, String(value));
}

async function stripeRequest(path, formValues, idempotencyKey = "") {
  const secretKey = cleanText(process.env.STRIPE_SECRET_KEY);
  if (!secretKey) {
    const error = new Error("STRIPE_SECRET_KEY manquante cote serveur.");
    error.status = 500;
    throw error;
  }

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(formValues)) {
    appendFormValue(body, key, value);
  }

  const headers = {
    Authorization: `Bearer ${secretKey}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;

  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers,
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || "Stripe ne repond pas correctement.");
    error.status = response.status;
    error.stripePayload = payload;
    throw error;
  }

  return payload;
}

function serializePayment(row) {
  return {
    id: row.id,
    supportType: row.support_type,
    amountCents: row.amount_cents || 0,
    amountEuros: centsToEuros(row.amount_cents || 0),
    currency: row.currency || PORTAL_SUPPORT_CONFIG.currency,
    status: row.status || "",
    paidAt: row.paid_at || null,
    donorPublicName: row.anonymous ? "" : row.donor_public_name || "",
    donorMessage: row.donor_message || "",
    displayPublicly: Boolean(row.display_publicly),
    anonymous: Boolean(row.anonymous),
  };
}

async function readSupportSummary(req, res) {
  const { start, end } = getCurrentMonthRange();
  const targetCents = getMonthlyTargetCents();

  const [monthlyResult, publicResult] = await Promise.all([
    supabase
      .from("portal_support_payments")
      .select("amount_cents, support_type, paid_at")
      .eq("status", "confirmed")
      .gte("paid_at", start.toISOString())
      .lt("paid_at", end.toISOString()),
    supabase
      .from("portal_support_payments")
      .select("id, support_type, amount_cents, currency, status, paid_at, donor_public_name, donor_message, display_publicly, anonymous")
      .eq("status", "confirmed")
      .eq("display_publicly", true)
      .eq("anonymous", false)
      .order("paid_at", { ascending: false })
      .limit(12),
  ]);

  if (monthlyResult.error || publicResult.error) {
    const error = monthlyResult.error || publicResult.error;
    if (isMissingSupportTable(error)) {
      sendPortalJson(res, 200, {
        schemaReady: false,
        error: "Tables de soutien manquantes. Execute scripts/portal_support.sql.",
        config: buildPublicConfig(targetCents),
        summary: buildEmptySummary(targetCents),
        publicSupporters: [],
      }, req);
      return;
    }

    sendPortalJson(res, 500, { error: error.message || "Chargement soutien impossible." }, req);
    return;
  }

  const monthlyRows = monthlyResult.data || [];
  const currentMonthCents = monthlyRows.reduce((total, row) => total + Number(row.amount_cents || 0), 0);
  const monthlyRecurringCents = monthlyRows
    .filter((row) => row.support_type === "monthly")
    .reduce((total, row) => total + Number(row.amount_cents || 0), 0);

  sendPortalJson(res, 200, {
    schemaReady: true,
    config: buildPublicConfig(targetCents),
    summary: {
      currentMonthCents,
      targetCents,
      progressPercent: targetCents > 0 ? Math.min(100, Math.round((currentMonthCents / targetCents) * 100)) : 0,
      monthlyRecurringCents,
      paymentCount: monthlyRows.length,
      monthStartsAt: start.toISOString(),
      monthEndsAt: end.toISOString(),
    },
    publicSupporters: (publicResult.data || []).map(serializePayment),
  }, req);
}

function buildPublicConfig(targetCents) {
  const { minCents, maxCents } = getSupportAmountLimitsCents(process.env);

  return {
    currency: PORTAL_SUPPORT_CONFIG.currency,
    suggestedAmountsEuros: PORTAL_SUPPORT_CONFIG.suggestedAmountsEuros,
    minAmountEuros: centsToEuros(minCents),
    maxAmountEuros: centsToEuros(maxCents),
    monthlyTargetEuros: centsToEuros(targetCents),
  };
}

function buildEmptySummary(targetCents) {
  return {
    currentMonthCents: 0,
    targetCents,
    progressPercent: 0,
    monthlyRecurringCents: 0,
    paymentCount: 0,
    monthStartsAt: null,
    monthEndsAt: null,
  };
}

async function createCheckout(req, res, body) {
  const supportType = normalizeSupportType(body.supportType || body.support_type);
  const amountCents = Number.isFinite(Number(body.amountCents))
    ? Math.round(Number(body.amountCents))
    : Math.round(Number(body.amountEuros || body.amount || 0) * 100);
  const validation = validateSupportAmountCents(amountCents, getSupportAmountLimitsCents(process.env));

  if (!validation.ok) {
    sendPortalJson(res, 400, {
      error: `Montant invalide. Choisis entre ${centsToEuros(validation.minCents)} EUR et ${centsToEuros(validation.maxCents)} EUR.`,
    }, req);
    return;
  }

  const sessionResult = await getOptionalPortalSession(req);
  const member = sessionResult.member || null;
  const displayPublicly = Boolean(body.displayPublicly || body.display_publicly);
  const anonymous = displayPublicly ? Boolean(body.anonymous) : true;
  const donorPublicName = anonymous
    ? ""
    : cleanText(body.donorPublicName || body.donor_public_name || member?.watcher_name || member?.discord_id || "", 80);
  const donorMessage = cleanText(body.donorMessage || body.donor_message || "", 220);
  const nowIso = new Date().toISOString();

  const insertResult = await supabase
    .from("portal_support_payments")
    .insert({
      support_type: supportType,
      amount_cents: validation.amountCents,
      currency: PORTAL_SUPPORT_CONFIG.currency,
      status: "pending",
      member_id: member?.id || null,
      donor_public_name: donorPublicName || null,
      donor_message: donorMessage || null,
      display_publicly: displayPublicly,
      anonymous,
      metadata: {
        created_from: "portal",
        member_name: member?.watcher_name || "",
        created_at: nowIso,
      },
    })
    .select("id")
    .single();

  if (insertResult.error) {
    sendPortalJson(res, isMissingSupportTable(insertResult.error) ? 409 : 500, {
      error: isMissingSupportTable(insertResult.error)
        ? "Tables de soutien manquantes. Execute scripts/portal_support.sql."
        : insertResult.error.message || "Preparation paiement impossible.",
    }, req);
    return;
  }

  const paymentId = insertResult.data.id;
  const origin = getRequestOrigin(req);
  const mode = supportType === "monthly" ? "subscription" : "payment";

  const form = {
    mode,
    currency: PORTAL_SUPPORT_CONFIG.currency,
    success_url: `${origin}/portal?support=success&type=${supportType}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/portal?support=cancel&type=${supportType}`,
    client_reference_id: member?.id || paymentId,
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": PORTAL_SUPPORT_CONFIG.currency,
    "line_items[0][price_data][unit_amount]": validation.amountCents,
    "line_items[0][price_data][product_data][name]": getSupportTypeLabel(supportType),
    "metadata[portal_support_payment_id]": paymentId,
    "metadata[support_type]": supportType,
    "metadata[portal_member_id]": member?.id || "",
    "metadata[portal_member_name]": member?.watcher_name || "",
  };

  if (supportType === "monthly") {
    form["line_items[0][price_data][recurring][interval]"] = "month";
    form["subscription_data[metadata][portal_support_payment_id]"] = paymentId;
    form["subscription_data[metadata][portal_member_id]"] = member?.id || "";
  }

  try {
    const checkoutSession = await stripeRequest(
      "checkout/sessions",
      form,
      `portal-support-${paymentId}-${supportType}`,
    );

    await supabase
      .from("portal_support_payments")
      .update({
        stripe_checkout_session_id: checkoutSession.id || null,
        stripe_customer_id: checkoutSession.customer || null,
        stripe_subscription_id: checkoutSession.subscription || null,
        metadata: {
          created_from: "portal",
          checkout_mode: mode,
          member_name: member?.watcher_name || "",
          stripe_checkout_created_at: new Date().toISOString(),
        },
      })
      .eq("id", paymentId);

    sendPortalJson(res, 200, {
      checkoutUrl: checkoutSession.url,
      paymentId,
    }, req);
  } catch (error) {
    await supabase
      .from("portal_support_payments")
      .update({
        status: "failed",
        metadata: {
          created_from: "portal",
          stripe_error: error.message || "Stripe error",
          failed_at: new Date().toISOString(),
        },
      })
      .eq("id", paymentId);

    sendPortalJson(res, error.status || 500, {
      error: error.message || "Creation du paiement Stripe impossible.",
    }, req);
  }
}

async function createCustomerPortal(req, res) {
  const sessionResult = await requirePortalSession(req, supabase);
  if (sessionResult.error) {
    sendPortalJson(res, sessionResult.status || 401, { error: sessionResult.error }, req);
    return;
  }

  const customerResult = await supabase
    .from("portal_support_payments")
    .select("stripe_customer_id")
    .eq("member_id", sessionResult.member.id)
    .not("stripe_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (customerResult.error) {
    sendPortalJson(res, 500, { error: customerResult.error.message || "Recherche client Stripe impossible." }, req);
    return;
  }

  const customerId = customerResult.data?.stripe_customer_id;
  if (!customerId) {
    sendPortalJson(res, 404, {
      error: "Aucun abonnement Stripe lie a ce compte Portal pour le moment.",
    }, req);
    return;
  }

  try {
    const portalSession = await stripeRequest(
      "billing_portal/sessions",
      {
        customer: customerId,
        return_url: `${getRequestOrigin(req)}/portal`,
      },
      `portal-support-customer-portal-${sessionResult.member.id}-${Date.now()}`,
    );

    sendPortalJson(res, 200, { portalUrl: portalSession.url }, req);
  } catch (error) {
    sendPortalJson(res, error.status || 500, {
      error: error.message || "Ouverture du portail Stripe impossible.",
    }, req);
  }
}

export default async function handler(req, res) {
  try {
    applyPortalCorsHeaders(req, res);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (!["GET", "POST"].includes(req.method)) {
      sendPortalJson(res, 405, { error: "Method not allowed" }, req);
      return;
    }

    if (!verifyPortalRequestOrigin(req)) {
      sendPortalJson(res, 403, { error: "Origine de la requete refusee." }, req);
      return;
    }

    if (req.method === "GET") {
      await readSupportSummary(req, res);
      return;
    }

    const body = await readJsonBody(req);
    const action = cleanText(body.action).toLowerCase();

    if (action === "create_checkout") {
      await createCheckout(req, res, body);
      return;
    }

    if (action === "create_customer_portal") {
      await createCustomerPortal(req, res);
      return;
    }

    sendPortalJson(res, 400, { error: "Action soutien inconnue." }, req);
  } catch (error) {
    sendPortalJson(res, error.status || 500, {
      error: error?.message || "Erreur soutien Portal.",
    }, req);
  }
}
