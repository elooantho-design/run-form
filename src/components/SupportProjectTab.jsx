import React, { useEffect, useMemo, useState } from "react";
import {
  CreditCard,
  ExternalLink,
  HeartHandshake,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PORTAL_SUPPORT_CONFIG } from "@/lib/portalSupportConfig";
import { usePortalLanguage } from "@/lib/portalLanguage";

const DEFAULT_SUMMARY = {
  currentMonthCents: 0,
  targetCents: PORTAL_SUPPORT_CONFIG.monthlyTargetEuros * 100,
  progressPercent: 0,
  monthlyRecurringCents: 0,
  paymentCount: 0,
};

const DEFAULT_PUBLIC_CONFIG = {
  currency: PORTAL_SUPPORT_CONFIG.currency,
  suggestedAmountsEuros: PORTAL_SUPPORT_CONFIG.suggestedAmountsEuros,
  minAmountEuros: PORTAL_SUPPORT_CONFIG.minAmountEuros,
  maxAmountEuros: PORTAL_SUPPORT_CONFIG.maxAmountEuros,
  monthlyTargetEuros: PORTAL_SUPPORT_CONFIG.monthlyTargetEuros,
  publicEnabled: false,
  livemode: false,
};

function getApiBase() {
  if (typeof window === "undefined") return "";
  const configuredBase = import.meta.env?.VITE_API_BASE_URL;
  if (configuredBase) return configuredBase.replace(/\/$/, "");
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "";
}

function isLeaderSession(session) {
  const role = String(session?.role || "").trim().toLowerCase();
  return Boolean(session?.isLeader || session?.leader || role === "leader");
}

function formatCurrency(cents, language = "fr") {
  const value = Number(cents || 0) / 100;
  return new Intl.NumberFormat(language === "en" ? "en-US" : "fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function formatDate(value, language = "fr") {
  if (!value) return "-";
  try {
    return new Intl.DateTimeFormat(language === "en" ? "en-US" : "fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return "-";
  }
}

function statusLabel(status, t) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "confirmed") return t("support.statusConfirmed", "Confirme");
  if (normalized === "active") return t("support.statusActive", "Actif");
  if (normalized === "pending") return t("support.statusPending", "En attente");
  if (normalized === "failed") return t("support.statusFailed", "Echoue");
  if (normalized === "refunded") return t("support.statusRefunded", "Rembourse");
  if (normalized === "canceled") return t("support.statusCanceled", "Annule");
  return normalized || "-";
}

function modeLabel(livemode, t) {
  return livemode ? t("support.modeLive", "Live") : t("support.modeTest", "Test");
}

function readSupportReturnState() {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const state = params.get("support");
  if (state !== "success" && state !== "cancel") return null;
  return {
    state,
    type: params.get("type") === "monthly" ? "monthly" : "one_time",
  };
}

export default function SupportProjectTab({ session }) {
  const { t, language } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const isLeader = isLeaderSession(session);
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [publicSupporters, setPublicSupporters] = useState([]);
  const [publicConfig, setPublicConfig] = useState(DEFAULT_PUBLIC_CONFIG);
  const [schemaReady, setSchemaReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [returnState, setReturnState] = useState(readSupportReturnState);
  const [supportType, setSupportType] = useState("one_time");
  const [amountEuros, setAmountEuros] = useState(DEFAULT_PUBLIC_CONFIG.suggestedAmountsEuros[1] || 10);
  const [customAmount, setCustomAmount] = useState("");
  const [displayPublicly, setDisplayPublicly] = useState(false);
  const [donorPublicName, setDonorPublicName] = useState(session?.watcherName || session?.name || "");
  const [donorMessage, setDonorMessage] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminData, setAdminData] = useState(null);

  const selectedAmountEuros = customAmount ? Number(customAmount) : Number(amountEuros);
  const progressPercent = Math.max(0, Math.min(100, Number(summary.progressPercent || 0)));

  async function loadSummary() {
    setLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${apiBase}/api/portal-support`, {
        method: "GET",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || t("support.loadError", "Chargement du soutien impossible."));

      setSchemaReady(payload.schemaReady !== false);
      setSummary(payload.summary || DEFAULT_SUMMARY);
      setPublicConfig({
        ...DEFAULT_PUBLIC_CONFIG,
        ...(payload.config || {}),
        suggestedAmountsEuros: Array.isArray(payload.config?.suggestedAmountsEuros) && payload.config.suggestedAmountsEuros.length
          ? payload.config.suggestedAmountsEuros
          : DEFAULT_PUBLIC_CONFIG.suggestedAmountsEuros,
      });
      setPublicSupporters(payload.publicSupporters || []);
    } catch (error) {
      setErrorMessage(error?.message || t("support.loadError", "Chargement du soutien impossible."));
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminData() {
    if (!isLeader) return;
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await fetch(`${apiBase}/api/portal-support-admin`, {
        method: "GET",
        credentials: "include",
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || t("support.adminLoadError", "Chargement leader impossible."));
      setAdminData(payload);
    } catch (error) {
      setAdminError(error?.message || t("support.adminLoadError", "Chargement leader impossible."));
    } finally {
      setAdminLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  useEffect(() => {
    if (isLeader) void loadAdminData();
  }, [isLeader]);

  useEffect(() => {
    if (!returnState || typeof window === "undefined") return;
    const timer = window.setTimeout(() => setReturnState(null), 12000);
    return () => window.clearTimeout(timer);
  }, [returnState]);

  async function createCheckout() {
    const amount = Number(selectedAmountEuros);
    if (!Number.isFinite(amount)) {
      setErrorMessage(t("support.invalidAmount", "Choisis un montant valide."));
      return;
    }

    setCheckoutLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${apiBase}/api/portal-support`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_checkout",
          supportType,
          amountEuros: amount,
          displayPublicly,
          anonymous: !displayPublicly,
          donorPublicName,
          donorMessage,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || t("support.checkoutError", "Ouverture Stripe impossible."));
      if (!payload.checkoutUrl) throw new Error(t("support.checkoutMissingUrl", "Stripe n'a pas renvoye de lien."));
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      setErrorMessage(error?.message || t("support.checkoutError", "Ouverture Stripe impossible."));
    } finally {
      setCheckoutLoading(false);
    }
  }

  async function openCustomerPortal() {
    setPortalLoading(true);
    setErrorMessage("");
    try {
      const response = await fetch(`${apiBase}/api/portal-support`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_customer_portal" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || t("support.portalError", "Portail Stripe indisponible."));
      if (!payload.portalUrl) throw new Error(t("support.portalMissingUrl", "Stripe n'a pas renvoye de lien."));
      window.open(payload.portalUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setErrorMessage(error?.message || t("support.portalError", "Portail Stripe indisponible."));
    } finally {
      setPortalLoading(false);
    }
  }

  async function updatePaymentVisibility(payment, display) {
    setAdminError("");
    try {
      const response = await fetch(`${apiBase}/api/portal-support-admin`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_visibility",
          paymentId: payment.id,
          displayPublicly: display,
          anonymous: !display,
          donorPublicName: display ? payment.donorPublicName : "",
          donorMessage: payment.donorMessage || "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || t("support.adminUpdateError", "Modification impossible."));
      await Promise.all([loadSummary(), loadAdminData()]);
    } catch (error) {
      setAdminError(error?.message || t("support.adminUpdateError", "Modification impossible."));
    }
  }

  return (
    <section className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-emerald-500/25 bg-zinc-950 shadow-[0_24px_90px_rgba(0,0,0,0.35)]">
        <div className="grid gap-6 border-b border-zinc-800 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_34%),linear-gradient(135deg,rgba(9,9,11,0.96),rgba(12,12,15,0.96))] p-5 lg:grid-cols-[1fr_360px] lg:p-7">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-200">
              <HeartHandshake className="h-3.5 w-3.5" />
              {t("support.eyebrow", "Soutien volontaire")}
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-zinc-50 sm:text-3xl">
              {t("support.title", "Soutenir le projet")}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-300">
              {t(
                "support.description",
                "Si Portal t'aide au quotidien, tu peux participer aux frais techniques du site. Le soutien reste entierement facultatif et ne donne aucun avantage en jeu.",
              )}
            </p>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-black/35 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-zinc-300">{t("support.monthlyGauge", "Objectif mensuel")}</span>
              <Badge className="border border-emerald-400/30 bg-emerald-950/40 text-emerald-100">
                {formatCurrency(summary.currentMonthCents, language)} / {formatCurrency(summary.targetCents, language)}
              </Badge>
            </div>
            <div className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300 transition-all"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
              <span>{progressPercent}%</span>
              <span>{t("support.thisMonth", "Ce mois-ci")}</span>
            </div>
          </div>
        </div>

        {returnState ? (
          <div className={`mx-5 mt-5 rounded-xl border p-4 text-sm ${
            returnState.state === "success"
              ? "border-emerald-400/30 bg-emerald-950/35 text-emerald-100"
              : "border-amber-400/30 bg-amber-950/35 text-amber-100"
          }`}>
            {returnState.state === "success"
              ? t("support.success", "Merci, Stripe a bien pris en compte ton soutien. Le compteur se mettra a jour apres confirmation du paiement.")
              : t("support.cancel", "Paiement annule. Rien n'a ete preleve.")}
          </div>
        ) : null}

        {!schemaReady ? (
          <div className="mx-5 mt-5 rounded-xl border border-amber-400/30 bg-amber-950/35 p-4 text-sm text-amber-100">
            {t("support.schemaMissing", "Les tables de soutien ne sont pas encore installees. Execute la migration SQL avant les tests Stripe.")}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mx-5 mt-5 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-100">
            {errorMessage}
          </div>
        ) : null}

        <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:p-7">
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSupportType("one_time")}
                className={`rounded-xl border p-4 text-left transition ${
                  supportType === "one_time"
                    ? "border-emerald-300/60 bg-emerald-400/10 text-emerald-50"
                    : "border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                <CreditCard className="h-5 w-5" />
                <div className="mt-3 font-semibold">{t("support.oneTime", "Soutien ponctuel")}</div>
                <p className="mt-1 text-xs text-zinc-500">{t("support.oneTimeHelp", "Un coup de pouce unique pour les frais du mois.")}</p>
              </button>
              <button
                type="button"
                onClick={() => setSupportType("monthly")}
                className={`rounded-xl border p-4 text-left transition ${
                  supportType === "monthly"
                    ? "border-cyan-300/60 bg-cyan-400/10 text-cyan-50"
                    : "border-zinc-800 bg-zinc-900/70 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                <Sparkles className="h-5 w-5" />
                <div className="mt-3 font-semibold">{t("support.monthly", "Soutien mensuel")}</div>
                <p className="mt-1 text-xs text-zinc-500">{t("support.monthlyHelp", "Un abonnement mensuel modifiable depuis Stripe.")}</p>
              </button>
            </div>

            <div className="mt-5">
              <p className="text-sm font-medium text-zinc-300">{t("support.amount", "Montant")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {publicConfig.suggestedAmountsEuros.map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => {
                      setAmountEuros(amount);
                      setCustomAmount("");
                    }}
                    className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                      !customAmount && Number(amountEuros) === Number(amount)
                        ? "border-emerald-300/60 bg-emerald-400/15 text-emerald-100"
                        : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                    }`}
                  >
                    {formatCurrency(amount * 100, language)}
                  </button>
                ))}
                <label className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-4 py-2 text-sm text-zinc-300">
                  <span>{t("support.custom", "Autre montant")}</span>
                  <input
                    value={customAmount}
                    onChange={(event) => setCustomAmount(event.target.value)}
                    inputMode="decimal"
                    min={publicConfig.minAmountEuros}
                    max={publicConfig.maxAmountEuros}
                    className="w-20 bg-transparent text-right text-zinc-50 outline-none"
                    placeholder="EUR"
                  />
                </label>
              </div>
              <p className="mt-2 text-xs text-zinc-500">
                {t("support.amountLimits", "Montant accepte")} : {formatCurrency(Number(publicConfig.minAmountEuros || 0) * 100, language)} - {formatCurrency(Number(publicConfig.maxAmountEuros || 0) * 100, language)}.
              </p>
            </div>

            <div className="mt-5 rounded-xl border border-zinc-800 bg-black/25 p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={displayPublicly}
                  onChange={(event) => setDisplayPublicly(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-zinc-700 bg-zinc-950 text-emerald-400"
                />
                <span>
                  <span className="block text-sm font-semibold text-zinc-100">{t("support.publicOptIn", "Afficher mon soutien publiquement")}</span>
                  <span className="mt-1 block text-xs leading-5 text-zinc-500">
                    {t("support.publicOptInHelp", "Par defaut, le soutien reste anonyme. Tu peux choisir d'afficher un nom et un court message.")}
                  </span>
                </span>
              </label>

              {displayPublicly ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm text-zinc-300">
                    <span>{t("support.publicName", "Nom public")}</span>
                    <input
                      value={donorPublicName}
                      onChange={(event) => setDonorPublicName(event.target.value)}
                      maxLength={80}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-50 outline-none focus:border-emerald-400/60"
                    />
                  </label>
                  <label className="space-y-1 text-sm text-zinc-300">
                    <span>{t("support.publicMessage", "Message public")}</span>
                    <input
                      value={donorMessage}
                      onChange={(event) => setDonorMessage(event.target.value)}
                      maxLength={220}
                      className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-zinc-50 outline-none focus:border-emerald-400/60"
                      placeholder={t("support.publicMessagePlaceholder", "Facultatif")}
                    />
                  </label>
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={createCheckout}
                disabled={checkoutLoading || !schemaReady}
                className="rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
              >
                {checkoutLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <HeartHandshake className="h-4 w-4" />}
                {supportType === "monthly"
                  ? t("support.payMonthly", "Soutenir chaque mois")
                  : t("support.payOneTime", "Soutenir ponctuellement")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={openCustomerPortal}
                disabled={portalLoading || !schemaReady}
                className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              >
                {portalLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                {t("support.manageSubscription", "Gerer mon abonnement")}
              </Button>
            </div>

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-900/45 p-4 text-xs leading-5 text-zinc-500">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
              <p>{t("support.legalNote", "Paiement securise par Stripe. Soutien volontaire, sans contrepartie competitive, sans obligation et sans remboursement automatique hors cas gere avec l'administrateur.")}</p>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-zinc-50">{t("support.publicSupporters", "Soutiens publics")}</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={loadSummary}
                  disabled={loading}
                  className="text-zinc-400 hover:text-zinc-100"
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </div>
              <div className="mt-4 space-y-3">
                {publicSupporters.length ? (
                  publicSupporters.map((supporter) => (
                    <div key={supporter.id} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-zinc-100">{supporter.donorPublicName}</span>
                        <span className="text-xs text-emerald-200">{formatCurrency(supporter.amountCents, language)}</span>
                      </div>
                      {supporter.donorMessage ? (
                        <p className="mt-2 text-xs leading-5 text-zinc-400">{supporter.donorMessage}</p>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-sm text-zinc-500">
                    {t("support.noPublicSupporters", "Aucun soutien public pour le moment.")}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
                <LockKeyhole className="h-4 w-4 text-zinc-400" />
                {t("support.privacyTitle", "Confidentialite")}
              </div>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                {t("support.privacyText", "Les informations Stripe sensibles restent chez Stripe. Portal conserve uniquement le statut, le montant, les identifiants techniques et ton choix d'affichage public.")}
              </p>
            </div>
          </aside>
        </div>
      </div>

      {isLeader ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">{t("support.leaderEyebrow", "Leader")}</p>
              <h3 className="mt-1 text-xl font-semibold text-zinc-50">{t("support.leaderTitle", "Suivi du soutien")}</h3>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={loadAdminData}
              disabled={adminLoading}
              className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-4 w-4 ${adminLoading ? "animate-spin" : ""}`} />
              {t("support.refresh", "Rafraichir")}
            </Button>
          </div>

          {adminError ? (
            <div className="mt-4 rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-sm text-red-100">{adminError}</div>
          ) : null}

          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-xs text-zinc-500">{t("support.totalConfirmed", "Total confirme")}</p>
              <p className="mt-1 text-lg font-semibold text-zinc-50">{formatCurrency(adminData?.summary?.confirmedCents || 0, language)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-xs text-zinc-500">{t("support.monthlyConfirmed", "Mensuel confirme")}</p>
              <p className="mt-1 text-lg font-semibold text-zinc-50">{formatCurrency(adminData?.summary?.monthlyConfirmedCents || 0, language)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-xs text-zinc-500">{t("support.oneTimeConfirmed", "Ponctuel confirme")}</p>
              <p className="mt-1 text-lg font-semibold text-zinc-50">{formatCurrency(adminData?.summary?.oneTimeConfirmedCents || 0, language)}</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
              <p className="text-xs text-zinc-500">{t("support.activeMonthly", "Mensuels actifs")}</p>
              <p className="mt-1 text-lg font-semibold text-zinc-50">{adminData?.summary?.activeMonthlyCount || 0}</p>
            </div>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-zinc-800 text-xs uppercase tracking-[0.18em] text-zinc-500">
                <tr>
                  <th className="px-3 py-3">{t("support.tableDate", "Date")}</th>
                  <th className="px-3 py-3">{t("support.tableType", "Type")}</th>
                  <th className="px-3 py-3">{t("support.tableAmount", "Montant")}</th>
                  <th className="px-3 py-3">{t("support.tableMode", "Mode")}</th>
                  <th className="px-3 py-3">{t("support.tableStatus", "Statut")}</th>
                  <th className="px-3 py-3">{t("support.tablePublic", "Public")}</th>
                  <th className="px-3 py-3 text-right">{t("support.tableActions", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {(adminData?.payments || []).map((payment) => (
                  <tr key={payment.id} className="border-b border-zinc-900 text-zinc-300">
                    <td className="px-3 py-3">{formatDate(payment.paidAt || payment.createdAt, language)}</td>
                    <td className="px-3 py-3">
                      {payment.supportType === "monthly" ? t("support.monthly", "Soutien mensuel") : t("support.oneTime", "Soutien ponctuel")}
                    </td>
                    <td className="px-3 py-3 font-semibold text-zinc-100">{formatCurrency(payment.amountCents, language)}</td>
                    <td className="px-3 py-3">
                      <Badge className={`border ${
                        payment.livemode
                          ? "border-emerald-400/30 bg-emerald-950/40 text-emerald-100"
                          : "border-amber-400/30 bg-amber-950/35 text-amber-100"
                      }`}>
                        {modeLabel(payment.livemode, t)}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">{statusLabel(payment.status, t)}</td>
                    <td className="px-3 py-3">{payment.displayPublicly && !payment.anonymous ? payment.donorPublicName || "-" : t("support.anonymous", "Anonyme")}</td>
                    <td className="px-3 py-3 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => updatePaymentVisibility(payment, !(payment.displayPublicly && !payment.anonymous))}
                        className="text-zinc-300 hover:text-zinc-50"
                      >
                        {payment.displayPublicly && !payment.anonymous ? t("support.hide", "Masquer") : t("support.show", "Afficher")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!adminData?.payments?.length ? (
              <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-sm text-zinc-500">
                {t("support.noPayments", "Aucun paiement a afficher.")}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
    </section>
  );
}
