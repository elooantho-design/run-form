export const PORTAL_LICENSE_PLAN_KEYS = [
  "trial_private",
  "trial_paladin",
  "manual",
  "gvg",
  "complete",
  "suspended",
];

export const PORTAL_LICENSE_STATUS_KEYS = ["active", "trial", "suspended", "cancelled"];

export const DEFAULT_EXTERNAL_LICENSE_PLAN = "gvg";

export const PORTAL_LICENSE_PLANS = {
  trial_private: {
    label: "Essai prive",
    shortLabel: "Essai prive",
    description: "Essai GVG complet limite a la data de la guilde externe.",
    isTrial: true,
  },
  trial_paladin: {
    label: "Essai + data Paladin",
    shortLabel: "Essai Paladin",
    description: "Essai complet avec lecture des runs Paladin, sans reset de la periode d'essai.",
    isTrial: true,
  },
  manual: {
    label: "Abonnement manuel",
    shortLabel: "Manuel",
    description: "Portal, recherche de run, ajout et modification manuels. Pas de launcher ni GVG auto.",
    isTrial: false,
  },
  gvg: {
    label: "Abonnement GVG",
    shortLabel: "GVG",
    description: "Acces GVG complet avec launcher, validation, pilotage et repro Discord, data externe uniquement.",
    isTrial: false,
  },
  complete: {
    label: "Abonnement complet",
    shortLabel: "Complet",
    description: "Abonnement GVG avec lecture des runs Paladin en plus.",
    isTrial: false,
  },
  suspended: {
    label: "Suspendu",
    shortLabel: "Suspendu",
    description: "Acces coupe en attendant decision ou regularisation.",
    isTrial: false,
  },
};

const PLAN_ACCESS = {
  trial_private: {
    portalCore: true,
    manualRuns: true,
    gvg: true,
    launcher: true,
    validation: true,
    paladinRuns: false,
    externalRuns: false,
  },
  trial_paladin: {
    portalCore: true,
    manualRuns: true,
    gvg: true,
    launcher: true,
    validation: true,
    paladinRuns: true,
    externalRuns: false,
  },
  manual: {
    portalCore: true,
    manualRuns: true,
    gvg: false,
    launcher: false,
    validation: false,
    paladinRuns: false,
    externalRuns: false,
  },
  gvg: {
    portalCore: true,
    manualRuns: true,
    gvg: true,
    launcher: true,
    validation: true,
    paladinRuns: false,
    externalRuns: false,
  },
  complete: {
    portalCore: true,
    manualRuns: true,
    gvg: true,
    launcher: true,
    validation: true,
    paladinRuns: true,
    externalRuns: false,
  },
  suspended: {
    portalCore: false,
    manualRuns: false,
    gvg: false,
    launcher: false,
    validation: false,
    paladinRuns: false,
    externalRuns: false,
  },
};

export function normalizeLicensePlan(value) {
  const plan = String(value || "").trim().toLowerCase();
  return PORTAL_LICENSE_PLAN_KEYS.includes(plan) ? plan : DEFAULT_EXTERNAL_LICENSE_PLAN;
}

export function normalizeLicenseStatus(value, plan = "") {
  const status = String(value || "").trim().toLowerCase();
  if (PORTAL_LICENSE_STATUS_KEYS.includes(status)) return status;
  return PORTAL_LICENSE_PLANS[normalizeLicensePlan(plan)]?.isTrial ? "trial" : "active";
}

export function isTrialLicensePlan(plan) {
  return Boolean(PORTAL_LICENSE_PLANS[normalizeLicensePlan(plan)]?.isTrial);
}

export function getPortalLicenseAccess(license, options = {}) {
  const plan = normalizeLicensePlan(license?.plan || options.defaultPlan);
  const status = normalizeLicenseStatus(license?.status, plan);
  const suspended = plan === "suspended" || status === "suspended" || status === "cancelled";
  const access = PLAN_ACCESS[suspended ? "suspended" : plan] || PLAN_ACCESS[DEFAULT_EXTERNAL_LICENSE_PLAN];

  return {
    plan,
    status,
    suspended,
    isTrial: isTrialLicensePlan(plan),
    canUsePortalCore: access.portalCore,
    canUseManualRuns: access.manualRuns,
    canUseGvg: access.gvg,
    canUseLauncher: access.launcher,
    canUseValidation: access.validation,
    canAccessPaladinRuns: access.paladinRuns,
    canAccessExternalRuns: access.externalRuns,
    canSearchRuns: access.portalCore && access.manualRuns,
    canManageOwnRuns: access.portalCore && access.manualRuns,
    canBoycottRuns: access.portalCore && access.manualRuns,
  };
}

export function getPaladinLicenseAccess() {
  return {
    plan: "paladin",
    status: "active",
    suspended: false,
    isTrial: false,
    canUsePortalCore: true,
    canUseManualRuns: true,
    canUseGvg: true,
    canUseLauncher: true,
    canUseValidation: true,
    canAccessPaladinRuns: true,
    canAccessExternalRuns: true,
    canSearchRuns: true,
    canManageOwnRuns: true,
    canBoycottRuns: true,
  };
}

export function addMonths(dateValue, months = 1) {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return new Date();
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

export function daysUntil(dateValue, nowValue = new Date()) {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  const now = new Date(nowValue);
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return null;
  return Math.ceil((date.getTime() - now.getTime()) / 86400000);
}
