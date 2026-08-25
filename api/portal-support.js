/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  PORTAL_SUPPORT_CONFIG,
  canPortalMemberUseSupport,
  centsToEuros,
  getSupportTypeLabel,
  getSupportAmountLimitsCents,
  isPortalSupportLiveMode,
  isPortalSupportPublicEnabled,
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
import {
  buildMemberCosmeticProgress,
  buildProfileCosmeticAccessCatalog,
  buildPublicSupportRankings,
  loadCosmeticAccessContext,
} from "./_portal-cosmetic-access.js";
import {
  isMissingProfileCosmeticsSchema,
  loadCosmeticsForMemberIds,
  loadProfileCosmeticAssetRows,
} from "./_portal-cosmetics.js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function cleanText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function isMissingSupportTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    message.includes("portal_support_payments") ||
    message.includes("amount_refunded_cents") ||
    message.includes("livemode")
  );
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
  const amountCents = Math.max(0, Number(row.amount_cents || 0) - Number(row.amount_refunded_cents || 0));
  return {
    id: row.id,
    supportType: row.support_type,
    amountCents,
    amountEuros: centsToEuros(amountCents),
    currency: row.currency || PORTAL_SUPPORT_CONFIG.currency,
    status: row.status || "",
    paidAt: row.paid_at || null,
    donorPublicName: row.anonymous ? "" : row.donor_public_name || "",
    donorMessage: row.donor_message || "",
    displayPublicly: Boolean(row.display_publicly),
    anonymous: Boolean(row.anonymous),
    livemode: Boolean(row.livemode),
  };
}

function buildEmptyCosmeticRewards() {
  return {
    schemaReady: false,
    accessSchemaReady: false,
    catalog: {
      assets: [],
      avatars: [],
      frames: [],
      collections: [],
    },
  };
}

function buildEmptyCosmeticProgress() {
  return {
    supportTotalCents: 0,
    monthlyConfirmedCount: 0,
    tiers: [],
    nextSupportTier: null,
    nextMonthlyTier: null,
  };
}

async function requireSupportAccess(req, res) {
  const sessionResult = await requirePortalSession(req, supabase);
  if (sessionResult.error) {
    sendPortalJson(res, sessionResult.status || 401, { error: sessionResult.error }, req);
    return null;
  }

  if (!canPortalMemberUseSupport(sessionResult.member, process.env)) {
    sendPortalJson(res, 403, { error: "Soutien Portal ferme pour le moment." }, req);
    return null;
  }

  return sessionResult;
}

async function readSupportAccess(req, res) {
  const sessionResult = await getPortalSession(req, supabase);
  const member = sessionResult?.error ? null : sessionResult.member;
  const publicEnabled = isPortalSupportPublicEnabled(process.env);
  const canUseSupport = member ? canPortalMemberUseSupport(member, process.env) : publicEnabled;

  sendPortalJson(res, 200, {
    config: {
      publicEnabled: canUseSupport,
      livemode: isPortalSupportLiveMode(process.env),
    },
    access: {
      canUseSupport,
      leaderOnly: false,
    },
  }, req);
}

async function readSupportSummary(req, res) {
  const supportAccess = await requireSupportAccess(req, res);
  if (!supportAccess) return;
  const member = supportAccess.member;

  const { start, end } = getCurrentMonthRange();
  const targetCents = getMonthlyTargetCents();
  const livemode = isPortalSupportLiveMode(process.env);

  const supportSelect =
    "id, member_id, support_type, amount_cents, amount_refunded_cents, currency, status, paid_at, donor_public_name, donor_message, display_publicly, anonymous, livemode, created_at";

  const [monthlyResult, supportResult] = await Promise.all([
    supabase
      .from("portal_support_payments")
      .select("amount_cents, amount_refunded_cents, support_type, paid_at")
      .eq("status", "confirmed")
      .eq("livemode", livemode)
      .gte("paid_at", start.toISOString())
      .lt("paid_at", end.toISOString()),
    supabase
      .from("portal_support_payments")
      .select(supportSelect)
      .eq("livemode", livemode)
      .order("paid_at", { ascending: false })
      .limit(500),
  ]);

  if (monthlyResult.error || supportResult.error) {
    const error = monthlyResult.error || supportResult.error;
    if (isMissingSupportTable(error)) {
      sendPortalJson(res, 200, {
        schemaReady: false,
        error: "Tables de soutien manquantes. Execute scripts/portal_support.sql.",
        config: buildPublicConfig(targetCents),
        summary: buildEmptySummary(targetCents),
        publicSupporters: [],
        publicRankings: { cumulative: [], monthly: [] },
        cosmeticProgress: buildEmptyCosmeticProgress(),
        cosmeticRewards: buildEmptyCosmeticRewards(),
      }, req);
      return;
    }

    sendPortalJson(res, 500, { error: error.message || "Chargement soutien impossible." }, req);
    return;
  }

  const monthlyRows = monthlyResult.data || [];
  const currentMonthCents = monthlyRows.reduce(
    (total, row) => total + Math.max(0, Number(row.amount_cents || 0) - Number(row.amount_refunded_cents || 0)),
    0,
  );
  const monthlyRecurringCents = monthlyRows
    .filter((row) => row.support_type === "monthly")
    .reduce((total, row) => total + Math.max(0, Number(row.amount_cents || 0) - Number(row.amount_refunded_cents || 0)), 0);
  const supportRows = supportResult.data || [];
  const publicSupporters = supportRows
    .filter((row) => row.status === "confirmed" && row.display_publicly && !row.anonymous)
    .slice(0, 12)
    .map(serializePayment);

  let publicRankings = { cumulative: [], monthly: [] };
  let cosmeticRewards = buildEmptyCosmeticRewards();
  let cosmeticProgress = buildEmptyCosmeticProgress();

  try {
    const publicMemberIds = [
      ...new Set(
        supportRows
          .filter((row) => row.display_publicly && !row.anonymous && row.member_id)
          .map((row) => String(row.member_id)),
      ),
    ];
    const [assetRows, accessContext, cosmeticsByMemberId] = await Promise.all([
      loadProfileCosmeticAssetRows(supabase),
      loadCosmeticAccessContext(supabase, [member.id]),
      loadCosmeticsForMemberIds(supabase, publicMemberIds),
    ]);

    cosmeticProgress = buildMemberCosmeticProgress({ member, accessContext });
    cosmeticRewards = {
      schemaReady: true,
      accessSchemaReady: accessContext.accessSchemaReady,
      catalog: buildProfileCosmeticAccessCatalog({
        assetRows,
        member,
        ...accessContext,
      }),
    };
    publicRankings = buildPublicSupportRankings({
      payments: supportRows,
      cosmeticsByMemberId,
      env: process.env,
    });
  } catch (error) {
    if (!isMissingProfileCosmeticsSchema(error)) throw error;
  }

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
    publicSupporters,
    publicRankings,
    cosmeticProgress,
    cosmeticRewards,
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
    publicEnabled: true,
    livemode: isPortalSupportLiveMode(process.env),
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
  const sessionResult = await requireSupportAccess(req, res);
  if (!sessionResult) return;

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

  const member = sessionResult.member;
  const livemode = isPortalSupportLiveMode(process.env);
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
      livemode,
      member_id: member?.id || null,
      donor_public_name: donorPublicName || null,
      donor_message: donorMessage || null,
      display_publicly: displayPublicly,
      anonymous,
      metadata: {
        created_from: "portal",
        member_name: member?.watcher_name || "",
        livemode,
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
    "metadata[portal_livemode]": livemode ? "true" : "false",
  };

  if (supportType === "monthly") {
    form["line_items[0][price_data][recurring][interval]"] = "month";
    form["subscription_data[metadata][portal_support_payment_id]"] = paymentId;
    form["subscription_data[metadata][portal_member_id]"] = member?.id || "";
    form["subscription_data[metadata][portal_livemode]"] = livemode ? "true" : "false";
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
        livemode: Boolean(checkoutSession.livemode),
        metadata: {
          created_from: "portal",
          checkout_mode: mode,
          member_name: member?.watcher_name || "",
          livemode: Boolean(checkoutSession.livemode),
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
  const sessionResult = await requireSupportAccess(req, res);
  if (!sessionResult) return;

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
      const intent = cleanText(req.query?.intent || req.query?.action).toLowerCase();
      if (intent === "access") {
        await readSupportAccess(req, res);
        return;
      }
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
