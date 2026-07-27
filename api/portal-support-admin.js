/* global process */
import { createClient } from "@supabase/supabase-js";
import {
  PORTAL_SUPPORT_CONFIG,
  centsToEuros,
  isPortalSupportLiveMode,
} from "../src/lib/portalSupportConfig.js";
import {
  applyPortalCorsHeaders,
  readJsonBody,
  requirePortalLeaderSession,
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

function serializePayment(row) {
  const amountRefundedCents = Number(row.amount_refunded_cents || 0);
  const netAmountCents = Math.max(0, Number(row.amount_cents || 0) - amountRefundedCents);
  return {
    id: row.id,
    createdAt: row.created_at || null,
    paidAt: row.paid_at || null,
    supportType: row.support_type || "",
    amountCents: netAmountCents,
    grossAmountCents: row.amount_cents || 0,
    amountRefundedCents,
    amountEuros: centsToEuros(netAmountCents),
    currency: row.currency || PORTAL_SUPPORT_CONFIG.currency,
    status: row.status || "",
    memberId: row.member_id || null,
    donorPublicName: row.donor_public_name || "",
    donorMessage: row.donor_message || "",
    displayPublicly: Boolean(row.display_publicly),
    anonymous: Boolean(row.anonymous),
    livemode: Boolean(row.livemode),
    stripeCheckoutSessionId: row.stripe_checkout_session_id || "",
    stripePaymentIntentId: row.stripe_payment_intent_id || "",
    stripeSubscriptionId: row.stripe_subscription_id || "",
    stripeInvoiceId: row.stripe_invoice_id || "",
  };
}

async function requireLeader(req, res) {
  const sessionResult = await requirePortalLeaderSession(req, supabase);
  if (sessionResult.error) {
    sendPortalJson(res, sessionResult.status || 403, { error: sessionResult.error }, req);
    return null;
  }
  return sessionResult;
}

async function listAdminData(req, res) {
  const { data, error } = await supabase
    .from("portal_support_payments")
    .select(
      "id, created_at, paid_at, support_type, amount_cents, amount_refunded_cents, currency, status, member_id, donor_public_name, donor_message, display_publicly, anonymous, livemode, stripe_checkout_session_id, stripe_payment_intent_id, stripe_subscription_id, stripe_invoice_id",
    )
    .order("created_at", { ascending: false })
    .limit(160);

  if (error) {
    if (isMissingSupportTable(error)) {
      sendPortalJson(res, 200, {
        schemaReady: false,
        error: "Tables de soutien manquantes. Execute scripts/portal_support.sql.",
        payments: [],
        summary: {
          confirmedCents: 0,
          monthlyConfirmedCents: 0,
          oneTimeConfirmedCents: 0,
          activeMonthlyCount: 0,
          targetCents: getMonthlyTargetCents(),
        },
      }, req);
      return;
    }

    sendPortalJson(res, 500, { error: error.message || "Chargement soutien impossible." }, req);
    return;
  }

  const rows = data || [];
  const currentLivemode = isPortalSupportLiveMode(process.env);
  const modeRows = rows.filter((row) => Boolean(row.livemode) === currentLivemode);
  const confirmedRows = modeRows.filter((row) => row.status === "confirmed");
  const activeMonthlySubscriptions = new Set(
    modeRows
      .filter((row) => row.support_type === "monthly" && ["active", "confirmed"].includes(row.status) && row.stripe_subscription_id)
      .map((row) => row.stripe_subscription_id),
  );

  sendPortalJson(res, 200, {
    schemaReady: true,
    payments: rows.map(serializePayment),
    summary: {
      confirmedCents: confirmedRows.reduce(
        (total, row) => total + Math.max(0, Number(row.amount_cents || 0) - Number(row.amount_refunded_cents || 0)),
        0,
      ),
      monthlyConfirmedCents: confirmedRows
        .filter((row) => row.support_type === "monthly")
        .reduce(
          (total, row) => total + Math.max(0, Number(row.amount_cents || 0) - Number(row.amount_refunded_cents || 0)),
          0,
        ),
      oneTimeConfirmedCents: confirmedRows
        .filter((row) => row.support_type !== "monthly")
        .reduce(
          (total, row) => total + Math.max(0, Number(row.amount_cents || 0) - Number(row.amount_refunded_cents || 0)),
          0,
        ),
      activeMonthlyCount: activeMonthlySubscriptions.size,
      targetCents: getMonthlyTargetCents(),
    },
  }, req);
}

async function updateVisibility(req, res, body) {
  const paymentId = cleanText(body.paymentId || body.id, 80);
  if (!paymentId) {
    sendPortalJson(res, 400, { error: "Paiement manquant." }, req);
    return;
  }

  const payload = {
    display_publicly: Boolean(body.displayPublicly || body.display_publicly),
    anonymous: Boolean(body.anonymous),
  };

  if (Object.prototype.hasOwnProperty.call(body, "donorPublicName")) {
    payload.donor_public_name = cleanText(body.donorPublicName, 80) || null;
  }

  if (Object.prototype.hasOwnProperty.call(body, "donorMessage")) {
    payload.donor_message = cleanText(body.donorMessage, 220) || null;
  }

  const { data, error } = await supabase
    .from("portal_support_payments")
    .update(payload)
    .eq("id", paymentId)
    .select(
      "id, created_at, paid_at, support_type, amount_cents, amount_refunded_cents, currency, status, member_id, donor_public_name, donor_message, display_publicly, anonymous, livemode, stripe_checkout_session_id, stripe_payment_intent_id, stripe_subscription_id, stripe_invoice_id",
    )
    .single();

  if (error) {
    sendPortalJson(res, 500, { error: error.message || "Modification visibilite impossible." }, req);
    return;
  }

  sendPortalJson(res, 200, { success: true, payment: serializePayment(data) }, req);
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

    const leader = await requireLeader(req, res);
    if (!leader) return;

    if (req.method === "GET") {
      await listAdminData(req, res);
      return;
    }

    const body = await readJsonBody(req);
    const action = cleanText(body.action).toLowerCase();

    if (action === "update_visibility") {
      await updateVisibility(req, res, body);
      return;
    }

    sendPortalJson(res, 400, { error: "Action soutien inconnue." }, req);
  } catch (error) {
    sendPortalJson(res, 500, { error: error?.message || "Erreur admin soutien." }, req);
  }
}
