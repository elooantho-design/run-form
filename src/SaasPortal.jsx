import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bell,
  Bot,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Compass,
  ClipboardPaste,
  Cpu,
  FileJson,
  Gauge,
  Grid3X3,
  HardDrive,
  ImagePlus,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Monitor,
  Play,
  PlusCircle,
  RefreshCw,
  Search,
  SearchCheck,
  Server,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  Star,
  UploadCloud,
  Users,
  WalletCards,
  X,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import DemonMonstersTab from "@/components/DemonMonstersTab";
import SoulStonesTab from "@/components/SoulStonesTab";
import PersonalBestTab from "@/components/PersonalBestTab";
import MyDefensesTab from "@/components/MyDefensesTab";
import PortalGuildManagementTab from "@/components/PortalGuildManagementTab";
import GvgCurrentTab from "@/components/GvgCurrentTab";
import GvgPanelTab from "@/components/GvgPanelTab";
import GvgAdminTab from "@/components/GvgAdminTab";
import GvgValidationTab from "@/components/GvgValidationTab";
import AdminDefensesTab from "@/components/AdminDefensesTab";
import RunSearchGrid from "@/components/RunSearchGrid";
import RunAddTab from "@/components/RunAddTab";
import RunEditTab from "@/components/RunEditTab";
import PortalIntersaisonTab from "@/components/PortalIntersaisonTab";
import PortalGuildsTab from "@/components/PortalGuildsTab";
import CommunityMembersTab from "@/components/CommunityMembersTab";
import PveLibraryTab from "@/components/PveLibraryTab";
import { supabase } from "@/lib/supabase";
import { logPortalActivity } from "@/lib/portalActivity";
import { getChampionEnglishName } from "@/lib/championDisplay";
import { PORTAL_LANGUAGES, PortalLanguageProvider, usePortalLanguage } from "@/lib/portalLanguage";
import moontonHeroImages from "@/data/moontonHeroImages.json";
import {
  filterByGuildScope,
  getControlBrand,
  getGvgGuildLabel,
  getGuildScopeDescription,
  getSessionGuildSpaceKey,
  getVisibleGvgGuildCodes,
  isPaladinGuildCode,
  isPaladinSession,
  normalizeGuildCode,
  normalizeGuildCodeKey,
  PALADIN_CLUSTER_GUILD_CODES,
} from "@/lib/guildScope";
import {
  DEFAULT_EXTERNAL_LICENSE_PLAN,
  PORTAL_LICENSE_PLANS,
  addMonths,
  getPaladinLicenseAccess,
  getPortalLicenseAccess,
  isTrialLicensePlan,
  normalizeLicensePlan,
  normalizeLicenseStatus,
} from "@/lib/portalLicensePlans";
import {
  getDefenseRootId,
  isInheritedDefense,
  resolveDefenseVariantsForGuild,
} from "@/lib/defenseVariants";
import {
  buildPublicCalqueUrl,
  buildPublicCalquesBaseUrl,
  buildPublicDownloadUrl,
} from "@/lib/vpsAssets";
import {
  canShowPortalAdminItem,
  canShowPortalHomeCard,
  canShowPortalNavItem,
  canShowPortalPve,
  isPortalCommunityRole,
  isPortalCommunitySession,
} from "@/lib/portalPermissions";

const navigation = [
  { id: "home", label: "Accueil", labelKey: "nav.home", icon: LayoutDashboard },
  { id: "hero-box", label: "Ma box heros", labelKey: "nav.heroBox", icon: Grid3X3 },
  { id: "soul-stones", label: "Pierre d'ame", labelKey: "nav.soulStones", icon: Sparkles },
  { id: "demon-monsters", label: "Monstres demoniaques", labelKey: "nav.demonMonsters", icon: Shield },
  { id: "personal-best", label: "Mes PB", labelKey: "nav.personalBest", icon: Activity },
  { id: "defenses", label: "Mes defenses", labelKey: "nav.defenses", icon: Bot },
  { id: "gvg", label: "GVG", labelKey: "nav.gvg", icon: Shield },
  { id: "run-search", label: "Recherche de run", labelKey: "nav.runSearch", icon: Search },
  { id: "settings", label: "Parametres", labelKey: "nav.settings", icon: Settings },
];

const adminNavigation = [
  { id: "guild-management", label: "Gestion guildes", labelKey: "nav.guildManagement", icon: Users, adminOnly: true },
  { id: "admin-defenses", label: "Gestion defense", labelKey: "nav.adminDefenses", icon: Shield, adminOnly: true },
  { id: "intersaison", label: "Intersaison", labelKey: "nav.intersaison", icon: RefreshCw, adminOnly: true, paladinOnly: true },
  { id: "run-add", label: "Ajout de run", labelKey: "nav.runAdd", icon: PlusCircle, adminOnly: true },
  { id: "run-edit", label: "Modification de run", labelKey: "nav.runEdit", icon: FileJson, adminOnly: true },
  { id: "templates", label: "Ajout heros", labelKey: "nav.templates", icon: PlusCircle, leaderOnly: true },
  { id: "guilds", label: "Guildes", labelKey: "nav.guilds", icon: Users, leaderOnly: true },
  { id: "billing", label: "Licences", labelKey: "nav.billing", icon: WalletCards, leaderOnly: true },
  { id: "community-members", label: "Membres communaute", labelKey: "nav.communityMembers", icon: Users, leaderOnly: true },
  { id: "launcher", label: "Launcher", labelKey: "nav.launcher", icon: Bot },
  { id: "validation", label: "Validation", labelKey: "nav.validation", icon: SearchCheck },
  { id: "logs", label: "Logs", labelKey: "nav.logs", icon: Activity },
  { id: "player-access", label: "Acces joueurs", labelKey: "nav.playerAccess", icon: Lock, adminOnly: true },
];

const pveContentBlueprints = [
  {
    slug: "gr1",
    name: "GR1",
    description: "Raid d'equipement 1",
    stageCount: 24,
    sortOrder: 10,
    categorySlug: "gear-raid",
    categoryName: "Raid d'equipement",
    categorySortOrder: 10,
  },
  {
    slug: "gr2",
    name: "GR2",
    description: "Raid d'equipement 2",
    stageCount: 24,
    sortOrder: 20,
    categorySlug: "gear-raid",
    categoryName: "Raid d'equipement",
    categorySortOrder: 10,
  },
  {
    slug: "gr3",
    name: "GR3",
    description: "Raid d'equipement 3",
    stageCount: 24,
    sortOrder: 30,
    categorySlug: "gear-raid",
    categoryName: "Raid d'equipement",
    categorySortOrder: 10,
  },
  {
    slug: "donjon1",
    name: "Donjon 1",
    description: "Donjon d'equipement 1",
    stageCount: 13,
    sortOrder: 40,
    categorySlug: "gear-raid",
    categoryName: "Raid d'equipement",
    categorySortOrder: 10,
  },
  {
    slug: "donjon2",
    name: "Donjon 2",
    description: "Donjon d'equipement 2",
    stageCount: 13,
    sortOrder: 50,
    categorySlug: "gear-raid",
    categoryName: "Raid d'equipement",
    categorySortOrder: 10,
  },
  {
    slug: "donjon3",
    name: "Donjon 3",
    description: "Donjon d'equipement 3",
    stageCount: 13,
    sortOrder: 60,
    categorySlug: "gear-raid",
    categoryName: "Raid d'equipement",
    categorySortOrder: 10,
  },
  {
    slug: "artifact-raid",
    name: "Raid d'artefacts",
    description: "Raid de materiaux d'artefacts",
    stageCount: 30,
    sortOrder: 10,
    categorySlug: "artifact-raid",
    categoryName: "Raid d'artefacts",
    categorySortOrder: 15,
    directNav: true,
  },
  {
    slug: "illusion-tower",
    name: "Tour de l'Illusion",
    description: "Tour de l'Illusion",
    stageCount: 48,
    sortOrder: 10,
    categorySlug: "illusion-tower",
    categoryName: "Tour de l'Illusion",
    categorySortOrder: 40,
    directNav: true,
  },
  {
    slug: "arena-anti-air",
    name: "Antiaérien",
    description: "Arène - Antiaérien",
    stageCount: 1,
    sortOrder: 10,
    categorySlug: "arena",
    categoryName: "Arène",
    categorySortOrder: 50,
  },
  {
    slug: "arena-zde",
    name: "ZDE",
    description: "Arène - ZDE",
    stageCount: 1,
    sortOrder: 20,
    categorySlug: "arena",
    categoryName: "Arène",
    categorySortOrder: 50,
  },
  {
    slug: "arena-single-target",
    name: "Monocible",
    description: "Arène - Monocible",
    stageCount: 1,
    sortOrder: 30,
    categorySlug: "arena",
    categoryName: "Arène",
    categorySortOrder: 50,
  },
  {
    slug: "campaign-normal",
    name: "Normal",
    description: "Campagne normale",
    stageCount: 10,
    sortOrder: 10,
    categorySlug: "campaign",
    categoryName: "Campagne",
    categorySortOrder: 60,
  },
  {
    slug: "campaign-hard",
    name: "Difficile",
    description: "Campagne difficile",
    stageCount: 9,
    sortOrder: 20,
    categorySlug: "campaign",
    categoryName: "Campagne",
    categorySortOrder: 60,
  },
  {
    slug: "campaign-expert",
    name: "Expert",
    description: "Campagne expert",
    stageCount: 9,
    sortOrder: 30,
    categorySlug: "campaign",
    categoryName: "Campagne",
    categorySortOrder: 60,
  },
  {
    slug: "malrik",
    name: "Malrik",
    description: "Pierres de Malrik",
    stageCount: 1,
    sortOrder: 10,
    categorySlug: "malrik",
    categoryName: "Malrik",
    categorySortOrder: 70,
    directNav: true,
  },
  {
    slug: "breche",
    name: "Brèche",
    description: "Brèche",
    stageCount: 2,
    sortOrder: 10,
    categorySlug: "breche",
    categoryName: "Brèche",
    categorySortOrder: 80,
    directNav: true,
  },
  {
    slug: "war-gallery",
    name: "Galerie de guerre",
    description: "Galerie de guerre",
    stageCount: 1,
    sortOrder: 10,
    categorySlug: "war-gallery",
    categoryName: "Galerie de guerre",
    categorySortOrder: 90,
    directNav: true,
  },
  {
    slug: "other",
    name: "Autre",
    description: "Autre",
    stageCount: 1,
    sortOrder: 10,
    categorySlug: "other",
    categoryName: "Autre",
    categorySortOrder: 100,
    directNav: true,
  },
  {
    slug: "dragon-chasm",
    name: "Gouffre du dragon",
    description: "Boss de guilde - Gouffre du dragon",
    stageCount: 8,
    sortOrder: 10,
    categorySlug: "guild-boss",
    categoryName: "Boss de guilde",
    categorySortOrder: 20,
  },
  {
    slug: "titan-ruins",
    name: "Ruine de titan",
    description: "Boss de guilde - Ruine de titan",
    stageCount: 4,
    sortOrder: 20,
    categorySlug: "guild-boss",
    categoryName: "Boss de guilde",
    categorySortOrder: 20,
  },
  {
    slug: "immortal-codex",
    name: "Défi d'épreuve",
    description: "Codex immortel - Défi d'épreuve",
    stageCount: 8,
    sortOrder: 10,
    categorySlug: "immortal-codex",
    categoryName: "Codex immortel",
    categorySortOrder: 30,
  },
  {
    slug: "immortal-codex-conquest",
    name: "Défi de conquête",
    description: "Codex immortel - Défi de conquête",
    stageCount: 2,
    sortOrder: 20,
    categorySlug: "immortal-codex",
    categoryName: "Codex immortel",
    categorySortOrder: 30,
  },
  {
    slug: "faction-trial-all",
    name: "All",
    description: "Épreuve de faction - All",
    stageCount: 18,
    sortOrder: 10,
    categorySlug: "faction-trial",
    categoryName: "Épreuve de faction",
    categorySortOrder: 18,
  },
  {
    slug: "faction-trial-nordiste",
    name: "Nordiste",
    description: "Épreuve de faction - Nordiste",
    stageCount: 18,
    sortOrder: 20,
    categorySlug: "faction-trial",
    categoryName: "Épreuve de faction",
    categorySortOrder: 18,
  },
  {
    slug: "faction-trial-arbiter-chaotic",
    name: "Arbitre et chaotique",
    description: "Épreuve de faction - Arbitre et chaotique",
    stageCount: 18,
    sortOrder: 30,
    categorySlug: "faction-trial",
    categoryName: "Épreuve de faction",
    categorySortOrder: 18,
  },
  {
    slug: "faction-trial-infernal",
    name: "Infernal",
    description: "Épreuve de faction - Infernal",
    stageCount: 18,
    sortOrder: 40,
    categorySlug: "faction-trial",
    categoryName: "Épreuve de faction",
    categorySortOrder: 18,
  },
  {
    slug: "faction-trial-perceur",
    name: "Perceur",
    description: "Épreuve de faction - Perceur",
    stageCount: 18,
    sortOrder: 50,
    categorySlug: "faction-trial",
    categoryName: "Épreuve de faction",
    categorySortOrder: 18,
  },
  {
    slug: "faction-trial-cultiste",
    name: "Cultiste",
    description: "Épreuve de faction - Cultiste",
    stageCount: 18,
    sortOrder: 60,
    categorySlug: "faction-trial",
    categoryName: "Épreuve de faction",
    categorySortOrder: 18,
  },
  {
    slug: "faction-trial-esoteriste",
    name: "Ésotériste",
    description: "Épreuve de faction - Ésotériste",
    stageCount: 18,
    sortOrder: 70,
    categorySlug: "faction-trial",
    categoryName: "Épreuve de faction",
    categorySortOrder: 18,
  },
  {
    slug: "faction-trial-sentinelle",
    name: "Sentinelle",
    description: "Épreuve de faction - Sentinelle",
    stageCount: 18,
    sortOrder: 80,
    categorySlug: "faction-trial",
    categoryName: "Épreuve de faction",
    categorySortOrder: 18,
  },
  {
    slug: "faction-trial-cauchemar",
    name: "Cauchemar",
    description: "Épreuve de faction - Cauchemar",
    stageCount: 18,
    sortOrder: 90,
    categorySlug: "faction-trial",
    categoryName: "Épreuve de faction",
    categorySortOrder: 18,
  },
];

const pveCategoryTranslationKeys = {
  "gear-raid": "pve.category.gearRaid",
  "artifact-raid": "pve.category.artifactRaid",
  "faction-trial": "pve.category.factionTrial",
  "guild-boss": "pve.category.guildBoss",
  "immortal-codex": "pve.category.immortalCodex",
  "illusion-tower": "pve.category.illusionTower",
  arena: "pve.category.arena",
  campaign: "pve.category.campaign",
  malrik: "pve.category.malrik",
  breche: "pve.category.breche",
  "war-gallery": "pve.category.warGallery",
  other: "pve.category.other",
};

function getPveCategoryTranslationKey(categorySlug) {
  return pveCategoryTranslationKeys[categorySlug] || "";
}

function normalizePveContentNavItem(row) {
  return {
    id: row.id || "",
    navId: row.navId || row.slug || row.id || "",
    label: row.name || row.slug || "PVE",
    slug: row.slug || "",
    description: row.description || "",
    categorySlug: row.categorySlug || row.category_slug || "gear-raid",
    categoryName: row.categoryName || row.category_name || "Raid d'equipement",
    categorySortOrder: row.categorySortOrder ?? row.category_sort_order ?? 9999,
    stageCount: row.stage_count ?? row.stageCount ?? 0,
    sortOrder: row.sort_order ?? row.sortOrder ?? 9999,
    directNav: row.directNav ?? row.direct_nav ?? false,
    isActive: row.is_active ?? true,
    missingInDatabase: Boolean(row.missingInDatabase),
  };
}

function mergePveContentNavItems(rows = []) {
  const rowsBySlug = new Map(rows.map((row) => [String(row.slug || "").toLowerCase(), row]));

  return pveContentBlueprints.map((blueprint) => {
    const row = rowsBySlug.get(blueprint.slug);

    return normalizePveContentNavItem({
      ...blueprint,
      ...(row || {}),
      slug: blueprint.slug,
      name: row?.name || blueprint.name,
      description: row?.description || blueprint.description,
      stage_count: row?.stage_count ?? blueprint.stageCount,
      sort_order: row?.sort_order ?? blueprint.sortOrder,
      is_active: row?.is_active ?? true,
      categorySlug: blueprint.categorySlug,
      categoryName: blueprint.categoryName,
      categorySortOrder: row?.category_sort_order ?? blueprint.categorySortOrder,
      directNav: blueprint.directNav,
      missingInDatabase: !row?.id,
    });
  });
}

function buildPveNavigationCategories(items = []) {
  const categoriesBySlug = new Map();

  items.forEach((item) => {
    const slug = item.categorySlug || "gear-raid";
    const existing = categoriesBySlug.get(slug);
    const category = existing || {
      slug,
      name: item.categoryName || "PVE",
      sortOrder: item.categorySortOrder ?? 9999,
      directNav: Boolean(item.directNav),
      items: [],
    };

    category.name = item.categoryName || category.name;
    category.sortOrder = Math.min(category.sortOrder, item.categorySortOrder ?? 9999);
    category.directNav = category.directNav || Boolean(item.directNav);
    category.items.push(item);
    categoriesBySlug.set(slug, category);
  });

  return [...categoriesBySlug.values()]
    .map((category) => ({
      ...category,
      items: [...category.items].sort((a, b) => {
        if ((a.sortOrder ?? 9999) !== (b.sortOrder ?? 9999)) {
          return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
        }

        return String(a.label || "").localeCompare(String(b.label || ""), "fr", {
          sensitivity: "base",
        });
      }),
    }))
    .sort((a, b) => {
      if ((a.sortOrder ?? 9999) !== (b.sortOrder ?? 9999)) {
        return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
      }

      return String(a.name || "").localeCompare(String(b.name || ""), "fr", {
        sensitivity: "base",
      });
    });
}

const PORTAL_VIEW_MODE_STORAGE_KEY = "portalViewMode";

function getInitialPortalViewMode() {
  if (typeof window === "undefined") return "desktop";

  const stored = window.localStorage.getItem(PORTAL_VIEW_MODE_STORAGE_KEY);
  if (stored === "desktop" || stored === "mobile") return stored;

  return window.matchMedia?.("(max-width: 767px)")?.matches ? "mobile" : "desktop";
}

const categoryCards = [
  {
    id: "profile",
    title: "Mon profil",
    titleKey: "home.myProfile.title",
    description: "Gerez vos informations personnelles et vos preferences.",
    descriptionKey: "home.myProfile.description",
    icon: Users,
    tone: "border-sky-500/25 bg-sky-500/10 text-sky-200",
  },
  {
    id: "hero-box",
    title: "Ma box heros",
    titleKey: "home.heroBox.title",
    description: "Accedez a votre collection et gerez vos heros.",
    descriptionKey: "home.heroBox.description",
    icon: Grid3X3,
    tone: "border-indigo-500/25 bg-indigo-500/10 text-indigo-200",
    target: "hero-box",
  },
  {
    id: "soul-stones",
    title: "Pierres d'ame",
    titleKey: "home.soulStones.title",
    description: "Gerez et optimisez vos pierres d'ame.",
    descriptionKey: "home.soulStones.description",
    icon: Sparkles,
    tone: "border-amber-500/25 bg-amber-500/10 text-amber-200",
    target: "soul-stones",
  },
  {
    id: "demon-monsters",
    title: "Monstres demoniaques",
    titleKey: "home.demonMonsters.title",
    description: "Affrontez les forces obscures et domptez-les.",
    descriptionKey: "home.demonMonsters.description",
    icon: Shield,
    tone: "border-red-500/25 bg-red-500/10 text-red-200",
    target: "demon-monsters",
  },
  {
    id: "personal-best",
    title: "Mes PB",
    titleKey: "home.personalBest.title",
    description: "Consultez vos records et performances personnelles.",
    descriptionKey: "home.personalBest.description",
    icon: Activity,
    tone: "border-emerald-500/25 bg-emerald-500/10 text-emerald-200",
    target: "personal-best",
  },
  {
    id: "defenses",
    title: "Mes defenses",
    titleKey: "home.defenses.title",
    description: "Configurez et renforcez vos defenses.",
    descriptionKey: "home.defenses.description",
    icon: Bot,
    tone: "border-violet-500/25 bg-violet-500/10 text-violet-200",
    target: "defenses",
  },
];

const guildRows = [
  { name: "Cluster Paladin", plan: "Interne", gvg: "G1 - G7", status: "Actif", tone: "emerald" },
  { name: "Guilde externe test", plan: "Essai", gvg: "G2", status: "A valider", tone: "amber" },
  { name: "Prospect", plan: "Aucun", gvg: "-", status: "Invite", tone: "zinc" },
];

const runSteps = [
  { label: "Launcher en ligne", status: "pret", icon: Cpu },
  { label: "Calibration plein ecran", status: "attente", icon: Gauge },
  { label: "Capture 48 defenses", status: "attente", icon: UploadCloud },
  { label: "Reco serveur", status: "attente", icon: FileJson },
  { label: "Validation joueur", status: "attente", icon: CheckCircle2 },
];

const bastions = Array.from({ length: 4 }, (_, index) => ({
  id: index + 1,
  title: `Bastion ${index + 1}`,
  done: index === 0 ? 12 : index === 1 ? 8 : 0,
  total: 12,
  status: index === 0 ? "pret" : index === 1 ? "controle" : "vide",
}));

const calquesBaseUrl = String(
  import.meta.env?.VITE_CALQUES_BASE_URL || buildPublicCalquesBaseUrl()
).replace(/\/$/, "");

function isLocalHost() {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function calqueUrl(kind, fileName, options = {}) {
  const folders = {
    hero: "hero-calques",
    faction: "faction-calques",
    role: "role-calques",
  };
  const folder = folders[kind];
  const encodedFile = encodeURIComponent(fileName);

  if (calquesBaseUrl) return `${calquesBaseUrl}/${folder}/${encodedFile}`;
  const publicUrl = buildPublicCalqueUrl(kind, fileName);
  if (publicUrl) return publicUrl;
  if (isLocalHost() && !options.forceProxy) return `/${folder}/${encodedFile}`;

  return `${options.forceProxy ? getApiBase() : ""}/api/gvg-server?action=calque&kind=${kind}&file=${encodedFile}`;
}

function launcherDownloadUrl(apiBase) {
  return buildPublicDownloadUrl("PaladinGVGLauncher.zip") || `${apiBase}/api/gvg-server?action=launcher-download`;
}

function getApiBase() {
  if (typeof window === "undefined") return "";

  const configuredBase = import.meta.env?.VITE_API_BASE_URL;
  if (configuredBase) return configuredBase.replace(/\/$/, "");

  return isLocalHost() ? "http://localhost:3000" : "";
}

const PORTAL_SESSION_STORAGE_KEY = "paladinPortalSession";
const DASHBOARD_SESSION_STORAGE_KEY = "guildDashboardSession";
const portalDefaultPasswords = ["motdepassemembre", "motdepasseadmin"];
const portalTemporaryPasswordPrefix = "TMP-";

function normalizeRoleValue(role) {
  return String(role || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isLeaderRole(role) {
  return normalizeRoleValue(role) === "leader";
}

function isAdminRole(role) {
  return ["admin", "administrateur", "leader"].includes(normalizeRoleValue(role));
}

function isLeaderSession(session) {
  return Boolean(session?.isLeader || session?.leader || isLeaderRole(session?.role));
}

function isAdminSession(session) {
  return Boolean(session?.isAdmin || session?.admin || isAdminRole(session?.role));
}

function isMissingPortalLicenseTable(error) {
  const message = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes("portal_guild_licenses")
  );
}

function buildPortalSession(member) {
  const watcherName = member?.watcher_name || member?.discord_id || "Joueur";
  const role = member?.role || "Joueur";
  const communityAccessType = member?.community_access_type || (isPortalCommunityRole(role) ? "community" : "");
  const community = communityAccessType === "community" || isPortalCommunityRole(role);
  const guildCode = community ? "COMMUNITY" : member?.guild_code || "G1";
  const admin = isAdminRole(role);
  const leader = isLeaderRole(role);

  return {
    memberId: member?.id || null,
    id: member?.id || null,
    discordId: member?.discord_id || "",
    discord_id: member?.discord_id || "",
    name: watcherName,
    watcherName,
    memberName: watcherName,
    role,
    guild: guildCode,
    guildCode,
    guild_code: guildCode,
    accessType: community ? "community" : "guild",
    access_type: community ? "community" : "guild",
    communityAccessType,
    community_access_type: communityAccessType,
    communityStatus: member?.community_status || (community ? "active" : ""),
    community_status: member?.community_status || (community ? "active" : ""),
    preferredLanguage: member?.preferred_language || "",
    preferred_language: member?.preferred_language || "",
    isAdmin: admin,
    admin,
    isLeader: leader,
    leader,
    passwordChangeRequired: Boolean(member?.password_change_required),
  };
}

function refreshPortalSessionStorage(nextSession) {
  replaceStoredPortalSession(nextSession);
  return nextSession;
}

function isForcedPortalPassword(password) {
  const cleanPassword = String(password || "").trim();
  return portalDefaultPasswords.includes(cleanPassword) || cleanPassword.startsWith(portalTemporaryPasswordPrefix);
}

function readJsonStorage(key, storage) {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readStoredPortalSession() {
  if (typeof window === "undefined") return null;
  return (
    readJsonStorage(PORTAL_SESSION_STORAGE_KEY, window.sessionStorage) ||
    readJsonStorage(PORTAL_SESSION_STORAGE_KEY, window.localStorage)
  );
}

function persistPortalSession(session, remember) {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(session);
  window.sessionStorage.setItem(PORTAL_SESSION_STORAGE_KEY, serialized);
  window.localStorage.setItem(DASHBOARD_SESSION_STORAGE_KEY, serialized);

  if (remember) {
    window.localStorage.setItem(PORTAL_SESSION_STORAGE_KEY, serialized);
  } else {
    window.localStorage.removeItem(PORTAL_SESSION_STORAGE_KEY);
  }
}

function replaceStoredPortalSession(session) {
  if (typeof window === "undefined") return;
  const serialized = JSON.stringify(session);
  window.sessionStorage.setItem(PORTAL_SESSION_STORAGE_KEY, serialized);
  window.localStorage.setItem(DASHBOARD_SESSION_STORAGE_KEY, serialized);

  if (window.localStorage.getItem(PORTAL_SESSION_STORAGE_KEY)) {
    window.localStorage.setItem(PORTAL_SESSION_STORAGE_KEY, serialized);
  }
}

function clearPortalSession() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(PORTAL_SESSION_STORAGE_KEY);
  window.localStorage.removeItem(PORTAL_SESSION_STORAGE_KEY);
  window.localStorage.removeItem(DASHBOARD_SESSION_STORAGE_KEY);
}

const heroRarityOrder = ["legendary", "epic", "rare", "ordinary", "basic"];
const latestHeroReleaseWindowDays = 30;

const heroRarityMeta = {
  legendary: { label: "Legendaires", color: "#facc15" },
  epic: { label: "Epiques", color: "#c084fc" },
  rare: { label: "Rares", color: "#38bdf8" },
  ordinary: { label: "Ordinaires", color: "#4ade80" },
  basic: { label: "Basiques", color: "#a1a1aa" },
};

const heroRoleMeta = {
  combattant: { label: "Combattant", imageFile: "Combattant.png" },
  heal: { label: "Heal", imageFile: "Heal.png" },
  soigneur: { label: "Soigneur", imageFile: "Heal.png" },
  mage: { label: "Mage", imageFile: "Mage.png" },
  tacticien: { label: "Tacticien", imageFile: "Tacticien.png" },
  tank: { label: "Tank", imageFile: "Tank.png" },
  tireur: { label: "Tireur", imageFile: "Tireur.png" },
};

const heroFactionMeta = {
  arbitre: { label: "Arbitre", imageFile: "Arbitre.png" },
  cauchemar: { label: "Cauchemar", imageFile: "Cauchemar.png" },
  chaotique: { label: "Chaotique", imageFile: "Chaotique.png" },
  cultiste: { label: "Cultiste", imageFile: "Cultiste.png" },
  esoterique: { label: "Esoterique", imageFile: "Esoterique.png" },
  infernal: { label: "Infernal", imageFile: "Infernal.png" },
  innommable: { label: "Innommable", imageFile: "Innommable.png" },
  nordiste: { label: "Nordiste", imageFile: "Nordiste.png" },
  perceur: { label: "Perceur", imageFile: "Perceur.png" },
  sentinelle: { label: "Sentinelle", imageFile: "Sentinelle.png" },
};

const heroRoleOrder = Object.keys(heroRoleMeta);
const heroFactionOrder = Object.keys(heroFactionMeta);
const bulkAwakeningRarities = new Set(["epic", "rare", "ordinary", "basic"]);

function decodeLegacyMojibake(value) {
  let text = String(value || "");

  for (let index = 0; index < 2; index += 1) {
    if ([...text].some((character) => character.charCodeAt(0) > 255)) break;

    try {
      const decoded = decodeURIComponent(
        [...text]
          .map((character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`)
          .join(""),
      );

      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }

  return text;
}

function normalizeHeroKey(value) {
  return decodeLegacyMojibake(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function getChampionField(champion, fieldNames) {
  for (const fieldName of fieldNames) {
    const value = champion?.[fieldName];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) return value;
      continue;
    }
    if (String(value).trim()) return value;
  }

  return "";
}

function normalizeHeroDataValue(value) {
  return decodeLegacyMojibake(value)
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function splitChampionValues(value) {
  if (Array.isArray(value)) return value.map(normalizeHeroDataValue).filter(Boolean);
  return String(value || "")
    .split(/[;,|]/)
    .map(normalizeHeroDataValue)
    .filter(Boolean);
}

function formatHeroFilterLabel(value) {
  const normalized = normalizeHeroDataValue(value);
  const label = String(value || "").replace(/[_-]+/g, " ").trim();
  if (!label) return normalized;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function orderIndex(value, order) {
  const index = order.indexOf(value);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function sortHeroValues(left, right, order) {
  const orderDiff = orderIndex(left, order) - orderIndex(right, order);
  if (orderDiff !== 0) return orderDiff;
  return left.localeCompare(right, "fr", { sensitivity: "base" });
}

function getChampionPortalName(champion) {
  return String(
    getChampionField(champion, [
      "PortalName",
      "portalName",
      "portal_name",
      "portalname",
      "display_name",
      "displayName",
      "name",
    ]) || "",
  ).trim();
}

function getChampionRarity(champion) {
  return normalizeHeroDataValue(getChampionField(champion, ["rarity", "Rarity"]));
}

function normalizeHeroImageFile(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  const withoutQuery = rawValue.split(/[?#]/)[0];
  const fileName = withoutQuery.split(/[\\/]/).filter(Boolean).pop() || withoutQuery;
  if (!fileName) return "";

  try {
    const decodedFileName = decodeURIComponent(fileName);
    return /\.[a-z0-9]+$/i.test(decodedFileName) ? decodedFileName : decodedFileName + ".png";
  } catch {
    return /\.[a-z0-9]+$/i.test(fileName) ? fileName : fileName + ".png";
  }
}

function getChampionHeroImageFile(champion, portalName) {
  const configuredFile = getChampionField(champion, [
    "image_file",
    "imageFile",
    "ImageFile",
    "calque_file",
    "CalqueFile",
  ]);
  const imageFile = normalizeHeroImageFile(configuredFile);

  return imageFile || normalizeHeroImageFile(portalName);
}

function buildHeroImageCandidates(champion, portalName) {
  const candidates = [
    getChampionHeroImageFile(champion, portalName),
    normalizeHeroImageFile(portalName),
    normalizeHeroImageFile(formatHeroFilterLabel(portalName)),
  ].filter(Boolean);

  return [...new Set(candidates)];
}

function getMoontonHeroImage(champion, portalName) {
  const keys = [
    champion?.name,
    getChampionEnglishName(champion),
    portalName,
  ]
    .map(normalizeHeroKey)
    .filter(Boolean);

  for (const key of keys) {
    if (moontonHeroImages[key]) return moontonHeroImages[key];
  }

  return null;
}

function getChampionReleaseTime(champion) {
  const releaseValue = getChampionField(champion, [
    "released_at",
    "release_date",
    "ReleaseDate",
    "latest_release_at",
    "LatestReleaseAt",
  ]);
  const releaseTime = Date.parse(releaseValue);

  return Number.isFinite(releaseTime) ? releaseTime : null;
}

function isChampionMarkedLatest(champion) {
  const flag = getChampionField(champion, ["is_latest_release", "isLatestRelease", "latest", "Latest"]);
  if (typeof flag === "boolean") return flag;
  return ["1", "true", "yes", "oui"].includes(String(flag || "").trim().toLowerCase());
}

function buildPortalHeroCards(champions) {
  const latestReleaseWindowMs = latestHeroReleaseWindowDays * 24 * 60 * 60 * 1000;

  return (champions || [])
    .map((champion) => {
      const portalName = getChampionPortalName(champion);
      const championId = champion?.id;
      if (!portalName || championId === null || championId === undefined) return null;

      const imageFiles = buildHeroImageCandidates(champion, portalName);
      const imageFile = imageFiles[0] || "";
      const officialImageInfo = getMoontonHeroImage(champion, portalName);
      const officialImageFile = normalizeHeroImageFile(officialImageInfo?.file || "");
      const releaseTime = getChampionReleaseTime(champion);
      const isRecentRelease = releaseTime !== null && Date.now() - releaseTime < latestReleaseWindowMs;
      const isLatestRelease = isChampionMarkedLatest(champion) || isRecentRelease;

      return {
        id: String(championId),
        championId,
        technicalName: String(champion?.name || "").trim(),
        name: portalName,
        portalName,
        englishName: getChampionEnglishName(champion),
        rarity: getChampionRarity(champion),
        factions: splitChampionValues(getChampionField(champion, ["faction", "Faction", "factions", "Factions"])),
        roles: splitChampionValues(getChampionField(champion, ["role", "Role", "roles", "Roles"])),
        imageFile,
        image: imageFile ? calqueUrl("hero", imageFile) : "",
        fallbackImages: imageFiles.slice(1).map((fileName) => calqueUrl("hero", fileName)),
        officialImageFile,
        officialImage: officialImageFile ? calqueUrl("hero", officialImageFile, { forceProxy: true }) : "",
        officialImageSource: officialImageInfo?.source || "",
        isLatestRelease,
        latestReleaseRank: releaseTime === null ? null : -releaseTime,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const rarityDiff = orderIndex(left.rarity, heroRarityOrder) - orderIndex(right.rarity, heroRarityOrder);
      if (rarityDiff !== 0) return rarityDiff;
      return left.name.localeCompare(right.name, "fr", { sensitivity: "base" });
    });
}

function getPortalHeroDisplayName(hero, language = "fr") {
  if (!hero) return "";
  return language === "en" && hero.englishName ? hero.englishName : hero.portalName || hero.name || hero.technicalName || "";
}

function createEmptyHeroStateMap(heroes = []) {
  return Object.fromEntries(heroes.map((hero) => [hero.id, { owned: false, awakening: -1 }]));
}

function buildChampionIdByHeroId(heroes = []) {
  return Object.fromEntries(heroes.map((hero) => [hero.id, hero.championId || ""]));
}

function clampAwakeningLevel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return -1;
  return Math.max(-1, Math.min(5, Math.trunc(numeric)));
}

function getMemberDisplayName(member) {
  return member?.watcher_name || member?.discord_id || (member?.id ? `Joueur ${member.id}` : "Joueur");
}

function getMemberGuildLabel(member) {
  return member?.guild_code || "Sans guilde";
}

function buildHeroRarityFilters(heroes) {
  const rarities = [...new Set((heroes || []).map((hero) => hero.rarity).filter(Boolean))].sort((left, right) =>
    sortHeroValues(left, right, heroRarityOrder),
  );

  return [
    { id: "all", label: "Toutes", color: "#facc15" },
    ...rarities.map((rarity) => ({
      id: rarity,
      label: heroRarityMeta[rarity]?.label || formatHeroFilterLabel(rarity),
      color: heroRarityMeta[rarity]?.color || "#a1a1aa",
    })),
  ];
}

function buildHeroIconFilters(heroes, fieldName, meta, order, kind, allLabel, allShortLabel) {
  const values = [
    ...new Set((heroes || []).flatMap((hero) => (Array.isArray(hero[fieldName]) ? hero[fieldName] : [])).filter(Boolean)),
  ].sort((left, right) => sortHeroValues(left, right, order));

  return [
    { id: "all", label: allLabel, shortLabel: allShortLabel },
    ...values.map((value) => {
      const itemMeta = meta[value] || {};
      return {
        id: value,
        label: itemMeta.label || formatHeroFilterLabel(value),
        shortLabel: itemMeta.shortLabel,
        image: itemMeta.imageFile ? calqueUrl(kind, itemMeta.imageFile) : null,
      };
    }),
  ];
}

function statusClass(status) {
  if (status === "pret" || status === "Actif") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "controle" || status === "A valider" || status === "attente") return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  return "bg-zinc-800 text-zinc-300 border-zinc-700";
}

const LOGIN_IMAGE_SIZE = { width: 1672, height: 941 };
const LOGIN_HOTSPOTS = {
  email: { x: 642, y: 501, w: 392, h: 66 },
  password: { x: 642, y: 580, w: 318, h: 66 },
  eye: { x: 996, y: 599, w: 42, h: 38 },
  remember: { x: 589, y: 666, w: 208, h: 36 },
  rememberBox: { x: 590, y: 668, w: 24, h: 24 },
  forgot: { x: 902, y: 666, w: 166, h: 36 },
  createAccount: { x: 683, y: 717, w: 310, h: 38 },
  submit: { x: 596, y: 775, w: 462, h: 75 },
};

function LoginPanel({ onLogin }) {
  const { language, t } = usePortalLanguage();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotDiscordId, setForgotDiscordId] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState("");
  const [forgotResult, setForgotResult] = useState(null);
  const [accountRequestOpen, setAccountRequestOpen] = useState(false);
  const [accountRequestDraft, setAccountRequestDraft] = useState({
    discordContact: "",
    preferredLanguage: language,
    guildName: "",
  });
  const [accountRequestLoading, setAccountRequestLoading] = useState(false);
  const [accountRequestError, setAccountRequestError] = useState("");
  const [accountRequestResult, setAccountRequestResult] = useState(null);
  const [viewport, setViewport] = useState(LOGIN_IMAGE_SIZE);
  const scrollRef = useRef(null);

  useEffect(() => {
    function updateViewport() {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    }

    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  const fitScale = Math.min(
    viewport.width / LOGIN_IMAGE_SIZE.width,
    viewport.height / LOGIN_IMAGE_SIZE.height,
  );
  const imageScale =
    viewport.width < 768
      ? Math.max(0.68, Math.min(0.86, (viewport.height * 0.96) / LOGIN_IMAGE_SIZE.height))
      : Math.max(0.7, fitScale * 0.985);
  const stageWidth = Math.round(LOGIN_IMAGE_SIZE.width * imageScale);
  const stageHeight = Math.round(LOGIN_IMAGE_SIZE.height * imageScale);
  const stageOffsetX = Math.max((viewport.width - stageWidth) / 2, 0);
  const stageOffsetY = Math.max((viewport.height - stageHeight) / 2, 0);
  const loginFontSize = Math.min(Math.max(14, 21 * imageScale), 38);
  const pageWidth = Math.max(viewport.width, stageWidth + stageOffsetX * 2);
  const pageHeight = Math.max(viewport.height, stageHeight + stageOffsetY * 2);
  const loginBackground = language === "en" ? "/backgrounds/login-realms-en.png" : "/backgrounds/login-realms.png";

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    if (stageWidth > viewport.width) {
      container.scrollLeft = (stageWidth - viewport.width) / 2;
    }
    if (stageHeight > viewport.height) {
      container.scrollTop = Math.max((stageHeight - viewport.height) * 0.08, 0);
    }
  }, [stageHeight, stageWidth, viewport.height, viewport.width]);

  function hotspotStyle(area) {
    return {
      left: `${area.x * imageScale}px`,
      top: `${area.y * imageScale}px`,
      width: `${area.w * imageScale}px`,
      height: `${area.h * imageScale}px`,
    };
  }

  function fieldOverlayClass(field) {
    return [
      "pointer-events-none absolute flex items-center overflow-hidden rounded-md bg-[#030910]/95 px-0 font-serif text-left shadow-[inset_0_0_18px_rgba(0,0,0,0.72)]",
      focusedField === field ? "ring-2 ring-[#4fc3ff]/70" : "",
    ].join(" ");
  }

  async function submit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    const cleanDiscordId = identifier.trim();
    const cleanPassword = password.trim();

    if (!cleanDiscordId || !cleanPassword) {
      setErrorMessage(t("login.missingCredentials", "Renseigne ton ID Discord et ton mot de passe."));
      return;
    }

    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const { data, error } = await supabase
        .from("guild_members")
        .select("id, role, discord_id, watcher_name, guild_code, community_access_type, community_status, preferred_language")
        .eq("discord_id", cleanDiscordId)
        .eq("password", cleanPassword)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setErrorMessage(t("login.invalidCredentials", "Identifiant Discord ou mot de passe incorrect."));
        return;
      }

      if (
        (data.community_access_type === "community" || isPortalCommunityRole(data.role)) &&
        data.community_status === "inactive"
      ) {
        setErrorMessage(t("login.inactiveCommunityAccount", "Ce compte communaute est desactive. Contacte Darius."));
        return;
      }

      onLogin(buildPortalSession({ ...data, password_change_required: isForcedPortalPassword(cleanPassword) }), { remember });
    } catch (error) {
      console.error("[portal-login]", error);
      setErrorMessage(t("login.failed", "Connexion impossible. Reessaie ou contacte un admin."));
    } finally {
      setIsSubmitting(false);
    }
  }

  function openForgotDialog() {
    setForgotDiscordId(identifier.trim());
    setForgotError("");
    setForgotResult(null);
    setForgotOpen(true);
  }

  function openAccountRequestDialog() {
    setAccountRequestDraft((current) => ({
      ...current,
      discordContact: identifier.trim() || current.discordContact,
      preferredLanguage: language,
    }));
    setAccountRequestError("");
    setAccountRequestResult(null);
    setAccountRequestOpen(true);
  }

  async function submitForgotPassword(event) {
    event.preventDefault();
    if (forgotLoading) return;

    const cleanDiscordId = forgotDiscordId.trim();
    if (!cleanDiscordId) {
      setForgotError(t("login.forgotMissingId", "Renseigne ton ID Discord."));
      setForgotResult(null);
      return;
    }

    setForgotLoading(true);
    setForgotError("");
    setForgotResult(null);

    try {
      const { data: member, error: memberError } = await supabase
        .from("guild_members")
        .select("id, watcher_name, discord_id, guild_code")
        .eq("discord_id", cleanDiscordId)
        .maybeSingle();

      if (memberError) throw memberError;

      if (!member) {
        setForgotError(t("login.forgotNotFound", "Aucun compte Portal trouve pour cet ID Discord."));
        return;
      }

      const guildCode = String(member.guild_code || "").trim();
      if (!guildCode) {
        setForgotError(t("login.forgotNoGuild", "Ce compte n'a pas de guilde assignee. Contacte un admin Paladin."));
        return;
      }

      const { data: admins, error: adminsError } = await supabase
        .from("guild_members")
        .select("watcher_name, discord_id, role, guild_code")
        .eq("guild_code", guildCode);

      if (adminsError) throw adminsError;

      const adminRows = (admins || [])
        .filter((row) => isAdminRole(row.role))
        .sort((left, right) => String(left.watcher_name || "").localeCompare(String(right.watcher_name || ""), "fr", { sensitivity: "base" }))
        .map((row) => ({
          name: row.watcher_name || row.discord_id || "Admin",
          discordId: row.discord_id || "",
          role: row.role || "admin",
        }));

      setForgotResult({
        guildCode,
        admins: adminRows,
      });
    } catch (error) {
      console.error("[portal-forgot-password]", error);
      setForgotError(t("login.failed", "Connexion impossible. Reessaie ou contacte un admin."));
    } finally {
      setForgotLoading(false);
    }
  }

  async function submitAccountRequest(event) {
    event.preventDefault();
    if (accountRequestLoading) return;

    const discordContact = accountRequestDraft.discordContact.trim();
    const guildName = accountRequestDraft.guildName.trim();
    const preferredLanguage = accountRequestDraft.preferredLanguage || language;

    if (!discordContact) {
      setAccountRequestError(t("login.accountRequestMissingDiscord", "Renseigne ton ID Discord ou ton nom Discord exact."));
      setAccountRequestResult(null);
      return;
    }

    setAccountRequestLoading(true);
    setAccountRequestError("");
    setAccountRequestResult(null);

    try {
      const apiBase = getApiBase();
      const response = await fetch(`${apiBase}/api/portal-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "external-account-request",
          discordContact,
          preferredLanguage,
          guildName,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload?.error || t("login.accountRequestFailed", "Demande impossible pour le moment."));
      }

      setAccountRequestResult(payload);
    } catch (error) {
      console.error("[portal-account-request]", error);
      setAccountRequestError(error?.message || t("login.accountRequestFailed", "Demande impossible pour le moment."));
    } finally {
      setAccountRequestLoading(false);
    }
  }

  return (
    <main ref={scrollRef} className="relative h-[100svh] min-h-[100svh] overflow-auto bg-[#02060d] text-zinc-100">
      <h1 className="sr-only">{t("login.title", "Dashboard of Realms - Connexion")}</h1>
      <div className="fixed right-4 top-4 z-50">
        <PortalLanguageSelector />
      </div>

      <div
        className="relative"
        style={{
          width: `${pageWidth}px`,
          height: `${pageHeight}px`,
          minWidth: "100%",
          minHeight: "100svh",
        }}
      >
        <div
          className="absolute overflow-hidden rounded-[10px] shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_26px_90px_rgba(0,0,0,0.78)]"
          style={{
            left: `${stageOffsetX}px`,
            top: `${stageOffsetY}px`,
            width: `${stageWidth}px`,
            height: `${stageHeight}px`,
          }}
        >
          <img
            aria-hidden="true"
            src={loginBackground}
            alt=""
            className="absolute inset-0 h-full w-full select-none object-fill"
            draggable="false"
          />

      <form onSubmit={submit} className="absolute inset-0 z-10">
        <div
          aria-hidden="true"
          className={fieldOverlayClass("identifier")}
          style={{
            ...hotspotStyle(LOGIN_HOTSPOTS.email),
            fontSize: `${loginFontSize}px`,
          }}
        >
          <span className={identifier ? "truncate text-[#e6dccb]" : "truncate text-[#cabeab]/65"}>
            {identifier || t("login.identifier", "Identifiant")}
          </span>
        </div>
        <input
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          onFocus={() => setFocusedField("identifier")}
          onBlur={() => setFocusedField(null)}
          aria-label={t("login.identifier", "Identifiant")}
          autoComplete="username"
          className="absolute cursor-text opacity-0"
          style={hotspotStyle(LOGIN_HOTSPOTS.email)}
        />
        <div
          aria-hidden="true"
          className={fieldOverlayClass("password")}
          style={{
            ...hotspotStyle(LOGIN_HOTSPOTS.password),
            fontSize: `${loginFontSize}px`,
          }}
        >
          <span className={password ? "truncate text-[#e6dccb]" : "truncate text-[#cabeab]/65"}>
            {password ? (showPassword ? password : "\u2022".repeat(password.length)) : t("login.password", "Mot de passe")}
          </span>
        </div>
        <input
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onFocus={() => setFocusedField("password")}
          onBlur={() => setFocusedField(null)}
          aria-label={t("login.password", "Mot de passe")}
          autoComplete="current-password"
          className="absolute cursor-text opacity-0"
          style={hotspotStyle(LOGIN_HOTSPOTS.password)}
        />
        <button
          type="button"
          onClick={() => setShowPassword((value) => !value)}
          aria-label={showPassword ? t("login.hidePassword", "Masquer le mot de passe") : t("login.showPassword", "Afficher le mot de passe")}
          className="absolute cursor-pointer rounded-full bg-transparent outline-none transition hover:bg-cyan-300/10 focus-visible:ring-2 focus-visible:ring-[#4fc3ff]/70"
          style={hotspotStyle(LOGIN_HOTSPOTS.eye)}
        />
        <button
          type="button"
          onClick={() => setRemember((value) => !value)}
          aria-pressed={remember}
          className="absolute cursor-pointer rounded-md bg-transparent outline-none transition hover:bg-amber-200/10 focus-visible:ring-2 focus-visible:ring-[#4fc3ff]/70"
          style={hotspotStyle(LOGIN_HOTSPOTS.remember)}
        >
          <span className="sr-only">{t("login.remember", "Se souvenir de moi")}</span>
        </button>
        {remember && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute z-20 flex items-center justify-center border border-[#d8c5a9] bg-[#0a5c97]/85 text-[11px] font-bold text-white shadow-[0_0_10px_rgba(80,190,255,0.8)]"
            style={hotspotStyle(LOGIN_HOTSPOTS.rememberBox)}
          >
            {"\u2713"}
          </span>
        )}
        <button
          type="button"
          onClick={openForgotDialog}
          className="absolute cursor-pointer rounded-full bg-transparent outline-none transition hover:bg-cyan-300/10 focus-visible:ring-2 focus-visible:ring-[#4fc3ff]/70"
          style={hotspotStyle(LOGIN_HOTSPOTS.forgot)}
        >
          <span className="sr-only">{t("login.forgot", "Mot de passe oublie ?")}</span>
        </button>
        <button
          type="button"
          onClick={openAccountRequestDialog}
          className="absolute cursor-pointer rounded-full bg-transparent outline-none transition hover:bg-amber-200/10 focus-visible:ring-2 focus-visible:ring-[#4fc3ff]/70"
          style={hotspotStyle(LOGIN_HOTSPOTS.createAccount)}
        >
          <span className="sr-only">{t("login.createAccount", "Creer un nouveau compte")}</span>
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="absolute cursor-pointer bg-transparent outline-none transition focus-visible:ring-2 focus-visible:ring-[#4fc3ff]/80 disabled:cursor-wait"
          style={hotspotStyle(LOGIN_HOTSPOTS.submit)}
        >
          <span className="sr-only">{t("login.submit", "Se connecter")}</span>
        </button>
        {(errorMessage || isSubmitting) && (
          <div
            role="status"
            className={`absolute rounded-xl border px-3 py-2 text-center font-semibold shadow-lg backdrop-blur-md ${
              errorMessage
                ? "border-red-400/45 bg-red-950/75 text-red-100"
                : "border-emerald-300/40 bg-emerald-950/65 text-emerald-100"
            }`}
            style={{
              left: `${LOGIN_HOTSPOTS.submit.x * imageScale}px`,
              top: `${(LOGIN_HOTSPOTS.submit.y + LOGIN_HOTSPOTS.submit.h + 12) * imageScale}px`,
              width: `${LOGIN_HOTSPOTS.submit.w * imageScale}px`,
              fontSize: `${Math.max(11, 14 * imageScale)}px`,
            }}
          >
            {isSubmitting ? t("login.submitting", "Connexion...") : errorMessage}
          </div>
        )}
      </form>
        </div>
      </div>
      {forgotOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">{t("login.forgotTitle", "Mot de passe oublie")}</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {t(
                    "login.forgotHelp",
                    "Renseigne ton ID Discord. On te dira quels admins contacter pour ta guilde.",
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                onClick={() => setForgotOpen(false)}
              >
                {t("common.close", "Fermer")}
              </Button>
            </div>

            <form onSubmit={submitForgotPassword} className="mt-5 space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-zinc-300">
                  {t("login.forgotIdLabel", "ID Discord")}
                </span>
                <input
                  value={forgotDiscordId}
                  onChange={(event) => setForgotDiscordId(event.target.value)}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                  placeholder={t("login.forgotIdPlaceholder", "Ton ID Discord")}
                  autoComplete="username"
                />
              </label>

              {forgotError ? (
                <div className="rounded-xl border border-red-400/40 bg-red-950/60 px-3 py-2 text-sm text-red-100">
                  {forgotError}
                </div>
              ) : null}

              {forgotResult ? (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-950/35 p-3 text-sm text-emerald-50">
                  <div className="font-semibold">{t("login.forgotResultTitle", "Contacte les admins de ta guilde")}</div>
                  <p className="mt-1 text-emerald-100/85">
                    {t(
                      "login.forgotResultIntro",
                      "Ton compte est lie a {guild}. Contacte un de ces admins pour recuperer ton acces.",
                    ).replace("{guild}", forgotResult.guildCode)}
                  </p>

                  {forgotResult.admins.length ? (
                    <div className="mt-3 space-y-2">
                      {forgotResult.admins.map((admin) => (
                        <div key={`${admin.discordId}-${admin.name}`} className="rounded-lg border border-emerald-300/20 bg-black/25 p-2">
                          <div className="font-medium">{admin.name}</div>
                          <div className="text-xs text-emerald-100/70">
                            {t("login.forgotDiscordId", "ID Discord")} : {admin.discordId || "-"} · {t("login.forgotRole", "Role")} : {admin.role}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-lg border border-amber-300/25 bg-amber-950/40 p-2 text-amber-100">
                      {t("login.forgotNoAdmin", "Aucun admin trouve pour cette guilde. Contacte Darius ou un leader Paladin.")}
                    </div>
                  )}
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={forgotLoading}
                className="w-full bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
              >
                {forgotLoading ? t("login.forgotSearching", "Recherche...") : t("login.forgotSearch", "Trouver mes admins")}
              </Button>
            </form>
          </div>
        </div>
      ) : null}
      {accountRequestOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold">{t("login.accountRequestTitle", "Creer un compte")}</h2>
                <p className="mt-1 text-sm text-zinc-400">
                  {t(
                    "login.accountRequestHelp",
                    "Envoie ta demande. Un leader verifiera les informations et creera ton acces Portal.",
                  )}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                onClick={() => setAccountRequestOpen(false)}
              >
                {t("common.close", "Fermer")}
              </Button>
            </div>

            <form onSubmit={submitAccountRequest} className="mt-5 space-y-4">
              <label className="block space-y-2">
                <span className="text-sm font-medium text-zinc-300">
                  {t("login.accountRequestDiscordLabel", "ID Discord ou nom Discord exact")}
                </span>
                <input
                  value={accountRequestDraft.discordContact}
                  onChange={(event) =>
                    setAccountRequestDraft((current) => ({ ...current, discordContact: event.target.value }))
                  }
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                  placeholder={t("login.accountRequestDiscordPlaceholder", "Ex : 123456789012345678 ou PseudoDiscord")}
                  autoComplete="username"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">
                    {t("login.accountRequestLanguageLabel", "Langue")}
                  </span>
                  <select
                    value={accountRequestDraft.preferredLanguage}
                    onChange={(event) =>
                      setAccountRequestDraft((current) => ({ ...current, preferredLanguage: event.target.value }))
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                  >
                    <option value="fr">Francais</option>
                    <option value="en">English</option>
                  </select>
                </label>

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-zinc-300">
                    {t("login.accountRequestGuildLabel", "Guilde")}
                  </span>
                  <input
                    value={accountRequestDraft.guildName}
                    onChange={(event) =>
                      setAccountRequestDraft((current) => ({ ...current, guildName: event.target.value }))
                    }
                    className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 outline-none focus:border-cyan-400"
                    placeholder={t("login.accountRequestGuildPlaceholder", "Optionnel")}
                  />
                </label>
              </div>

              {accountRequestError ? (
                <div className="rounded-xl border border-red-400/40 bg-red-950/60 px-3 py-2 text-sm text-red-100">
                  {accountRequestError}
                </div>
              ) : null}

              {accountRequestResult ? (
                <div className="rounded-xl border border-emerald-400/30 bg-emerald-950/35 px-3 py-2 text-sm text-emerald-50">
                  {t(
                    "login.accountRequestSuccess",
                    "Demande envoyee. Un leader reviendra vers toi sur Discord.",
                  )}
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={accountRequestLoading || Boolean(accountRequestResult)}
                className="w-full bg-cyan-500 text-zinc-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {accountRequestLoading
                  ? t("login.accountRequestSending", "Envoi...")
                  : t("login.accountRequestSubmit", "Envoyer la demande")}
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ElectricBorderFilter() {
  return (
    <svg className="portal-electric-svg" aria-hidden="true" focusable="false">
      <defs>
        <filter
          id="portal-electric-displace"
          colorInterpolationFilters="sRGB"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="5" result="noiseA" seed="1" />
          <feOffset in="noiseA" dx="0" dy="0" result="offsetNoiseA">
            <animate attributeName="dy" values="700;0" dur="6s" repeatCount="indefinite" calcMode="linear" />
          </feOffset>

          <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="5" result="noiseB" seed="1" />
          <feOffset in="noiseB" dx="0" dy="0" result="offsetNoiseB">
            <animate attributeName="dy" values="0;-700" dur="6s" repeatCount="indefinite" calcMode="linear" />
          </feOffset>

          <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="5" result="noiseC" seed="2" />
          <feOffset in="noiseC" dx="0" dy="0" result="offsetNoiseC">
            <animate attributeName="dx" values="490;0" dur="6s" repeatCount="indefinite" calcMode="linear" />
          </feOffset>

          <feTurbulence type="turbulence" baseFrequency="0.02" numOctaves="5" result="noiseD" seed="2" />
          <feOffset in="noiseD" dx="0" dy="0" result="offsetNoiseD">
            <animate attributeName="dx" values="0;-490" dur="6s" repeatCount="indefinite" calcMode="linear" />
          </feOffset>

          <feComposite in="offsetNoiseA" in2="offsetNoiseB" result="verticalNoise" />
          <feComposite in="offsetNoiseC" in2="offsetNoiseD" result="horizontalNoise" />
          <feBlend in="verticalNoise" in2="horizontalNoise" mode="color-dodge" result="combinedNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="combinedNoise"
            scale="30"
            xChannelSelector="R"
            yChannelSelector="B"
          />
        </filter>
      </defs>
    </svg>
  );
}

function ElectricBorderLayers() {
  return (
    <div className="electric-border-container" aria-hidden="true">
      <div className="electric-inner-container">
        <div className="electric-border-outer">
          <div className="electric-main-border" />
        </div>
        <div className="electric-glow-layer-1" />
        <div className="electric-glow-layer-2" />
      </div>
      <div className="electric-overlay-1" />
      <div className="electric-overlay-2" />
      <div className="electric-background-glow" />
    </div>
  );
}

function LanguageFlagMark({ languageCode }) {
  const isEnglish = languageCode === "en";

  return (
    <span
      aria-hidden="true"
      className="relative inline-flex h-4 w-6 overflow-hidden rounded-[3px] border border-white/20 shadow-sm"
      style={{
        background: isEnglish
          ? "linear-gradient(90deg, #012169 0 100%)"
          : "linear-gradient(90deg, #1d4ed8 0 33%, #f8fafc 33% 66%, #dc2626 66% 100%)",
      }}
    >
      {isEnglish ? (
        <>
          <span className="absolute left-1/2 top-0 h-full w-[3px] -translate-x-1/2 bg-white/90" />
          <span className="absolute left-0 top-1/2 h-[3px] w-full -translate-y-1/2 bg-white/90" />
          <span className="absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-red-600" />
          <span className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 bg-red-600" />
        </>
      ) : null}
    </span>
  );
}

function PortalLanguageSelector() {
  const { language, setLanguage, currentLanguage, t } = usePortalLanguage();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        className="h-9 rounded-lg border-zinc-700 bg-zinc-900 px-3 text-zinc-100 hover:bg-zinc-800"
        aria-label={`${t("language.current", "Langue actuelle")} : ${currentLanguage.label}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <LanguageFlagMark languageCode={language} />
        <span className="ml-2 text-xs font-semibold">{currentLanguage.shortLabel}</span>
      </Button>

      {open ? (
        <div className="absolute right-0 top-11 z-30 w-44 rounded-xl border border-zinc-800 bg-zinc-950 p-1 shadow-2xl">
          {PORTAL_LANGUAGES.map((item) => (
            <button
              key={item.code}
              type="button"
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                language === item.code
                  ? "bg-zinc-800 text-zinc-50"
                  : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
              onClick={() => {
                setLanguage(item.code);
                setOpen(false);
              }}
            >
              <LanguageFlagMark languageCode={item.code} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PortalShell({ session, onLogout }) {
  const { t } = usePortalLanguage();
  const [active, setActive] = useState("home");
  const [adminNavOpen, setAdminNavOpen] = useState(false);
  const [pveNavOpen, setPveNavOpen] = useState(false);
  const [pveCategoryNavOpen, setPveCategoryNavOpen] = useState(() => ({ "gear-raid": false }));
  const [viewMode, setViewMode] = useState(getInitialPortalViewMode);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [portalLicense, setPortalLicense] = useState(null);
  const [portalLicenseLoaded, setPortalLicenseLoaded] = useState(false);
  const [pveContents, setPveContents] = useState(() => mergePveContentNavItems([]));
  const [pveContentsLoaded, setPveContentsLoaded] = useState(false);
  const [editRunInitialId, setEditRunInitialId] = useState("");
  const loggedTabViewsRef = useRef(new Set());
  const isAdminUser = isAdminSession(session);
  const isLeaderUser = isLeaderSession(session);
  const isPaladinUser = isPaladinSession(session);
  const isCommunityUser = isPortalCommunitySession(session);
  const isMobileMode = viewMode === "mobile";
  const controlBrand = getControlBrand(session);
  const guildScopeDescription = getGuildScopeDescription(session);
  const portalAccess = useMemo(
    () => {
      if (isPaladinUser) return getPaladinLicenseAccess();
      if (isCommunityUser) return getPortalLicenseAccess({ plan: "manual", status: "active" });
      if (!portalLicenseLoaded) return getPortalLicenseAccess({ plan: "suspended", status: "suspended" });
      return getPortalLicenseAccess(portalLicense || { plan: DEFAULT_EXTERNAL_LICENSE_PLAN, status: "active" });
    },
    [isCommunityUser, isPaladinUser, portalLicense, portalLicenseLoaded],
  );
  const visibleNavigation = useMemo(
    () =>
      navigation.filter((item) => canShowPortalNavItem(item, session, portalAccess)),
    [portalAccess, session],
  );
  const visibleAdminNavigation = useMemo(
    () =>
      adminNavigation.filter((item) =>
        canShowPortalAdminItem({ item, session, isAdminUser, isLeaderUser, isPaladinUser, portalAccess }),
      ),
    [isAdminUser, isLeaderUser, isPaladinUser, portalAccess, session],
  );
  const canUsePve = canShowPortalPve(session, portalAccess);
  const visiblePveNavigation = useMemo(
    () =>
      pveContents
        .filter((content) => content.isActive)
        .sort((a, b) => {
          if ((a.categorySortOrder ?? 9999) !== (b.categorySortOrder ?? 9999)) {
            return (a.categorySortOrder ?? 9999) - (b.categorySortOrder ?? 9999);
          }

          if ((a.sortOrder ?? 9999) !== (b.sortOrder ?? 9999)) {
            return (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999);
          }

          return String(a.label || "").localeCompare(String(b.label || ""), "fr", {
            sensitivity: "base",
          });
        }),
    [pveContents],
  );
  const pveNavigationCategories = useMemo(
    () => buildPveNavigationCategories(visiblePveNavigation),
    [visiblePveNavigation],
  );
  const activePveContentId = active.startsWith("pve:") ? active.slice(4) : "";
  const activePveItem = visiblePveNavigation.find(
    (item) =>
      String(item.id) === String(activePveContentId) ||
      String(item.navId) === String(activePveContentId) ||
      String(item.slug) === String(activePveContentId),
  );
  const activePveTab = active === "pve" || active.startsWith("pve:");
  const mobileQuickNavigation = useMemo(
    () => [
      ...visibleNavigation,
      ...(canUsePve
        ? [
            { id: "pve", label: "PVE", labelKey: "nav.pve", icon: BookOpen },
            ...visiblePveNavigation.map((item) => ({
              id: `pve:${item.navId}`,
              label: item.label,
              labelKey: null,
              icon: Play,
            })),
          ]
        : []),
      ...visibleAdminNavigation,
    ],
    [canUsePve, visibleAdminNavigation, visibleNavigation, visiblePveNavigation],
  );

  const activeTitle = useMemo(() => {
    if (activePveTab) return activePveItem?.label || t("nav.pve", "PVE");

    const activeItem = [...navigation, ...adminNavigation].find((item) => item.id === active);
    return activeItem ? t(activeItem.labelKey, activeItem.label) : t("nav.home", "Accueil");
  }, [active, activePveItem, activePveTab, t]);
  const activeAdminItem = visibleAdminNavigation.some((item) => item.id === active);

  useEffect(() => {
    const isAdminTab = adminNavigation.some((item) => item.id === active);
    const isVisibleAdminTab = visibleAdminNavigation.some((item) => item.id === active);
    const isBaseTab = navigation.some((item) => item.id === active);
    const isVisibleBaseTab = visibleNavigation.some((item) => item.id === active);
    const isPveTab = active === "pve" || active.startsWith("pve:");

    if (
      (isAdminTab && !isVisibleAdminTab) ||
      (isBaseTab && !isVisibleBaseTab) ||
      (isPveTab && !canUsePve)
    ) {
      setActive("home");
    }
  }, [active, canUsePve, visibleAdminNavigation, visibleNavigation]);

  useEffect(() => {
    let cancelled = false;

    async function loadPortalLicense() {
      if (isPaladinUser || isCommunityUser) {
        setPortalLicense(null);
        setPortalLicenseLoaded(true);
        return;
      }

      const guildSpaceKey = getSessionGuildSpaceKey(session);
      if (!guildSpaceKey) {
        setPortalLicense(null);
        setPortalLicenseLoaded(true);
        return;
      }

      setPortalLicenseLoaded(false);
      const { data, error } = await supabase
        .from("portal_guild_licenses")
        .select("plan, status, trial_started_at, trial_ends_at, current_period_started_at, current_period_ends_at")
        .eq("guild_space_key", guildSpaceKey)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        if (!isMissingPortalLicenseTable(error)) {
          console.error("[portal-license]", error);
        }
        setPortalLicense(null);
        setPortalLicenseLoaded(true);
        return;
      }

      setPortalLicense(data || null);
      setPortalLicenseLoaded(true);
    }

    void loadPortalLicense();

    return () => {
      cancelled = true;
    };
  }, [isCommunityUser, isPaladinUser, session]);

  useEffect(() => {
    let cancelled = false;

    async function loadPveContents() {
      if (!canUsePve) {
        setPveContents([]);
        setPveContentsLoaded(true);
        return;
      }

      setPveContentsLoaded(false);

      const { data, error } = await supabase
        .from("pve_contents")
        .select("id, slug, name, description, stage_count, sort_order, category_slug, category_name, category_sort_order, is_active")
        .eq("is_active", true)
        .order("category_sort_order", { ascending: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (cancelled) return;

      if (error) {
        if (error.code !== "42P01") {
          console.error("[pve-contents]", error);
        }
        setPveContents(mergePveContentNavItems([]));
        setPveContentsLoaded(true);
        return;
      }

      setPveContents(mergePveContentNavItems(data || []));
      setPveContentsLoaded(true);
    }

    void loadPveContents();

    return () => {
      cancelled = true;
    };
  }, [canUsePve]);

  useEffect(() => {
    if (active === "home" || active === "logs" || loggedTabViewsRef.current.has(active)) return;

    loggedTabViewsRef.current.add(active);
    void logPortalActivity(session, {
      targetMemberId: session?.memberId || session?.id || null,
      targetName: session?.watcherName || session?.name || "",
      actionType: "portal_tab_view",
      entityType: "tab",
      entityId: active,
      summary: `${session?.watcherName || session?.name || "Joueur"} a ouvert ${activeTitle}`,
      metadata: { tab: active, title: activeTitle },
    });
  }, [active, activeTitle, session]);

  useEffect(() => {
    if (activeAdminItem) setAdminNavOpen(true);
  }, [activeAdminItem]);

  useEffect(() => {
    if (activePveTab) {
      setPveNavOpen(true);
    }

    if (active.startsWith("pve:")) {
      const categorySlug = activePveItem?.categorySlug;
      if (categorySlug) {
        setPveCategoryNavOpen((previous) => ({ ...previous, [categorySlug]: true }));
      }
    }
  }, [active, activePveItem?.categorySlug, activePveTab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PORTAL_VIEW_MODE_STORAGE_KEY, viewMode);
    if (viewMode !== "mobile") setMobileNavOpen(false);
  }, [viewMode]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    document.body.classList.toggle("portal-mobile-active", isMobileMode);

    return () => {
      document.body.classList.remove("portal-mobile-active");
    };
  }, [isMobileMode]);

  useEffect(() => {
    if (!isMobileMode || !mobileNavOpen || typeof document === "undefined") return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isMobileMode, mobileNavOpen]);

  const selectTab = (tabId) => {
    setActive(tabId);
    setMobileNavOpen(false);
  };

  const openRunEditor = (runId) => {
    setEditRunInitialId(String(runId || ""));
    setActive("run-edit");
    setAdminNavOpen(true);
    setMobileNavOpen(false);
  };

  const toggleViewMode = () => {
    setViewMode((current) => (current === "mobile" ? "desktop" : "mobile"));
  };

  const renderNavigation = (variant = "desktop") => {
    const itemClass = (selected) =>
      variant === "mobile"
        ? `flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-base transition ${
            selected
              ? "bg-zinc-800 text-zinc-50"
              : "text-zinc-300 hover:bg-zinc-900 hover:text-zinc-100"
          }`
        : `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
            selected
              ? "bg-zinc-800 text-zinc-50"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          }`;

    const adminItemClass = (selected) =>
      variant === "mobile"
        ? `flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
            selected
              ? "bg-zinc-800 text-zinc-50"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
          }`
        : `flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
            selected
              ? "bg-zinc-800 text-zinc-50"
              : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-100"
          }`;

    return (
      <>
        {visibleNavigation.map((item) => {
          const Icon = item.icon;
          const selected = active === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => selectTab(item.id)}
              className={itemClass(selected)}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t(item.labelKey, item.label)}</span>
            </button>
          );
        })}

        {canUsePve ? (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => {
              setPveNavOpen((value) => !value);
              if (!activePveTab) {
                setActive("pve");
              }
            }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 ${
              variant === "mobile" ? "py-3 text-base" : "py-2.5 text-sm"
            } text-left transition ${
              activePveTab
                ? "bg-zinc-900 text-zinc-50"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            }`}
            aria-expanded={pveNavOpen}
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("nav.pve", "PVE")}</span>
            <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${pveNavOpen ? "rotate-90" : ""}`} />
          </button>

          {pveNavOpen ? (
            <div className="mt-1 space-y-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
              {pveNavigationCategories.length ? (
                pveNavigationCategories.map((category) => {
                  const directContent = category.directNav && category.items.length === 1 ? category.items[0] : null;
                  const categoryOpen = directContent ? false : Boolean(pveCategoryNavOpen[category.slug]);
                  const categoryLabelKey = getPveCategoryTranslationKey(category.slug);
                  const selectedCategory = activePveItem?.categorySlug === category.slug;

                  return (
                    <div key={category.slug} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (directContent) {
                            selectTab(`pve:${directContent.navId}`);
                            return;
                          }

                          setPveCategoryNavOpen((previous) => ({
                            ...previous,
                            [category.slug]: !previous[category.slug],
                          }));
                          if (!activePveTab) {
                            const firstContent = category.items[0];
                            if (firstContent) setActive(`pve:${firstContent.navId}`);
                          }
                        }}
                        className={adminItemClass(selectedCategory)}
                        aria-expanded={categoryOpen}
                      >
                        <BookOpen className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">
                          {categoryLabelKey ? t(categoryLabelKey, category.name) : category.name}
                        </span>
                        {directContent ? null : (
                          <ChevronRight
                            className={`h-4 w-4 shrink-0 transition-transform ${categoryOpen ? "rotate-90" : ""}`}
                          />
                        )}
                      </button>

                      {categoryOpen ? (
                        <div className="space-y-1 pl-4">
                          {category.items.map((item) => {
                            const selected = active === `pve:${item.navId}`;

                            return (
                              <button
                                key={item.navId}
                                type="button"
                                onClick={() => selectTab(`pve:${item.navId}`)}
                                className={adminItemClass(selected)}
                              >
                                <Play className="h-4 w-4 shrink-0" />
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <button
                  type="button"
                  onClick={() => selectTab("pve")}
                  className={adminItemClass(active === "pve")}
                >
                  <BookOpen className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">
                    {pveContentsLoaded ? t("pve.noContentShort", "Aucun contenu") : t("common.loading", "Chargement...")}
                  </span>
                </button>
              )}
            </div>
          ) : null}
        </div>
        ) : null}

        {visibleAdminNavigation.length ? (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setAdminNavOpen((value) => !value)}
            className={`flex w-full items-center gap-3 rounded-xl px-3 ${
              variant === "mobile" ? "py-3 text-base" : "py-2.5 text-sm"
            } text-left transition ${
              activeAdminItem
                ? "bg-zinc-900 text-zinc-50"
                : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
            }`}
            aria-expanded={adminNavOpen}
          >
            <Lock className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t("nav.admin", "Admin")}</span>
            <ChevronRight className={`h-4 w-4 shrink-0 transition-transform ${adminNavOpen ? "rotate-90" : ""}`} />
          </button>

          {adminNavOpen ? (
            <div className="mt-1 space-y-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
              {visibleAdminNavigation.map((item) => {
                const Icon = item.icon;
                const selected = active === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectTab(item.id)}
                    className={adminItemClass(selected)}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{t(item.labelKey, item.label)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        ) : null}
      </>
    );
  };

  return (
    <div className={`min-h-screen bg-[#11100d] text-zinc-100 ${isMobileMode ? "portal-mobile-mode" : "portal-desktop-mode"}`}>
      <ElectricBorderFilter />
      {isMobileMode ? (
        <div className={`fixed inset-0 z-50 ${mobileNavOpen ? "" : "pointer-events-none"}`} aria-hidden={!mobileNavOpen}>
          <button
            type="button"
            className={`absolute inset-0 bg-black/65 transition-opacity ${mobileNavOpen ? "opacity-100" : "opacity-0"}`}
            onClick={() => setMobileNavOpen(false)}
            aria-label="Fermer le menu"
          />
          <aside
            className={`absolute inset-y-0 left-0 flex w-[min(88vw,340px)] max-w-full flex-col border-r border-zinc-800 bg-zinc-950 px-4 py-4 shadow-2xl transition-transform duration-200 ${
              mobileNavOpen ? "translate-x-0" : "-translate-x-full"
            }`}
          >
            <div className="flex flex-none items-start justify-between gap-3 border-b border-zinc-800 pb-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10">
                  <Compass className="h-5 w-5 text-emerald-300" />
                </div>
                <div className="min-w-0">
                  <div className="truncate font-semibold text-zinc-50">{controlBrand}</div>
                  <div className="truncate text-xs text-zinc-500">{guildScopeDescription}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-2 text-zinc-300"
                aria-label="Fermer le menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto py-4 pr-1">
              {renderNavigation("mobile")}
            </nav>

            <div className="flex-none rounded-xl border border-zinc-800 bg-zinc-900 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-zinc-100">{session.name}</div>
                  <div className="truncate text-xs text-zinc-500">{session.role}</div>
                </div>
                <button
                  type="button"
                  onClick={onLogout}
                  className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  title={t("settings.logout", "Deconnexion")}
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <aside className={`${isMobileMode ? "hidden" : "fixed inset-y-0 left-0 hidden w-72 flex-col border-r border-zinc-800 bg-zinc-950/95 px-4 py-5 lg:flex"}`}>
        <div className="flex flex-none items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/25 bg-emerald-500/10">
            <Compass className="h-5 w-5 text-emerald-300" />
          </div>
          <div>
            <div className="font-semibold text-zinc-50">{controlBrand}</div>
            <div className="text-xs text-zinc-500">{guildScopeDescription}</div>
          </div>
        </div>

        <nav className="mt-8 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 pb-3">
          {renderNavigation("desktop")}
        </nav>

        <div className="mt-4 flex-none rounded-lg border border-zinc-800 bg-zinc-900 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-zinc-100">{session.name}</div>
              <div className="text-xs text-zinc-500">{session.role}</div>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="rounded-md p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              title={t("settings.logout", "Deconnexion")}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className={isMobileMode ? "min-w-0" : "lg:pl-72"}>
        <header className={`sticky top-0 z-20 border-b border-zinc-800 bg-[#11100d]/95 backdrop-blur ${isMobileMode ? "px-3 py-3" : "px-4 py-4 md:px-6"}`}>
          <div className={`flex gap-3 ${isMobileMode ? "flex-col" : "flex-wrap items-center justify-between"}`}>
            <div className={isMobileMode ? "flex min-w-0 items-center gap-3" : ""}>
              {isMobileMode ? (
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(true)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-700 bg-zinc-950 text-zinc-100"
                  aria-label="Ouvrir le menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
              ) : null}
              <div className="min-w-0">
              <div className="text-sm text-zinc-500">{t("portal.label", "Portail")}</div>
                <h1 className={`${isMobileMode ? "truncate text-2xl" : "text-2xl"} font-semibold text-zinc-50`}>{activeTitle}</h1>
              </div>
            </div>
            <div className={`flex items-center gap-2 ${isMobileMode ? "overflow-x-auto pb-1" : ""}`}>
              <Badge className="shrink-0 rounded-lg border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
                {t("portal.apiReady", "API VPS prete")}
              </Badge>
              <PortalLanguageSelector />
              <Button
                type="button"
                variant="outline"
                onClick={toggleViewMode}
                className="shrink-0 rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                title={isMobileMode ? "Passer en mode ordinateur" : "Passer en mode telephone"}
              >
                {isMobileMode ? <Monitor className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
                <span className={isMobileMode ? "ml-2 text-xs font-semibold" : "sr-only"}>
                  {isMobileMode ? "PC" : "Mobile"}
                </span>
              </Button>
              <Button variant="outline" className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800">
                <Bell className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </header>

        {isMobileMode ? (
          <div className="border-b border-zinc-800 bg-[#0d0c0a]/95 px-3 py-2">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {mobileQuickNavigation.map((item) => {
                const Icon = item.icon;
                const selected = active === item.id;

                return (
                  <button
                    key={`mobile-quick-${item.id}`}
                    type="button"
                    onClick={() => selectTab(item.id)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold transition ${
                      selected
                        ? "border-cyan-300/60 bg-cyan-400/15 text-cyan-100"
                        : "border-zinc-800 bg-zinc-950/70 text-zinc-400"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{item.labelKey ? t(item.labelKey, item.label) : item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <main className={`${isMobileMode ? "portal-mobile-main space-y-5 px-3 py-4" : "space-y-6 px-4 py-6 md:px-6"}`}>
          {active === "home" ? <HomeView session={session} setActive={setActive} /> : null}
          {active === "hero-box" ? <HeroBoxView session={session} /> : null}
          {active === "soul-stones" ? <SoulStonesTab session={session} /> : null}
          {active === "demon-monsters" ? <DemonMonstersTab session={session} /> : null}
          {active === "personal-best" ? <PersonalBestTab session={session} /> : null}
          {active === "defenses" ? <MyDefensesTab session={session} /> : null}
          {active === "gvg" ? <GvgView session={session} onEditRun={openRunEditor} /> : null}
          {active === "run-search" ? <RunSearchGrid session={session} /> : null}
          {activePveTab ? (
            <PveLibraryTab
              session={session}
              contents={visiblePveNavigation}
              selectedContentId={activePveContentId}
            />
          ) : null}
          {active === "launcher" ? <LauncherView session={session} /> : null}
          {active === "validation" ? <GvgValidationTab session={session} /> : null}
          {active === "guild-management" ? <PortalGuildManagementTab session={session} /> : null}
          {active === "admin-defenses" ? <PortalAdminDefensesView session={session} /> : null}
          {active === "intersaison" ? <PortalIntersaisonTab session={session} /> : null}
          {active === "run-add" ? <RunAddTab session={session} /> : null}
          {active === "run-edit" ? <RunEditTab session={session} initialRunId={editRunInitialId} /> : null}
          {active === "player-access" ? <PlayerAccessView session={session} /> : null}
          {active === "templates" ? <AddHeroView session={session} /> : null}
          {active === "guilds" ? <GuildsView session={session} /> : null}
          {active === "billing" ? <BillingView session={session} /> : null}
          {active === "community-members" ? <CommunityMembersTab session={session} apiBase={getApiBase()} /> : null}
          {active === "logs" ? <LogsView session={session} /> : null}
          {active === "settings" ? <SettingsView session={session} onLogout={onLogout} /> : null}
        </main>
      </div>
    </div>
  );
}

function HomeView({ session, setActive }) {
  const { t } = usePortalLanguage();
  const displayName = session.watcherName || session.name || "Joueur";
  const summaryCards = [
    { label: t("home.guild", "Guilde"), value: session.guild || "Paladin", icon: Users },
    { label: t("home.role", "Role"), value: session.role || "Joueur", icon: Shield },
    { label: t("home.profile", "Profil"), value: t("home.notValidated", "Non valide"), icon: CheckCircle2 },
  ];

  return (
    <>
      <section
        className="electric-card player-home-card group relative min-h-[340px] overflow-hidden rounded-[1.35rem] border border-violet-500/70 bg-zinc-950 shadow-[0_0_34px_rgba(168,85,247,0.24)] transition-[border-color,box-shadow] duration-300 hover:border-violet-300/85 hover:shadow-[0_0_54px_rgba(168,85,247,0.48),0_30px_90px_rgba(0,0,0,0.58)] lg:h-[clamp(300px,24vw,380px)] lg:min-h-0"
        style={{
          backgroundImage:
            "linear-gradient(90deg, rgba(0,0,0,0.62), rgba(8,5,16,0.08) 44%, rgba(0,0,0,0.58)), url('/backgrounds/player-home-preview.png')",
          backgroundPosition: "center 42%",
          backgroundSize: "cover",
        }}
      >
        <ElectricBorderLayers />
        <div className="absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_50%_42%,rgba(168,85,247,0.3),transparent_30%),linear-gradient(180deg,rgba(0,0,0,0.04),rgba(0,0,0,0.68))]" />
        <div className="relative z-10 grid min-h-[340px] gap-6 p-6 sm:p-8 lg:h-full lg:min-h-0 lg:grid-cols-[1fr_minmax(420px,0.78fr)] lg:items-end lg:p-[clamp(28px,2.4vw,42px)]">
          <div className="max-w-[620px] self-start lg:self-center">
            <p className="text-sm font-medium text-violet-200 sm:text-base">{t("home.playerHome", "Accueil joueur")}</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white drop-shadow-[0_2px_16px_rgba(0,0,0,0.85)] sm:text-4xl lg:text-[2.35rem]">
              {t("home.welcome", "Bienvenue")}, {displayName}
            </h2>
            <p className="mt-4 max-w-[410px] text-sm leading-6 text-zinc-300 sm:text-base">
              {t(
                "home.description",
                "Gerez vos outils, suivez vos activites et preparez vos batailles pour la gloire.",
              )}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:gap-4">
            {summaryCards.map((card) => {
              const Icon = card.icon;

              return (
                <div
                  key={card.label}
                  className="relative min-h-[112px] cursor-default overflow-hidden rounded-xl border border-violet-400/55 bg-black/38 p-4 shadow-[inset_0_0_34px_rgba(0,0,0,0.72),0_0_18px_rgba(168,85,247,0.18)] backdrop-blur-[2px]"
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-violet-300/80 shadow-[0_0_18px_4px_rgba(168,85,247,0.68)] opacity-75" />
                  <div className="pointer-events-none absolute inset-x-8 bottom-0 h-px bg-violet-400/60 shadow-[0_0_18px_4px_rgba(168,85,247,0.54)] opacity-65" />
                  <Icon className="h-5 w-5 text-zinc-200" />
                  <div className="mt-4 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-violet-300">
                    {card.label}
                  </div>
                  <div className="mt-1 text-lg font-semibold text-white">{card.value}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {categoryCards.filter((card) => canShowPortalHomeCard(card, session)).map((card) => {
          const Icon = card.icon;
          const canOpen = Boolean(card.target);
          const isProfile = card.id === "profile";
          const isHeroBox = card.id === "hero-box";
          const isSoulStone = card.id === "soul-stones";
          const isDemonMonsters = card.id === "demon-monsters";
          const isPersonalBest = card.id === "personal-best";
          const isDefenses = card.id === "defenses";
          const isImageCard = isProfile || isHeroBox || isSoulStone || isDemonMonsters || isPersonalBest || isDefenses;
          const imageHoverClass = isProfile
            ? "group-hover/profile:scale-[1.04]"
            : isSoulStone
              ? "group-hover/soulStone:scale-[1.04]"
              : isDemonMonsters
                ? "group-hover/demonMonsters:scale-[1.04]"
                : isPersonalBest
                  ? "group-hover/personalBest:scale-[1.04]"
                  : isDefenses
                    ? "group-hover/defenses:scale-[1.04]"
                    : "group-hover/heroBox:scale-[1.04]";
          const imageCardClass = isProfile
            ? "electric-card profile-category-card group/profile relative min-h-[200px] overflow-hidden rounded-lg border border-sky-400/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(14,165,233,0.16)] transition-[border-color,box-shadow,transform] duration-300 hover:border-sky-200/90 hover:shadow-[0_0_38px_rgba(56,189,248,0.42),0_18px_54px_rgba(2,8,23,0.72)]"
            : isSoulStone
              ? "electric-card soul-stone-category-card group/soulStone relative min-h-[200px] overflow-hidden rounded-lg border border-white/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(255,255,255,0.18)] transition-[border-color,box-shadow,transform] duration-300 hover:border-white/90 hover:shadow-[0_0_40px_rgba(255,255,255,0.45),0_18px_54px_rgba(15,23,42,0.74)]"
              : isDemonMonsters
                ? "electric-card demon-monsters-category-card group/demonMonsters relative min-h-[200px] overflow-hidden rounded-lg border border-red-500/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(239,68,68,0.18)] transition-[border-color,box-shadow,transform] duration-300 hover:border-orange-200/90 hover:shadow-[0_0_42px_rgba(239,68,68,0.48),0_18px_54px_rgba(24,2,2,0.78)]"
                : isPersonalBest
                  ? "electric-card personal-best-category-card group/personalBest relative min-h-[200px] overflow-hidden rounded-lg border border-emerald-500/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(16,185,129,0.18)] transition-[border-color,box-shadow,transform] duration-300 hover:border-emerald-200/90 hover:shadow-[0_0_42px_rgba(16,185,129,0.48),0_18px_54px_rgba(2,24,12,0.78)]"
                : isDefenses
  ? "electric-card defenses-category-card group/defenses relative min-h-[200px] overflow-hidden rounded-lg border border-pink-500/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(236,72,153,0.18)] transition-[border-color,box-shadow,transform] duration-300 hover:border-pink-200/90 hover:shadow-[0_0_42px_rgba(236,72,153,0.48),0_18px_54px_rgba(24,2,16,0.78)]"
  : "electric-card hero-box-category-card group/heroBox relative min-h-[200px] overflow-hidden rounded-lg border border-amber-300/55 bg-zinc-950 p-0 text-left shadow-[0_0_22px_rgba(245,158,11,0.16)] transition-[border-color,box-shadow,transform] duration-300 hover:border-yellow-100/90 hover:shadow-[0_0_40px_rgba(251,191,36,0.44),0_18px_54px_rgba(24,16,2,0.74)]";

          return (
            <button
              key={card.id}
              type="button"
              onClick={() => canOpen && setActive(card.target)}
              className={
                isImageCard
                  ? imageCardClass
                  : "rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-left transition hover:border-zinc-700 hover:bg-zinc-900"
              }
            >
              {isImageCard ? (
                <>
                  <ElectricBorderLayers />
                  <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
                    <img
                      src={
                      isProfile
                        ? "/backgrounds/profile-card-preview.png"
                        : isSoulStone
                          ? "/backgrounds/soul-stone-card-preview.png"
                          : isDemonMonsters
                            ? "/backgrounds/demon-monsters-card-preview.png"
                            : isPersonalBest
                              ? "/backgrounds/personal-best-card-preview.png"
                              : isDefenses
                                ? "/backgrounds/defenses-card-preview.png"
                                : "/backgrounds/hero-box-card-preview.png"
                    }
                      alt=""
                      className={`h-full w-full object-cover object-center opacity-[0.92] transition duration-500 ${imageHoverClass}`}
                      draggable="false"
                    />
                    <div
                      className={
                        isProfile
                          ? "absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,23,0.88),rgba(2,8,23,0.38)_48%,rgba(2,8,23,0.06)),linear-gradient(180deg,rgba(2,8,23,0.04),rgba(2,8,23,0.82))]"
                          : "absolute inset-0 bg-[linear-gradient(90deg,rgba(24,16,2,0.88),rgba(24,16,2,0.38)_48%,rgba(24,16,2,0.05)),linear-gradient(180deg,rgba(24,16,2,0.02),rgba(24,16,2,0.84))]"
                      }
                    />
                  </div>
                  <div className="relative z-10 flex min-h-[200px] flex-col justify-end p-5">
                    <div
                      className={`inline-flex w-fit rounded-lg border p-2 ${
                        isProfile
                          ? card.tone
                          : "border-amber-300/35 bg-amber-300/10 text-amber-100 shadow-[0_0_22px_rgba(251,191,36,0.18)]"
                      }`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div>
                        <div
                          className={`text-xs font-bold uppercase tracking-[0.18em] ${
                            isProfile ? "text-sky-200/85" : "text-amber-100/85"
                          }`}
                        >
                          {isProfile ? t("home.profileCard", "Profil joueur") : t("home.heroesCard", "Heros")}
                        </div>
                        <div className="mt-1 text-lg font-semibold text-zinc-50">{t(card.titleKey, card.title)}</div>
                        <p className="mt-2 max-w-[260px] text-sm leading-5 text-zinc-200/80">
                          {t(card.descriptionKey, card.description)}
                        </p>
                      </div>
                      <ChevronRight className={`h-4 w-4 ${isProfile ? "text-sky-100" : "text-amber-100"}`} />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className={`inline-flex rounded-lg border p-2 ${card.tone}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="text-base font-semibold text-zinc-50">{t(card.titleKey, card.title)}</div>
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </>
              )}
            </button>
          );
        })}
      </section>
    </>
  );
}

function HeroBoxView({ session }) {
  const { language, t } = usePortalLanguage();
  const [query, setQuery] = useState("");
  const [playerQuery, setPlayerQuery] = useState("");
  const [ownedFilter, setOwnedFilter] = useState("all");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [factionFilter, setFactionFilter] = useState("all");
  const [latestOnly, setLatestOnly] = useState(false);
  const [loadedHeroImages, setLoadedHeroImages] = useState(() => new Set());
  const preloadingHeroImagesRef = useRef(new Set());
  const [heroCards, setHeroCards] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState(session?.memberId || session?.id || "");
  const [heroBoxLoading, setHeroBoxLoading] = useState(false);
  const [heroBoxError, setHeroBoxError] = useState("");
  const [savingHeroId, setSavingHeroId] = useState("");
  const [bulkSavingRarity, setBulkSavingRarity] = useState("");
  const [heroStates, setHeroStates] = useState({});
  const [selectedHeroDetails, setSelectedHeroDetails] = useState(null);

  const connectedPlayerId = session?.memberId || session?.id || "";
  const isAdminUser = isAdminSession(session);
  const connectedPlayerKey = connectedPlayerId ? String(connectedPlayerId) : "";
  const selectedPlayerKey = selectedPlayerId ? String(selectedPlayerId) : "";
  const canEdit = Boolean(isAdminUser || (selectedPlayerKey && selectedPlayerKey === connectedPlayerKey));
  const championIdByHeroId = useMemo(() => buildChampionIdByHeroId(heroCards), [heroCards]);
  const heroRarityFilters = useMemo(() => buildHeroRarityFilters(heroCards), [heroCards]);
  const heroRoleFilters = useMemo(
    () =>
      buildHeroIconFilters(
        heroCards,
        "roles",
        heroRoleMeta,
        heroRoleOrder,
        "role",
        t("heroBox.allRoles", "Tous les roles"),
        t("heroBox.allRolesShort", "Tous"),
      ),
    [heroCards, t],
  );
  const heroFactionFilters = useMemo(
    () =>
      buildHeroIconFilters(
        heroCards,
        "factions",
        heroFactionMeta,
        heroFactionOrder,
        "faction",
        t("heroBox.allFactions", "Toutes les factions"),
        t("heroBox.allFactionsShort", "Toutes"),
      ),
    [heroCards, t],
  );
  const hasLatestHeroes = useMemo(() => heroCards.some((hero) => hero.isLatestRelease), [heroCards]);
  const selectedRarityFilter = useMemo(
    () => heroRarityFilters.find((filter) => filter.id === rarityFilter) || null,
    [heroRarityFilters, rarityFilter],
  );
  const bulkAwakeningHeroes = useMemo(() => {
    if (!bulkAwakeningRarities.has(rarityFilter)) return [];
    return heroCards.filter((hero) => hero.rarity === rarityFilter && championIdByHeroId[hero.id]);
  }, [championIdByHeroId, heroCards, rarityFilter]);
  const bulkAwakeningPendingCount = useMemo(
    () => bulkAwakeningHeroes.filter((hero) => (heroStates[hero.id] || { awakening: -1 }).awakening !== 5).length,
    [bulkAwakeningHeroes, heroStates],
  );
  const canBulkAwaken =
    canEdit &&
    selectedPlayerKey &&
    bulkAwakeningHeroes.length > 0 &&
    bulkAwakeningPendingCount > 0 &&
    !heroBoxLoading &&
    !bulkSavingRarity;

  const selectedPlayer = useMemo(
    () => members.find((member) => String(member.id) === selectedPlayerKey) || null,
    [members, selectedPlayerKey],
  );

  const playerSuggestions = useMemo(() => {
    const normalizedPlayerQuery = normalizeHeroKey(playerQuery);

    return members
      .filter((member) => {
        if (!normalizedPlayerQuery) return true;
        return normalizeHeroKey(`${getMemberDisplayName(member)} ${getMemberGuildLabel(member)}`).includes(
          normalizedPlayerQuery,
        );
      })
      .slice(0, 8);
  }, [members, playerQuery]);

  useEffect(() => {
    if (!hasLatestHeroes && latestOnly) setLatestOnly(false);
  }, [hasLatestHeroes, latestOnly]);

  useEffect(() => {
    if (!heroRarityFilters.some((filter) => filter.id === rarityFilter)) setRarityFilter("all");
    if (!heroRoleFilters.some((filter) => filter.id === roleFilter)) setRoleFilter("all");
    if (!heroFactionFilters.some((filter) => filter.id === factionFilter)) setFactionFilter("all");
  }, [factionFilter, heroFactionFilters, heroRarityFilters, heroRoleFilters, rarityFilter, roleFilter]);

  useEffect(() => {
    let cancelled = false;

    async function loadHeroBoxBaseData() {
      setHeroBoxLoading(true);
      setHeroBoxError("");

      try {
        const [membersResult, championsResult] = await Promise.all([
          supabase
            .from("guild_members")
            .select("id, role, discord_id, watcher_name, guild_code")
            .order("watcher_name", { ascending: true }),
          supabase.from("champions").select("*"),
        ]);

        if (membersResult.error) throw membersResult.error;
        if (championsResult.error) throw championsResult.error;
        if (cancelled) return;

        const nextMembers = filterByGuildScope(
          membersResult.data || [],
          session,
          (member) => member.guild_code,
          { leaderSeesAll: true },
        );
        const nextHeroCards = buildPortalHeroCards(championsResult.data || []);
        setMembers(nextMembers);
        setHeroCards(nextHeroCards);
        setHeroStates(createEmptyHeroStateMap(nextHeroCards));
        setSelectedPlayerId((current) => current || connectedPlayerKey || String(nextMembers[0]?.id || ""));
      } catch (error) {
        if (!cancelled) setHeroBoxError(error?.message || "Impossible de charger les joueurs et champions.");
      } finally {
        if (!cancelled) setHeroBoxLoading(false);
      }
    }

    loadHeroBoxBaseData();

    return () => {
      cancelled = true;
    };
  }, [connectedPlayerKey, session]);

  useEffect(() => {
    let cancelled = false;

    async function loadPlayerAwakenings() {
      if (heroCards.length === 0) {
        setHeroStates({});
        return;
      }

      if (!selectedPlayerKey) {
        setHeroStates(createEmptyHeroStateMap(heroCards));
        return;
      }

      const championIds = Object.values(championIdByHeroId).filter(Boolean);
      if (championIds.length === 0) {
        setHeroStates(createEmptyHeroStateMap(heroCards));
        return;
      }

      setHeroBoxLoading(true);
      setHeroBoxError("");

      try {
        const { data, error } = await supabase
          .from("member_awakenings")
          .select("champion_id, awakening_level")
          .eq("member_id", selectedPlayerKey)
          .in("champion_id", championIds);

        if (error) throw error;
        if (cancelled) return;

        const awakeningByChampionId = new Map(
          (data || []).map((row) => [String(row.champion_id), clampAwakeningLevel(row.awakening_level)]),
        );
        const nextStates = createEmptyHeroStateMap(heroCards);

        heroCards.forEach((hero) => {
          const championId = championIdByHeroId[hero.id];
          if (!championId) return;

          const awakening = awakeningByChampionId.get(String(championId));
          if (awakening !== undefined) {
            nextStates[hero.id] = { owned: awakening >= 0, awakening };
          }
        });

        setHeroStates(nextStates);
      } catch (error) {
        if (!cancelled) {
          setHeroStates(createEmptyHeroStateMap(heroCards));
          setHeroBoxError(error?.message || "Impossible de charger la box du joueur.");
        }
      } finally {
        if (!cancelled) setHeroBoxLoading(false);
      }
    }

    loadPlayerAwakenings();

    return () => {
      cancelled = true;
    };
  }, [championIdByHeroId, heroCards, selectedPlayerKey]);

  const visibleHeroes = useMemo(() => {
    const normalizedQuery = normalizeHeroKey(query);

    return heroCards
      .filter((hero) => {
        const state = heroStates[hero.id] || { owned: false, awakening: -1 };
        const displayName = getPortalHeroDisplayName(hero, language);
        const matchesQuery =
          normalizedQuery.length === 0 ||
          normalizeHeroKey(`${displayName} ${hero.name} ${hero.portalName} ${hero.technicalName} ${hero.englishName}`).includes(
            normalizedQuery,
          );
        const matchesState =
          ownedFilter === "all" ||
          (ownedFilter === "owned" && state.owned) ||
          (ownedFilter === "locked" && !state.owned) ||
          (ownedFilter === "a5" && state.owned && state.awakening === 5);
        const matchesRarity = rarityFilter === "all" || hero.rarity === rarityFilter;
        const matchesRole = roleFilter === "all" || hero.roles.includes(roleFilter);
        const matchesFaction = factionFilter === "all" || hero.factions.includes(factionFilter);
        const matchesLatest = !latestOnly || hero.isLatestRelease;

        return matchesQuery && matchesState && matchesRarity && matchesRole && matchesFaction && matchesLatest;
      })
      .sort((left, right) => {
        if (!latestOnly) return 0;
        return (left.latestReleaseRank || 999) - (right.latestReleaseRank || 999);
      });
  }, [factionFilter, heroCards, heroStates, language, latestOnly, ownedFilter, query, rarityFilter, roleFilter]);

  const priorityHeroes = useMemo(() => visibleHeroes.slice(0, 24), [visibleHeroes]);
  const priorityHeroImageCount = priorityHeroes.length;
  const loadedPriorityHeroImageCount = priorityHeroes.filter((hero) => loadedHeroImages.has(hero.id)).length;
  const heroImagesAreWarming =
    priorityHeroImageCount > 0 && loadedPriorityHeroImageCount < Math.min(priorityHeroImageCount, 12);
  const heroImageWarmProgress =
    priorityHeroImageCount > 0 ? Math.round((loadedPriorityHeroImageCount / priorityHeroImageCount) * 100) : 100;

  useEffect(() => {
    let cancelled = false;

    priorityHeroes.forEach((hero) => {
      if (loadedHeroImages.has(hero.id) || preloadingHeroImagesRef.current.has(hero.id)) return;

      preloadingHeroImagesRef.current.add(hero.id);
      const image = new Image();
      image.decoding = "async";

      const markReady = () => {
        preloadingHeroImagesRef.current.delete(hero.id);
        if (cancelled) return;
        setLoadedHeroImages((current) => {
          if (current.has(hero.id)) return current;
          const next = new Set(current);
          next.add(hero.id);
          return next;
        });
      };

      image.onload = markReady;
      image.onerror = markReady;
      image.src = hero.image;

      if (image.decode) {
        image.decode().then(markReady).catch(markReady);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadedHeroImages, priorityHeroes]);

  const stats = useMemo(() => {
    const values = Object.values(heroStates);
    const legendaryValues = heroCards
      .filter((hero) => hero.rarity === "legendary")
      .map((hero) => heroStates[hero.id] || { owned: false, awakening: -1 });
    const owned = values.filter((state) => state.owned).length;
    const legendaryA5 = legendaryValues.filter((state) => state.owned && state.awakening === 5).length;
    const legendaryAwakening = legendaryValues.reduce(
      (total, state) => total + (state.owned ? state.awakening : 0),
      0,
    );

    return { owned, a5: legendaryA5, awakening: legendaryAwakening };
  }, [heroCards, heroStates]);

  async function saveHeroAwakening(heroId, nextLevel) {
    if (!canEdit || !selectedPlayerKey) return;

    const championId = championIdByHeroId[heroId];
    const hero = heroCards.find((item) => item.id === heroId);
    const heroDisplayName = getPortalHeroDisplayName(hero, language);
    if (!championId) {
      setHeroBoxError("Ce heros n'est pas relie a la table champions.");
      return;
    }

    const previousState = heroStates[heroId] || { owned: false, awakening: -1 };
    const awakeningLevel = clampAwakeningLevel(nextLevel);

    setSavingHeroId(heroId);
    setHeroBoxError("");
    setHeroStates((current) => ({
      ...current,
      [heroId]: { owned: awakeningLevel >= 0, awakening: awakeningLevel },
    }));

    try {
      const { error } = await supabase.from("member_awakenings").upsert(
        {
          member_id: selectedPlayerKey,
          champion_id: championId,
          awakening_level: awakeningLevel,
        },
        { onConflict: "member_id,champion_id" },
      );

      if (error) throw error;
      void logPortalActivity(session, {
        targetMemberId: selectedPlayerKey,
        targetName: selectedPlayer ? getMemberDisplayName(selectedPlayer) : "",
        actionType: "hero_box_update",
        entityType: "champion",
        entityId: String(championId),
        summary: `${selectedPlayer ? getMemberDisplayName(selectedPlayer) : "Joueur"} : ${heroDisplayName || "heros"} A${previousState.awakening} -> A${awakeningLevel}`,
        metadata: {
          heroId,
          heroName: hero?.name || "",
          heroDisplayName,
          previousAwakening: previousState.awakening,
          nextAwakening: awakeningLevel,
        },
      });
    } catch (error) {
      setHeroStates((current) => ({
        ...current,
        [heroId]: previousState,
      }));
      setHeroBoxError(error?.message || "Sauvegarde de la box impossible.");
    } finally {
      setSavingHeroId("");
    }
  }

  async function setBulkAwakeningToA5() {
    if (!canBulkAwaken) return;

    const targetHeroes = bulkAwakeningHeroes;
    const previousStates = Object.fromEntries(
      targetHeroes.map((hero) => [hero.id, heroStates[hero.id] || { owned: false, awakening: -1 }]),
    );

    setBulkSavingRarity(rarityFilter);
    setHeroBoxError("");
    setHeroStates((current) => ({
      ...current,
      ...Object.fromEntries(targetHeroes.map((hero) => [hero.id, { owned: true, awakening: 5 }])),
    }));

    try {
      const { error } = await supabase.from("member_awakenings").upsert(
        targetHeroes.map((hero) => ({
          member_id: selectedPlayerKey,
          champion_id: championIdByHeroId[hero.id],
          awakening_level: 5,
        })),
        { onConflict: "member_id,champion_id" },
      );

      if (error) throw error;
      void logPortalActivity(session, {
        targetMemberId: selectedPlayerKey,
        targetName: selectedPlayer ? getMemberDisplayName(selectedPlayer) : "",
        actionType: "hero_box_bulk_a5",
        entityType: "champion",
        summary: `${selectedPlayer ? getMemberDisplayName(selectedPlayer) : "Joueur"} : ${targetHeroes.length} heros ${rarityFilter} passes A5`,
        metadata: {
          rarity: rarityFilter,
          count: targetHeroes.length,
          heroes: targetHeroes.map((hero) => ({
            id: hero.id,
            name: hero.name,
            championId: championIdByHeroId[hero.id],
          })),
        },
      });
    } catch (error) {
      setHeroStates((current) => ({
        ...current,
        ...previousStates,
      }));
      setHeroBoxError(error?.message || "Mise a jour groupee des eveils impossible.");
    } finally {
      setBulkSavingRarity("");
    }
  }

  function unlockHero(heroId) {
    saveHeroAwakening(heroId, 0);
  }

  function lockHero(heroId) {
    saveHeroAwakening(heroId, -1);
  }

  function setAwakening(heroId, level) {
    const currentState = heroStates[heroId] || { owned: false, awakening: -1 };
    const nextAwakening = level === 1 && currentState.awakening === 1 ? 0 : level;

    saveHeroAwakening(heroId, nextAwakening);
  }

  function markHeroImageReady(heroId) {
    setLoadedHeroImages((current) => {
      if (current.has(heroId)) return current;
      const next = new Set(current);
      next.add(heroId);
      return next;
    });
  }

  return (
    <section className="hero-box-page">
      <div className="hero-box-panel">
        <div className="hero-box-heading">
          <div>
            <div className="hero-box-eyebrow">Watcher of Realms</div>
            <h2>{t("heroBox.title", "Ma box heros")}</h2>
            <p>
              {t(
                "heroBox.description",
                "Collection alimentee par Supabase, avec les calques servis par le VPS et les eveils relies aux champions.",
              )}
            </p>
          </div>
          <div className="hero-box-stats" aria-label={t("heroBox.statsLabel", "Statistiques de collection")}>
            <div>
              <span>{t("heroBox.owned", "Possedes")}</span>
              <strong>{stats.owned}/{heroCards.length}</strong>
            </div>
            <div>
              <span>{t("heroBox.legendaryAwakenings", "Eveils leg.")}</span>
              <strong>{stats.awakening}</strong>
            </div>
            <div>
              <span>{t("heroBox.legendaryA5", "A5 leg.")}</span>
              <strong>{stats.a5}</strong>
            </div>
          </div>
        </div>

        <div className="hero-box-player-panel">
          <div className="hero-box-player-current">
            <span>{t("heroBox.viewedBox", "Box consultee")}</span>
            <strong>{selectedPlayer ? getMemberDisplayName(selectedPlayer) : t("common.none", "Aucun joueur")}</strong>
            <small>{selectedPlayer ? getMemberGuildLabel(selectedPlayer) : t("heroBox.selectPlayer", "Selectionne un joueur")}</small>
          </div>

          <label className="hero-box-player-search">
            <Search className="h-4 w-4" />
            <input
              type="search"
              value={playerQuery}
              onChange={(event) => setPlayerQuery(event.target.value)}
              placeholder={t("heroBox.searchPlayer", "Rechercher un joueur")}
              aria-label={t("heroBox.searchPlayer", "Rechercher un joueur")}
            />
          </label>

          <div className="hero-box-player-results" aria-label="Joueurs disponibles">
            {playerSuggestions.map((member) => {
              const memberId = String(member.id);
              const isSelected = memberId === selectedPlayerKey;

              return (
                <button
                  key={memberId}
                  type="button"
                  className={`hero-box-player-option ${isSelected ? "is-selected" : ""}`}
                  onClick={() => {
                    setSelectedPlayerId(memberId);
                    setPlayerQuery(getMemberDisplayName(member));
                  }}
                >
                  <strong>{getMemberDisplayName(member)}</strong>
                  <span>{getMemberGuildLabel(member)}</span>
                </button>
              );
            })}
          </div>

          <p className={`hero-box-readonly-note ${canEdit ? "can-edit" : "is-readonly"}`}>
            {canEdit
              ? t("heroBox.editAllowed", "Edition autorisee pour cette box.")
              : t(
                  "heroBox.readOnly",
                  "Lecture seule : tu peux consulter cette box, mais seules ta box ou les admins sont modifiables.",
                )}
          </p>

          {heroBoxLoading ? <p className="hero-box-sync-note">{t("heroBox.sync", "Synchronisation Supabase...")}</p> : null}
          {heroBoxError ? <p className="hero-box-error">{heroBoxError}</p> : null}
        </div>

        <div className="hero-box-toolbar">
          <label className="hero-box-search">
            <Search className="h-4 w-4" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("heroBox.searchHero", "Rechercher un heros")}
              aria-label={t("heroBox.searchHero", "Rechercher un heros")}
            />
          </label>

          <div className="hero-box-filter-group" aria-label={t("heroBox.filterHeroes", "Filtrer les heros")}>
            {[
              ["all", t("heroBox.filterAll", "Tous")],
              ["owned", t("heroBox.filterOwned", "Possedes")],
              ["locked", t("heroBox.filterLocked", "Verrouilles")],
              ["a5", t("heroBox.filterAwakening5", "Eveil 5")],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={ownedFilter === id}
                onClick={() => setOwnedFilter(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="hero-box-filter-row" aria-label={t("heroBox.rarityFilters", "Filtres de rarete")}>
          {hasLatestHeroes ? (
            <button
              type="button"
              className="hero-rarity-filter hero-box-latest-filter"
              style={{ "--rarity-color": "#38bdf8" }}
              aria-pressed={latestOnly}
              onClick={() => setLatestOnly((value) => !value)}
              title={t("heroBox.latestTitle", "Afficher les dernieres sorties ingame")}
            >
              <Clock3 className="h-4 w-4" />
              {t("heroBox.latest", "Dernieres sorties")}
            </button>
          ) : null}
          {heroRarityFilters.map((filter) => {
            const label =
              filter.id === "all" ? t("heroBox.filterAll", filter.label) : t(`rarity.${filter.id}`, filter.label);

            return (
              <button
                key={filter.id}
                type="button"
                className="hero-rarity-filter"
                style={{ "--rarity-color": filter.color }}
                aria-pressed={rarityFilter === filter.id}
                onClick={() => setRarityFilter(filter.id)}
              >
                <span className="hero-rarity-dot" />
                {label}
              </button>
            );
          })}
        </div>

        {bulkAwakeningRarities.has(rarityFilter) && bulkAwakeningHeroes.length > 0 ? (
          <div className="hero-box-bulk-actions">
            <button
              type="button"
              className="hero-box-bulk-awakening"
              disabled={!canBulkAwaken}
              onClick={setBulkAwakeningToA5}
              title={
                bulkAwakeningPendingCount > 0
                  ? `${t("heroBox.bulkApply", "Tout ce filtre A5")} (${t(
                      `rarity.${selectedRarityFilter?.id || ""}`,
                      selectedRarityFilter?.label || "heros",
                    )})`
                  : `${t("heroBox.bulkDone", "Filtre deja A5")} (${t(
                      `rarity.${selectedRarityFilter?.id || ""}`,
                      selectedRarityFilter?.label || "heros",
                    )})`
              }
            >
              <CheckCircle2 className="h-4 w-4" />
              {bulkSavingRarity === rarityFilter
                ? t("heroBox.bulkSaving", "Mise a jour A5...")
                : bulkAwakeningPendingCount > 0
                  ? t("heroBox.bulkApply", "Tout ce filtre A5")
                  : t("heroBox.bulkDone", "Filtre deja A5")}
              <span>{bulkAwakeningHeroes.length}</span>
            </button>
          </div>
        ) : null}

        <div className="hero-box-icon-filter-grid">
          <div className="hero-box-icon-filters" aria-label={t("heroBox.roleFilters", "Filtres de roles")}>
            {heroRoleFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className="hero-icon-filter"
                aria-label={filter.label}
                title={filter.label}
                aria-pressed={roleFilter === filter.id}
                onClick={() => setRoleFilter(filter.id)}
              >
                {filter.image ? (
                  <img src={filter.image} alt="" draggable="false" />
                ) : (
                  <span>{filter.shortLabel || filter.label}</span>
                )}
              </button>
            ))}
          </div>

          <div className="hero-box-icon-filters" aria-label={t("heroBox.factionFilters", "Filtres de factions")}>
            {heroFactionFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className="hero-icon-filter"
                aria-label={filter.label}
                title={filter.label}
                aria-pressed={factionFilter === filter.id}
                onClick={() => setFactionFilter(filter.id)}
              >
                {filter.image ? (
                  <img src={filter.image} alt="" draggable="false" />
                ) : (
                  <span>{filter.shortLabel || filter.label}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="hero-box-result-count">
          {visibleHeroes.length} {t("heroBox.displayedHeroes", "heros affiches")}
          {latestOnly ? <span>{t("heroBox.latestBadge", "Dernieres sorties ingame")}</span> : null}
        </div>

        {heroImagesAreWarming ? (
          <div className="hero-box-image-loader" role="status" aria-live="polite">
            <div>
              <strong>{t("heroBox.loadingImages", "Chargement des vignettes")}</strong>
              <span>{loadedPriorityHeroImageCount}/{priorityHeroImageCount}</span>
            </div>
            <div className="hero-box-image-loader-bar" aria-hidden="true">
              <i style={{ width: `${heroImageWarmProgress}%` }} />
            </div>
          </div>
        ) : null}

        <div className="hero-layer-grid">
          {visibleHeroes.map((hero, index) => (
            <HeroLayerCard
              key={hero.id}
              hero={hero}
              state={heroStates[hero.id] || { owned: false, awakening: -1 }}
              onUnlock={unlockHero}
              onLock={lockHero}
              onAwakening={setAwakening}
              priority={index < 24}
              imageReady={loadedHeroImages.has(hero.id)}
              onImageReady={markHeroImageReady}
              canEdit={canEdit}
              saving={savingHeroId === hero.id || bulkSavingRarity === hero.rarity}
              language={language}
              onOpenDetails={setSelectedHeroDetails}
            />
          ))}
        </div>

        {selectedHeroDetails ? (
          <HeroDetailsModal
            hero={selectedHeroDetails}
            language={language}
            onClose={() => setSelectedHeroDetails(null)}
          />
        ) : null}
      </div>
    </section>
  );
}

function HeroLayerCard({
  hero,
  state,
  onUnlock,
  onLock,
  onAwakening,
  priority = false,
  imageReady = false,
  onImageReady,
  canEdit = false,
  saving = false,
  language = "fr",
  onOpenDetails,
}) {
  const { t } = usePortalLanguage();
  const [fallbackImageIndex, setFallbackImageIndex] = useState(-1);
  const [lockPressing, setLockPressing] = useState(false);
  const lockTimerRef = useRef(null);
  const lockTriggeredRef = useRef(false);
  const imageSrc = fallbackImageIndex === -1 ? hero.image : hero.fallbackImages?.[fallbackImageIndex] || hero.image;
  const displayName = getPortalHeroDisplayName(hero, language);
  const canLongPressLock = canEdit && state.owned && !saving;

  function clearLockPress() {
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
    setLockPressing(false);
  }

  useEffect(
    () => () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    },
    [],
  );

  function startLockPress(event) {
    const detailsHitbox = event.target.closest?.(".hero-layer-details-hitbox");
    const blockedByControl = event.target.closest?.("button") && !detailsHitbox;
    if (!canLongPressLock || event.button > 0 || blockedByControl) return;

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is only a comfort feature here; the long press still works without it.
    }
    setLockPressing(true);
    lockTimerRef.current = window.setTimeout(() => {
      lockTimerRef.current = null;
      lockTriggeredRef.current = true;
      setLockPressing(false);
      onLock?.(hero.id);
    }, 650);
  }

  function handleCardClick(event) {
    if (lockTriggeredRef.current) {
      lockTriggeredRef.current = false;
      return;
    }

    const detailsHitbox = event.target.closest?.(".hero-layer-details-hitbox");
    const blockedByControl = event.target.closest?.("button") && !detailsHitbox;
    if (!state.owned || event.defaultPrevented || blockedByControl) return;
    onOpenDetails?.(hero);
  }

  function handleImageReady() {
    onImageReady?.(hero.id);
  }

  function handleImageError() {
    const nextFallbackImageIndex = fallbackImageIndex + 1;
    if (hero.fallbackImages?.[nextFallbackImageIndex]) {
      setFallbackImageIndex(nextFallbackImageIndex);
      return;
    }

    handleImageReady();
  }

  return (
    <article
      className={`hero-layer-card ${state.owned ? "is-owned" : "is-locked"} ${
        imageReady ? "is-image-ready" : "is-image-loading"
      } ${canEdit ? "is-editable" : "is-readonly"} ${saving ? "is-saving" : ""} ${
        lockPressing ? "is-long-pressing" : ""
      }`}
      title={canLongPressLock ? t("heroBox.longPressLock", "Maintenir pour regriser") : undefined}
      onPointerDown={startLockPress}
      onPointerUp={clearLockPress}
      onPointerCancel={clearLockPress}
      onPointerLeave={clearLockPress}
      onContextMenu={(event) => {
        if (canLongPressLock) event.preventDefault();
      }}
      onClick={handleCardClick}
    >
      <div className="hero-layer-skeleton" aria-hidden="true" />
      <img
        src={imageSrc}
        alt={displayName}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        draggable="false"
        onLoad={handleImageReady}
        onError={handleImageError}
      />

      {state.owned ? (
        <button
          type="button"
          className="hero-layer-details-hitbox"
          aria-label={`${t("heroDetails.open", "Ouvrir la fiche heros")} ${displayName}`}
          title={`${t("heroDetails.open", "Ouvrir la fiche heros")} ${displayName}`}
        />
      ) : null}

      {!state.owned ? (
        <button
          type="button"
          className="hero-layer-lock"
          aria-label={`${t("heroBox.markOwned", "Marquer comme possede")} ${displayName}`}
          disabled={!canEdit || saving}
          title={canEdit ? `${t("heroBox.markOwned", "Marquer comme possede")} ${displayName}` : t("heroBox.readOnlyShort", "Lecture seule")}
          onClick={() => onUnlock(hero.id)}
        >
          <Lock className="h-7 w-7" />
        </button>
      ) : null}

      <div
        className="hero-layer-stars"
        aria-label={
          state.owned
            ? `${displayName} ${t("heroBox.awakening", "eveil")} A${state.awakening}`
            : `${displayName} ${t("heroBox.notOwned", "non possede")}`
        }
      >
        {[1, 2, 3, 4, 5].map((level) => (
          <button
            key={level}
            type="button"
            className={state.owned && state.awakening >= level ? "is-active" : ""}
            aria-label={`${t("heroBox.setAwakening", "Regler en eveil")} ${displayName} ${level}`}
            disabled={!canEdit || !state.owned || saving}
            title={canEdit ? `${t("heroBox.setAwakening", "Regler en eveil")} ${displayName} ${level}` : t("heroBox.readOnlyShort", "Lecture seule")}
            onClick={() => onAwakening(hero.id, level)}
          >
            <Star className="h-full w-full" />
          </button>
        ))}
      </div>

      <div className="hero-layer-name">
        <strong>{displayName}</strong>
      </div>
    </article>
  );
}

function HeroDetailsModal({ hero, language = "fr", onClose }) {
  const { t } = usePortalLanguage();
  const displayName = getPortalHeroDisplayName(hero, language);
  const detailImage = hero.officialImage || hero.image;
  const hasOfficialImage = Boolean(hero.officialImage);
  const rarityLabel = hero.rarity ? t(`rarity.${hero.rarity}`, formatHeroFilterLabel(hero.rarity)) : "";
  const roleLabels = (hero.roles || []).map((role) => t(`heroRole.${role}`, formatHeroFilterLabel(role)));
  const factionLabels = (hero.factions || []).map((faction) => t(`heroFaction.${faction}`, formatHeroFilterLabel(faction)));

  return (
    <div className="hero-details-backdrop" role="presentation" onClick={onClose}>
      <article
        className="hero-details-modal"
        role="dialog"
        aria-modal="true"
        aria-label={displayName}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="hero-details-close"
          aria-label={t("common.close", "Fermer")}
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </button>

        <div className="hero-details-portrait">
          {detailImage ? <img src={detailImage} alt={displayName} draggable="false" /> : null}
        </div>

        <div className="hero-details-content">
          <div>
            <p className="hero-details-eyebrow">{t("heroDetails.eyebrow", "Fiche heros")}</p>
            <h3>{displayName}</h3>
            <p className="hero-details-subtitle">
              {hasOfficialImage
                ? t("heroDetails.officialImageReady", "Portrait officiel Moonton connecte au VPS.")
                : t("heroDetails.officialImageMissing", "Portrait officiel Moonton manquant pour ce heros.")}
            </p>
          </div>

          <div className="hero-details-tags" aria-label={t("heroDetails.tags", "Informations heros")}>
            {rarityLabel ? <span>{rarityLabel}</span> : null}
            {roleLabels.map((label) => (
              <span key={`role-${label}`}>{label}</span>
            ))}
            {factionLabels.map((label) => (
              <span key={`faction-${label}`}>{label}</span>
            ))}
          </div>

          <div className="hero-details-placeholder">
            <strong>{t("heroDetails.inProgressTitle", "Page en construction")}</strong>
            <p>
              {t(
                "heroDetails.inProgressText",
                "Les eveils, stuffs et usages par contenu seront ajoutes ici au fur et a mesure.",
              )}
            </p>
          </div>
        </div>
      </article>
    </div>
  );
}

function GvgView({ session, onEditRun }) {
  const { t } = usePortalLanguage();
  const [activeGvgView, setActiveGvgView] = useState("current");
  const canUseGvgAdminViews = isAdminSession(session);

  const views = [
    { id: "current", label: "GVG en cours", labelKey: "gvg.current" },
    { id: "panel", label: "Pilotage", labelKey: "gvg.panel", adminOnly: true },
    { id: "admin", label: "Imports VPS", labelKey: "gvg.imports", adminOnly: true },
  ];

  useEffect(() => {
    const activeView = views.find((view) => view.id === activeGvgView);
    if (activeView?.adminOnly && !canUseGvgAdminViews) {
      setActiveGvgView("current");
    }
  }, [activeGvgView, canUseGvgAdminViews]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap gap-2 rounded-xl border border-zinc-800 bg-zinc-950/90 p-2">
        {views.map((view) => {
          const selected = activeGvgView === view.id;
          const disabled = Boolean(view.adminOnly && !canUseGvgAdminViews);

          return (
            <button
              key={view.id}
              type="button"
              onClick={() => {
                if (!disabled) setActiveGvgView(view.id);
              }}
              disabled={disabled}
              title={disabled ? t("gvg.adminReserved", "Reserve aux admins et leaders") : t(view.labelKey, view.label)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                selected
                  ? "bg-violet-500/20 text-violet-100 shadow-[0_0_18px_rgba(168,85,247,0.22)]"
                  : disabled
                    ? "cursor-not-allowed text-zinc-600 opacity-50"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"
              }`}
            >
              {t(view.labelKey, view.label)}
            </button>
          );
        })}
      </div>

      {activeGvgView === "current" ? <GvgCurrentTab session={session} onEditRun={onEditRun} /> : null}
      {activeGvgView === "panel" && canUseGvgAdminViews ? <GvgPanelTab session={session} onEditRun={onEditRun} /> : null}
      {activeGvgView === "admin" && canUseGvgAdminViews ? <GvgAdminTab session={session} /> : null}
    </section>
  );
}

function makeLauncherSessionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, "");
  }

  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
}

function launcherEventLabel(event) {
  const labels = {
    created: "Session creee",
    launcher_started: "Launcher detecte",
    waiting_f9: "Attente F9",
    capture_started: "Capture en cours",
    capture_progress: "Capture en cours",
    uploading: "Upload en cours",
    upload_done: "Upload termine",
    received_by_vps: "Recu par le VPS",
    recognition_processing: "Reconnaissance serveur",
    ready: "Resultat disponible",
    error: "Erreur",
  };

  return labels[event] || event;
}

function LauncherView({ session: portalSession }) {
  const { t } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const pollRef = useRef(null);
  const detectionDeadlineRef = useRef(0);
  const visibleGvgGuilds = useMemo(() => getVisibleGvgGuildCodes(portalSession), [portalSession]);

  const [guild, setGuild] = useState("G1");
  const [side, setSide] = useState("enemy");
  const [sessionId, setSessionId] = useState("");
  const [launcherSession, setLauncherSession] = useState(null);
  const [launching, setLaunching] = useState(false);
  const [detected, setDetected] = useState(false);
  const [installModalOpen, setInstallModalOpen] = useState(false);
  const [message, setMessage] = useState("");

  const events = Array.isArray(launcherSession?.events) ? launcherSession.events : [];
  const progress = launcherSession?.progress || {};
  const state = launcherSession?.state || "idle";

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (visibleGvgGuilds.length === 0) return;
    setGuild((current) => (visibleGvgGuilds.includes(current) ? current : visibleGvgGuilds[0]));
  }, [visibleGvgGuilds]);

  async function readJson(response, label) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      throw new Error(`Reponse non JSON ${label}`);
    }
  }

  async function fetchSessionStatus(nextSessionId) {
    const response = await fetch(
      `${apiBase}/api/gvg-server?action=launcher-status&session=${encodeURIComponent(nextSessionId)}`
    );
    const data = await readJson(response, "session launcher");

    if (!response.ok) {
      throw new Error(data?.error || "Session launcher introuvable.");
    }

    const nextSession = data?.session || null;
    setLauncherSession(nextSession);

    const nextState = nextSession?.state || "created";
    const hasStarted = nextState !== "created" || (nextSession?.events || []).some((item) => item.event === "launcher_started");

    if (hasStarted) {
      setDetected(true);
      setInstallModalOpen(false);
      setLaunching(false);
      setMessage(nextSession?.message || t("launcher.detectedReady", "Launcher detecte, capture prete a demarrer."));
    } else if (Date.now() > detectionDeadlineRef.current) {
      setLaunching(false);
      setDetected(false);
      setInstallModalOpen(true);
      setMessage(t("launcher.notDetected", "Launcher Paladin GVG non detecte sur ce PC."));
      if (pollRef.current) window.clearInterval(pollRef.current);
    }

    if (["ready", "error"].includes(nextState) && pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function startPolling(nextSessionId) {
    if (pollRef.current) window.clearInterval(pollRef.current);
    detectionDeadlineRef.current = Date.now() + 8500;

    pollRef.current = window.setInterval(() => {
      fetchSessionStatus(nextSessionId).catch((error) => {
        setMessage(error?.message || t("launcher.followError", "Erreur suivi launcher."));
      });
    }, 1000);
  }

  async function launchCapture() {
    if (!visibleGvgGuilds.includes(guild)) {
      setMessage(t("launcher.guildDenied", "Guilde non autorisee pour cette session."));
      return;
    }

    const nextSessionId = makeLauncherSessionId();

    try {
      setLaunching(true);
      setDetected(false);
      setInstallModalOpen(false);
      setSessionId(nextSessionId);
      setLauncherSession(null);
      setMessage(t("launcher.opening", "Ouverture du launcher Paladin GVG..."));

      const response = await fetch(`${apiBase}/api/gvg-server`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "launcher-create",
          sessionId: nextSessionId,
          guild,
          mode: guild.toLowerCase(),
          side,
        }),
      });
      const data = await readJson(response, "creation session launcher");

      if (!response.ok) {
        throw new Error(data?.error || t("launcher.createError", "Impossible de creer la session launcher."));
      }

      setLauncherSession(data?.session || null);
      void logPortalActivity(portalSession, {
        targetMemberId: portalSession?.memberId || portalSession?.id || null,
        targetName: portalSession?.watcherName || portalSession?.name || "",
        actionType: "gvg_launcher_start",
        entityType: "gvg",
        entityId: nextSessionId,
        summary: `${portalSession?.watcherName || portalSession?.name || "Joueur"} a lance une capture GVG ${guild} (${side})`,
        metadata: {
          guild,
          side,
          sessionId: nextSessionId,
        },
      });
      startPolling(nextSessionId);
      window.location.href = `paladin-gvg://start?guild=${encodeURIComponent(guild)}&mode=${encodeURIComponent(
        guild.toLowerCase()
      )}&side=${encodeURIComponent(side)}&session=${encodeURIComponent(nextSessionId)}`;
    } catch (error) {
      setLaunching(false);
      setMessage(error?.message || t("launcher.launchError", "Erreur lancement launcher."));
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-violet-500/25 bg-[radial-gradient(circle_at_top_left,rgba(124,58,237,0.24),transparent_34%),linear-gradient(135deg,rgba(10,10,18,0.96),rgba(16,24,39,0.88))] p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100">
              {t("launcher.eyebrow", "Capture GVG")}
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-zinc-50">{t("launcher.title", "Lancer la capture GVG")}</h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-300">
              {t("launcher.description", "Le site ouvre le launcher installe sur le PC, puis suit la capture jusqu'au resultat disponible dans Validation.")}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              className="rounded-2xl bg-emerald-600 px-5 py-6 text-base text-white hover:bg-emerald-500"
              disabled={launching}
              onClick={launchCapture}
            >
              <Play className="mr-2 h-5 w-5" />
              {launching ? t("launcher.openingShort", "Ouverture...") : t("launcher.startCapture", "Lancer la capture GVG")}
            </Button>
            <a
              href={launcherDownloadUrl(apiBase)}
              className="inline-flex items-center rounded-2xl border border-zinc-700 bg-zinc-950/70 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:border-cyan-300/60 hover:text-cyan-100"
            >
              <UploadCloud className="mr-2 h-4 w-4" />
              {t("launcher.download", "Telecharger / reinstaller")}
            </a>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-[1fr_1fr_1.4fr]">
          <div className="rounded-2xl border border-zinc-700/70 bg-zinc-950/55 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{t("home.guild", "Guilde")}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {visibleGvgGuilds.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setGuild(item)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    guild === item
                      ? "border-cyan-300/70 bg-cyan-400/15 text-cyan-100"
                      : "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {getGvgGuildLabel(item)}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-700/70 bg-zinc-950/55 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{t("common.type", "Type")}</div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {[
                ["enemy", t("gvg.enemy", "Ennemi")],
                ["ally", t("gvg.ally", "Allie")],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setSide(value)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    side === value
                      ? "border-violet-300/70 bg-violet-400/15 text-violet-100"
                      : "border-zinc-700 bg-zinc-900/70 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-700/70 bg-zinc-950/55 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.18em] text-zinc-500">{t("launcher.state", "Etat")}</div>
                <div className="mt-2 font-semibold text-zinc-100">
                  {detected
                    ? t("launcher.detected", "Launcher detecte")
                    : launching
                      ? t("launcher.detecting", "Detection en cours")
                      : t(`launcher.event.${state}`, launcherEventLabel(state))}
                </div>
              </div>
              {detected ? (
                <CheckCircle2 className="h-7 w-7 text-emerald-300" />
              ) : launching ? (
                <Clock3 className="h-7 w-7 text-amber-300" />
              ) : (
                <XCircle className="h-7 w-7 text-zinc-500" />
              )}
            </div>
            <div className="mt-3 text-sm text-zinc-400">
              {message || t("launcher.readyMessage", "Pret a lancer une session de capture.")}
            </div>
            {sessionId ? (
              <div className="mt-2 truncate text-xs text-zinc-600">Session {sessionId}</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-950/75 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">{t("launcher.playerSteps", "Etapes joueur")}</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {[
              t("launcher.step1", "Ouvre Watcher of Realms."),
              t("launcher.step2", "Va sur l'ecran GVG."),
              t("launcher.step3", "Quand tu es pret, appuie sur F9."),
              t("launcher.step4", "Ne touche plus a la souris ni au clavier pendant la capture."),
            ].map((item, index) => (
              <div key={item} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
                <div className="text-xs text-zinc-500">{t("launcher.step", "Etape")} {index + 1}</div>
                <div className="mt-2 text-sm font-medium text-zinc-100">{item}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-950/75 p-5">
          <h3 className="text-lg font-semibold text-zinc-100">{t("launcher.sessionTracking", "Suivi session")}</h3>
          <div className="mt-4 space-y-3">
            {events.length ? (
              events.slice(-8).reverse().map((event, index) => (
                <div key={`${event.event}-${event.at}-${index}`} className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-zinc-100">{t(`launcher.event.${event.event}`, launcherEventLabel(event.event))}</div>
                    <div className="text-xs text-zinc-500">
                      {event.at ? new Date(event.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}
                    </div>
                  </div>
                  {event.message ? <div className="mt-1 text-sm text-zinc-400">{event.message}</div> : null}
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-500">
                {t("launcher.noEvent", "Les statuts apparaitront ici des que le launcher repondra.")}
              </div>
            )}
          </div>

          {progress.total ? (
            <div className="mt-4 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">{t("launcher.captureProgress", "Progression capture")}</span>
                <span className="font-semibold text-zinc-100">
                  {progress.current || 0} / {progress.total || 48}
                </span>
              </div>
              <div className="mt-3 h-2 rounded-full bg-zinc-800">
                <div
                  className="h-full rounded-full bg-cyan-300 transition-all"
                  style={{ width: `${Math.min(100, ((progress.current || 0) / (progress.total || 48)) * 100)}%` }}
                />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {installModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-violet-400/30 bg-zinc-950 p-6 shadow-[0_0_80px_rgba(124,58,237,0.35)]">
            <div className="flex items-start gap-3">
              <XCircle className="mt-1 h-6 w-6 text-amber-300" />
              <div>
                <h3 className="text-xl font-semibold text-zinc-50">{t("launcher.notDetected", "Launcher Paladin GVG non detecte sur votre PC.")}</h3>
                <p className="mt-3 text-sm text-zinc-300">
                  {t("launcher.installHelp", "Vous devez l'installer une seule fois pour pouvoir lancer les captures depuis le site.")}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={launcherDownloadUrl(apiBase)}
                className="inline-flex items-center rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500"
              >
                <UploadCloud className="mr-2 h-4 w-4" />
                {t("launcher.downloadInstall", "Telecharger et installer le launcher")}
              </a>
              <Button
                type="button"
                variant="outline"
                className="rounded-2xl border-zinc-700 text-zinc-200"
                onClick={() => setInstallModalOpen(false)}
              >
                {t("common.close", "Fermer")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

    </section>
  );
}

const EMPTY_DEFENSE_SLOT = "--";

const emptyPortalDefenseDraft = {
  id: 0,
  name: "",
  tier: "meta_s",
  type: "Tour",
  faction: "",
  image: "",
  guildCode: "G1",
  isGlobal: false,
  sourceDefenseId: null,
  slots: ["", "", "", "", ""],
};

function getPortalSessionGuildCode(session) {
  return normalizeGuildCode(session?.guildCode || session?.guild_code || session?.guild || "G1");
}

function mapPortalAdminDefenseRow(row, blocksByDefenseId = new Map()) {
  const slots = [...(row.guild_defense_slots || [])]
    .sort((a, b) => (a.slot_index ?? 0) - (b.slot_index ?? 0))
    .map((slot) => slot.champions?.name || "")
    .filter(Boolean);

  const conditions = (row.guild_defense_conditions || []).map(mapPortalDefenseConditionRow);

  return {
    id: row.id,
    name: row.name || "",
    tier: row.tier || "meta_s",
    type: row.type || "Tour",
    faction: row.faction || "",
    guildCode: row.guild_code || "G1",
    isGlobal: Boolean(row.is_global),
    isHidden: Boolean(row.is_hidden),
    sourceDefenseId: row.source_defense_id || null,
    sortOrder: row.sort_order ?? 9999,
    slots,
    conditions,
    infoBlocks: blocksByDefenseId.get(String(row.id)) || [],
    image: row.image_url || "",
    image_url: row.image_url || "",
  };
}

function mapPortalDefenseConditionRow(condition) {
  return {
    id: condition.id,
    championId: condition.champion_id,
    minAwakening: condition.min_awakening,
    label: `${condition.champions?.name || "Hero"} A${condition.min_awakening} minimum`,
  };
}

function normalizePortalDefenseFaction(value) {
  const normalized = normalizeHeroDataValue(value);
  return heroFactionMeta[normalized] ? normalized : String(value || "").trim();
}

function normalizeDefenseChampionName(value) {
  return String(value || "").trim().toLowerCase();
}

function getDefenseStoragePathFromPublicUrl(fileUrl) {
  if (!fileUrl) return null;

  try {
    const url = new URL(fileUrl);
    const marker = "/storage/v1/object/public/defense-images/";
    const markerIndex = url.pathname.indexOf(marker);

    if (markerIndex === -1) return null;
    return decodeURIComponent(url.pathname.slice(markerIndex + marker.length));
  } catch (error) {
    console.error("Erreur parsing URL storage defense:", error);
    return null;
  }
}

function compressPortalDefenseImage(file, maxWidth = 1400, quality = 0.86) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("Choisis une image valide pour la defense."));
      return;
    }

    const image = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      image.onload = () => {
        const scale = Math.min(1, maxWidth / Math.max(image.width || 1, image.height || 1));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Compression image impossible."));
              return;
            }

            resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" }));
          },
          "image/webp",
          quality,
        );
      };

      image.onerror = () => reject(new Error("Lecture de l'image impossible."));
      image.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

function PortalAdminDefensesView({ session }) {
  const { t } = usePortalLanguage();
  const [activeGuildCode, setActiveGuildCode] = useState(getPortalSessionGuildCode(session));
  const [defenses, setDefenses] = useState([]);
  const [champions, setChampions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [draftOpen, setDraftOpen] = useState(false);
  const [draft, setDraft] = useState(emptyPortalDefenseDraft);
  const [draftImageMessage, setDraftImageMessage] = useState("");
  const [conditionOpen, setConditionOpen] = useState(false);
  const [conditionDefenseId, setConditionDefenseId] = useState("");
  const [conditionRemoveOpen, setConditionRemoveOpen] = useState(false);
  const [conditionRemoveDefense, setConditionRemoveDefense] = useState(null);
  const [newCondition, setNewCondition] = useState({ hero: "", minAwakening: 5 });
  const isAdminUser = isAdminSession(session);
  const visibleDefenseGuildCodes = useMemo(() => {
    if (isPaladinSession(session)) return PALADIN_CLUSTER_GUILD_CODES;

    const sessionGuildCode = getPortalSessionGuildCode(session);
    return sessionGuildCode ? [sessionGuildCode] : [];
  }, [session]);
  const activeGuildCodeKey = normalizeGuildCodeKey(activeGuildCode);
  const activeGuildIsVisible = visibleDefenseGuildCodes.some(
    (guildCode) => normalizeGuildCodeKey(guildCode) === activeGuildCodeKey,
  );
  const activeGuildIsPaladin = isPaladinGuildCode(activeGuildCode);

  const championByName = useMemo(() => {
    const entries = champions.map((champion) => [
      normalizeDefenseChampionName(champion.name),
      champion,
    ]);
    return new Map(entries);
  }, [champions]);

  const selectedConditionDefense = useMemo(
    () => defenses.find((defense) => String(defense.id) === String(conditionDefenseId)) || null,
    [conditionDefenseId, defenses],
  );

  const defenseFactionOptions = useMemo(
    () => {
      const championFactions = champions.flatMap((champion) =>
        splitChampionValues(getChampionField(champion, ["faction", "Faction", "factions", "Factions"])),
      );
      const factionValues = [...new Set([...heroFactionOrder, ...championFactions])].sort((left, right) =>
        sortHeroValues(left, right, heroFactionOrder),
      );

      return factionValues.map((faction) => ({
        value: faction,
        label: t(`heroFaction.${faction}`, heroFactionMeta[faction]?.label || formatHeroFilterLabel(faction)),
      }));
    },
    [champions, t],
  );

  useEffect(() => {
    if (visibleDefenseGuildCodes.length === 0 || activeGuildIsVisible) return;
    setActiveGuildCode(visibleDefenseGuildCodes[0]);
  }, [activeGuildIsVisible, visibleDefenseGuildCodes]);

  useEffect(() => {
    let cancelled = false;

    async function loadAdminDefenses() {
      if (!isAdminUser || !activeGuildIsVisible) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMessage("");

      let defensesQuery = supabase
        .from("guild_defenses")
        .select(`
          *,
          guild_defense_slots (
            slot_index,
            champion_id,
            champions (
              name
            )
          ),
          guild_defense_conditions (
            id,
            champion_id,
            min_awakening,
            champions (
              name
            )
          )
        `);

      defensesQuery = activeGuildIsPaladin
        ? defensesQuery.or(`is_global.eq.true,guild_code.eq.${activeGuildCode}`)
        : defensesQuery.eq("guild_code", activeGuildCode);

      const [defensesResult, championsResult] = await Promise.all([
        defensesQuery.order("created_at", { ascending: true }),
        supabase.from("champions").select("*").order("name", { ascending: true }),
      ]);

      if (cancelled) return;

      if (defensesResult.error || championsResult.error) {
        console.error("Erreur chargement gestion defense Portal:", defensesResult.error || championsResult.error);
        setDefenses([]);
        setChampions([]);
        setErrorMessage("Impossible de charger les defenses admin pour le moment.");
        setLoading(false);
        return;
      }

      const defenseRows = defensesResult.data || [];
      const defenseIds = defenseRows.map((row) => row.id).filter(Boolean);
      let blocksByDefenseId = new Map();

      if (defenseIds.length > 0) {
        const { data: blockRows, error: blocksError } = await supabase
          .from("guild_defense_blocks")
          .select("id, defense_id, block_type, content, sort_order")
          .in("defense_id", defenseIds)
          .order("sort_order", { ascending: true });

        if (cancelled) return;

        if (blocksError) {
          console.error("Erreur chargement infos gestion defense Portal:", blocksError);
        } else {
          blocksByDefenseId = (blockRows || []).reduce((grouped, block) => {
            const defenseId = String(block.defense_id);
            const previous = grouped.get(defenseId) || [];

            grouped.set(defenseId, [
              ...previous,
              {
                id: block.id,
                blockType: block.block_type,
                block_type: block.block_type,
                content: block.content,
                sortOrder: block.sort_order ?? 9999,
                sort_order: block.sort_order ?? 9999,
              },
            ]);

            return grouped;
          }, new Map());
        }
      }

      const nextDefenses = resolveDefenseVariantsForGuild(
        defenseRows.map((row) => mapPortalAdminDefenseRow(row, blocksByDefenseId)),
        activeGuildCode,
      )
        .sort((left, right) => {
          if ((left.sortOrder ?? 9999) !== (right.sortOrder ?? 9999)) {
            return (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999);
          }

          return String(left.name || "").localeCompare(String(right.name || ""), "fr", { sensitivity: "base" });
        });

      setDefenses(nextDefenses);
      setChampions(championsResult.data || []);
      setLoading(false);
    }

    loadAdminDefenses();

    return () => {
      cancelled = true;
    };
  }, [activeGuildCode, activeGuildIsPaladin, activeGuildIsVisible, isAdminUser, refreshTick]);

  function openAddDefense() {
    setMessage("");
    setErrorMessage("");
    setDraftImageMessage("");
    setDraft({
      ...emptyPortalDefenseDraft,
      guildCode: activeGuildCode,
      isGlobal: activeGuildIsPaladin && activeGuildCode === "G1",
    });
    setDraftOpen(true);
  }

  function addOrReplaceLocalDefense(localDefense) {
    if (!localDefense?.id) return;

    setDefenses((previous) =>
      resolveDefenseVariantsForGuild(
        [
          ...previous.filter((item) => String(item.id) !== String(localDefense.id)),
          localDefense,
        ],
        activeGuildCode,
      ).sort((left, right) => {
        if ((left.sortOrder ?? 9999) !== (right.sortOrder ?? 9999)) {
          return (left.sortOrder ?? 9999) - (right.sortOrder ?? 9999);
        }

        return String(left.name || "").localeCompare(String(right.name || ""), "fr", { sensitivity: "base" });
      }),
    );
  }

  async function createLocalDefenseVariant(defense, { hidden = false } = {}) {
    if (!defense?.id) return null;

    const rootId = getDefenseRootId(defense);
    if (!rootId) return null;

    const { data: existingRows, error: existingError } = await supabase
      .from("guild_defenses")
      .select("*")
      .eq("source_defense_id", rootId)
      .eq("guild_code", activeGuildCode)
      .limit(1);

    if (existingError) throw existingError;

    const existing = existingRows?.[0] || null;
    const localPayload = {
      name: defense.name || "",
      tier: defense.tier || "meta_s",
      type: defense.type || "Tour",
      faction: defense.faction || null,
      image_url: defense.image || defense.image_url || null,
      guild_code: activeGuildCode,
      is_global: false,
      source_defense_id: rootId,
      sort_order: defense.sortOrder ?? 9999,
      is_hidden: hidden,
    };

    const { data: localRow, error: localError } = existing
      ? await supabase
          .from("guild_defenses")
          .update(localPayload)
          .eq("id", existing.id)
          .select("*")
          .single()
      : await supabase
          .from("guild_defenses")
          .insert(localPayload)
          .select("*")
          .single();

    if (localError) throw localError;

    if (!existing && !hidden) {
      const slotChampions = (defense.slots || [])
        .map((heroName) => championByName.get(normalizeDefenseChampionName(heroName)))
        .filter(Boolean);

      if (slotChampions.length > 0) {
        const { error: slotsError } = await supabase.from("guild_defense_slots").insert(
          slotChampions.map((champion, index) => ({
            defense_id: localRow.id,
            champion_id: champion.id,
            slot_index: index + 1,
          })),
        );

        if (slotsError) throw slotsError;
      }

      const conditionRows = (defense.conditions || [])
        .filter((condition) => condition.championId)
        .map((condition) => ({
          defense_id: localRow.id,
          champion_id: condition.championId,
          min_awakening: condition.minAwakening,
        }));

      if (conditionRows.length > 0) {
        const { error: conditionsError } = await supabase.from("guild_defense_conditions").insert(conditionRows);
        if (conditionsError) throw conditionsError;
      }

      const blockRows = (defense.infoBlocks || []).map((block, index) => ({
        defense_id: localRow.id,
        block_type: block.block_type || block.blockType || "text",
        content: block.content,
        sort_order: block.sort_order ?? block.sortOrder ?? index + 1,
      }));

      if (blockRows.length > 0) {
        const { error: blocksError } = await supabase.from("guild_defense_blocks").insert(blockRows);
        if (blocksError) throw blocksError;
      }
    }

    const localDefense = {
      ...defense,
      id: localRow.id,
      guildCode: localRow.guild_code || activeGuildCode,
      isGlobal: false,
      isHidden: Boolean(localRow.is_hidden),
      sourceDefenseId: localRow.source_defense_id || rootId,
    };

    addOrReplaceLocalDefense(localDefense);
    return localDefense;
  }

  async function ensureEditableDefense(defense) {
    if (!isInheritedDefense(defense, activeGuildCode)) return defense;

    setSaving(true);
    setErrorMessage("");

    try {
      const localDefense = await createLocalDefenseVariant(defense);
      setMessage(`Copie locale creee pour ${activeGuildCode} : ${defense.name}.`);
      return localDefense || defense;
    } catch (error) {
      setErrorMessage(error?.message || "Creation de la copie locale impossible.");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function openEditDefense(defense) {
    setMessage("");
    setErrorMessage("");
    const editableDefense = await ensureEditableDefense(defense);
    if (!editableDefense) return;

    setDraft({
      id: editableDefense.id,
      name: editableDefense.name || "",
      tier: editableDefense.tier || "meta_s",
      type: editableDefense.type || "Tour",
      faction: normalizePortalDefenseFaction(editableDefense.faction),
      image: editableDefense.image || editableDefense.image_url || "",
      guildCode: editableDefense.guildCode || activeGuildCode,
      isGlobal: Boolean(editableDefense.isGlobal),
      sourceDefenseId: editableDefense.sourceDefenseId || null,
      slots: [...(editableDefense.slots || []), "", "", "", "", ""].slice(0, 5),
    });
    setDraftImageMessage("");
    setDraftOpen(true);
  }

  function updateDraftSlot(index, value) {
    setDraft((previous) => {
      const nextSlots = [...previous.slots];
      nextSlots[index] = value;
      return { ...previous, slots: nextSlots };
    });
  }

  async function uploadDraftDefenseImage(file, successMessage) {
    if (!file) return;

    setSaving(true);
    setErrorMessage("");
    setDraftImageMessage(t("adminDefenses.imageUploadInProgress", "Upload de l'image en cours..."));

    try {
      const compressedFile = await compressPortalDefenseImage(file);
      const randomId =
        typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      const filePath = `portal-defense-${Date.now()}-${randomId}.webp`;

      const { error: uploadError } = await supabase.storage
        .from("defense-images")
        .upload(filePath, compressedFile, {
          contentType: "image/webp",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("defense-images").getPublicUrl(filePath);
      setDraft((previous) => ({ ...previous, image: data.publicUrl }));
      setDraftImageMessage(successMessage || t("adminDefenses.fileImageAdded", "Image ajoutee."));
      return true;
    } catch (error) {
      setErrorMessage(error?.message || "Upload de l'image impossible.");
      setDraftImageMessage(t("adminDefenses.imageUploadFailed", "Impossible d'ajouter cette image."));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleDefenseImageChange(event) {
    const file = event.target.files?.[0] || null;
    event.target.value = "";

    await uploadDraftDefenseImage(file, t("adminDefenses.fileImageAdded", "Image ajoutee."));
  }

  async function handleDraftDefenseImagePaste(event) {
    const clipboardItems = Array.from(event.clipboardData?.items || []);
    const imageItem = clipboardItems.find((item) => item.type?.startsWith("image/"));

    if (!imageItem) {
      setDraftImageMessage(t("adminDefenses.clipboardNoImage", "Aucune image trouvee dans le presse-papier."));
      return;
    }

    event.preventDefault();
    await uploadDraftDefenseImage(
      imageItem.getAsFile(),
      t("adminDefenses.clipboardImageAdded", "Image collee depuis le presse-papier.")
    );
  }

  async function pasteDraftDefenseImageFromClipboard() {
    if (typeof navigator === "undefined" || !navigator.clipboard?.read) {
      setDraftImageMessage(
        t(
          "adminDefenses.clipboardUnsupported",
          "Lecture directe du presse-papier indisponible. Clique dans la zone de collage puis fais Ctrl+V."
        )
      );
      return;
    }

    try {
      const clipboardItems = await navigator.clipboard.read();

      for (const item of clipboardItems) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;

        const blob = await item.getType(imageType);
        const extension = imageType.split("/")[1]?.split("+")[0] || "png";
        const file = new File([blob], `portal-defense-${Date.now()}.${extension}`, {
          type: imageType,
        });

        await uploadDraftDefenseImage(
          file,
          t("adminDefenses.clipboardImageAdded", "Image collee depuis le presse-papier.")
        );
        return;
      }

      setDraftImageMessage(t("adminDefenses.clipboardNoImage", "Aucune image trouvee dans le presse-papier."));
    } catch (error) {
      console.error("Erreur lecture presse-papier defense:", error);
      setDraftImageMessage(
        t(
          "adminDefenses.clipboardUnsupported",
          "Lecture directe du presse-papier indisponible. Clique dans la zone de collage puis fais Ctrl+V."
        )
      );
    }
  }

  async function saveDraftDefense(event) {
    event?.preventDefault();
    if (!isAdminUser || saving) return;

    const cleanName = draft.name.trim();
    const normalizedSlots = draft.slots.map((slot) => slot.trim()).filter(Boolean);

    if (!cleanName || normalizedSlots.length !== 5) {
      setErrorMessage("Renseigne un nom et les 5 heros de la defense.");
      return;
    }

    const slotChampions = normalizedSlots.map((heroName) => championByName.get(normalizeDefenseChampionName(heroName)));

    if (slotChampions.some((champion) => !champion)) {
      setErrorMessage("Un des heros n'existe pas dans la table champions. Utilise l'autocompletion.");
      return;
    }

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    const isEditMode = draft.id && String(draft.id) !== "0";
    const nextIsGlobal = activeGuildIsPaladin && (isEditMode ? Boolean(draft.isGlobal) : activeGuildCode === "G1");
    const nextGuildCode = nextIsGlobal ? draft.guildCode || "G1" : activeGuildCode;
    const defensePayload = {
      name: cleanName,
      tier: draft.tier,
      type: draft.type,
      faction: normalizePortalDefenseFaction(draft.faction) || null,
      image_url: draft.image || null,
      guild_code: nextGuildCode,
      is_global: nextIsGlobal,
      source_defense_id: draft.sourceDefenseId || null,
    };

    try {
      const { data: defenseData, error: defenseError } = isEditMode
        ? await supabase
            .from("guild_defenses")
            .update(defensePayload)
            .eq("id", draft.id)
            .select("*")
            .single()
        : await supabase
            .from("guild_defenses")
            .insert(defensePayload)
            .select("*")
            .single();

      if (defenseError) throw defenseError;

      if (isEditMode) {
        const { error: deleteSlotsError } = await supabase
          .from("guild_defense_slots")
          .delete()
          .eq("defense_id", defenseData.id);

        if (deleteSlotsError) throw deleteSlotsError;
      }

      const { error: slotsError } = await supabase.from("guild_defense_slots").insert(
        slotChampions.map((champion, index) => ({
          defense_id: defenseData.id,
          champion_id: champion.id,
          slot_index: index + 1,
        })),
      );

      if (slotsError) throw slotsError;

      void logPortalActivity(session, {
        actionType: isEditMode ? "admin_defense_update" : "admin_defense_create",
        entityType: "defense",
        entityId: String(defenseData.id),
        summary: `${session?.watcherName || session?.name || "Admin"} a ${isEditMode ? "modifie" : "cree"} la defense ${cleanName}`,
        metadata: {
          defenseName: cleanName,
          guildCode: nextGuildCode,
          isGlobal: nextIsGlobal,
          slots: normalizedSlots,
        },
      });

      setDraftOpen(false);
      setMessage(`Defense ${isEditMode ? "mise a jour" : "ajoutee"} : ${cleanName}.`);
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setErrorMessage(error?.message || "Sauvegarde de la defense impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function openConditionDialog(defense) {
    const editableDefense = await ensureEditableDefense(defense);
    if (!editableDefense) return;

    const firstHero = editableDefense?.slots?.[0] || "";
    setConditionDefenseId(String(editableDefense?.id || ""));
    setNewCondition({ hero: firstHero, minAwakening: 5 });
    setConditionOpen(true);
    setMessage("");
    setErrorMessage("");
  }

  async function addDefenseCondition(event) {
    event?.preventDefault();
    if (!isAdminUser || saving || !selectedConditionDefense) return;

    const heroName = newCondition.hero.trim();
    const minAwakening = Number(newCondition.minAwakening);

    if (!heroName || Number.isNaN(minAwakening)) {
      setErrorMessage("Choisis un heros et un niveau d'eveil.");
      return;
    }

    if (!(selectedConditionDefense.slots || []).includes(heroName)) {
      setErrorMessage("La condition doit viser un heros present dans cette defense.");
      return;
    }

    const champion = championByName.get(normalizeDefenseChampionName(heroName));
    if (!champion) {
      setErrorMessage("Hero introuvable dans la table champions.");
      return;
    }

    const alreadyExists = (selectedConditionDefense.conditions || []).some(
      (condition) =>
        normalizeDefenseChampionName(condition.label).startsWith(normalizeDefenseChampionName(heroName)) &&
        Number(condition.minAwakening) === minAwakening,
    );

    if (alreadyExists) {
      setErrorMessage("Cette condition existe deja.");
      return;
    }

    setSaving(true);
    setErrorMessage("");

    try {
      const { error } = await supabase.from("guild_defense_conditions").insert({
        defense_id: selectedConditionDefense.id,
        champion_id: champion.id,
        min_awakening: minAwakening,
      });

      if (error) throw error;

      void logPortalActivity(session, {
        actionType: "admin_defense_condition_add",
        entityType: "defense",
        entityId: String(selectedConditionDefense.id),
        summary: `${session?.watcherName || session?.name || "Admin"} a ajoute une condition a ${selectedConditionDefense.name}`,
        metadata: {
          defenseName: selectedConditionDefense.name,
          heroName,
          minAwakening,
        },
      });

      setConditionOpen(false);
      setMessage(`Condition ajoutee a ${selectedConditionDefense.name}.`);
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setErrorMessage(error?.message || "Ajout de condition impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function openRemoveConditionDialog(defense) {
    const editableDefense = await ensureEditableDefense(defense);
    if (!editableDefense) return;

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { data, error } = await supabase
        .from("guild_defense_conditions")
        .select(`
          id,
          champion_id,
          min_awakening,
          champions (
            name
          )
        `)
        .eq("defense_id", editableDefense.id)
        .order("min_awakening", { ascending: false });

      if (error) throw error;

      const conditions = (data || []).map(mapPortalDefenseConditionRow);
      if (conditions.length === 0) {
        setErrorMessage("Cette defense n'a aucune condition a retirer.");
        return;
      }

      setConditionRemoveDefense({
        ...editableDefense,
        conditions,
      });
      setConditionRemoveOpen(true);
    } catch (error) {
      setErrorMessage(error?.message || "Chargement des conditions impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function removeDefenseCondition(condition) {
    if (!isAdminUser || saving || !conditionRemoveDefense?.id || !condition?.id) return;

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { error } = await supabase
        .from("guild_defense_conditions")
        .delete()
        .eq("id", condition.id)
        .eq("defense_id", conditionRemoveDefense.id);

      if (error) throw error;

      void logPortalActivity(session, {
        actionType: "admin_defense_condition_remove",
        entityType: "defense",
        entityId: String(conditionRemoveDefense.id),
        summary: `${session?.watcherName || session?.name || "Admin"} a retire une condition de ${conditionRemoveDefense.name}`,
        metadata: {
          defenseName: conditionRemoveDefense.name,
          condition: condition.label,
        },
      });

      const nextConditions = (conditionRemoveDefense.conditions || []).filter(
        (item) => String(item.id) !== String(condition.id),
      );

      setConditionRemoveDefense((previous) =>
        previous
          ? {
              ...previous,
              conditions: nextConditions,
            }
          : previous,
      );

      setDefenses((previous) =>
        previous.map((defense) =>
          String(defense.id) === String(conditionRemoveDefense.id)
            ? {
                ...defense,
                conditions: (defense.conditions || []).filter((item) => String(item.id) !== String(condition.id)),
              }
            : defense,
        ),
      );

      setMessage(`Condition retiree de ${conditionRemoveDefense.name}.`);
      if (nextConditions.length === 0) setConditionRemoveOpen(false);
    } catch (error) {
      setErrorMessage(error?.message || "Suppression de condition impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDefense(defense) {
    if (!isAdminUser || saving || !defense?.id) return;

    const shouldHideLocally = Boolean(defense.sourceDefenseId || isInheritedDefense(defense, activeGuildCode));
    const confirmed = window.confirm(
      shouldHideLocally
        ? `Retirer la defense "${defense.name}" uniquement pour ${activeGuildCode} ?`
        : `Supprimer la defense "${defense.name}" ?`,
    );
    if (!confirmed) return;

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      const resetGuildCodes = shouldHideLocally
        ? [activeGuildCode]
        : defense.isGlobal || isPaladinGuildCode(defense.guildCode)
          ? PALADIN_CLUSTER_GUILD_CODES
          : [defense.guildCode || activeGuildCode].filter(Boolean);

      let resetDefense1Query = supabase
        .from("guild_members")
        .update({ defense_1: EMPTY_DEFENSE_SLOT })
        .eq("defense_1", defense.name);
      let resetDefense2Query = supabase
        .from("guild_members")
        .update({ defense_2: EMPTY_DEFENSE_SLOT })
        .eq("defense_2", defense.name);

      if (resetGuildCodes.length > 0) {
        resetDefense1Query = resetDefense1Query.in("guild_code", resetGuildCodes);
        resetDefense2Query = resetDefense2Query.in("guild_code", resetGuildCodes);
      }

      if (shouldHideLocally) {
        const localDefense = await createLocalDefenseVariant(defense, { hidden: true });
        const [resetDefense1, resetDefense2] = await Promise.all([resetDefense1Query, resetDefense2Query]);

        const mutationError = resetDefense1.error || resetDefense2.error;
        if (mutationError) throw mutationError;

        void logPortalActivity(session, {
          actionType: "admin_defense_local_hide",
          entityType: "defense",
          entityId: String(localDefense?.id || defense.id),
          summary: `${session?.watcherName || session?.name || "Admin"} a retire localement ${defense.name} pour ${activeGuildCode}`,
          metadata: {
            defenseName: defense.name,
            guildCode: activeGuildCode,
            sourceDefenseId: getDefenseRootId(defense),
          },
        });

        setDefenses((previous) =>
          resolveDefenseVariantsForGuild(previous, activeGuildCode).filter(
            (item) => String(getDefenseRootId(item)) !== String(getDefenseRootId(defense)),
          ),
        );
        setMessage(`Defense retiree uniquement pour ${activeGuildCode} : ${defense.name}.`);
        setRefreshTick((value) => value + 1);
        return;
      }

      const { data: blocks, error: blocksError } = await supabase
        .from("guild_defense_blocks")
        .select("id, block_type, content")
        .eq("defense_id", defense.id);

      if (blocksError) throw blocksError;

      const storagePaths = [
        getDefenseStoragePathFromPublicUrl(defense.image || defense.image_url),
        ...(blocks || [])
          .filter((block) => block.block_type === "image")
          .map((block) => getDefenseStoragePathFromPublicUrl(block.content)),
      ].filter(Boolean);

      const uniqueStoragePaths = [...new Set(storagePaths)];

      if (uniqueStoragePaths.length > 0) {
        const { error: storageError } = await supabase.storage.from("defense-images").remove(uniqueStoragePaths);
        if (storageError) throw storageError;
      }

      const [resetDefense1, resetDefense2, blocksDelete, conditionsDelete, slotsDelete] = await Promise.all([
        resetDefense1Query,
        resetDefense2Query,
        supabase.from("guild_defense_blocks").delete().eq("defense_id", defense.id),
        supabase.from("guild_defense_conditions").delete().eq("defense_id", defense.id),
        supabase.from("guild_defense_slots").delete().eq("defense_id", defense.id),
      ]);

      const mutationError =
        resetDefense1.error ||
        resetDefense2.error ||
        blocksDelete.error ||
        conditionsDelete.error ||
        slotsDelete.error;

      if (mutationError) throw mutationError;

      const { error: defenseError } = await supabase.from("guild_defenses").delete().eq("id", defense.id);
      if (defenseError) throw defenseError;

      void logPortalActivity(session, {
        actionType: "admin_defense_delete",
        entityType: "defense",
        entityId: String(defense.id),
        summary: `${session?.watcherName || session?.name || "Admin"} a supprime la defense ${defense.name}`,
        metadata: {
          defenseName: defense.name,
          guildCode: defense.guildCode,
          isGlobal: defense.isGlobal,
        },
      });

      setMessage(`Defense supprimee : ${defense.name}.`);
      setRefreshTick((value) => value + 1);
    } catch (error) {
      setErrorMessage(error?.message || "Suppression de la defense impossible.");
    } finally {
      setSaving(false);
    }
  }

  if (!isAdminUser) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-xl font-semibold text-zinc-50">{t("adminDefenses.title", "Gestion defense")}</h2>
        <p className="mt-2 text-sm text-zinc-400">{t("common.adminReserved", "Cet onglet est reserve aux administrateurs.")}</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-zinc-50">{t("adminDefenses.title", "Gestion defense")}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {t("adminDefenses.portalDescription", "Gestion admin des defenses disponibles dans Mes defenses.")}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={() => setRefreshTick((value) => value + 1)}
              disabled={loading || saving}
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              {t("common.refresh", "Actualiser")}
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {visibleDefenseGuildCodes.map((guildCode) => (
            <button
              key={guildCode}
              type="button"
              onClick={() => setActiveGuildCode(guildCode)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                normalizeGuildCodeKey(activeGuildCode) === normalizeGuildCodeKey(guildCode)
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-200"
                  : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              }`}
            >
              {guildCode}
            </button>
          ))}
          <Badge className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-300">
            {defenses.length} {t("adminDefenses.visibleDefenses", "defenses visibles")}
          </Badge>
        </div>
      </div>

      {message ? (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
          {t("adminDefenses.loading", "Chargement des defenses...")}
        </div>
      ) : (
        <AdminDefensesTab
          defenses={defenses}
          onAdd={openAddDefense}
          onEdit={openEditDefense}
          onDelete={deleteDefense}
          onAddCondition={openConditionDialog}
          onRemoveCondition={openRemoveConditionDialog}
          onEnsureEditable={ensureEditableDefense}
        />
      )}

      <datalist id="portal-admin-defense-heroes">
        {champions.map((champion) => (
          <option key={champion.id} value={champion.name}>
            {champion.portal_name || champion.name}
          </option>
        ))}
      </datalist>

      {draftOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={saveDraftDefense}
            className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">
                  {draft.id ? t("adminDefenses.editDefense", "Modifier une defense") : t("adminDefenses.addDefense", "Ajouter une defense")}
                </h3>
                <p className="mt-1 text-sm text-zinc-500">
                  {t("adminDefenses.heroNameHelp", "Les heros doivent correspondre au champ Name de Supabase.")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDraftOpen(false)}
                className="rounded-lg border border-zinc-700 p-2 text-zinc-300 hover:bg-zinc-800"
                aria-label={t("common.close", "Fermer")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_260px]">
              <div className="space-y-4">
                <label className="block text-sm font-medium text-zinc-300">
                  {t("adminDefenses.defenseName", "Nom de la defense")}
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
                    className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                    required
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm font-medium text-zinc-300">
                    Tier
                    <select
                      value={draft.tier}
                      onChange={(event) => setDraft((previous) => ({ ...previous, tier: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                    >
                      <option value="meta_s">Meta S</option>
                      <option value="meta_a">Meta A</option>
                      <option value="secondaire">{t("defenses.secondary", "Secondaire")}</option>
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-zinc-300">
                    Type
                    <select
                      value={draft.type}
                      onChange={(event) => setDraft((previous) => ({ ...previous, type: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                    >
                      <option value="Tour">{t("defenses.tower", "Tour")}</option>
                      <option value="Bastion">{t("defenses.bastion", "Bastion")}</option>
                      <option value="Bulle">{t("defenses.bubble", "Bulle")}</option>
                    </select>
                  </label>

                  <label className="block text-sm font-medium text-zinc-300">
                    Faction
                    <select
                      value={draft.faction}
                      onChange={(event) => setDraft((previous) => ({ ...previous, faction: event.target.value }))}
                      className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                    >
                      <option value="">{t("adminDefenses.noFaction", "Sans faction")}</option>
                      {defenseFactionOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {draft.slots.map((slot, index) => (
                    <label key={`slot-${index}`} className="block text-sm font-medium text-zinc-300">
                      {t("common.hero", "Hero")} {index + 1}
                      <input
                        type="text"
                        list="portal-admin-defense-heroes"
                        value={slot}
                        onChange={(event) => updateDraftSlot(index, event.target.value)}
                        className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                        required
                      />
                    </label>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900">
                  {draft.image ? (
                    <img src={draft.image} alt={draft.name || "Defense"} className="h-52 w-full object-contain" />
                  ) : (
                    <div className="flex h-52 items-center justify-center text-sm text-zinc-500">
                      {t("common.noImage", "Aucune image")}
                    </div>
                  )}
                </div>

                <label
                  className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-800 ${
                    saving ? "pointer-events-none opacity-60" : ""
                  }`}
                >
                  <ImagePlus className="h-4 w-4" />
                  {t("adminDefenses.defenseImage", "Image defense")}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleDefenseImageChange}
                    disabled={saving}
                  />
                </label>

                <button
                  type="button"
                  onClick={pasteDraftDefenseImageFromClipboard}
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-violet-700 bg-violet-900/30 px-3 py-2 text-sm text-violet-200 hover:bg-violet-800/50 disabled:cursor-wait disabled:opacity-60"
                >
                  <ClipboardPaste className="h-4 w-4" />
                  {t("adminDefenses.pasteImage", "Coller depuis le presse-papier")}
                </button>

                <div
                  role="button"
                  tabIndex={0}
                  onPaste={handleDraftDefenseImagePaste}
                  className="rounded-lg border border-dashed border-violet-800 bg-violet-950/20 p-3 text-xs text-zinc-400 outline-none transition focus:border-violet-400 focus:bg-violet-950/40"
                >
                  <div className="flex items-center gap-2 font-semibold text-violet-200">
                    <ClipboardPaste className="h-4 w-4" />
                    {t("adminDefenses.pasteZoneTitle", "Collage rapide")}
                  </div>
                  <div className="mt-1">
                    {t(
                      "adminDefenses.pasteZoneHelp",
                      "Clique ici puis fais Ctrl+V pour ajouter directement l'image copiee."
                    )}
                  </div>
                </div>

                {draftImageMessage ? (
                  <div className="text-xs text-zinc-300">{draftImageMessage}</div>
                ) : null}

                {draft.isGlobal && isPaladinGuildCode(draft.guildCode || activeGuildCode) ? (
                  <Badge className="rounded-lg border-sky-500/30 bg-sky-500/10 text-sky-200">{t("adminDefenses.globalDefense", "Defense globale")}</Badge>
                ) : (
                  <Badge className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-300">
                    {t("home.guild", "Guilde")} {activeGuildCode}
                  </Badge>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 bg-transparent text-zinc-200"
                onClick={() => setDraftOpen(false)}
                disabled={saving}
              >
                {t("common.cancel", "Annuler")}
              </Button>
              <Button type="submit" className="rounded-lg bg-emerald-600 text-white hover:bg-emerald-500" disabled={saving}>
                {saving ? t("common.saving", "Sauvegarde...") : t("common.save", "Sauvegarder")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {conditionOpen && selectedConditionDefense ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form
            onSubmit={addDefenseCondition}
            className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{t("adminDefenses.addCondition", "Ajouter une condition")}</h3>
                <p className="mt-1 text-sm text-zinc-500">{selectedConditionDefense.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setConditionOpen(false)}
                className="rounded-lg border border-zinc-700 p-2 text-zinc-300 hover:bg-zinc-800"
                aria-label={t("common.close", "Fermer")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_140px]">
              <label className="block text-sm font-medium text-zinc-300">
                Hero
                <select
                  value={newCondition.hero}
                  onChange={(event) => setNewCondition((previous) => ({ ...previous, hero: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                >
                  {(selectedConditionDefense.slots || []).map((heroName) => (
                    <option key={heroName} value={heroName}>
                      {heroName}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm font-medium text-zinc-300">
                {t("adminDefenses.minAwakening", "Eveil min")}
                <select
                  value={newCondition.minAwakening}
                  onChange={(event) =>
                    setNewCondition((previous) => ({ ...previous, minAwakening: Number(event.target.value) }))
                  }
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500"
                >
                  {[0, 1, 2, 3, 4, 5].map((level) => (
                    <option key={level} value={level}>
                      A{level}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 bg-transparent text-zinc-200"
                onClick={() => setConditionOpen(false)}
                disabled={saving}
              >
                {t("common.cancel", "Annuler")}
              </Button>
              <Button type="submit" className="rounded-lg bg-emerald-600 text-white hover:bg-emerald-500" disabled={saving}>
                {t("common.add", "Ajouter")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {conditionRemoveOpen && conditionRemoveDefense ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{t("adminDefenses.removeCondition", "Retirer une condition")}</h3>
                <p className="mt-1 text-sm text-zinc-500">{conditionRemoveDefense.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setConditionRemoveOpen(false)}
                className="rounded-lg border border-zinc-700 p-2 text-zinc-300 hover:bg-zinc-800"
                aria-label={t("common.close", "Fermer")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 space-y-2">
              {(conditionRemoveDefense.conditions || []).length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-400">
                  {t("adminDefenses.noCondition", "Aucune condition")}
                </div>
              ) : (
                (conditionRemoveDefense.conditions || []).map((condition) => (
                  <div
                    key={condition.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900 p-3"
                  >
                    <span className="text-sm text-zinc-100">{condition.label}</span>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-lg border-red-800 bg-transparent text-red-200 hover:bg-red-950/40"
                      onClick={() => removeDefenseCondition(condition)}
                      disabled={saving}
                    >
                      {t("common.delete", "Supprimer")}
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 bg-transparent text-zinc-200"
                onClick={() => setConditionRemoveOpen(false)}
                disabled={saving}
              >
                {t("common.close", "Fermer")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ValidationView() {
  return (
    <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-zinc-50">Validation des defenses</h2>
          <p className="mt-1 text-sm text-zinc-500">Previews compressees, JSON min et corrections manuelles.</p>
        </div>
        <Badge className="rounded-lg border-sky-500/30 bg-sky-500/10 text-sky-300">48/48 exemple</Badge>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="space-y-2">
          {["Bastion 1", "Bastion 2", "Bastion 3", "Bastion 4"].map((bastion, index) => (
            <button key={bastion} type="button" className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-left hover:bg-zinc-800">
              <span className="font-medium text-zinc-100">{bastion}</span>
              <Badge className={`rounded-md ${index === 0 ? statusClass("pret") : statusClass("attente")}`}>
                {index === 0 ? "valide" : "a controler"}
              </Badge>
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="aspect-video rounded-lg border border-zinc-800 bg-[linear-gradient(135deg,#1d1b16,#0f1720_45%,#132018)]" />
          <div className="mt-4 grid gap-2 md:grid-cols-5">
            {["Torodor", "Eirlys", "Venoma", "Hex", "Praetus"].map((hero, index) => (
              <div key={hero} className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm">
                <div className="font-medium text-zinc-100">{hero}</div>
                <div className="mt-1 text-zinc-500">E{index + 1} - {["N", "S", "E", "O", "S"][index]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const addHeroInitialState = {
  portalName: "",
  technicalName: "",
  rarity: "legendary",
  role: "combattant",
  factions: ["sentinelle"],
  lord: "non-lord",
  adminPassword: "",
};

const HERO_CALQUE_MAX_DIMENSION = 900;
const HERO_CALQUE_MAX_BYTES = 2 * 1024 * 1024;

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} Mo`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${bytes} o`;
}

function compressHeroCalqueFile(file, outputName) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("Choisis une image valide pour le calque hero-calc."));
      return;
    }

    const image = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      image.onload = () => {
        const scale = Math.min(
          1,
          HERO_CALQUE_MAX_DIMENSION / Math.max(image.width || 1, image.height || 1),
        );
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement("canvas");

        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.clearRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Compression du calque impossible."));
            return;
          }

          const compressedFile = new File([blob], outputName, { type: "image/png" });

          if (compressedFile.size > HERO_CALQUE_MAX_BYTES) {
            reject(new Error("Le calque reste au-dessus du seuil de 2 Mo apres compression."));
            return;
          }

          resolve({
            file: compressedFile,
            width,
            height,
            originalBytes: file.size,
            compressedBytes: compressedFile.size,
          });
        }, "image/png");
      };

      image.onerror = () => reject(new Error("Lecture du calque impossible."));
      image.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}

function AddHeroView({ session }) {
  const apiBase = useMemo(() => getApiBase(), []);
  const heroCalqueInputRef = useRef(null);
  const [form, setForm] = useState(addHeroInitialState);
  const [heroCalqueFile, setHeroCalqueFile] = useState(null);
  const [compressionInfo, setCompressionInfo] = useState(null);
  const [technicalNameTouched, setTechnicalNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [createdChampion, setCreatedChampion] = useState(null);
  const isLeaderUser = isLeaderSession(session);

  const selectedFactionLabels = form.factions
    .map((faction) => heroFactionMeta[faction]?.label || formatHeroFilterLabel(faction))
    .join(", ");

  const expectedImageFile = normalizeHeroImageFile(form.portalName);

  function updateForm(patch) {
    setForm((previous) => ({ ...previous, ...patch }));
  }

  function handlePortalNameChange(value) {
    setForm((previous) => ({
      ...previous,
      portalName: value,
      technicalName: technicalNameTouched ? previous.technicalName : normalizeHeroKey(value),
    }));
  }

  function handleHeroCalqueChange(event) {
    const file = event.target.files?.[0] || null;
    setHeroCalqueFile(file);
    setCompressionInfo(null);
    setMessage("");
    setErrorMessage("");
  }

  function toggleFaction(faction) {
    setForm((previous) => {
      const nextFactions = previous.factions.includes(faction)
        ? previous.factions.filter((item) => item !== faction)
        : [...previous.factions, faction];

      return {
        ...previous,
        factions: nextFactions.length > 0 ? nextFactions : [faction],
      };
    });
  }

  async function submitHero(event) {
    event.preventDefault();
    if (!isLeaderUser || saving) return;

    const payload = {
      action: "create",
      actorMemberId: session?.memberId || session?.id,
      adminPassword: form.adminPassword,
      name: form.technicalName.trim(),
      portalName: form.portalName.trim(),
      rarity: form.rarity,
      role: form.role,
      factions: form.factions,
      lord: form.lord,
    };

    if (!payload.name || !payload.portalName || !payload.adminPassword) {
      setErrorMessage("Name technique, PortalName et mot de passe leader sont obligatoires.");
      return;
    }

    if (!heroCalqueFile) {
      setErrorMessage("Ajoute le calque hero-calc du heros avant de valider.");
      return;
    }

    setSaving(true);
    setMessage("");
    setErrorMessage("");
    setCreatedChampion(null);
    setCompressionInfo(null);

    try {
      const compressedCalque = await compressHeroCalqueFile(heroCalqueFile, expectedImageFile);
      const formData = new FormData();

      Object.entries(payload).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          formData.append(key, value.join(";"));
          return;
        }

        formData.append(key, value ?? "");
      });

      formData.append("heroCalque", compressedCalque.file, expectedImageFile);

      const response = await fetch(`${apiBase}/api/portal-champions`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Creation du heros impossible.");
      }

      setCreatedChampion(data?.champion || null);
      setCompressionInfo(compressedCalque);
      setMessage(`${payload.portalName} a ete ajoute a Supabase et envoye dans hero-calques.`);
      setForm({ ...addHeroInitialState, adminPassword: form.adminPassword });
      setHeroCalqueFile(null);
      if (heroCalqueInputRef.current) heroCalqueInputRef.current.value = "";
      setTechnicalNameTouched(false);
    } catch (error) {
      setErrorMessage(error?.message || "Creation du heros impossible.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <form onSubmit={submitHero} className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <PlusCircle className="h-5 w-5 text-emerald-300" />
              <h2 className="text-xl font-semibold text-zinc-50">Ajout heros</h2>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500">
              Creation du heros dans Supabase et envoi du calque hero-calc vers le VPS.
            </p>
          </div>
          <Badge className="rounded-lg border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            Hero-calques VPS
          </Badge>
        </div>

        {!isLeaderUser ? (
          <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            Cet onglet est reserve au role leader.
          </div>
        ) : (
          <>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="text-sm text-zinc-400">Name technique normalise</span>
                <input
                  type="text"
                  value={form.technicalName}
                  onChange={(event) => {
                    setTechnicalNameTouched(true);
                    updateForm({ technicalName: event.target.value });
                  }}
                  placeholder="ex: nouvelheros"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                />
                <span className="mt-1 block text-xs text-zinc-600">Utilise par la detection et les liens techniques.</span>
              </label>

              <label className="block">
                <span className="text-sm text-zinc-400">PortalName</span>
                <input
                  type="text"
                  value={form.portalName}
                  onChange={(event) => handlePortalNameChange(event.target.value)}
                  placeholder="Ex: Nouveau Heros"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                />
                <span className="mt-1 block text-xs text-zinc-600">Nom affiche dans la box Portal.</span>
              </label>

              <label className="block">
                <span className="text-sm text-zinc-400">Rarete</span>
                <select
                  value={form.rarity}
                  onChange={(event) => updateForm({ rarity: event.target.value })}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                >
                  {heroRarityOrder.map((rarity) => (
                    <option key={rarity} value={rarity}>
                      {heroRarityMeta[rarity]?.label || rarity}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm text-zinc-400">Role</span>
                <select
                  value={form.role}
                  onChange={(event) => updateForm({ role: event.target.value })}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                >
                  {heroRoleOrder.map((role) => (
                    <option key={role} value={role}>
                      {heroRoleMeta[role]?.label || formatHeroFilterLabel(role)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="text-sm text-zinc-400">Lord</span>
                <select
                  value={form.lord}
                  onChange={(event) => updateForm({ lord: event.target.value })}
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                >
                  <option value="non-lord">Non-lord</option>
                  <option value="lord">Lord</option>
                </select>
              </label>

              <label className="block">
                <span className="text-sm text-zinc-400">Mot de passe leader</span>
                <input
                  type="password"
                  value={form.adminPassword}
                  onChange={(event) => updateForm({ adminPassword: event.target.value })}
                  placeholder="Confirmation leader"
                  className="mt-2 h-11 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/20"
                />
              </label>
            </div>

            <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                    <UploadCloud className="h-4 w-4 text-emerald-300" />
                    Calque hero-calc
                  </div>
                  <p className="mt-1 text-sm text-zinc-500">
                    Le fichier est converti en PNG, limite 900 px sur le plus grand cote, puis envoye dans `hero-calques`.
                  </p>
                </div>
                <Badge className="w-fit rounded-lg border-zinc-700 bg-zinc-950 text-zinc-300">
                  seuil 2 Mo
                </Badge>
              </div>
              <label className="mt-4 block">
                <input
                  ref={heroCalqueInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleHeroCalqueChange}
                  className="block w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-500 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-zinc-950 hover:file:bg-emerald-400"
                />
              </label>
              <div className="mt-3 grid gap-2 text-xs text-zinc-500 sm:grid-cols-2">
                <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                  Fichier final : <span className="text-zinc-200">{expectedImageFile || "--"}</span>
                </div>
                <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2">
                  Source : <span className="text-zinc-200">{heroCalqueFile?.name || "--"}</span>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="text-sm text-zinc-400">Faction</div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {heroFactionOrder.map((faction) => {
                  const selected = form.factions.includes(faction);
                  return (
                    <button
                      key={faction}
                      type="button"
                      onClick={() => toggleFaction(faction)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm transition ${
                        selected
                          ? "border-emerald-300/60 bg-emerald-500/15 text-emerald-100"
                          : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-600 hover:text-zinc-100"
                      }`}
                    >
                      {heroFactionMeta[faction]?.label || formatHeroFilterLabel(faction)}
                    </button>
                  );
                })}
              </div>
            </div>

            {message ? (
              <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                {message}
              </div>
            ) : null}

            {errorMessage ? (
              <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {errorMessage}
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-lg border-zinc-700 text-zinc-200"
                disabled={saving}
                onClick={() => {
                  setForm(addHeroInitialState);
                  setHeroCalqueFile(null);
                  if (heroCalqueInputRef.current) heroCalqueInputRef.current.value = "";
                  setCompressionInfo(null);
                  setTechnicalNameTouched(false);
                  setMessage("");
                  setErrorMessage("");
                  setCreatedChampion(null);
                }}
              >
                Reset
              </Button>
              <Button
                type="submit"
                className="rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                disabled={saving}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                {saving ? "Creation..." : "Ajouter le heros"}
              </Button>
            </div>
          </>
        )}
      </form>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-lg font-semibold text-zinc-50">Apercu creation</h2>
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <div className="text-zinc-500">name</div>
            <div className="mt-1 break-words font-medium text-zinc-100">{form.technicalName || "--"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <div className="text-zinc-500">PortalName</div>
            <div className="mt-1 break-words font-medium text-zinc-100">{form.portalName || "--"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <div className="text-zinc-500">Rarity / role / faction</div>
            <div className="mt-1 text-zinc-100">
              {heroRarityMeta[form.rarity]?.label || form.rarity} / {heroRoleMeta[form.role]?.label || form.role} / {selectedFactionLabels}
            </div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <div className="text-zinc-500">lord</div>
            <div className="mt-1 font-medium text-zinc-100">{form.lord}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <div className="text-zinc-500">Calque attendu par la box</div>
            <div className="mt-1 break-words font-medium text-zinc-100">{expectedImageFile || "--"}</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
            <div className="text-zinc-500">Compression hero-calc</div>
            <div className="mt-1 text-zinc-100">
              {compressionInfo
                ? `${formatBytes(compressionInfo.originalBytes)} -> ${formatBytes(compressionInfo.compressedBytes)} (${compressionInfo.width}x${compressionInfo.height})`
                : `PNG max ${HERO_CALQUE_MAX_DIMENSION}px / ${formatBytes(HERO_CALQUE_MAX_BYTES)}`}
            </div>
          </div>
          {createdChampion ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200">
              Dernier heros cree : {createdChampion.portal_name || createdChampion.PortalName || createdChampion.name}
            </div>
          ) : null}
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-100">
            Seul le dossier VPS hero-calques est concerne ici. Les templates de reconnaissance ne sont pas geres par cet onglet.
          </div>
        </div>
      </div>
    </section>
  );
}

function GuildsView({ session }) {
  return <PortalGuildsTab session={session} />;
}

function formatLicenseDate(value) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatLicenseDateInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function getLicenseDeadlineTone(daysLeft, status) {
  if (status === "suspended" || status === "cancelled") {
    return "border-red-500/40 bg-red-500/10 text-red-200";
  }

  if (daysLeft === null || daysLeft === undefined) {
    return "border-zinc-700 bg-zinc-900 text-zinc-300";
  }

  if (daysLeft < 0) return "border-red-500/40 bg-red-500/10 text-red-200";
  if (daysLeft <= 3) return "border-amber-500/40 bg-amber-500/10 text-amber-100";
  return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
}

function getLicenseDeadlineLabel(license) {
  if (license.status === "suspended") return "Suspendu";
  if (license.status === "cancelled") return "Annule";
  if (license.daysLeft === null || license.daysLeft === undefined) return "Aucune echeance";
  if (license.daysLeft < 0) return `Expire depuis ${Math.abs(license.daysLeft)} j`;
  if (license.daysLeft === 0) return "Expire aujourd'hui";
  return `${license.daysLeft} j restants`;
}

function BillingView({ session }) {
  const apiBase = useMemo(() => getApiBase(), []);
  const actorMemberId = session?.memberId || session?.id || "";
  const isLeaderUser = isLeaderSession(session);
  const [licenses, setLicenses] = useState([]);
  const [schemaReady, setSchemaReady] = useState(true);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [drafts, setDrafts] = useState({});

  async function loadLicenses() {
    if (!isLeaderUser) return;

    setLoading(true);
    setErrorMessage("");

    try {
      const params = new URLSearchParams({ actorMemberId });
      const response = await fetch(`${apiBase}/api/portal-licenses?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Chargement licences impossible.");
      }

      setSchemaReady(payload.schemaReady !== false);
      setLicenses(payload.licenses || []);
      setDrafts(
        Object.fromEntries(
          (payload.licenses || []).map((license) => [
            license.guildSpaceKey,
            {
              plan: license.plan,
              status: license.status,
              notes: license.notes || "",
              guildLabel: license.guildLabel || license.guildSpaceKey,
              trialStartedAt: formatLicenseDateInput(license.trialStartedAt),
              trialEndsAt: formatLicenseDateInput(license.trialEndsAt),
              currentPeriodStartedAt: formatLicenseDateInput(license.currentPeriodStartedAt),
              currentPeriodEndsAt: formatLicenseDateInput(license.currentPeriodEndsAt),
            },
          ])
        )
      );
    } catch (error) {
      setErrorMessage(error.message || "Chargement licences impossible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!isLeaderUser) return;
    void loadLicenses();
  }, [actorMemberId, isLeaderUser]);

  if (!isLeaderUser) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-xl font-semibold text-zinc-50">Licences</h2>
        <p className="mt-2 text-sm text-zinc-400">Cet onglet est reserve au role leader.</p>
      </section>
    );
  }

  function updateDraft(guildSpaceKey, patch) {
    setDrafts((current) => ({
      ...current,
      [guildSpaceKey]: {
        ...(current[guildSpaceKey] || {}),
        ...patch,
      },
    }));
  }

  async function mutateLicense(action, guildSpaceKey, extra = {}) {
    if (!guildSpaceKey || savingKey) return;

    const draft = drafts[guildSpaceKey] || {};
    setSavingKey(`${action}:${guildSpaceKey}`);
    setMessage("");
    setErrorMessage("");

    try {
      const response = await fetch(`${apiBase}/api/portal-licenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          actorMemberId,
          guildSpaceKey,
          guildLabel: draft.guildLabel || extra.guildLabel || guildSpaceKey,
          plan: draft.plan || extra.plan || DEFAULT_EXTERNAL_LICENSE_PLAN,
          status: draft.status || extra.status || "active",
          notes: draft.notes || "",
          trialStartedAt: draft.trialStartedAt || extra.trialStartedAt || "",
          trialEndsAt: draft.trialEndsAt || extra.trialEndsAt || "",
          currentPeriodStartedAt: draft.currentPeriodStartedAt || extra.currentPeriodStartedAt || "",
          currentPeriodEndsAt: draft.currentPeriodEndsAt || extra.currentPeriodEndsAt || "",
          ...extra,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Mise a jour impossible.");
      }

      setMessage("Licence mise a jour.");
      await loadLicenses();
    } catch (error) {
      setErrorMessage(error.message || "Mise a jour impossible.");
    } finally {
      setSavingKey("");
    }
  }

  async function createGuildTestLicense() {
    const guildSpaceKey = "GUILDTEST";
    updateDraft(guildSpaceKey, {
      guildLabel: "Guild Test",
      plan: "trial_private",
      status: "trial",
      notes: "Espace de test des abonnements.",
      trialStartedAt: formatLicenseDateInput(new Date()),
      trialEndsAt: formatLicenseDateInput(addMonths(new Date(), 1)),
    });

    await mutateLicense("save", guildSpaceKey, {
      guildLabel: "Guild Test",
      plan: "trial_private",
      status: "trial",
      notes: "Espace de test des abonnements.",
      trialStartedAt: formatLicenseDateInput(new Date()),
      trialEndsAt: formatLicenseDateInput(addMonths(new Date(), 1)),
    });
  }

  return (
    <section className="space-y-5">
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-emerald-300">Leader</p>
            <h2 className="mt-1 text-2xl font-semibold text-zinc-50">Licences guildes externes</h2>
            <p className="mt-2 max-w-3xl text-sm text-zinc-400">
              Gere les essais, abonnements, suspensions et l'acces en lecture a la data Paladin. Une guilde externe
              ne peut jamais modifier ni supprimer un run qui ne vient pas de son propre espace.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={loadLicenses}
              className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              disabled={loading}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Rafraichir
            </Button>
            <Button
              type="button"
              onClick={createGuildTestLicense}
              className="rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
              disabled={!schemaReady || Boolean(savingKey)}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              Creer Guild Test
            </Button>
          </div>
        </div>

        {!schemaReady ? (
          <div className="mt-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Table <span className="font-mono">portal_guild_licenses</span> manquante. Colle d'abord le SQL que je vais
            te donner, puis reviens ici.
          </div>
        ) : null}

        {message ? (
          <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
            {message}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {errorMessage}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {loading ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
            Chargement des licences...
          </div>
        ) : licenses.length ? (
          licenses.map((license) => {
            const draft = drafts[license.guildSpaceKey] || {};
            const plan = normalizeLicensePlan(draft.plan || license.plan);
            const status = normalizeLicenseStatus(draft.status || license.status, plan);
            const deadlineTone = getLicenseDeadlineTone(license.daysLeft, license.status);
            const isSavingThis = savingKey.endsWith(`:${license.guildSpaceKey}`);
            const isTrial = isTrialLicensePlan(plan);

            return (
              <article key={license.guildSpaceKey} className="rounded-xl border border-zinc-800 bg-zinc-950 p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                      Espace externe
                    </div>
                    <h3 className="mt-1 text-xl font-semibold text-zinc-50">{license.guildLabel}</h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(license.guildCodes || []).length ? (
                        license.guildCodes.map((guildCode) => (
                          <Badge key={guildCode} className="rounded-md border-zinc-700 bg-zinc-900 text-zinc-200">
                            {guildCode}
                          </Badge>
                        ))
                      ) : (
                        <Badge className="rounded-md border-amber-500/30 bg-amber-500/10 text-amber-200">
                          Aucun membre
                        </Badge>
                      )}
                    </div>
                  </div>

                  <Badge className={`rounded-md border px-3 py-1 ${deadlineTone}`}>
                    {getLicenseDeadlineLabel(license)}
                  </Badge>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <div className="text-xs text-zinc-500">Membres</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-50">{license.memberCount}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <div className="text-xs text-zinc-500">Admins</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-50">{license.adminCount}</div>
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <div className="text-xs text-zinc-500">Officiers</div>
                    <div className="mt-1 text-lg font-semibold text-zinc-50">{license.officerCount}</div>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Plan</span>
                    <select
                      value={plan}
                      onChange={(event) => updateDraft(license.guildSpaceKey, { plan: event.target.value })}
                      className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                    >
                      {Object.entries(PORTAL_LICENSE_PLANS).map(([planKey, planConfig]) => (
                        <option key={planKey} value={planKey}>
                          {planConfig.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Statut</span>
                    <select
                      value={status}
                      onChange={(event) => updateDraft(license.guildSpaceKey, { status: event.target.value })}
                      className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                    >
                      <option value="active">Actif</option>
                      <option value="trial">Essai</option>
                      <option value="suspended">Suspendu</option>
                      <option value="cancelled">Annule</option>
                    </select>
                  </label>
                </div>

                <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-sm text-zinc-300">
                  <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <span className="text-zinc-500">Essai : </span>
                      {formatLicenseDate(license.trialStartedAt)} {"->"} {formatLicenseDate(license.trialEndsAt)}
                      </div>
                      <div>
                        <span className="text-zinc-500">Periode payee : </span>
                      {formatLicenseDate(license.currentPeriodStartedAt)} {"->"} {formatLicenseDate(license.currentPeriodEndsAt)}
                      </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        Debut essai
                      </span>
                      <input
                        type="date"
                        value={draft.trialStartedAt ?? formatLicenseDateInput(license.trialStartedAt)}
                        onChange={(event) => updateDraft(license.guildSpaceKey, { trialStartedAt: event.target.value })}
                        className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        Fin essai
                      </span>
                      <input
                        type="date"
                        value={draft.trialEndsAt ?? formatLicenseDateInput(license.trialEndsAt)}
                        onChange={(event) => updateDraft(license.guildSpaceKey, { trialEndsAt: event.target.value })}
                        className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        Debut periode payee
                      </span>
                      <input
                        type="date"
                        value={draft.currentPeriodStartedAt ?? formatLicenseDateInput(license.currentPeriodStartedAt)}
                        onChange={(event) =>
                          updateDraft(license.guildSpaceKey, { currentPeriodStartedAt: event.target.value })
                        }
                        className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                        Fin periode payee
                      </span>
                      <input
                        type="date"
                        value={draft.currentPeriodEndsAt ?? formatLicenseDateInput(license.currentPeriodEndsAt)}
                        onChange={(event) =>
                          updateDraft(license.guildSpaceKey, { currentPeriodEndsAt: event.target.value })
                        }
                        className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                      />
                    </label>
                  </div>
                  <div className="mt-3 text-xs text-zinc-500">
                    {PORTAL_LICENSE_PLANS[plan]?.description || ""}
                  </div>
                </div>

                <label className="mt-4 block">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Notes internes</span>
                  <textarea
                    value={draft.notes ?? license.notes ?? ""}
                    onChange={(event) => updateDraft(license.guildSpaceKey, { notes: event.target.value })}
                    className="mt-2 min-h-20 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                    placeholder="Infos paiement, contact, conditions particulieres..."
                  />
                </label>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    onClick={() => mutateLicense("save", license.guildSpaceKey)}
                    className="rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                    disabled={isSavingThis}
                  >
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    Enregistrer
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => mutateLicense("mark_paid", license.guildSpaceKey)}
                    className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                    disabled={isSavingThis || isTrial || plan === "suspended"}
                    title={isTrial ? "Passe d'abord sur un abonnement payant." : "Prolonge d'un mois."}
                  >
                    <Clock3 className="mr-2 h-4 w-4" />
                    Paiement recu +1 mois
                  </Button>
                  {status === "suspended" || plan === "suspended" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => mutateLicense("resume", license.guildSpaceKey, { status: "active" })}
                      className="rounded-lg border-emerald-500/40 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                      disabled={isSavingThis}
                    >
                      Reprendre
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => mutateLicense("suspend", license.guildSpaceKey)}
                      className="rounded-lg border-red-500/40 bg-red-500/10 text-red-100 hover:bg-red-500/20"
                      disabled={isSavingThis}
                    >
                      Suspendre
                    </Button>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-sm text-zinc-400">
            Aucun espace externe trouve pour le moment. Cree Guild Test ou ajoute une guilde externe depuis l'onglet Guildes.
          </div>
        )}
      </div>
    </section>
  );
}

function PasswordChangeRequiredView({ session, onPasswordChanged, onLogout }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  async function submit(event) {
    event.preventDefault();
    if (saving) return;

    const cleanCurrentPassword = currentPassword.trim();
    const cleanNewPassword = newPassword.trim();
    const cleanConfirmPassword = confirmPassword.trim();

    if (!cleanCurrentPassword || !cleanNewPassword || !cleanConfirmPassword) {
      setErrorMessage("Tous les champs sont obligatoires.");
      return;
    }

    if (cleanNewPassword.length < 6) {
      setErrorMessage("Le nouveau mot de passe doit faire au moins 6 caracteres.");
      return;
    }

    if (cleanNewPassword !== cleanConfirmPassword) {
      setErrorMessage("La confirmation ne correspond pas.");
      return;
    }

    if (isForcedPortalPassword(cleanNewPassword)) {
      setErrorMessage("Choisis un mot de passe different du mot de passe temporaire.");
      return;
    }

    setSaving(true);
    setErrorMessage("");

    try {
      const { data, error } = await supabase
        .from("guild_members")
        .update({ password: cleanNewPassword })
        .eq("id", session?.memberId || session?.id)
        .eq("password", cleanCurrentPassword)
        .select("id")
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setErrorMessage("Le mot de passe actuel est incorrect.");
        return;
      }

      await logPortalActivity(session, {
        targetMemberId: session?.memberId || session?.id || null,
        targetName: session?.watcherName || session?.name || "",
        actionType: "player_password_change",
        entityType: "guild_members",
        entityId: session?.memberId || session?.id || null,
        summary: `${session?.watcherName || session?.name || "Joueur"} a change son mot de passe`,
      });

      onPasswordChanged();
    } catch (error) {
      console.error("[portal-password-change]", error);
      setErrorMessage("Changement impossible. Reessaie ou contacte un admin.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#11100d] px-4 py-8 text-zinc-100">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-50">Changement requis</h1>
            <p className="mt-1 text-sm text-zinc-500">{session?.watcherName || session?.name || "Joueur"}</p>
          </div>
          <Badge className="rounded-md border-amber-500/30 bg-amber-500/10 text-amber-200">Temporaire</Badge>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="current-password">
              Mot de passe actuel
            </label>
            <input
              id="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
              autoComplete="current-password"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="new-password">
              Nouveau mot de passe
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="confirm-password">
              Confirmation
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="mt-2 w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
              autoComplete="new-password"
            />
          </div>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {errorMessage}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <Button type="submit" className="rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400" disabled={saving}>
            {saving ? "Enregistrement..." : "Changer"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
            onClick={onLogout}
          >
            Deconnexion
          </Button>
        </div>
      </form>
    </main>
  );
}

function PlayerAccessView({ session }) {
  const { t } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const actorMemberId = session?.memberId || session?.id || "";
  const isAdminUser = isAdminSession(session);
  const [members, setMembers] = useState([]);
  const [adminPassword, setAdminPassword] = useState("");
  const [query, setQuery] = useState("");
  const [selectedMember, setSelectedMember] = useState(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [copiedField, setCopiedField] = useState("");
  const selectedMemberIsProtected = isAdminRole(selectedMember?.role);

  useEffect(() => {
    if (!isAdminUser) return;

    async function loadMembers() {
      setLoadingMembers(true);
      try {
        const { data, error } = await supabase
          .from("guild_members")
          .select("id, role, discord_id, watcher_name, guild_code")
          .order("watcher_name", { ascending: true });

        if (error) throw error;

        const scopedMembers = filterByGuildScope(data || [], session, (member) => member.guild_code, {
          leaderSeesAll: true,
        });

        setMembers(scopedMembers.map((member) => ({
          id: member.id,
          name: getMemberDisplayName(member),
          discordId: member.discord_id || "",
          guildCode: member.guild_code || "",
          role: member.role || "Joueur",
        })));
      } catch (error) {
        console.error("[portal-access-members]", error);
        setMembers([]);
        setErrorMessage(t("playerAccess.loadPlayersError", "Impossible de charger les joueurs."));
      } finally {
        setLoadingMembers(false);
      }
    }

    loadMembers();
  }, [isAdminUser, session]);

  const suggestions = useMemo(() => {
    const search = normalizeHeroKey(query);
    if (search.length < 2) return [];

    return members
      .filter((member) => {
        const haystack = normalizeHeroKey(`${member.name} ${member.discordId} ${member.guildCode}`);
        return haystack.includes(search);
      })
      .slice(0, 20);
  }, [members, query]);

  async function copyValue(value, field) {
    if (!value || !navigator?.clipboard) return;

    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(""), 1400);
  }

  async function resetPassword() {
    if (!selectedMember?.id || !adminPassword.trim() || resetting) return;

    setResetting(true);
    setErrorMessage("");
    setSuccessMessage("");
    setTemporaryPassword("");

    try {
      const response = await fetch(`${apiBase}/api/portal-access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          actorMemberId,
          adminPassword,
          memberId: selectedMember.id,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || "Reset impossible.");
      }

      setSelectedMember(payload.member || selectedMember);
      setTemporaryPassword(payload.temporaryPassword || "");
      setSuccessMessage(t("playerAccess.resetSuccess", "Mot de passe temporaire genere. Le joueur devra le changer a la prochaine connexion."));
    } catch (error) {
      setErrorMessage(error.message || t("playerAccess.resetError", "Reset impossible."));
    } finally {
      setResetting(false);
    }
  }

  if (!isAdminUser) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-xl font-semibold text-zinc-50">{t("playerAccess.title", "Acces joueurs")}</h2>
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {t("common.adminReserved", "Reserve aux administrateurs.")}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-zinc-50">{t("playerAccess.title", "Acces joueurs")}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {t("playerAccess.description", "Recherche joueur, identifiant et reset temporaire.")}
            </p>
          </div>
          <Badge className="rounded-md border-amber-500/30 bg-amber-500/10 text-amber-200">Admin</Badge>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="player-access-search">
                {t("common.player", "Joueur")}
              </label>
              <div className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2">
                <Search className="h-4 w-4 text-zinc-500" />
                <input
                  id="player-access-search"
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelectedMember(null);
                    setSuccessMessage("");
                  }}
                  className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
                  placeholder={t("playerAccess.searchPlaceholder", "Nom ou identifiant")}
                  autoComplete="off"
                />
              </div>

              <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
                {loadingMembers ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-500">
                    {t("common.loading", "Chargement...")}
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-500">
                    {query.trim().length < 2 ? t("common.typeAtLeast2", "Tape au moins 2 lettres.") : t("common.noPlayerFound", "Aucun joueur trouve.")}
                  </div>
                ) : (
                  suggestions.map((member) => {
                    const selected = String(member.id) === String(selectedMember?.id);

                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => {
                          setSelectedMember(member);
                          setQuery(member.name);
                          setTemporaryPassword("");
                          setSuccessMessage("");
                        }}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                          selected
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
                            : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:border-zinc-700"
                        }`}
                      >
                        <span className="block truncate text-sm font-semibold">{member.name}</span>
                        <span className="mt-0.5 block truncate text-xs text-zinc-500">
                          {member.guildCode || "Cluster"} {member.discordId ? `- ${member.discordId}` : ""}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/70 p-4">
            {!selectedMember ? (
              <div className="flex h-full min-h-64 items-center justify-center text-sm text-zinc-500">
                {t("playerAccess.selectPlayer", "Selectionne un joueur.")}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t("home.profile", "Profil")}</div>
                    <div className="mt-1 text-2xl font-semibold text-zinc-50">{selectedMember.name}</div>
                    <div className="mt-1 text-sm text-zinc-500">
                      {selectedMember.guildCode || t("common.cluster", "Cluster")} - {selectedMember.role || t("common.player", "Joueur")}
                    </div>
                  </div>
                  <Badge className="rounded-md border-zinc-700 bg-zinc-950 text-zinc-300">
                    {selectedMember.role || "Joueur"}
                  </Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t("playerAccess.identifier", "Identifiant")}</div>
                    <div className="mt-2 break-all text-lg font-semibold text-zinc-50">
                      {selectedMember.discordId || "-"}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                      onClick={() => copyValue(selectedMember.discordId, "login")}
                      disabled={!selectedMember.discordId}
                    >
                      {copiedField === "login" ? t("common.copied", "Copie") : t("common.copy", "Copier")}
                    </Button>
                  </div>

                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">{t("playerAccess.temporaryPassword", "Mot de passe temporaire")}</div>
                    <div className="mt-2 break-all text-lg font-semibold text-zinc-50">
                      {temporaryPassword || "-"}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
                      onClick={() => copyValue(temporaryPassword, "password")}
                      disabled={!temporaryPassword}
                    >
                      {copiedField === "password" ? t("common.copied", "Copie") : t("common.copy", "Copier")}
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="player-access-password">
                    {t("playerAccess.adminConfirmation", "Confirmation admin")}
                  </label>
                  <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                    <input
                      id="player-access-password"
                      type="password"
                      value={adminPassword}
                      onChange={(event) => setAdminPassword(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
                      placeholder={t("playerAccess.yourPassword", "Ton mot de passe")}
                      autoComplete="current-password"
                    />
                    <Button
                      type="button"
                      className="rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
                      onClick={resetPassword}
                      disabled={resetting || !adminPassword.trim() || selectedMemberIsProtected}
                    >
                      {resetting ? t("playerAccess.generating", "Generation...") : t("playerAccess.generate", "Generer")}
                    </Button>
                  </div>
                </div>
                {selectedMemberIsProtected ? (
                  <div className="text-sm text-amber-300">{t("playerAccess.protectedAdmin", "Compte admin protege.")}</div>
                ) : null}
              </div>
            )}
          </div>
        </div>

        {errorMessage ? (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {errorMessage}
          </div>
        ) : null}
        {successMessage ? (
          <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {successMessage}
          </div>
        ) : null}
      </div>
    </section>
  );
}

const logActionFilters = [
  { id: "all", label: "Tout", labelKey: "common.all" },
  { id: "hero_box_update", label: "Box heros", labelKey: "logs.filter.heroBox" },
  { id: "hero_box_bulk_a5", label: "Box A5", labelKey: "logs.filter.heroBoxA5" },
  { id: "pb_update", label: "PB" },
  { id: "pb_hero_update", label: "Heros PB", labelKey: "logs.filter.pbHeroes" },
  { id: "demon_monster_update", label: "Monstres", labelKey: "logs.filter.monsters" },
  { id: "soul_stone_add", label: "Pierres +", labelKey: "logs.filter.stonesAdd" },
  { id: "soul_stone_remove", label: "Pierres -", labelKey: "logs.filter.stonesRemove" },
  { id: "defense_assign", label: "Defense +", labelKey: "logs.filter.defenseAdd" },
  { id: "defense_unassign", label: "Defense -", labelKey: "logs.filter.defenseRemove" },
  { id: "gvg_launcher_start", label: "GVG" },
  { id: "gvg_validation_import", label: "Import GVG", labelKey: "logs.filter.gvgImport" },
  { id: "gvg_job_delete", label: "Jobs GVG", labelKey: "logs.filter.gvgJobs" },
  { id: "player_password_reset", label: "Acces joueurs", labelKey: "logs.filter.playerAccess" },
  { id: "player_password_change", label: "Mot de passe", labelKey: "logs.filter.password" },
  { id: "portal_tab_view", label: "Vues", labelKey: "logs.filter.views" },
];

function formatLogDate(value) {
  if (!value) return "-";

  return new Date(value).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const logActionLabelKeys = {
  hero_box_update: ["logs.action.heroBoxUpdate", "Mise a jour box"],
  hero_box_bulk_a5: ["logs.action.heroBoxBulkA5", "Box A5"],
  pb_update: ["logs.action.pbUpdate", "Mise a jour PB"],
  pb_hero_update: ["logs.action.pbHeroUpdate", "Heros PB"],
  demon_monster_update: ["logs.action.demonMonsterUpdate", "Monstre demoniaque"],
  soul_stone_add: ["logs.action.soulStoneAdd", "Pierre ajoutee"],
  soul_stone_remove: ["logs.action.soulStoneRemove", "Pierre retiree"],
  defense_assign: ["logs.action.defenseAssign", "Defense affectee"],
  defense_unassign: ["logs.action.defenseUnassign", "Defense retiree"],
  guild_management_defense_assign: ["logs.action.guildDefenseAssign", "Defense affectee"],
  guild_management_defense_unassign: ["logs.action.guildDefenseUnassign", "Defense retiree"],
  guild_management_assignment_update: ["logs.action.guildAssignmentUpdate", "Role defense"],
  guild_management_status_update: ["logs.action.guildStatusUpdate", "Statut defense"],
  guild_management_member_transfer: ["logs.action.guildMemberTransfer", "Transfert membre"],
  guild_management_member_attach: ["logs.action.guildMemberAttach", "Membre rattache"],
  guild_management_member_create: ["logs.action.guildMemberCreate", "Membre ajoute"],
  guild_management_member_delete: ["logs.action.guildMemberDelete", "Membre supprime"],
  gvg_launcher_start: ["logs.action.gvgLauncherStart", "Capture GVG"],
  gvg_validation_import: ["logs.action.gvgValidationImport", "Import GVG"],
  gvg_job_delete: ["logs.action.gvgJobDelete", "Job GVG supprime"],
  player_password_reset: ["logs.action.playerPasswordReset", "Acces joueur"],
  player_password_change: ["logs.action.playerPasswordChange", "Mot de passe"],
  portal_tab_view: ["logs.action.portalTabView", "Onglet ouvert"],
  admin_defense_create: ["logs.action.adminDefenseCreate", "Defense creee"],
  admin_defense_update: ["logs.action.adminDefenseUpdate", "Defense modifiee"],
  admin_defense_condition_add: ["logs.action.adminDefenseConditionAdd", "Condition ajoutee"],
  admin_defense_local_hide: ["logs.action.adminDefenseLocalHide", "Defense masquee"],
  admin_defense_delete: ["logs.action.adminDefenseDelete", "Defense supprimee"],
  guild_external_create: ["logs.action.guildExternalCreate", "Guilde externe"],
  guild_member_create: ["logs.action.guildMemberCreate", "Membre ajoute"],
  intersaison_campaign_create: ["logs.action.intersaisonCampaignCreate", "Campagne intersaison"],
  intersaison_campaign_cancel: ["logs.action.intersaisonCampaignCancel", "Campagne annulee"],
  intersaison_transfers_apply: ["logs.action.intersaisonTransfersApply", "Transferts intersaison"],
};

const logEntityLabelKeys = {
  tab: ["logs.entity.tab", "Onglet"],
  champion: ["logs.entity.champion", "Heros"],
  pb: ["logs.entity.pb", "PB"],
  demonic_monster: ["logs.entity.demonicMonster", "Monstre"],
  soul_stone: ["logs.entity.soulStone", "Pierre"],
  defense: ["logs.entity.defense", "Defense"],
  gvg: ["logs.entity.gvg", "GVG"],
  member: ["logs.entity.member", "Membre"],
  guild: ["logs.entity.guild", "Guilde"],
  guild_members: ["logs.entity.guildMembers", "Joueurs"],
};

function getLogMetadata(log) {
  if (!log?.metadata) return {};
  if (typeof log.metadata === "object") return log.metadata;

  try {
    return JSON.parse(log.metadata);
  } catch {
    return {};
  }
}

function formatLogTemplate(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(new RegExp(`\\{${key}\\}`, "g"), value ?? ""),
    template,
  );
}

function translateLogTemplate(t, key, fallback, values = {}) {
  return formatLogTemplate(t(key, fallback), values);
}

function getLogTargetName(log, t) {
  return log?.target_name || log?.actor_name || t("logs.system", "Systeme");
}

function getLogActorName(log, t) {
  return log?.actor_name || t("logs.system", "Systeme");
}

function getLogTabLabel(log, t) {
  const metadata = getLogMetadata(log);
  const tabId = metadata.tab || log?.entity_id || "";
  const tabItem = [...navigation, ...adminNavigation].find((item) => item.id === tabId);

  if (tabItem) return t(tabItem.labelKey, tabItem.label);
  return metadata.title || tabId || t("logs.entity.tab", "Onglet");
}

function getLogDisplaySummary(log, t) {
  const metadata = getLogMetadata(log);
  const actor = getLogActorName(log, t);
  const target = getLogTargetName(log, t);

  switch (log?.action_type) {
    case "portal_tab_view":
      return translateLogTemplate(t, "logs.event.portalTabView", "{actor} a ouvert {tab}", {
        actor,
        tab: getLogTabLabel(log, t),
      });
    case "hero_box_update":
      return translateLogTemplate(t, "logs.event.heroBoxUpdate", "{target} a mis a jour {hero} : A{from} -> A{to}", {
        target,
        hero: metadata.heroDisplayName || metadata.heroName || t("logs.entity.champion", "Heros"),
        from: metadata.previousAwakening ?? "-",
        to: metadata.nextAwakening ?? "-",
      });
    case "hero_box_bulk_a5":
      return translateLogTemplate(t, "logs.event.heroBoxBulkA5", "{target} a passe {count} heros {rarity} en A5", {
        target,
        count: metadata.count ?? "-",
        rarity: metadata.rarity || "",
      });
    case "pb_hero_update":
      return translateLogTemplate(t, "logs.event.pbHeroUpdate", "{target} a change le heros PB {slot} : {from} -> {to}", {
        target,
        slot: metadata.slotIndex ?? "-",
        from: metadata.previousHeroName || "-",
        to: metadata.nextHeroDisplayName || metadata.nextHeroName || "-",
      });
    case "pb_update":
      return translateLogTemplate(t, "logs.event.pbUpdate", "{target} a mis a jour le PB {slot}", {
        target,
        slot: metadata.slotIndex ?? "-",
      });
    case "demon_monster_update":
      return translateLogTemplate(t, "logs.event.demonMonsterUpdate", "{target} a mis a jour {monster} : niveau {from} -> {to}", {
        target,
        monster: metadata.monsterName || t("logs.entity.demonicMonster", "Monstre"),
        from: metadata.previousLevel ?? "-",
        to: metadata.nextLevel ?? "-",
      });
    case "soul_stone_add":
      return translateLogTemplate(t, "logs.event.soulStoneAdd", "{target} a ajoute une pierre {type}", {
        target,
        type: metadata.type || "",
      });
    case "soul_stone_remove":
      return translateLogTemplate(t, "logs.event.soulStoneRemove", "{target} a retire une pierre {type}", {
        target,
        type: metadata.type || "",
      });
    case "defense_assign":
    case "guild_management_defense_assign":
      return translateLogTemplate(t, "logs.event.defenseAssign", "{target} a recu la defense {slot} : {defense}", {
        target,
        slot: metadata.slot ?? "-",
        defense: metadata.defenseName || "-",
      });
    case "defense_unassign":
    case "guild_management_defense_unassign":
      return translateLogTemplate(t, "logs.event.defenseUnassign", "{target} a retire la defense {slot}", {
        target,
        slot: metadata.slot ?? "-",
      });
    case "gvg_launcher_start":
      return translateLogTemplate(t, "logs.event.gvgLauncherStart", "{actor} a lance une capture GVG {guild} ({side})", {
        actor,
        guild: metadata.guild || "-",
        side: metadata.side || "-",
      });
    case "gvg_validation_import":
      return translateLogTemplate(t, "logs.event.gvgValidationImport", "{actor} a importe {count} defenses GVG dans {guild}", {
        actor,
        count: metadata.inserted ?? "-",
        guild: metadata.guild || "-",
      });
    case "gvg_job_delete":
      return translateLogTemplate(t, "logs.event.gvgJobDelete", "{actor} a supprime un job GVG {guild} / {job}", {
        actor,
        guild: metadata.sourceGuild || "-",
        job: metadata.jobId || log?.entity_id || "-",
      });
    case "player_password_reset":
      return translateLogTemplate(t, "logs.event.playerPasswordReset", "{actor} a genere un mot de passe temporaire pour {target}", {
        actor,
        target,
      });
    case "player_password_change":
      return translateLogTemplate(t, "logs.event.playerPasswordChange", "{actor} a change son mot de passe", { actor });
    case "guild_management_member_delete":
      return translateLogTemplate(t, "logs.event.guildMemberDelete", "{actor} a supprime {target} de {guild}", {
        actor,
        target,
        guild: metadata.guildCode || "-",
      });
    default:
      return log?.summary || t("logs.event.unknown", "Evenement");
  }
}

function getLogActionLabel(actionType, t) {
  const [key, fallback] = logActionLabelKeys[actionType] || [];
  return key ? t(key, fallback) : actionType || t("logs.event.unknown", "Evenement");
}

function getLogEntityLabel(entityType, t) {
  const [key, fallback] = logEntityLabelKeys[entityType] || [];
  return key ? t(key, fallback) : entityType;
}

function LogsView({ session }) {
  const { t } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const [members, setMembers] = useState([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState(session?.memberId || session?.id || "");
  const [actionFilter, setActionFilter] = useState("all");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const selectedMember = useMemo(
    () => members.find((member) => String(member.id) === String(selectedMemberId)) || null,
    [members, selectedMemberId],
  );

  const memberSuggestions = useMemo(() => {
    const search = normalizeHeroKey(memberQuery);

    return members
      .filter((member) => {
        if (!search) return true;
        return normalizeHeroKey(`${getMemberDisplayName(member)} ${getMemberGuildLabel(member)} ${member.discord_id || ""}`).includes(search);
      })
      .slice(0, 10);
  }, [memberQuery, members]);

  useEffect(() => {
    let cancelled = false;

    async function loadMembers() {
      const { data, error } = await supabase
        .from("guild_members")
        .select("id, role, discord_id, watcher_name, guild_code")
        .order("watcher_name", { ascending: true });

      if (cancelled) return;

      if (error) {
        setErrorMessage(error.message || t("playerAccess.loadPlayersError", "Impossible de charger les joueurs."));
        return;
      }

      const nextMembers = filterByGuildScope(data || [], session, (member) => member.guild_code, {
        leaderSeesAll: true,
      });
      setMembers(nextMembers);
      setSelectedMemberId((current) => {
        if (current && nextMembers.some((member) => String(member.id) === String(current))) return current;
        const connectedId = session?.memberId || session?.id || "";
        const connected = nextMembers.find((member) => String(member.id) === String(connectedId));
        return connected?.id || nextMembers[0]?.id || "";
      });
    }

    loadMembers();

    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    let cancelled = false;

    async function loadLogs() {
      setLoading(true);
      setErrorMessage("");

      const params = new URLSearchParams();
      if (selectedMemberId) params.set("memberId", selectedMemberId);
      if (actionFilter !== "all") params.set("actionType", actionFilter);
      params.set("limit", "120");

      try {
        const response = await fetch(`${apiBase}/api/portal-activity?${params.toString()}`);
        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(data?.error || t("logs.loadError", "Impossible de charger les logs."));
        }

        if (!cancelled) setLogs(data?.logs || []);
      } catch (error) {
        if (!cancelled) {
          setLogs([]);
          setErrorMessage(error?.message || t("logs.loadError", "Impossible de charger les logs."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadLogs();

    return () => {
      cancelled = true;
    };
  }, [actionFilter, apiBase, selectedMemberId]);

  return (
    <section className="space-y-5">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-500">{t("logs.eyebrow", "Journal d'activite")}</div>
            <h2 className="mt-2 text-2xl font-semibold text-zinc-50">{t("logs.title", "Logs joueur")}</h2>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">
              {t("logs.description", "Recherche un joueur pour voir ses dernieres actions Portal : box, PB, monstres, pierres, defenses et GVG.")}
            </p>
          </div>

          <Badge className="w-fit rounded-lg border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            {logs.length} {t("logs.events", "evenement(s)")}
          </Badge>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(280px,420px)_1fr]">
          <div>
            <label className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500" htmlFor="log-member-search">
              {t("common.player", "Joueur")}
            </label>
            <div className="mt-2 flex h-11 items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 ring-emerald-400/20 transition focus-within:border-emerald-400/60 focus-within:ring-2">
              <Search className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                id="log-member-search"
                type="search"
                value={memberQuery}
                onChange={(event) => setMemberQuery(event.target.value)}
                placeholder={t("logs.searchPlayer", "Taper un nom de joueur")}
                className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
              />
            </div>

            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/80 p-2">
              {memberSuggestions.length === 0 ? (
                <div className="px-3 py-2 text-sm text-zinc-500">{t("common.noPlayerFound", "Aucun joueur trouve.")}</div>
              ) : (
                memberSuggestions.map((member) => {
                  const selected = String(member.id) === String(selectedMemberId);

                  return (
                    <button
                      key={member.id}
                      type="button"
                      onClick={() => {
                        setSelectedMemberId(member.id);
                        setMemberQuery(getMemberDisplayName(member));
                      }}
                      className={`w-full rounded-md border px-3 py-2 text-left transition ${
                        selected
                          ? "border-emerald-300/55 bg-emerald-500/10 text-white"
                          : "border-transparent bg-zinc-900/70 text-zinc-300 hover:border-emerald-400/35 hover:bg-zinc-900"
                      }`}
                    >
                      <span className="block truncate text-sm font-semibold">{getMemberDisplayName(member)}</span>
                      <span className="mt-0.5 block truncate text-xs text-zinc-500">{getMemberGuildLabel(member)}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{t("logs.actionType", "Type d'action")}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {logActionFilters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setActionFilter(filter.id)}
                  className={`rounded-lg px-3 py-2 text-sm transition ${
                    actionFilter === filter.id
                      ? "bg-zinc-100 text-zinc-950"
                      : "border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
                  }`}
                >
                  {t(filter.labelKey || `logs.filter.${filter.id}`, filter.label)}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-400">
              {t("logs.viewedProfile", "Profil consulte")} :{" "}
              <span className="font-semibold text-zinc-100">
                {selectedMember ? getMemberDisplayName(selectedMember) : t("common.noPlayer", "Aucun joueur")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
        {loading ? (
          <div className="text-sm text-zinc-500">{t("logs.loading", "Chargement des logs...")}</div>
        ) : logs.length === 0 ? (
          <div className="text-sm text-zinc-500">{t("logs.noLog", "Aucun log trouve pour ce filtre.")}</div>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <article key={log.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-zinc-50">{getLogDisplaySummary(log, t)}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {t("logs.actor", "Acteur")} : {log.actor_name || t("logs.system", "Systeme")}
                      {log.target_name ? ` - ${t("logs.target", "Cible")} : ${log.target_name}` : ""}
                    </div>
                  </div>
                  <div className="text-right text-xs text-zinc-500">{formatLogDate(log.created_at)}</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge className="rounded-md border-zinc-700 bg-zinc-950 text-zinc-300" title={log.action_type}>
                    {getLogActionLabel(log.action_type, t)}
                  </Badge>
                  {log.entity_type ? (
                    <Badge className="rounded-md border-zinc-700 bg-zinc-950 text-zinc-400" title={log.entity_type}>
                      {getLogEntityLabel(log.entity_type, t)}
                    </Badge>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function SettingsView({ session, onLogout }) {
  const { t } = usePortalLanguage();

  return (
    <section className="space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-xl font-semibold text-zinc-50">{t("settings.title", "Parametres")}</h2>
        <p className="mt-2 text-sm text-zinc-500">{t("settings.description", "Gestion de la session Portal.")}</p>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-500">{t("settings.connectedAccount", "Compte connecte")}</div>
            <div className="mt-2 text-lg font-semibold text-zinc-50">{session?.watcherName || session?.name || t("common.player", "Joueur")}</div>
            <div className="mt-1 text-sm text-zinc-500">
              {session?.role || t("common.member", "Membre")} {session?.guildCode ? `- ${session.guildCode}` : ""}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={onLogout}
            className="w-full rounded-lg border-red-500/35 bg-red-500/10 text-red-100 hover:bg-red-500/20 md:w-auto"
          >
            <LogOut className="mr-2 h-4 w-4" />
            {t("settings.logoutAction", "Se deconnecter")}
          </Button>
        </div>
      </div>
    </section>
  );
}

export default function SaasPortal() {
  return (
    <PortalLanguageProvider>
      <SaasPortalContent />
    </PortalLanguageProvider>
  );
}

function SaasPortalContent() {
  const [session, setSession] = useState(() => readStoredPortalSession());

  useEffect(() => {
    const memberId = session?.memberId || session?.id || null;
    const discordId = session?.discordId || session?.discord_id || null;

    if (!memberId && !discordId) return undefined;

    let cancelled = false;

    async function refreshStoredSessionRole() {
      try {
        let query = supabase
          .from("guild_members")
          .select("id, role, discord_id, watcher_name, guild_code, community_access_type, community_status, preferred_language");

        query = memberId ? query.eq("id", memberId) : query.eq("discord_id", discordId);

        const { data, error } = await query.maybeSingle();

        if (cancelled) return;

        if (error) {
          console.warn("[portal-session-refresh]", error);
          return;
        }

        if (!data) return;

        setSession((current) => {
          const currentMemberId = current?.memberId || current?.id || null;
          const currentDiscordId = current?.discordId || current?.discord_id || null;

          if (memberId && String(currentMemberId) !== String(memberId)) return current;
          if (!memberId && discordId && String(currentDiscordId) !== String(discordId)) return current;

          return refreshPortalSessionStorage(
            buildPortalSession({
              ...data,
              password_change_required: Boolean(current?.passwordChangeRequired),
            }),
          );
        });
      } catch (error) {
        if (!cancelled) console.warn("[portal-session-refresh]", error);
      }
    }

    void refreshStoredSessionRole();

    return () => {
      cancelled = true;
    };
  }, [session?.memberId, session?.id, session?.discordId, session?.discord_id]);

  function handleLogin(nextSession, options = {}) {
    persistPortalSession(nextSession, Boolean(options.remember));
    setSession(nextSession);
  }

  function handlePasswordChanged() {
    setSession((current) => {
      const nextSession = { ...(current || {}), passwordChangeRequired: false };
      replaceStoredPortalSession(nextSession);
      return nextSession;
    });
  }

  function handleLogout() {
    clearPortalSession();
    setSession(null);
  }

  if (!session) {
    return <LoginPanel onLogin={handleLogin} />;
  }

  if (session.passwordChangeRequired) {
    return (
      <PasswordChangeRequiredView
        session={session}
        onPasswordChanged={handlePasswordChanged}
        onLogout={handleLogout}
      />
    );
  }

  return <PortalShell session={session} onLogout={handleLogout} />;
}
