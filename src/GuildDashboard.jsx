import React, { useEffect, useMemo, useState } from "react";
import GestionDefenseTab from "./components/GestionDefenseTab";
import AdminDefensesTab from "@/components/AdminDefensesTab";
import MonSuiviTab from "./components/MonSuiviTab";
import { supabase } from "@/lib/supabase";
import { DndContext, closestCenter } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import GvgCurrentTab from "@/components/GvgCurrentTab";
import GvgAdminTab from "@/components/GvgAdminTab";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import LoginScreen from "./components/LoginScreen";
import RunSearchGrid from "./components/RunSearchGrid";
import RunAddTab from "@/components/RunAddTab";
import RunEditTab from "@/components/RunEditTab";
import GvgPanelTab from "@/components/GvgPanelTab";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Search,
  Pencil,
  Trash2,
  Plus,
  Shield,
  Users,
  AlertTriangle,
  CheckCircle2,
  Upload,
  ImagePlus,
  Send,
  UserPlus,
  X,
  Star,
  ArrowRightLeft,
} from "lucide-react";

const allHeroesSeed = [
  "Aracha",
  "Lucius",
  "Valeriya",
  "Hex",
  "Aolmond",
  "Silas",
  "Khamet",
  "Hollow",
];

const metaHeroesSeed = [
  "Aracha",
  "Lucius",
  "Valeriya",
  "Hex",
  "Aolmond",
  "Silas",
  "Khamet",
  "Hollow",
];

function buildDefaultAwakenings(metaHeroes) {
  return Object.fromEntries(metaHeroes.map((hero) => [hero, -1]));
}

const heroFaction = [
  "nordiste",
  "cauchemar",
  "sentinelle",
  "esoterique",
  "perceur",
  "chaotique",
  "cultiste",
  "infernal",
  "innommable",
  "arbitre",
];

const membersSeed = [
  {
    id: 1,
    name: "Darius",
    discordId: "259417928569585665",
    assignment: "Tour",
    status: "Actif",
    defense1: "Meta nord",
    defense2: "Anti burst",
    awakenings: {
      ...buildDefaultAwakenings(metaHeroesSeed),
      Aracha: 5,
      Lucius: 3,
      Valeriya: 0,
      Hex: 4,
      Aolmond: 5,
      Silas: 2,
      Hollow: 1,
    },
  },
  {
    id: 2,
    name: "Thanatos",
    discordId: "184726351998001152",
    assignment: "Bastion",
    status: "Actif",
    defense1: "Meta contrôle",
    defense2: "Secondaire tank",
    awakenings: {
      ...buildDefaultAwakenings(metaHeroesSeed),
      Aracha: 4,
      Lucius: 5,
      Valeriya: 2,
      Hex: 5,
      Aolmond: 4,
      Silas: 4,
      Khamet: 3,
      Hollow: 0,
    },
  },
  {
    id: 3,
    name: "Mira",
    discordId: "301998112334455667",
    assignment: "Tour",
    status: "À vérifier",
    defense1: "—",
    defense2: "—",
    awakenings: {
      ...buildDefaultAwakenings(metaHeroesSeed),
      Lucius: 1,
      Hex: 2,
      Aolmond: 1,
      Hollow: 0,
    },
  },
];

const defensesSeed = [
  {
    id: 1,
    name: "Meta nord",
    tier: "Meta",
    type: "Tour",
    slots: ["Aracha", "Lucius", "Hex", "Aolmond", "Silas"],
    conditions: ["Aracha A5", "Hex A4 minimum"],
    image:
      "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80",
    usageCount: 7,
  },
  {
    id: 2,
    name: "Anti burst",
    tier: "Secondaire",
    type: "Bastion",
    slots: ["Valeriya", "Lucius", "Hollow", "Aracha", "Hex"],
    conditions: ["Lucius possédé"],
    image:
      "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&w=1200&q=80",
    usageCount: 4,
  },
  {
    id: 3,
    name: "Meta contrôle",
    tier: "Meta",
    type: "Tour",
    slots: ["Hex", "Aolmond", "Khamet", "Silas", "Lucius"],
    conditions: ["Hex A5", "Khamet A3 minimum"],
    image:
      "https://images.unsplash.com/photo-1560253023-3ec5d502959f?auto=format&fit=crop&w=1200&q=80",
    usageCount: 2,
  },
];

function awakeningLabel(value) {
  return value === -1 ? "✖" : String(value);
}

function awakeningTone(value) {
  if (value === -1) return "bg-red-500/20 text-red-300 border-red-500/40";
  return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
}

function getMemberDefenseCompletion(member, defense) {
  if (!defense) return 0;

  const missingHeroes = (defense.slots || []).filter(
    (hero) => (member.awakenings?.[hero] ?? -1) < 0
  );

  if (missingHeroes.length > 0) {
    return 0;
  }

  const unmetConditions = getDefenseConditionRequirements(defense).filter(
    (requirement) =>
      (member.awakenings?.[requirement.hero] ?? -1) < requirement.minAwakening
  );

  if (unmetConditions.length > 0) {
    return 50;
  }

  return 100;
}

function getMemberTrackedDefenseScore(member, defense) {
  if (!member || !defense) return null;

  const completion = getMemberDefenseCompletion(member, defense);

  if (completion === 0) {
    return null;
  }

  return getDefenseAwakeningScore(member, defense);
}

function getDefenseAwakeningScore(member, defense) {
  if (!member || !defense) return 0;

  return (defense.slots || []).reduce((total, hero) => {
    const value = member.awakenings?.[hero] ?? -1;

    // héros absent = 0 point
    if (value < 0) return total;

    // héros présent = on ajoute son éveil réel
    return total + value;
  }, 0);
}

function buildDiscordMessage(member, profileLink) {
  return [
    `Bonjour ${member.name},`,
    "",
    "Merci de renseigner les éveils de tes héros méta via ton profil personnel :",
    profileLink,
    "",
    `ID Discord enregistré : ${member.discordId}`,
    member.personalForumPostUrl
      ? `Post forum personnel : ${member.personalForumPostUrl}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDefenseCounterLabel(index) {
  return `Def méta ${index + 1}`;
}

function getMetaDefenseCounters(defenses, members, metaFilter = "all") {
  const usageMap = new Map();

  (members || []).forEach((member) => {
    const assigned = [...new Set([member.defense1, member.defense2])].filter(
      (name) => name && name !== "—"
    );

    assigned.forEach((name) => {
      usageMap.set(name, (usageMap.get(name) || 0) + 1);
    });
  });

  return defenses
    .filter((defense) => {
      const tier = normalizeDefenseTier(defense.tier);

      if (metaFilter === "meta_s") return tier === "meta_s";
      if (metaFilter === "meta_a") return tier === "meta_a";

      return tier === "meta_s" || tier === "meta_a";
    })
    .sort((a, b) => a.id - b.id)
    .map((defense, index) => ({
      id: defense.id,
      label: formatDefenseCounterLabel(index),
      name: defense.name,
      count: usageMap.get(defense.name) || 0,
      tier: normalizeDefenseTier(defense.tier),
    }));
}

function getDefenseConditionRequirements(defense) {
  return (defense.conditions || [])
    .map((condition) => {
      if (typeof condition === "object" && condition !== null) {
        return {
          hero: condition.label?.match(/^(.+?) A(\d) minimum$/)?.[1] || "",
          minAwakening: Number(condition.minAwakening ?? 0),
        };
      }

      const match = String(condition).match(/^(.+?) A(\d) minimum$/);
      if (!match) return null;

      return {
        hero: match[1],
        minAwakening: Number(match[2]),
      };
    })
    .filter((condition) => condition && condition.hero);
}

function analyzeDefenseCompatibility(member, defense) {
  const missingHeroes = (defense.slots || []).filter(
    (hero) => (member.awakenings?.[hero] ?? -1) < 0
  );

  const unmetConditions = getDefenseConditionRequirements(defense).filter(
    (requirement) => (member.awakenings?.[requirement.hero] ?? -1) < requirement.minAwakening
  );

  return {
    isCompatible: missingHeroes.length === 0 && unmetConditions.length === 0,
    missingHeroes,
    unmetConditions,
  };
}

function getAssignedDefenseTone(defense, member) {
  if (!defense) {
    return {
      card: "border-zinc-800 bg-zinc-950",
      badge: "rounded-xl bg-zinc-800 text-zinc-300",
      label: "Aucune",
    };
  }

  const analysis = analyzeDefenseCompatibility(member, defense);

  if (defense.tier === "Secondaire") {
    return {
      card: "border-zinc-700 bg-zinc-900",
      badge: "rounded-xl bg-zinc-700 text-zinc-200",
      label: "Secondaire",
    };
  }

  if (defense.tier === "Meta" && analysis.isCompatible) {
    return {
      card: "border-emerald-500/30 bg-emerald-500/10",
      badge: "rounded-xl bg-emerald-500/15 text-emerald-300",
      label: "Meta",
    };
  }

  return {
    card: "border-red-500/30 bg-red-500/10",
    badge: "rounded-xl bg-red-500/15 text-red-300",
    label: "Meta incompatible",
  };
}

function getDefenseConflict(defenseA, defenseB) {
  if (!defenseA || !defenseB) return [];

  const slotsA = defenseA.slots || [];
  const slotsB = defenseB.slots || [];

  return [...new Set(slotsA.filter((hero) => slotsB.includes(hero)))];
}

function getDefenseRootId(defense) {
  return defense?.sourceDefenseId || defense?.id || null;
}

function canShowDefenseForMember(defense, assignedDefense1, assignedDefense2) {
  if (!defense) return false;

  // On laisse visibles les défenses déjà assignées
  if (assignedDefense1?.name === defense.name || assignedDefense2?.name === defense.name) {
    return true;
  }

  const conflictsWithDef1 = getDefenseConflict(defense, assignedDefense1);
  if (conflictsWithDef1.length > 0) return false;

  const conflictsWithDef2 = getDefenseConflict(defense, assignedDefense2);
  if (conflictsWithDef2.length > 0) return false;

  return true;
}

function runSanityChecks() {
  console.assert(awakeningLabel(-1) === "✖", "awakeningLabel should return ✖ for missing hero");
  console.assert(awakeningLabel(3) === "3", "awakeningLabel should stringify awakening values");
console.assert(
  getMemberDefenseCompletion(
    {
      id: 999,
      name: "Test",
      discordId: "1",
      assignment: "Tour",
      status: "Actif",
      defense1: "—",
      defense2: "—",
      awakenings: { Aracha: -1, Lucius: 2 },
    },
    {
      id: 1,
      name: "Test defense",
      slots: ["Aracha", "Lucius"],
      conditions: [],
    }
  ) === 0,
  "getMemberDefenseCompletion should return 0 if a hero is missing"
);

console.assert(
  getMemberDefenseCompletion(
    {
      id: 1000,
      name: "Test 2",
      discordId: "2",
      assignment: "Tour",
      status: "Actif",
      defense1: "—",
      defense2: "—",
      awakenings: { Aracha: 4, Lucius: 0 },
    },
    {
      id: 2,
      name: "Defense with condition",
      slots: ["Aracha", "Lucius"],
      conditions: ["Aracha A5 minimum"],
    }
  ) === 50,
  "getMemberDefenseCompletion should return 50 if heroes exist but awakening is insufficient"
);


console.assert(
  getMemberDefenseCompletion(
    {
      id: 1001,
      name: "Test 3",
      discordId: "3",
      assignment: "Tour",
      status: "Actif",
      defense1: "—",
      defense2: "—",
      awakenings: { Aracha: 5, Lucius: 2 },
    },
    {
      id: 3,
      name: "Compatible defense",
      slots: ["Aracha", "Lucius"],
      conditions: ["Aracha A5 minimum"],
    }
  ) === 100,
  "getMemberDefenseCompletion should return 100 if defense is fully playable"
);

  console.assert(
    buildDefaultAwakenings(["Aracha", "Lucius"]).Lucius === -1,
    "buildDefaultAwakenings should default heroes to -1"
  );
  const msg = buildDiscordMessage(
    {
      id: 1,
      name: "Darius",
      discordId: "123",
      assignment: "Tour",
      status: "Actif",
      defense1: "—",
      defense2: "—",
      awakenings: {},
    },
    "https://guild-box.local/profile/1"
  );
  console.assert(msg.includes("https://guild-box.local/profile/1"), "discord message should include profile link");
const counters = getMetaDefenseCounters(
  [
    { ...defensesSeed[0], tier: "meta_s" },
    { ...defensesSeed[1], tier: "secondaire" },
    { ...defensesSeed[2], tier: "meta_a" },
  ],
  membersSeed
);

console.assert(counters.length === 2, "should expose one counter per meta defense");
console.assert(counters[0]?.label === "Def méta 1", "counter labels should be ordered");
}

runSanityChecks();

function normalizeHeroImageName(heroName) {
  return (heroName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getHeroImageUrl(heroName) {
  return `/heroes/${normalizeHeroImageName(heroName)}.png`;
}

function getDemonicMonsterImageUrl(slug) {
  return `/demonic-monsters/${slug}.png`;
}

const guildCodes = ["G1", "G2", "G3", "G4", "G5", "G6", "G7"];
const defaultPasswords = ["motdepassemembre", "motdepasseadmin"];

function normalizeDefenseTier(tier) {
  const value = String(tier || "").trim().toLowerCase();

  if (value === "meta_s" || value === "meta s") return "meta_s";
  if (value === "meta_a" || value === "meta a") return "meta_a";
  if (value === "meta") return "meta";
  if (value === "secondaire") return "secondaire";

  return value;
}

function SortableDefenseCard({ defense, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: defense.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export default function GuildDashboard() {
function extractGuildCodeFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean).map((part) => part.toUpperCase());

  const guildPart = parts.find((part) => /^G[1-9]\d*$/.test(part));

  return guildPart || "G1";
}

const currentGuildCode = extractGuildCodeFromPath(window.location.pathname);

  const [activeGuildCode, setActiveGuildCode] = useState(currentGuildCode);
  const cacheGuildKey = useMemo(() => {
  const normalized = String(activeGuildCode || "G1").toUpperCase();
  return normalized === "G1" ? "G1" : normalized;
}, [activeGuildCode]);

  const [session, setSession] = useState(() => {
  const raw = localStorage.getItem("guildDashboardSession");
  return raw ? JSON.parse(raw) : null;
});
useEffect(() => {
  setActiveGuildCode(currentGuildCode);
}, [currentGuildCode]);
  const [query, setQuery] = useState("");
  const [memberAssignmentSortMode, setMemberAssignmentSortMode] = useState("alpha");
  const [clusterMemberSearchQuery, setClusterMemberSearchQuery] = useState("");
const [clusterMemberSearchResults, setClusterMemberSearchResults] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [defenses, setDefenses] = useState([]);
  const [allHeroes, setAllHeroes] = useState(allHeroesSeed);
  const [pbEntries, setPbEntries] = useState([]);
  const [allHeroesData, setAllHeroesData] = useState([]);
  const [metaHeroes, setMetaHeroes] = useState([]);
  const [heroesLoading, setHeroesLoading] = useState(true);
  const [heroesError, setHeroesError] = useState("");
  const [metaDialogOpen, setMetaDialogOpen] = useState(false);
  const [heroSearch, setHeroSearch] = useState("");
  const [newDefenseOpen, setNewDefenseOpen] = useState(false);
  const [newMemberOpen, setNewMemberOpen] = useState(false);
  const [newExternalOpen, setNewExternalOpen] = useState(false);
  const [newExternalMember, setNewExternalMember] = useState({
    name: "",
    discordId: "",
  });
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [metaCounterDialogOpen, setMetaCounterDialogOpen] = useState(false);
  const [selectedMetaCounter, setSelectedMetaCounter] = useState(null);
  const [conditionDefenseId, setConditionDefenseId] = useState("");
  const [defenseTypeFilter, setDefenseTypeFilter] = useState("Tous");
  const [awakeningFactionFilter, setAwakeningFactionFilter] = useState("Tous");
  const [awakeningRoleFilter, setAwakeningRoleFilter] = useState("Tous");
  const [selectedMetaDefenseForCompletion, setSelectedMetaDefenseForCompletion] = useState(null);
const [reproHeroes, setReproHeroes] = useState(["", "", "", "", ""]);
const [reproConditions, setReproConditions] = useState([0, 0, 0, 0, 0]);
const [scoreDetailOpen, setScoreDetailOpen] = useState(false);
const [scoreDetailMember, setScoreDetailMember] = useState(null);
const [scoreDetailDefense, setScoreDetailDefense] = useState(null);
const [reproResultOpen, setReproResultOpen] = useState(false);
const [reproMatches, setReproMatches] = useState([]);
  const [editingDefense, setEditingDefense] = useState(null);
  const [sendingDefense, setSendingDefense] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [forumPostUrlInput, setForumPostUrlInput] = useState("");
const [messageDialogState, setMessageDialogState] = useState({
  status: "idle", // idle | loading | success | error
  memberName: "",
  discordId: "",
});
const [activeProfileView, setActiveProfileView] = useState("gestion_guildes");
const [pbSortMode, setPbSortMode] = useState("top3");
const [pbEditDialogOpen, setPbEditDialogOpen] = useState(false);
const [pbHeroSearch, setPbHeroSearch] = useState("");
const [pbSlotToEdit, setPbSlotToEdit] = useState(null);
const [pbRawInput, setPbRawInput] = useState("");
const [pbRowDetailOpen, setPbRowDetailOpen] = useState(false);
const [pbSelectedMember, setPbSelectedMember] = useState(null);
const [forcePasswordDialogOpen, setForcePasswordDialogOpen] = useState(false);
    const [currentPasswordInput, setCurrentPasswordInput] = useState("");
    const [newPasswordInput, setNewPasswordInput] = useState("");
    const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState("");
    const [passwordChangeLoading, setPasswordChangeLoading] = useState(false);
    const [editorBlocks, setEditorBlocks] = useState([]);
  const [editorBlocksLoading, setEditorBlocksLoading] = useState(false);
  const [previewImageOpen, setPreviewImageOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
const [memberToTransfer, setMemberToTransfer] = useState(null);
const [targetGuildCode, setTargetGuildCode] = useState("");
const [deleteDefenseDialogOpen, setDeleteDefenseDialogOpen] = useState(false);
const [defenseToDelete, setDefenseToDelete] = useState(null);
const [deleteDefenseMode, setDeleteDefenseMode] = useState("local");
const [demonicMonsters, setDemonicMonsters] = useState([]);
const [memberDemonicEntries, setMemberDemonicEntries] = useState([]);
const [dashboardCache, setDashboardCache] = useState({});
const [clusterLibraryDefenses, setClusterLibraryDefenses] = useState([]);
const [libraryLoading, setLibraryLoading] = useState(false);
const [clusterDefenseLikes, setClusterDefenseLikes] = useState([]);
const [likesLoading, setLikesLoading] = useState(false);
const [demonRarityFilter, setDemonRarityFilter] = useState("Tous");
const [defenseFactionFilter, setDefenseFactionFilter] = useState("Tous");
const [demonLevelDialogOpen, setDemonLevelDialogOpen] = useState(false);
const [selectedDemonMonster, setSelectedDemonMonster] = useState(null);
const [demonLevelInput, setDemonLevelInput] = useState("");
const [demonLevelSaving, setDemonLevelSaving] = useState(false);
const [soulStones, setSoulStones] = useState([]);
const [soulStonesLoading, setSoulStonesLoading] = useState(false);
const [soulStoneView, setSoulStoneView] = useState("mes-pierres");
const [clusterSoulStoneRows, setClusterSoulStoneRows] = useState([]);
const [clusterSoulStonesLoading, setClusterSoulStonesLoading] = useState(false);
const [intersaisonCampaign, setIntersaisonCampaign] = useState(null);
const [intersaisonDashboards, setIntersaisonDashboards] = useState([]);
const [selectedIntersaisonDashboardId, setSelectedIntersaisonDashboardId] = useState("");
const [intersaisonAssignments, setIntersaisonAssignments] = useState([]);
const [intersaisonSearchQuery, setIntersaisonSearchQuery] = useState("");
const [launchIntersaisonDialogOpen, setLaunchIntersaisonDialogOpen] = useState(false);
const [intersaisonNotes, setIntersaisonNotes] = useState([]);
const [intersaisonNoteDialogOpen, setIntersaisonNoteDialogOpen] = useState(false);
const [selectedIntersaisonNoteRow, setSelectedIntersaisonNoteRow] = useState(null);
const [intersaisonNoteInput, setIntersaisonNoteInput] = useState("");
const [confirmFinalizeIntersaisonDialogOpen, setConfirmFinalizeIntersaisonDialogOpen] = useState(false);
const [intersaisonGuildCountInput, setIntersaisonGuildCountInput] = useState("7");
const [intersaisonLoading, setIntersaisonLoading] = useState(false);
const [intersaisonMoveDialogOpen, setIntersaisonMoveDialogOpen] = useState(false);
const [intersaisonAssignmentToMove, setIntersaisonAssignmentToMove] = useState(null);
const [selectedIntersaisonMoveDashboardId, setSelectedIntersaisonMoveDashboardId] = useState("");
const [intersaisonTransferSummary, setIntersaisonTransferSummary] = useState("");
const [testWishRow, setTestWishRow] = useState(null);
const [testWishInput, setTestWishInput] = useState([]);
const [highlightedIntersaisonRowId, setHighlightedIntersaisonRowId] = useState(null);
const [intersaisonSourceFilter, setIntersaisonSourceFilter] = useState("Tous");
const [intersaisonSourceMenuOpen, setIntersaisonSourceMenuOpen] = useState(false);
const [renameDefenseDialogOpen, setRenameDefenseDialogOpen] = useState(false);
const [renameDefenseTarget, setRenameDefenseTarget] = useState(null);
const [renameDefenseName, setRenameDefenseName] = useState("");
const [renameDefenseFaction, setRenameDefenseFaction] = useState("");
const [metaCounterFilter, setMetaCounterFilter] = useState("all");
const [workspaceTierFilter, setWorkspaceTierFilter] = useState("Tous");
const [compatibleTierFilter, setCompatibleTierFilter] = useState("Tous");
const [conditionDialogOpen, setConditionDialogOpen] = useState(false);


const guildCodes = Array.from(
  { length: intersaisonCampaign?.guild_count || 7 },
  (_, i) => `G${i + 1}`
);

const selectedIntersaisonDashboard = useMemo(() => {
  return (
    intersaisonDashboards.find(
      (dashboard) => String(dashboard.id) === String(selectedIntersaisonDashboardId)
    ) || null
  );
}, [intersaisonDashboards, selectedIntersaisonDashboardId]);

const selectedIntersaisonRows = useMemo(() => {
  if (!selectedIntersaisonDashboardId) return [];

  return intersaisonAssignments
    .filter(
      (assignment) =>
        String(assignment.dashboard_id) === String(selectedIntersaisonDashboardId)
    )
    .filter((assignment) =>
      intersaisonSourceFilter === "Tous"
        ? true
        : assignment.source_guild_code === intersaisonSourceFilter
    );
}, [
  intersaisonAssignments,
  selectedIntersaisonDashboardId,
  intersaisonSourceFilter,
]);

const intersaisonSearchResults = useMemo(() => {
  const q = intersaisonSearchQuery.trim().toLowerCase();

  if (!q) return [];

  return intersaisonAssignments
    .filter((assignment) =>
      String(assignment.watcher_name || "")
        .toLowerCase()
        .includes(q)
    )
    .sort((a, b) =>
      String(a.watcher_name || "").localeCompare(
        String(b.watcher_name || ""),
        "fr",
        { sensitivity: "base" }
      )
    )
    .slice(0, 8);
}, [intersaisonAssignments, intersaisonSearchQuery]);

const memberIdsForGuild = useMemo(() => {
  return members.map((member) => member.id).filter(Boolean);
}, [members]);

  const [newDefense, setNewDefense] = useState({
    id: 0,
    name: "",
    tier: "meta_s",
    type: "Tour",
    faction: "",
    slots: ["", "", "", "", ""],
    conditions: [],
    image: "",
  });

    const [newMember, setNewMember] = useState({
    name: "",
    discordId: "",
    forumPostUrl: "",
    });

  const [newCondition, setNewCondition] = useState({
    defenseId: "",
    hero: "",
    minAwakening: "",
  });

useEffect(() => {
  async function loadMembers() {
    if (metaHeroes.length === 0) return;

    const { data, error } = await supabase
      .from("guild_members")
      .select(`
        *,
        member_awakenings (
          awakening_level,
          champion_id,
          champions (
            name
          )
        )
      `)
      .eq("guild_code", activeGuildCode)
      .order("watcher_name", { ascending: true });

    if (error) {
      console.error("Erreur chargement membres:", error);
      return;
    }

    const mappedMembers = (data || []).map((row) => {
      const awakenings = buildDefaultAwakenings(metaHeroes);

      (row.member_awakenings || []).forEach((entry) => {
        const heroName = entry.champions?.name;
        if (heroName) {
          awakenings[heroName] = entry.awakening_level;
        }
      });

      return {
        id: row.id,
        name: row.watcher_name,
        discordId: row.discord_id,
        password: row.password || "",
        personalForumPostUrl: row.personal_forum_post_url || "",
        assignment: row.assignment || "Tour",
        status: row.status || "À faire",
        awakeningStatus: row.awakening_status || "En attente",
        defense1: row.defense_1 || "—",
        defense2: row.defense_2 || "—",
        createdAt: row.created_at || null,
        awakenings,
      };
    });

setMembers(mappedMembers);

if (mappedMembers.length > 0) {
  const connectedMember = mappedMembers.find(
    (member) => String(member.id) === String(session?.memberId)
  );

  setSelectedId((prev) => {
    // Si un profil est déjà sélectionné et qu'il existe encore dans la liste,
    // on ne touche à rien.
    if (prev && mappedMembers.some((member) => String(member.id) === String(prev))) {
      return prev;
    }

    // Sinon, au chargement initial / refresh / reconnexion,
    // on sélectionne le profil du compte connecté si on le trouve.
    if (connectedMember) {
      return connectedMember.id;
    }

    // Fallback
    return mappedMembers[0].id;
  });
}
  }

  loadMembers();
}, [metaHeroes, activeGuildCode, session?.memberId]);

useEffect(() => {
  async function loadClusterLibraryDefenses() {
    const cachedLibraryDefenses =
      dashboardCache[cacheGuildKey]?.clusterLibraryDefenses;

    if (cachedLibraryDefenses) {
      setClusterLibraryDefenses(cachedLibraryDefenses);
      return;
    }

    setLibraryLoading(true);

    const { data, error } = await supabase
      .from("guild_defenses")
      .select(`
        id,
        name,
        tier,
        type,
        image_url,
        guild_code,
        is_global,
        source_defense_id,
        created_at,
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
      `)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Erreur chargement bibliothèque cluster:", error);
      setClusterLibraryDefenses([]);
      setLibraryLoading(false);
      return;
    }

    const mapped = (data || []).map((row) => {
      const orderedSlots = [...(row.guild_defense_slots || [])]
        .sort((a, b) => a.slot_index - b.slot_index)
        .map((slot) => slot.champions?.name || "");

const conditions = (row.guild_defense_conditions || []).map((condition) => ({
  id: condition.id,
  championId: condition.champion_id,
  minAwakening: condition.min_awakening,
  label: `${condition.champions?.name} A${condition.min_awakening} minimum`,
}));

      return {
        id: row.id,
        name: row.name,
        tier: row.tier,
        type: row.type,
        guildCode: row.guild_code,
        isGlobal: row.is_global,
        sourceDefenseId: row.source_defense_id,
        slots: orderedSlots,
        conditions,
        image: row.image_url,
        usageCount: 0,
      };
    });

    setClusterLibraryDefenses(mapped);

    setDashboardCache((prev) => ({
      ...prev,
      [cacheGuildKey]: {
        ...prev[cacheGuildKey],
        clusterLibraryDefenses: mapped,
      },
    }));

    setLibraryLoading(false);
  }

  loadClusterLibraryDefenses();
}, [cacheGuildKey, dashboardCache]);

useEffect(() => {
  async function loadClusterDefenseLikes() {
    const cachedLikes = dashboardCache[cacheGuildKey]?.clusterDefenseLikes;

    if (cachedLikes) {
      setClusterDefenseLikes(cachedLikes);
      return;
    }

    setLikesLoading(true);

const { data, error } = await supabase
  .from("cluster_defense_likes")
  .select("id, defense_id, member_id, value, created_at");

    if (error) {
      console.error("Erreur chargement likes défenses cluster:", error);
      setClusterDefenseLikes([]);
      setLikesLoading(false);
      return;
    }

const mapped = (data || []).map((row) => ({
  id: row.id,
  defenseId: row.defense_id,
  memberId: row.member_id,
  value: row.value,
  createdAt: row.created_at,
}));

    setClusterDefenseLikes(mapped);

    setDashboardCache((prev) => ({
      ...prev,
      [cacheGuildKey]: {
        ...prev[cacheGuildKey],
        clusterDefenseLikes: mapped,
      },
    }));

    setLikesLoading(false);
  }

  loadClusterDefenseLikes();
}, [cacheGuildKey, dashboardCache]);

useEffect(() => {
  if (!session) return;

  const mustChangePassword = defaultPasswords.includes(session.password || "");
  setForcePasswordDialogOpen(mustChangePassword);
}, [session]);

  useEffect(() => {
    async function loadChampions() {
      setHeroesLoading(true);
      setHeroesError("");

        const { data, error } = await supabase
        .from("champions")
        .select("id, name, faction, role")
        .order("name", { ascending: true });

      if (error) {
        console.error("Erreur chargement champions:", error);
        setHeroesError(error.message || "Impossible de charger les champions");
        setHeroesLoading(false);
        return;
      }

      const heroNames = (data || [])
        .map((row) => row.name)
        .filter(Boolean);
        setAllHeroesData(data || []);

if (heroNames.length > 0) {
  setAllHeroes(heroNames);
  setMetaHeroes(heroNames);
}

      setHeroesLoading(false);
    }

    loadChampions();
  }, []);



useEffect(() => {
  async function loadDefenses() {
    const { data, error } = await supabase
      .from("guild_defenses")
.select(`
  id,
  name,
  tier,
  type,
  faction,
  image_url,
  guild_code,
  is_global,
  source_defense_id,
  sort_order,
  created_at,
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
`)
      .or(`is_global.eq.true,guild_code.eq.${activeGuildCode}`)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Erreur chargement défenses:", error);
      return;
    }



    const mapped = (data || []).map((row) => {
      const orderedSlots = [...(row.guild_defense_slots || [])]
        .sort((a, b) => a.slot_index - b.slot_index)
        .map((slot) => slot.champions?.name || "");

const conditions = (row.guild_defense_conditions || []).map((condition) => ({
  id: condition.id,
  championId: condition.champion_id,
  minAwakening: condition.min_awakening,
  label: `${condition.champions?.name} A${condition.min_awakening} minimum`,
}));

return {
  id: row.id,
  name: row.name,
  tier: row.tier,
  type: row.type,
  faction: row.faction || "",
  guildCode: row.guild_code,
  isGlobal: row.is_global,
  sourceDefenseId: row.source_defense_id,
  sort_order: row.sort_order ?? 9999,
  slots: orderedSlots,
  conditions,
  image: row.image_url,
  usageCount: 0,
};
    });

    const sorted = [...mapped].sort(
  (a, b) => (a.sort_order ?? 9999) - (b.sort_order ?? 9999)
);

setDefenses(sorted);
  }

  loadDefenses();
}, [activeGuildCode]);

useEffect(() => {
  async function loadDemonicMonsters() {
    const { data, error } = await supabase
      .from("demonic_monsters")
      .select("id, name, slug, rarity, image_url, sort_order, is_active")
      .eq("is_active", true)
      .order("rarity", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("Erreur chargement monstres démoniaques:", error);
      return;
    }

    setDemonicMonsters(data || []);
  }

  loadDemonicMonsters();
}, []);

useEffect(() => {
  if (activeProfileView !== "pb") return;
  if (memberIdsForGuild.length === 0) {
    setPbEntries([]);
    return;
  }

  async function loadPbEntries() {
    const cachedPbEntries = dashboardCache[cacheGuildKey]?.pbEntries;

    if (cachedPbEntries) {
      const filteredCachedPbEntries = cachedPbEntries.filter((entry) =>
        memberIdsForGuild.includes(entry.memberId)
      );

      setPbEntries(filteredCachedPbEntries);
      return;
    }

    const { data, error } = await supabase
      .from("member_pb_entries")
.select(`
  id,
  member_id,
  member_name,
  slot_index,
  pb_raw,
  champion_id,
  updated_at,
  champions (
    id,
    name,
    lord
  )
`)
      .in("member_id", memberIdsForGuild)
      .order("member_name", { ascending: true })
      .order("slot_index", { ascending: true });

    if (error) {
      console.error("Erreur chargement PB entries:", error);
      return;
    }

const mapped = (data || []).map((row) => ({
  id: row.id,
  memberId: row.member_id,
  memberName: row.member_name || "",
  slotIndex: row.slot_index,
  pbRaw: Number(row.pb_raw || 0),
  championId: row.champion_id || null,
  championName: row.champions?.name || "",
  championLord: row.champions?.lord || "non-lord",
  updatedAt: row.updated_at || null,
}));
    setPbEntries(mapped);

    setDashboardCache((prev) => ({
      ...prev,
      [cacheGuildKey]: {
        ...prev[cacheGuildKey],
        pbEntries: mapped,
      },
    }));
  }

  loadPbEntries();
}, [activeProfileView, memberIdsForGuild, cacheGuildKey, dashboardCache]);


    const selectedConditionDefense = useMemo(() => {
    if (!conditionDefenseId) return null;

    return defenses.find(
        (defense) => String(defense.id) === String(conditionDefenseId)
    ) ?? null;
    }, [defenses, conditionDefenseId]);

    const availableConditionHeroes = useMemo(() => {
    return selectedConditionDefense?.slots?.filter(Boolean) ?? [];
    }, [selectedConditionDefense]);

    useEffect(() => {
    setNewCondition((prev) => ({
        ...prev,
        defenseId: conditionDefenseId,
        hero: availableConditionHeroes.includes(prev.hero) ? prev.hero : "",
    }));
    }, [conditionDefenseId, availableConditionHeroes]);

    useEffect(() => {
    if (!conditionDefenseId && defenses.length > 0) {
        setConditionDefenseId(String(defenses[0].id));
    }
    }, [conditionDefenseId, defenses]);

    const selectedMember = useMemo(
    () => members.find((m) => m.id === selectedId) ?? members[0] ?? null,
    [members, selectedId]
    );

    useEffect(() => {
  if (activeProfileView !== "demon") return;

  if (!selectedMember?.id) {
    setMemberDemonicEntries([]);
    return;
  }



  async function loadSelectedMemberDemonicEntries() {
    const { data, error } = await supabase
      .from("member_demonic_monsters")
      .select(`
        id,
        member_id,
        monster_id,
        level,
        demonic_monsters (
          id,
          name,
          slug,
          rarity
        )
      `)
      .eq("member_id", selectedMember.id);

    if (error) {
      console.error("Erreur chargement box monstres démoniaques:", error);
      return;
    }

    const mapped = (data || []).map((row) => ({
      id: row.id,
      memberId: row.member_id,
      monsterId: row.monster_id,
      level: Number(row.level || 0),
      monsterName: row.demonic_monsters?.name || "",
      monsterSlug: row.demonic_monsters?.slug || "",
      rarity: row.demonic_monsters?.rarity || "",
    }));

    setMemberDemonicEntries(mapped);
  }

  loadSelectedMemberDemonicEntries();
}, [activeProfileView, selectedMember?.id]);

useEffect(() => {
  if (activeProfileView !== "soulstones") return;

  if (!selectedMember?.id) {
    setSoulStones([]);
    return;
  }

  async function loadSoulStones() {
    setSoulStonesLoading(true);

    const { data, error } = await supabase
      .from("soul_stones")
      .select("id, member_id, watcher_name, type, created_at")
      .eq("member_id", selectedMember.id)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Erreur chargement pierres d'âme:", error);
      setSoulStones([]);
      setSoulStonesLoading(false);
      return;
    }

    const mapped = (data || []).map((row) => ({
      id: row.id,
      memberId: row.member_id,
      watcherName: row.watcher_name || "",
      type: row.type,
      createdAt: row.created_at,
    }));

    setSoulStones(mapped);
    setSoulStonesLoading(false);
  }

  loadSoulStones();
}, [activeProfileView, selectedMember?.id]);

useEffect(() => {
  if (activeProfileView !== "soulstones") return;

  async function loadClusterSoulStoneRows() {
    setClusterSoulStonesLoading(true);

    const { data, error } = await supabase
      .rpc("get_soulstone_ranking");

    if (error) {
      console.error("Erreur chargement classement pierres d'âme:", error);
      setClusterSoulStoneRows([]);
      setClusterSoulStonesLoading(false);
      return;
    }

const rows = (data || []).map((row) => ({
  memberId: row.member_id,
  watcherName: row.watcher_name || "Inconnu",
  lord: Number(row.lord_count || 0),
  brute: Number(row.brute_count || 0),
  total: Number(row.total || 0),
})).sort((a, b) => {
  if (b.total !== a.total) return b.total - a.total;
  if (b.lord !== a.lord) return b.lord - a.lord;
  return a.watcherName.localeCompare(b.watcherName, "fr", {
    sensitivity: "base",
  });
});

    setClusterSoulStoneRows(rows);
    setClusterSoulStonesLoading(false);
  }

  loadClusterSoulStoneRows();
}, [activeProfileView, soulStones]);

const isAdmin = session?.role === "admin";
const isExternal = !session?.guildCode;
const isMember = session?.role === "member";
const isOwnProfile = selectedMember?.id === session?.memberId;

const canEditAwakenings = isAdmin || isOwnProfile;

const canEditDemonicMonsters = isAdmin || isOwnProfile;
const canEditSoulStones = isAdmin || isOwnProfile;

useEffect(() => {
  if (activeProfileView !== "intersaison") return;
  if (!isAdmin) return;

  async function loadIntersaisonData() {
    setIntersaisonLoading(true);

    const { data: campaign, error: campaignError } = await supabase
      .from("intersaison_campaigns")
      .select("*")
      .eq("status", "active")
      .maybeSingle();

    if (campaignError) {
      console.error("Erreur chargement campagne intersaison:", campaignError);
      setIntersaisonCampaign(null);
      setIntersaisonDashboards([]);
      setIntersaisonAssignments([]);
      setIntersaisonLoading(false);
      return;
    }

    if (!campaign) {
      setIntersaisonCampaign(null);
      setIntersaisonDashboards([]);
      setIntersaisonAssignments([]);
      setSelectedIntersaisonDashboardId("");
      setIntersaisonLoading(false);
      return;
    }

    setIntersaisonCampaign(campaign);

    const { data: dashboards, error: dashboardsError } = await supabase
      .from("intersaison_dashboards")
      .select("*")
      .eq("campaign_id", campaign.id)
      .order("sort_order", { ascending: true });

    if (dashboardsError) {
      console.error("Erreur chargement dashboards intersaison:", dashboardsError);
      setIntersaisonDashboards([]);
      setIntersaisonAssignments([]);
      setIntersaisonLoading(false);
      return;
    }

    const dashboardsList = dashboards || [];
    setIntersaisonDashboards(dashboardsList);

    setSelectedIntersaisonDashboardId((prev) => {
      if (prev && dashboardsList.some((d) => String(d.id) === String(prev))) {
        return prev;
      }

      const firstNonDraft = dashboardsList.find((d) => !d.is_draft);
      return firstNonDraft?.id || dashboardsList[0]?.id || "";
    });

    const { data: assignments, error: assignmentsError } = await supabase
      .from("intersaison_assignments")
      .select(`
        id,
        campaign_id,
        dashboard_id,
        member_id,
        watcher_name,
        discord_id_raw,
        source_guild_code,
        target_guild_code,
        poll_choice,
        assignment_source,
        has_note,
        created_at,
        updated_at,
        is_manually_confirmed,
        wished_guild_codes
      `)
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: true });

    if (assignmentsError) {
      console.error("Erreur chargement assignations intersaison:", assignmentsError);
      setIntersaisonAssignments([]);
      setIntersaisonLoading(false);
      return;
    }

setIntersaisonAssignments(assignments || []);

const assignmentIds = (assignments || [])
  .map((item) => item.id)
  .filter(Boolean);

if (assignmentIds.length === 0) {
  setIntersaisonNotes([]);
  setIntersaisonLoading(false);
  return;
}

const { data: notesData, error: notesError } = await supabase
  .from("intersaison_notes")
  .select("*")
  .in("assignment_id", assignmentIds)
  .order("updated_at", { ascending: false });

if (notesError) {
  console.error("Erreur chargement notes intersaison:", notesError);
  setIntersaisonNotes([]);
  setIntersaisonLoading(false);
  return;
}

setIntersaisonNotes(notesData || []);
setIntersaisonLoading(false);
  }

  loadIntersaisonData();
}, [activeProfileView, isAdmin]);

        useEffect(() => {
        setForumPostUrlInput(selectedMember?.personalForumPostUrl || "");
        }, [selectedMember]);

    const defaultDefenseTypeFilter = useMemo(() => {
    if (!selectedMember?.assignment) return "Tous";
    if (selectedMember.assignment === "Bastion") return "Bastion";
    return "Tour";
    }, [selectedMember]);

        useEffect(() => {
    setDefenseTypeFilter(defaultDefenseTypeFilter);
    }, [defaultDefenseTypeFilter]);

    useEffect(() => {
  const search = async () => {
    const query = clusterMemberSearchQuery.trim();

    if (!query) {
      setClusterMemberSearchResults([]);
      return;
    }

    const { data, error } = await supabase
      .from("guild_members")
      .select("id, watcher_name, guild_code")
      .ilike("watcher_name", `%${query}%`)
      .limit(10);

    if (error) {
      console.error("Erreur recherche cluster membres:", error);
      return;
    }

    setClusterMemberSearchResults(data || []);
  };

  search();
}, [clusterMemberSearchQuery]);

useEffect(() => {
  async function loadEditorBlocks() {
    if (!editingDefense?.id) {
      setEditorBlocks([]);
      return;
    }

    setEditorBlocksLoading(true);

    const { data, error } = await supabase
      .from("guild_defense_blocks")
      .select("id, block_type, content, sort_order")
      .eq("defense_id", editingDefense.id)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("Erreur chargement blocs éditeur:", error);
      setEditorBlocks([]);
      setEditorBlocksLoading(false);
      return;
    }

    const mappedBlocks = (data || []).map((row) => ({
      id: row.id,
      type: row.block_type,
      content: row.block_type === "text" ? row.content || "" : "",
      url: row.block_type === "image" ? row.content || "" : "",
    }));

    setEditorBlocks(mappedBlocks);
    setEditorBlocksLoading(false);
  }

  loadEditorBlocks();
}, [editingDefense]);

const cycleMemberAssignmentSortMode = () => {
  setMemberAssignmentSortMode((prev) => {
    if (prev === "alpha") return "tour_first";
    if (prev === "tour_first") return "bastion_first";
    return "alpha";
  });
};

const filteredMembers = useMemo(() => {
  const q = query.trim().toLowerCase();

  const textFiltered = !q
    ? members
    : members.filter((m) => m.name.toLowerCase().includes(q));

  const assignmentRank = (assignment) => {
    const value = String(assignment || "").trim();

    if (memberAssignmentSortMode === "tour_first") {
      if (value === "Tour") return 0;
      if (value === "Bastion") return 1;
      if (value === "Bulle") return 2;
      return 3;
    }

    if (memberAssignmentSortMode === "bastion_first") {
      if (value === "Bastion") return 0;
      if (value === "Tour") return 1;
      if (value === "Bulle") return 2;
      return 3;
    }

    return 0;
  };

  return [...textFiltered].sort((a, b) => {
    if (memberAssignmentSortMode !== "alpha") {
      const rankA = assignmentRank(a.assignment);
      const rankB = assignmentRank(b.assignment);

      if (rankA !== rankB) return rankA - rankB;
    }

    return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
  });
}, [members, query, memberAssignmentSortMode]);

const memberLimitExceeded = members.length > 30;

const latestMember = useMemo(() => {
  if (!memberLimitExceeded || !members.length) return null;

  return [...members].sort((a, b) => {
    const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bTime - aTime;
  })[0] ?? null;
}, [members, memberLimitExceeded]);

const availableTransferGuilds = useMemo(() => {
  return guildCodes.filter((code) => code !== activeGuildCode);
}, [activeGuildCode]);


const pbRows = useMemo(() => {
  const grouped = new Map();

  pbEntries.forEach((entry) => {
if (!grouped.has(entry.memberId)) {
  grouped.set(entry.memberId, {
    memberId: entry.memberId,
    memberName: entry.memberName || "Inconnu",
    slots: [null, null, null, null, null],
    updatedAt: entry.updatedAt || null,
  });
}

    const row = grouped.get(entry.memberId);
    if (
  entry.updatedAt &&
  (!row.updatedAt || new Date(entry.updatedAt) > new Date(row.updatedAt))
) {
  row.updatedAt = entry.updatedAt;
}
    const slotPosition = Math.max(0, Math.min(4, (entry.slotIndex || 1) - 1));

    row.slots[slotPosition] = {
      id: entry.id,
      slotIndex: entry.slotIndex,
      pbRaw: Number(entry.pbRaw || 0),
      championId: entry.championId,
      championName: entry.championName,
      championLord: entry.championLord || "non-lord",
    };
  });

  return Array.from(grouped.values())
.map((row) => {
  const member = members.find((m) => m.id === row.memberId);

  const sortedSlots = [...row.slots].sort((a, b) => {
    const pbA = getDisplayedPbValue(a, member);
    const pbB = getDisplayedPbValue(b, member);
    return pbB - pbA;
  });

  const pbValues = sortedSlots
    .map((slot) => getDisplayedPbValue(slot, member))
    .sort((a, b) => b - a);

      const top1 = pbValues[0] || 0;
      const top3 =
        pbValues.length >= 3
          ? (pbValues[0] + pbValues[1] + pbValues[2]) / 3
          : 0;
      const top5 =
        pbValues.length >= 5
          ? (pbValues[0] + pbValues[1] + pbValues[2] + pbValues[3] + pbValues[4]) / 5
          : 0;

return {
  ...row,
  slots: sortedSlots,
  top1,
  top3,
  top5,
};
    })
    .sort((a, b) => {
      if (pbSortMode === "top1") {
        if (b.top1 !== a.top1) return b.top1 - a.top1;
      }

      if (pbSortMode === "top3") {
        if (b.top3 !== a.top3) return b.top3 - a.top3;
      }

      if (pbSortMode === "top5") {
        if (b.top5 !== a.top5) return b.top5 - a.top5;
      }

      return a.memberName.localeCompare(b.memberName, "fr", { sensitivity: "base" });
    });
}, [pbEntries, pbSortMode]);

const totalLordSoulStones = useMemo(() => {
  return soulStones.filter((stone) => stone.type === "lord").length;
}, [soulStones]);

const totalBruteSoulStones = useMemo(() => {
  return soulStones.filter((stone) => stone.type === "brute").length;
}, [soulStones]);

const lastLordSoulStoneDate = useMemo(() => {
  return soulStones.find((stone) => stone.type === "lord")?.createdAt || null;
}, [soulStones]);

const lastBruteSoulStoneDate = useMemo(() => {
  return soulStones.find((stone) => stone.type === "brute")?.createdAt || null;
}, [soulStones]);

const selectedMemberDemonicEntries = useMemo(() => {
  if (!selectedMember) return [];

return memberDemonicEntries.filter(
  (entry) => String(entry.memberId) === String(selectedMember.id)
);
}, [memberDemonicEntries, selectedMember]);

const filteredDemonicMonsters = useMemo(() => {
  if (demonRarityFilter === "Tous") {
    return demonicMonsters;
  }

  return demonicMonsters.filter(
    (monster) => monster.rarity === demonRarityFilter
  );
}, [demonicMonsters, demonRarityFilter]);

const demonicMonsterCards = useMemo(() => {
  return filteredDemonicMonsters.map((monster) => {
const memberEntry = selectedMemberDemonicEntries.find(
  (entry) => String(entry.monsterId) === String(monster.id)
);

    if (monster.slug === "archerbleu") {
      console.log("SELECTED MEMBER", selectedMember?.id, selectedMember?.name);
      console.log("MONSTER ID", monster.id);
      console.log("MATCHED ENTRY", memberEntry);
      console.log(
        "ALL IDS",
        selectedMemberDemonicEntries.map((entry) => ({
          monsterId: entry.monsterId,
          level: entry.level,
          slug: entry.monsterSlug,
          name: entry.monsterName,
        }))
      );
    }

    return {
      ...monster,
      name: monster.name,
      slug: monster.slug,
      rarity: monster.rarity,
      level: memberEntry?.level ?? 0,
      entryId: memberEntry?.id ?? null,
      isOwned: (memberEntry?.level ?? 0) > 0,
    };
  });
}, [filteredDemonicMonsters, selectedMemberDemonicEntries, selectedMember]);

const filteredPbHeroResults = useMemo(() => {
  const q = pbHeroSearch.trim().toLowerCase();

  if (!q) return allHeroes.slice(0, 20);

  return allHeroes
    .filter((hero) => hero.toLowerCase().includes(q))
    .slice(0, 20);
}, [pbHeroSearch, allHeroes]);

const selectPbHero = async (heroName) => {
  if (!pbSlotToEdit?.entryId) return;

  const { data: champion, error: championError } = await supabase
    .from("champions")
    .select("id, name, lord")
    .eq("name", heroName)
    .single();

  if (championError || !champion) {
    console.error("Erreur récupération champion PB:", championError);
    return;
  }

  const { error } = await supabase
    .from("member_pb_entries")
    .update({
      champion_id: champion.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", pbSlotToEdit.entryId);

  if (error) {
    console.error("Erreur mise à jour héros PB:", error);
    return;
  }

  let nextEntries = [];

  setPbEntries((prev) => {
    nextEntries = prev.map((entry) =>
      entry.id === pbSlotToEdit.entryId
        ? {
            ...entry,
            championId: champion.id,
            championName: champion.name,
            championLord: champion.lord || "non-lord",
          }
        : entry
    );

    return nextEntries;
  });

  setDashboardCache((prev) => ({
    ...prev,
    [cacheGuildKey]: {
      ...prev[cacheGuildKey],
      pbEntries: nextEntries,
    },
  }));

  setPbSlotToEdit((prev) =>
    prev
      ? {
          ...prev,
          currentChampionId: champion.id,
          currentChampionName: champion.name,
        }
      : prev
  );
};

const openPbEditDialog = (slot, memberId) => {
  setPbSlotToEdit({
    entryId: slot.id,
    memberId,
    slotIndex: slot.slotIndex,
    currentChampionId: slot.championId,
    currentChampionName: slot.championName || "",
    currentPbRaw: Number(slot.pbRaw || 0),
  });

  setPbHeroSearch(slot.championName || "");
  setPbRawInput(String(Number(slot.pbRaw || 0)));
  setPbEditDialogOpen(true);
};

  const filteredAllHeroes = useMemo(() => {
    const q = heroSearch.trim().toLowerCase();
    if (!q) return allHeroes;
    return allHeroes.filter((hero) => hero.toLowerCase().includes(q));
  }, [heroSearch, allHeroes]);



const filteredMetaHeroes = useMemo(() => {
  return metaHeroes.filter((heroName) => {
    const champion = allHeroesData.find((item) => item.name === heroName);

    if (!champion) return false;

    const factionMatch =
      awakeningFactionFilter === "Tous"
        ? true
        : String(champion.faction || "")
            .split(",")
            .map((f) => f.trim().toLowerCase())
            .includes(awakeningFactionFilter.toLowerCase());

    const roleMatch =
      awakeningRoleFilter === "Tous"
        ? true
        : String(champion.role || "").trim().toLowerCase() ===
          awakeningRoleFilter.toLowerCase();

    return factionMatch && roleMatch;
  });
}, [metaHeroes, awakeningFactionFilter, awakeningRoleFilter, allHeroesData]);

const availableHeroRoles = useMemo(() => {
  return [...new Set(
    allHeroesData
      .map((hero) => String(hero.role || "").trim())
      .filter(Boolean)
  )].sort((a, b) =>
    a.localeCompare(b, "fr", { sensitivity: "base" })
  );
}, [allHeroesData]);

function resetAwakeningFilters() {
  setAwakeningFactionFilter("Tous");
  setAwakeningRoleFilter("Tous");
}

const metaDefenseCounters = useMemo(
  () => getMetaDefenseCounters(defenses, members, metaCounterFilter),
  [defenses, members, metaCounterFilter]
);

const activeDashboardDefenseRootIds = useMemo(() => {
  return new Set(
    defenses.map((defense) => getDefenseRootId(defense)).filter(Boolean)
  );
}, [defenses]);

function getDefenseLikeTargetId(defense) {
  return getDefenseRootId(defense);
}

const defenseLikesCountByRootId = useMemo(() => {
  const counts = new Map();

  clusterDefenseLikes.forEach((vote) => {
    if (vote.value !== 1) return;
    const currentCount = counts.get(vote.defenseId) || 0;
    counts.set(vote.defenseId, currentCount + 1);
  });

  return counts;
}, [clusterDefenseLikes]);

const defenseDislikesCountByRootId = useMemo(() => {
  const counts = new Map();

  clusterDefenseLikes.forEach((vote) => {
    if (vote.value !== -1) return;
    const currentCount = counts.get(vote.defenseId) || 0;
    counts.set(vote.defenseId, currentCount + 1);
  });

  return counts;
}, [clusterDefenseLikes]);

const defenseVoteByRootId = useMemo(() => {
  if (!session?.memberId) return new Map();

  const votes = new Map();

  clusterDefenseLikes
    .filter((vote) => String(vote.memberId) === String(session.memberId))
    .forEach((vote) => {
      votes.set(vote.defenseId, vote.value);
    });

  return votes;
}, [clusterDefenseLikes, session?.memberId]);

const trackedMetaDefense = useMemo(() => {
  if (!selectedMetaDefenseForCompletion) return null;

  return (
    defenses.find(
      (defense) => String(defense.id) === String(selectedMetaDefenseForCompletion)
    ) ?? null
  );
}, [defenses, selectedMetaDefenseForCompletion]);

const scoreDetailRows = useMemo(() => {
  if (!scoreDetailMember || !scoreDetailDefense) return [];

  return (scoreDetailDefense.slots || []).map((hero) => ({
    hero,
    awakening: scoreDetailMember.awakenings?.[hero] ?? -1,
  }));
}, [scoreDetailMember, scoreDetailDefense]);

    const membersForSelectedMetaDefense = useMemo(() => {
    if (!selectedMetaCounter?.name) return [];

    return members.filter(
        (member) =>
        member.defense1 === selectedMetaCounter.name ||
        member.defense2 === selectedMetaCounter.name
    );
    }, [members, selectedMetaCounter]);

const compatibleDefenses = useMemo(() => {
  if (!selectedMember) return [];

  return [...defenses]
    .map((defense) => ({
      ...defense,
      analysis: analyzeDefenseCompatibility(selectedMember, defense),
      awakeningScore: getDefenseAwakeningScore(selectedMember, defense),
    }))
    .sort((a, b) => {
      // 1. score d'éveils total décroissant
      if (b.awakeningScore !== a.awakeningScore) {
        return b.awakeningScore - a.awakeningScore;
      }

      // 2. à score égal, compatible avant incompatible
      if (a.analysis.isCompatible !== b.analysis.isCompatible) {
        return a.analysis.isCompatible ? -1 : 1;
      }

      // 3. à score égal, Meta avant Secondaire
      if (a.tier !== b.tier) {
        if (a.tier === "Meta") return -1;
        if (b.tier === "Meta") return 1;
      }

      // 4. ordre alphabétique stable
      return a.name.localeCompare(b.name, "fr", { sensitivity: "base" });
    });
}, [defenses, selectedMember]);

  const selectedDefense1 = useMemo(
  () => defenses.find((d) => d.name === selectedMember?.defense1) ?? null,
  [defenses, selectedMember?.defense1]
);

const selectedDefense2 = useMemo(
  () => defenses.find((d) => d.name === selectedMember?.defense2) ?? null,
  [defenses, selectedMember?.defense2]
);

const visibleCompatibleDefenses = useMemo(() => {
  return compatibleDefenses.filter((defense) => {
    const isVisibleByConflict = canShowDefenseForMember(
      defense,
      selectedDefense1,
      selectedDefense2
    );

    if (!isVisibleByConflict) return false;

    const typeOk =
      defenseTypeFilter === "Tous"
        ? true
        : defense.type === defenseTypeFilter;

    const tierOk =
      compatibleTierFilter === "Tous"
        ? true
        : normalizeDefenseTier(defense.tier) === compatibleTierFilter;

    return typeOk && tierOk;
  });
}, [
  compatibleDefenses,
  selectedDefense1,
  selectedDefense2,
  defenseTypeFilter,
  compatibleTierFilter,
]);

const defense1Tone = getAssignedDefenseTone(selectedDefense1, selectedMember);
const defense2Tone = getAssignedDefenseTone(selectedDefense2, selectedMember);

const openDefensePreview = (defense) => {
  if (!defense?.image) return;

  setPreviewImageUrl(defense.image);
  setPreviewImageOpen(true);
};

const openDemonLevelDialog = (monster) => {
  if (!canEditDemonicMonsters) return;

  setSelectedDemonMonster(monster);
  setDemonLevelInput(monster.level > 0 ? String(monster.level) : "");
  setDemonLevelDialogOpen(true);
};

const saveDemonLevel = async () => {
  if (!selectedMember?.id || !selectedDemonMonster?.id) return;

  const parsedLevel = Number(demonLevelInput);

  if (!Number.isInteger(parsedLevel) || parsedLevel < 0 || parsedLevel > 20) {
    alert("Le niveau doit être un nombre entier entre 0 et 20.");
    return;
  }

  try {
    setDemonLevelSaving(true);

    const payload = {
      member_id: selectedMember.id,
      monster_id: selectedDemonMonster.id,
      level: parsedLevel,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("member_demonic_monsters")
      .upsert(payload, {
        onConflict: "member_id,monster_id",
      })
      .select("id, member_id, monster_id, level")
      .single();

    if (error) {
      console.error("Erreur sauvegarde niveau monstre démoniaque:", error);
      alert(`Sauvegarde impossible : ${error.message || "erreur inconnue"}`);
      return;
    }

    const nextEntry = {
      id: data.id,
      memberId: data.member_id,
      monsterId: data.monster_id,
      level: Number(data.level || 0),
      monsterName: selectedDemonMonster.name || "",
      monsterSlug: selectedDemonMonster.slug || "",
      rarity: selectedDemonMonster.rarity || "",
    };

    let nextEntries = [];

    setMemberDemonicEntries((prev) => {
      const existingIndex = prev.findIndex(
        (entry) =>
          entry.memberId === selectedMember.id &&
          entry.monsterId === selectedDemonMonster.id
      );

      if (existingIndex === -1) {
        nextEntries = [...prev, nextEntry];
        return nextEntries;
      }

      nextEntries = prev.map((entry, index) =>
        index === existingIndex ? nextEntry : entry
      );

      return nextEntries;
    });

setDashboardCache((prev) => ({
  ...prev,
  [cacheGuildKey]: {
    ...prev[cacheGuildKey],
    memberDemonicEntries: nextEntries,
  },
}));

    setDemonLevelDialogOpen(false);
    setSelectedDemonMonster(null);
    setDemonLevelInput("");
  } catch (error) {
    console.error("Erreur sauvegarde monstre démoniaque:", error);
    alert("Une erreur est survenue pendant la sauvegarde.");
  } finally {
    setDemonLevelSaving(false);
  }
};

const setReproHero = (index, value) => {
  setReproHeroes((prev) => {
    const next = [...prev];
    next[index] = value;
    return next;
  });
};

const setReproCondition = (index, value) => {
  setReproConditions((prev) => {
    const next = [...prev];
    next[index] = Number(value);
    return next;
  });
};

const findReproMatches = () => {
  const filledHeroes = reproHeroes
    .map((hero, index) => ({
      hero,
      minAwakening: reproConditions[index] ?? 0,
    }))
    .filter((item) => item.hero);

  if (filledHeroes.length === 0) {
    setReproMatches([]);
    setReproResultOpen(true);
    return;
  }

  const matches = members.filter((member) =>
    filledHeroes.every(
      (item) => (member.awakenings?.[item.hero] ?? -1) >= item.minAwakening
    )
  );

  setReproMatches(matches);
  setReproResultOpen(true);
};

const addSoulStone = async (type) => {
  if (!selectedMember?.id) return;
  if (!canEditSoulStones) return;

  try {
    const { data, error } = await supabase
      .from("soul_stones")
      .insert({
        member_id: selectedMember.id,
        watcher_name: selectedMember.name,
        type,
      })
      .select("id, member_id, watcher_name, type, created_at")
      .single();

    if (error) {
      console.error("Erreur ajout pierre d'âme:", error);
      return;
    }

    const created = {
      id: data.id,
      memberId: data.member_id,
      watcherName: data.watcher_name || "",
      type: data.type,
      createdAt: data.created_at,
    };

    setSoulStones((prev) => [created, ...prev]);
  } catch (error) {
    console.error("Erreur addSoulStone:", error);
  }
};

const addExternalMember = async () => {
  const watcherName = String(newExternalMember.name || "").trim();
  const discordId = String(newExternalMember.discordId || "").trim();

  if (!watcherName || !discordId) {
    alert("Le nom watcher et l’ID Discord sont obligatoires.");
    return;
  }

  const { data: existingByDiscord, error: existingError } = await supabase
    .from("guild_members")
    .select("id, watcher_name, guild_code")
    .eq("discord_id", discordId)
    .maybeSingle();

  if (existingError) {
    console.error("Erreur vérification membre externe :", existingError);
    alert("Impossible de vérifier si ce joueur existe déjà.");
    return;
  }

  if (existingByDiscord) {
    alert("Un compte avec cet ID Discord existe déjà.");
    return;
  }

  const { data, error } = await supabase
    .from("guild_members")
    .insert({
      watcher_name: watcherName,
      discord_id: discordId,
      password: "motdepassemembre",
      role: "member",
      guild_code: null,
      assignment: "Tour",
      status: "À faire",
      awakening_status: "En attente",
      defense_1: "—",
      defense_2: "—",
      personal_forum_post_url: null,
    })
    .select("id, watcher_name, discord_id")
    .single();

  if (error) {
    console.error("Erreur ajout membre externe :", error);
    alert(`Ajout externe impossible : ${error.message || "erreur inconnue"}`);
    return;
  }

  setNewExternalMember({
    name: "",
    discordId: "",
  });
  setNewExternalOpen(false);

  alert(`Compte externe créé pour ${data.watcher_name}.`);
};

const removeLastSoulStone = async (type) => {
  if (!selectedMember?.id) return;
  if (!canEditSoulStones) return;

  const lastStone = soulStones.find(
    (stone) => stone.type === type
  );

  if (!lastStone) {
    return;
  }

  try {
    const { error } = await supabase
      .from("soul_stones")
      .delete()
      .eq("id", lastStone.id);

    if (error) {
      console.error("Erreur suppression pierre d'âme:", error);
      return;
    }

    setSoulStones((prev) =>
      prev.filter((stone) => stone.id !== lastStone.id)
    );
  } catch (error) {
    console.error("Erreur removeLastSoulStone:", error);
  }
};

const updatePbRaw = async (entryId, nextValue) => {
  const normalizedValue = Number(String(nextValue).replace(",", "."));

  if (Number.isNaN(normalizedValue)) {
    return;
  }

  const { error } = await supabase
    .from("member_pb_entries")
    .update({
      pb_raw: normalizedValue,
      updated_at: new Date().toISOString(),
    })
    .eq("id", entryId);

  if (error) {
    console.error("Erreur mise à jour PB brut:", error);
    return;
  }

  setPbEntries((prev) =>
    prev.map((entry) =>
      entry.id === entryId
        ? { ...entry, pbRaw: normalizedValue }
        : entry
    )
  );
};

const handleDragEnd = async (event) => {
  const { active, over } = event;

  if (!over || active.id === over.id) return;

  const oldIndex = defenses.findIndex((d) => d.id === active.id);
  const newIndex = defenses.findIndex((d) => d.id === over.id);

  if (oldIndex === -1 || newIndex === -1) return;

  const updated = [...defenses];
  const [movedItem] = updated.splice(oldIndex, 1);
  updated.splice(newIndex, 0, movedItem);

  const reordered = updated.map((d, index) => ({
    ...d,
    sort_order: index,
  }));

  setDefenses(reordered);

  for (const def of reordered) {
    await supabase
      .from("guild_defenses")
      .update({ sort_order: def.sort_order })
      .eq("id", def.id);
  }
};

const assignDefense = async (slot, defense, memberId) => {
  if (!memberId || !defense?.name) return;

  const column = slot === 1 ? "defense_1" : "defense_2";
  const localKey = slot === 1 ? "defense1" : "defense2";

  const { error } = await supabase
    .from("guild_members")
    .update({ [column]: defense.name })
    .eq("id", memberId);

  if (error) {
    console.error("Erreur assignation défense:", error);
    return;
  }

  setMembers((prev) =>
    prev.map((member) =>
      member.id === memberId
        ? { ...member, [localKey]: defense.name }
        : member
    )
  );
};



const clearAssignedDefense = async (slot) => {
  if (!selectedMember?.id) return;

  const column = slot === 1 ? "defense_1" : "defense_2";
  const localKey = slot === 1 ? "defense1" : "defense2";

  const { error } = await supabase
    .from("guild_members")
    .update({ [column]: "—" })
    .eq("id", selectedMember.id);

  if (error) {
    console.error("Erreur suppression défense assignée:", error);
    return;
  }

  setMembers((prev) =>
    prev.map((member) =>
      member.id === selectedMember.id
        ? { ...member, [localKey]: "—" }
        : member
    )
  );
};

const resetAllStatuses = async () => {
  const { error } = await supabase
    .from("guild_members")
    .update({ status: "À faire" })
    .not("id", "is", null);

  if (error) {
    console.error("Erreur reset statuts:", error);
    return;
  }

  setMembers((prev) =>
    prev.map((member) => ({
      ...member,
      status: "À faire",
    }))
  );
};

const setMemberAssignment = async (memberId, value) => {
  const { error } = await supabase
    .from("guild_members")
    .update({ assignment: value })
    .eq("id", memberId);

  if (error) {
    console.error("Erreur mise à jour affectation membre:", error);
    return;
  }

  setMembers((prev) =>
    prev.map((member) =>
      member.id === memberId
        ? { ...member, assignment: value }
        : member
    )
  );
};

const validateMember = async (memberId) => {
  const { error } = await supabase
    .from("guild_members")
    .update({ status: "Validé" })
    .eq("id", memberId);

  if (error) {
    console.error("Erreur validation membre:", error);
    return;
  }

  setMembers((prev) =>
    prev.map((member) =>
      member.id === memberId
        ? { ...member, status: "Validé" }
        : member
    )
  );
};

const setVerifyMember = async (memberId) => {
  const { error } = await supabase
    .from("guild_members")
    .update({ status: "À vérifier" })
    .eq("id", memberId);

  if (error) {
    console.error("Erreur statut à vérifier:", error);
    return;
  }

  setMembers((prev) =>
    prev.map((member) =>
      member.id === memberId
        ? { ...member, status: "À vérifier" }
        : member
    )
  );
};

const savePersonalForumPostUrl = async (memberId) => {
  const cleanUrl = forumPostUrlInput.trim();

  const { error } = await supabase
    .from("guild_members")
    .update({
      personal_forum_post_url: cleanUrl || null,
    })
    .eq("id", memberId);

  if (error) {
    console.error("Erreur sauvegarde lien forum personnel:", error);
    return;
  }

  setMembers((prev) =>
    prev.map((member) =>
      member.id === memberId
        ? { ...member, personalForumPostUrl: cleanUrl }
        : member
    )
  );
};

const setTodoMember = async (memberId) => {
  const { error } = await supabase
    .from("guild_members")
    .update({ status: "À faire" })
    .eq("id", memberId);

  if (error) {
    console.error("Erreur statut à faire:", error);
    return;
  }

  setMembers((prev) =>
    prev.map((member) =>
      member.id === memberId
        ? { ...member, status: "À faire" }
        : member
    )
  );
};

const confirmNoMoreAwakenings = async (memberId) => {
  const { error } = await supabase
    .from("guild_members")
    .update({ awakening_status: "OK" })
    .eq("id", memberId);

  if (error) {
    console.error("Erreur confirmation éveils:", error);
    return;
  }

  setMembers((prev) =>
    prev.map((member) =>
      member.id === memberId
        ? { ...member, awakeningStatus: "OK" }
        : member
    )
  );
};

    const deleteMember = async (memberId) => {
    if (!isAdmin) return;

    const confirmDelete = window.confirm(
        "Supprimer ce joueur et toutes ses données ?"
    );

    if (!confirmDelete) return;

    console.log("Suppression demandée pour memberId =", memberId);

    const { error: awakeningsError, count: awakeningsDeleted } = await supabase
        .from("member_awakenings")
        .delete({ count: "exact" })
        .eq("member_id", memberId);

    console.log("Résultat suppression éveils :", {
        memberId,
        awakeningsDeleted,
        awakeningsError,
    });

    if (awakeningsError) {
        console.error("Erreur suppression éveils membre:", awakeningsError);
        alert(`Suppression éveils impossible : ${awakeningsError?.message || "erreur inconnue"}`);
        return;
    }

    const { error: memberError, count: memberDeleted } = await supabase
        .from("guild_members")
        .delete({ count: "exact" })
        .eq("id", memberId);

    console.log("Résultat suppression membre :", {
        memberId,
        memberDeleted,
        memberError,
    });

    if (memberError) {
        console.error("Erreur suppression membre:", memberError);
        alert(`Suppression membre impossible : ${memberError?.message || "erreur inconnue"}`);
        return;
    }

    if (!memberDeleted) {
        alert("Aucune ligne membre supprimée dans Supabase.");
        return;
    }

    setMembers((prev) => {
        const next = prev.filter((m) => m.id !== memberId);

        setSelectedId((currentSelectedId) => {
        if (currentSelectedId !== memberId) return currentSelectedId;
        return next[0]?.id ?? null;
        });

        return next;
    });
    };

    const setAwakening = async (hero, value) => {
    if (!selectedId) return;

    const { data: champion, error: championError } = await supabase
        .from("champions")
        .select("id")
        .eq("name", hero)
        .single();

    if (championError || !champion) {
        console.error("Erreur récupération champion:", championError);
        return;
    }

    const { error: awakeningError } = await supabase
        .from("member_awakenings")
        .upsert(
        {
            member_id: selectedId,
            champion_id: champion.id,
            awakening_level: value,
        },
        {
            onConflict: "member_id,champion_id",
        }
        );

    if (awakeningError) {
        console.error("Erreur sauvegarde éveil:", awakeningError);
        return;
    }

    const { error: statusError } = await supabase
        .from("guild_members")
        .update({ awakening_status: "OK" })
        .eq("id", selectedId);

    if (statusError) {
        console.error("Erreur mise à jour statut éveils:", statusError);
        return;
    }

    setMembers((prev) =>
        prev.map((m) =>
        m.id === selectedId
            ? {
                ...m,
                awakenings: { ...m.awakenings, [hero]: value },
                awakeningStatus: "OK",
            }
            : m
        )
    );
    };

const addMember = async () => {
  const cleanName = newMember.name.trim();
  const cleanDiscordId = newMember.discordId.trim();
  const cleanForumPostUrl = newMember.forumPostUrl.trim();

  if (!cleanName || !cleanDiscordId) return;

  const { data: existingMember, error: existingMemberError } = await supabase
    .from("guild_members")
    .select("id, watcher_name, guild_code")
    .eq("discord_id", cleanDiscordId)
    .maybeSingle();

  if (existingMemberError) {
    console.error("Erreur vérification membre existant:", existingMemberError);
    alert(
      `Vérification impossible : ${
        existingMemberError.message || "erreur inconnue"
      }`
    );
    return;
  }

  if (existingMember) {
    if (existingMember.guild_code) {
      alert("Ce joueur est déjà dans une guilde.");
      return;
    }

    const confirmConvert = window.confirm(
      `Ce joueur existe déjà en externe.\n\nVeux-tu le rattacher à la guilde ${activeGuildCode} ?`
    );

    if (!confirmConvert) return;

    const { error: convertError } = await supabase
      .from("guild_members")
      .update({
        watcher_name: cleanName,
        personal_forum_post_url: cleanForumPostUrl || null,
        guild_code: activeGuildCode,
      })
      .eq("id", existingMember.id);

    if (convertError) {
      console.error("Erreur transformation externe → membre:", convertError);
      alert(
        `Transformation impossible : ${
          convertError.message || "erreur inconnue"
        }`
      );
      return;
    }

    alert(
      `${existingMember.watcher_name} a été rattaché à la guilde ${activeGuildCode}.`
    );

    setNewMember({
      name: "",
      discordId: "",
      forumPostUrl: "",
    });
    setNewMemberOpen(false);

    window.location.reload();
    return;
  }

  const { data, error } = await supabase
      .from("guild_members")
.insert([
  {
    watcher_name: cleanName,
    discord_id: cleanDiscordId,
    personal_forum_post_url: cleanForumPostUrl || null,
    guild_code: activeGuildCode,
    role: "member",
    password: "motdepassemembre",
    assignment: "Tour",
    status: "À faire",
    awakening_status: "En attente",
    defense_1: "—",
    defense_2: "—",
  }
])
      .select()
      .single();

    if (error) {
      console.error("Erreur ajout membre:", error);
      return;
    }

    const { data: championsData, error: championsError } = await supabase
      .from("champions")
      .select("id, name")
      .in("name", metaHeroes);

    if (championsError) {
      console.error("Erreur chargement champions pour éveils:", championsError);
      return;
    }

    const awakeningRows = (championsData || []).map((champion) => ({
      member_id: data.id,
      champion_id: champion.id,
      awakening_level: -1,
    }));

    if (awakeningRows.length > 0) {
      const { error: awakeningInsertError } = await supabase
        .from("member_awakenings")
        .insert(awakeningRows);

      if (awakeningInsertError) {
        console.error("Erreur création éveils membre:", awakeningInsertError);
        return;
      }
    }

const pbRows = [1, 2, 3, 4, 5].map((slotIndex) => ({
  member_id: data.id,
  member_name: data.watcher_name,
  slot_index: slotIndex,
  pb_raw: 0,
  champion_id: null,
}));

const { data: insertedPbRows, error: pbInsertError } = await supabase
  .from("member_pb_entries")
  .insert(pbRows)
  .select("id, member_id, member_name, slot_index, pb_raw, champion_id");
setDashboardCache((prev) => ({
  ...prev,
  [cacheGuildKey]: {
    ...prev[cacheGuildKey],
    pbEntries: [
      ...(prev[cacheGuildKey]?.pbEntries || []),
      ...((insertedPbRows || []).map((row) => ({
        id: row.id,
        memberId: row.member_id,
        memberName: row.member_name || "",
        slotIndex: row.slot_index,
        pbRaw: Number(row.pb_raw || 0),
        championId: row.champion_id || null,
        championName: "",
        championLord: "non-lord",
      }))),
    ],
  },
}));

if (pbInsertError) {
  console.error("Erreur création slots PB membre:", pbInsertError);
  return;
}

const created = {
  id: data.id,
  name: data.watcher_name,
  discordId: data.discord_id,
  password: data.password || "motdepassemembre",
  role: data.role || "member",
  personalForumPostUrl: data.personal_forum_post_url || "",
  guildCode: data.guild_code || activeGuildCode,
  assignment: data.assignment || "Tour",
  status: data.status || "À faire",
  awakeningStatus: data.awakening_status || "En attente",
  defense1: data.defense_1 || "—",
  defense2: data.defense_2 || "—",
  createdAt: data.created_at || null,
  awakenings: buildDefaultAwakenings(metaHeroes),
};

    setMembers((prev) => [...prev, created]);
setDashboardCache((prev) => ({
  ...prev,
  [cacheGuildKey]: {
    ...prev[cacheGuildKey],
    pbEntries: [
      ...(prev[cacheGuildKey]?.pbEntries || []),
      ...pbRows.map((row) => ({
        id: row.id ?? `${data.id}-${row.slot_index}`,
        memberId: row.member_id,
        memberName: data.watcher_name || "",
        slotIndex: row.slot_index,
        pbRaw: Number(row.pb_raw || 0),
        championId: row.champion_id || null,
        championName: "",
        championLord: "non-lord",
      })),
    ],
  },
}));
    setSelectedId(data.id);
    setNewMember({ name: "", discordId: "", forumPostUrl: "" });
    setNewMemberOpen(false);
  };

const addMetaHero = async (hero) => {
  if (metaHeroes.includes(hero)) {
    console.warn("Ce héros est déjà dans les héros méta.");
    return;
  }

  const { data: champion, error: championError } = await supabase
    .from("champions")
    .select("id")
    .eq("name", hero)
    .single();

  if (championError || !champion) {
    console.error("Erreur récupération champion:", championError);
    return;
  }

  const { data: existingMeta, error: existingError } = await supabase
    .from("meta_heroes")
    .select("champion_id")
    .eq("champion_id", champion.id)
    .maybeSingle();

  if (existingError) {
    console.error("Erreur vérification meta hero existant:", existingError);
    return;
  }

  if (existingMeta) {
    console.warn("Ce héros est déjà enregistré en meta en base.");
    setMetaHeroes((prev) => (prev.includes(hero) ? prev : [...prev, hero]));
    return;
  }

  const { error } = await supabase
    .from("meta_heroes")
    .insert({
      champion_id: champion.id,
    });

  if (error) {
    console.error("Erreur ajout meta hero:", error);
    return;
  }

  setMetaHeroes((prev) => [...prev, hero]);
};

const removeMetaHero = async (hero) => {

  const { data: champion } = await supabase
    .from("champions")
    .select("id")
    .eq("name", hero)
    .single();

  if (!champion) return;

  const { error } = await supabase
    .from("meta_heroes")
    .delete()
    .eq("champion_id", champion.id);

  if (error) {
    console.error("Erreur suppression meta hero:", error);
    return;
  }

  setMetaHeroes((prev) => prev.filter((h) => h !== hero));
};

  const toggleMetaHero = (hero) => {
    if (metaHeroes.includes(hero)) removeMetaHero(hero);
    else addMetaHero(hero);
  };

  const setDefenseSlot = (index, value) => {
    setNewDefense((prev) => {
      const nextSlots = [...prev.slots];
      nextSlots[index] = value;
      return { ...prev, slots: nextSlots };
    });
  };

async function compressImageBeforeUpload(file, options = {}) {
  const {
    quality = 0.88,
    outputType = "image/webp",
  } = options;

  if (!file || !file.type?.startsWith("image/")) {
    throw new Error("Fichier image invalide");
  }

  const imageUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Impossible de charger l'image"));
      image.src = imageUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Impossible de créer le canvas");
    }

    ctx.drawImage(img, 0, 0, img.width, img.height);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => {
          if (result) resolve(result);
          else reject(new Error("Compression image impossible"));
        },
        outputType,
        quality
      );
    });

    const extension =
      outputType === "image/webp"
        ? "webp"
        : outputType === "image/jpeg"
        ? "jpg"
        : "png";

    return new File(
      [blob],
      file.name.replace(/\.[^.]+$/, `.${extension}`),
      { type: outputType }
    );
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function getStoragePathFromPublicUrl(fileUrl) {
  if (!fileUrl) return null;

  try {
    const url = new URL(fileUrl);
    const marker = "/storage/v1/object/public/defense-images/";
    const index = url.pathname.indexOf(marker);

    if (index === -1) return null;

    return decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch (error) {
    console.error("Erreur parsing URL storage:", error);
    return null;
  }
}

const handleDefenseImage = async (file) => {
  if (!file) return;

  try {
    const compressedFile = await compressImageBeforeUpload(file, {
      quality: 0.88,
      outputType: "image/webp",
    });

  console.log(
      "Image originale:",
      (file.size / 1024 / 1024).toFixed(2) + " MB"
    );

    console.log(
      "Image compressée:",
      (compressedFile.size / 1024 / 1024).toFixed(2) + " MB"
    );

    const fileExt = compressedFile.name.split(".").pop()?.toLowerCase() || "webp";
    const fileName = `defense-${Date.now()}.${fileExt}`;
    const filePath = fileName;

    const { error: uploadError } = await supabase.storage
      .from("defense-images")
      .upload(filePath, compressedFile, {
        upsert: false,
        contentType: compressedFile.type,
      });

    if (uploadError) {
      console.error("Erreur upload image:", uploadError);
      return;
    }

    const { data } = supabase.storage
      .from("defense-images")
      .getPublicUrl(filePath);

    setNewDefense((prev) => ({
      ...prev,
      image: data.publicUrl,
    }));
  } catch (error) {
    console.error("Erreur compression/upload image défense:", error);
  }
};

const handleEditorBlockImage = async (blockId, file) => {
  if (!file) return;

  try {
    const compressedFile = await compressImageBeforeUpload(file, {
      quality: 0.88,
      outputType: "image/webp",
    });

    const fileExt = compressedFile.name.split(".").pop()?.toLowerCase() || "webp";
    const fileName = `editor-block-${Date.now()}-${blockId}.${fileExt}`;
    const filePath = fileName;

    const { error: uploadError } = await supabase.storage
      .from("defense-images")
      .upload(filePath, compressedFile, {
        upsert: false,
        contentType: compressedFile.type,
      });

    if (uploadError) {
      console.error("Erreur upload image bloc éditeur:", uploadError);
      return;
    }

    const { data } = supabase.storage
      .from("defense-images")
      .getPublicUrl(filePath);

    const publicUrl = data.publicUrl;

    const { error: updateError } = await supabase
      .from("guild_defense_blocks")
      .update({ content: publicUrl })
      .eq("id", blockId);

    if (updateError) {
      console.error("Erreur sauvegarde URL image bloc éditeur:", updateError);
      return;
    }

    setEditorBlocks((prev) =>
      prev.map((item) =>
        item.id === blockId
          ? { ...item, url: publicUrl }
          : item
      )
    );
  } catch (error) {
    console.error("Erreur compression/upload image bloc éditeur:", error);
  }
};

const confirmNewDefense = async () => {
  const cleanName = newDefense.name.trim();
  const filledSlots = newDefense.slots.filter(Boolean);

  if (!cleanName || filledSlots.length !== 5) return;

  const normalizedSlots = newDefense.slots.map((s) => s.trim());

  const { data: championsData, error: championsError } = await supabase
    .from("champions")
    .select("id, name")
    .in("name", normalizedSlots);

  if (championsError) {
    console.error("Erreur récupération champions:", championsError);
    return;
  }

  if (!championsData || championsData.length !== 5) {
    console.error("Impossible de retrouver les 5 héros en base.");
    return;
  }

  const championIdByName = new Map(
    championsData.map((c) => [c.name, c.id])
  );

const isGlobalDefense = activeGuildCode === "G1";

const isEditMode =
  newDefense.id &&
  String(newDefense.id) !== "0";
const defensePayload = {
  name: cleanName,
  tier: newDefense.tier,
  type: newDefense.type,
  faction: newDefense.faction || null,
  image_url: newDefense.image || null,
  guild_code: activeGuildCode,
  is_global: isGlobalDefense,
};

const { data: defenseData, error: defenseError } = isEditMode
  ? await supabase
      .from("guild_defenses")
      .update(defensePayload)
      .eq("id", newDefense.id)
      .select()
      .single()
  : await supabase
      .from("guild_defenses")
      .insert(defensePayload)
      .select()
      .single();

  if (defenseError) {
    console.error("Erreur création défense:", defenseError);
    return;
  }

  const slotsRows = normalizedSlots.map((heroName, index) => ({
    defense_id: defenseData.id,
    champion_id: championIdByName.get(heroName),
    slot_index: index + 1,
  }));



  if (isEditMode) {
  const { error: deleteSlotsError } = await supabase
    .from("guild_defense_slots")
    .delete()
    .eq("defense_id", defenseData.id);

  if (deleteSlotsError) {
    console.error("Erreur suppression anciens slots défense:", deleteSlotsError);
    return;
  }
}
  const { error: slotsError } = await supabase
    .from("guild_defense_slots")
    
    .insert(slotsRows);

  if (slotsError) {
    console.error("Erreur création slots défense:", slotsError);
    return;
  }

const created = {
  id: defenseData.id,
  name: defenseData.name,
  tier: defenseData.tier,
  type: defenseData.type,
  faction: defenseData.faction,
  guildCode: defenseData.guild_code,
  isGlobal: defenseData.is_global,
  slots: normalizedSlots,
  conditions: [],
  image: defenseData.image_url,
  usageCount: 0,
};

  setDefenses((prev) =>
  isEditMode
    ? prev.map((defense) =>
        String(defense.id) === String(created.id) ? created : defense
      )
    : [...prev, created]
);

setConditionDefenseId(String(created.id));
  setConditionDefenseId(String(created.id));

setNewDefense({
  id: 0,
  name: "",
  tier: "meta_s",
  type: "Tour",
  faction: "",
  slots: ["", "", "", "", ""],
  conditions: [],
  image: "",
});

  setNewDefenseOpen(false);
};

const addCondition = async () => {
  if (!conditionDefenseId || !newCondition.hero || newCondition.minAwakening === "") {
    return;
  }

  const defense = defenses.find(
    (d) => String(d.id) === String(conditionDefenseId)
  );

  if (!defense) return;
  if (!isAdmin) return;

  if (!(defense.slots || []).includes(newCondition.hero)) {
    console.error("Le héros choisi n'appartient pas à cette défense.");
    return;
  }

const alreadyExists = (defense.conditions || []).some((condition) => {
  const label =
    typeof condition === "string" ? condition : condition.label || "";

  const match = label.match(/^(.+?) A(\d) minimum$/);
  if (!match) return false;

  return (
    match[1] === newCondition.hero &&
    Number(match[2]) === Number(newCondition.minAwakening)
  );
});

  if (alreadyExists) {
    console.error("Cette condition existe déjà.");
    return;
  }

  const { data: champion, error: championError } = await supabase
    .from("champions")
    .select("id")
    .eq("name", newCondition.hero)
    .single();

  if (championError || !champion) {
    console.error("Erreur récupération héros condition:", championError);
    return;
  }

  const { data, error } = await supabase
    .from("guild_defense_conditions")
    .insert({
      defense_id: defense.id,
      champion_id: champion.id,
      min_awakening: Number(newCondition.minAwakening),
    })
.select(`
  id,
  champion_id,
  min_awakening,
  champions (
    name
  )
`)
    .single();

  if (error) {
    console.error("Erreur ajout condition:", error);
    return;
  }

  setDefenses((prev) =>
    prev.map((item) =>
      String(item.id) === String(defense.id)
        ? {
            ...item,
            conditions: [
              ...(item.conditions || []),
              {
  id: data.id,
  championId: data.champion_id,
  minAwakening: data.min_awakening,
  label: `${data.champions?.name} A${data.min_awakening} minimum`,
},
            ],
          }
        : item
    )
  );

  setNewCondition((prev) => ({
    ...prev,
    hero: "",
    minAwakening: "",
  }));
};

const removeCondition = async (defenseId, conditionLabel) => {
  const defense = defenses.find((d) => String(d.id) === String(defenseId));
  if (!canDeleteDefense(defense)) return;

  const match = conditionLabel.match(/^(.+?) A(\d) minimum$/);
  if (!match) return;

  const heroName = match[1];
  const minAwakening = Number(match[2]);

  const { data: champion, error: championError } = await supabase
    .from("champions")
    .select("id")
    .eq("name", heroName)
    .single();

  if (championError || !champion) {
    console.error("Erreur récupération héros suppression condition:", championError);
    return;
  }

  const { error } = await supabase
    .from("guild_defense_conditions")
    .delete()
    .eq("defense_id", defenseId)
    .eq("champion_id", champion.id)
    .eq("min_awakening", minAwakening);

  if (error) {
    console.error("Erreur suppression condition:", error);
    return;
  }

  setDefenses((prev) =>
    prev.map((defense) =>
      String(defense.id) === String(defenseId)
        ? {
            ...defense,
            conditions: (defense.conditions || []).filter((c) => c !== conditionLabel),
          }
        : defense
    )
  );
};

const sendDefenseToMember = async (memberId) => {
  if (sendingDefense) return;

  const member = members.find((m) => m.id === memberId);
  if (!member) return;

  const assignedDefenseNames = [member.defense1, member.defense2].filter(
    (name) => name && name !== "—"
  );

  if (assignedDefenseNames.length === 0) {
    alert("Veuillez sélectionner au moins une défense avant d’envoyer.");
    return;
  }

  if (!member.personalForumPostUrl) {
    alert("Aucun lien de forum personnel n’est enregistré pour ce joueur.");
    return;
  }

try {

  setMessageDialogState({
    status: "loading",
    memberName: member.name,
    discordId: member.discordId,
  });

  setMessageDialogOpen(true);
    setSendingDefense(true);

    const selectedDefenses = defenses.filter((defense) =>
      assignedDefenseNames.includes(defense.name)
    );

    const defensesWithBlocks = await Promise.all(
      selectedDefenses.map(async (defense) => {
        const { data, error } = await supabase
          .from("guild_defense_blocks")
          .select("id, block_type, content, sort_order")
          .eq("defense_id", defense.id)
          .order("sort_order", { ascending: true });

        if (error) {
          throw error;
        }

        return {
          id: defense.id,
          name: defense.name,
          type: defense.type,
          tier: defense.tier,
          image: defense.image || "",
          blocks: (data || []).map((block) => ({
            id: block.id,
            type: block.block_type,
            content: block.content || "",
            sortOrder: block.sort_order,
          })),
        };
      })
    );

    const res = await fetch("/api/discord/send-defense", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        memberName: member.name,
        discordId: member.discordId,
        forumPostUrl: member.personalForumPostUrl,
        defenses: defensesWithBlocks,
      }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
        await supabase
        .from("guild_members")
        .update({ status: "À vérifier" })
        .eq("id", member.id);

        setMembers((prev) =>
        prev.map((m) =>
            m.id === member.id
            ? { ...m, status: "À vérifier" }
            : m
        )
        );
        setMessageDialogState({
        status: "success",
        memberName: member.name,
        discordId: member.discordId,
        });
    setMessageDialogOpen(true);
  } catch (error) {
    console.error("Erreur envoi défense :", error);

        setMessageDialogState({
        status: "error",
        memberName: member.name,
        discordId: member.discordId,
        });
    setMessageDialogOpen(true);
  } finally {
    setSendingDefense(false);
  }
};

const requestAwakeningUpdate = async (memberId) => {
  const member = members.find((m) => m.id === memberId);
  if (!member) return;

  const { error } = await supabase
    .from("guild_members")
    .update({ awakening_status: "En attente" })
    .eq("id", memberId);

  if (error) {
    console.error("Erreur reset statut éveils du membre:", error);
    return;
  }

  setMembers((prev) =>
    prev.map((item) =>
      item.id === memberId
        ? { ...item, awakeningStatus: "En attente" }
        : item
    )
  );

  try {
    if (!member.discordId) {
      console.warn("discordId manquant pour ce membre");
      return;
    }

    setMessageDialogState({
      status: "loading",
      memberName: member.name,
      discordId: member.discordId,
    });
    setMessageDialogOpen(true);

    const discordApiBaseUrl =
      import.meta.env.VITE_DISCORD_API_BASE_URL?.replace(/\/$/, "") || "";

    if (!discordApiBaseUrl) {
      throw new Error("VITE_DISCORD_API_BASE_URL manquante");
    }

    const dashboardBaseUrl = window.location.origin;
    const dashboardPath =
      activeGuildCode === "G1"
        ? "/dashboard"
        : `/dashboard/${activeGuildCode}`;

    const res = await fetch(
      `${discordApiBaseUrl}/api/discord/send-awakening-request`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          discordId: member.discordId,
          memberName: member.name,
          profileLink: `${dashboardBaseUrl}${dashboardPath}`,
          password: member.password,
          guildTag: activeGuildCode,
        }),
      }
    );

    const data = await res.json().catch(() => null);

    console.log("API Discord status =", res.status);
    console.log("API Discord response =", data);

    if (!res.ok) {
      throw new Error(data?.details || data?.error || "Erreur API Discord");
    }

    setMessageDialogState({
      status: "success",
      memberName: member.name,
      discordId: member.discordId,
    });
    setMessageDialogOpen(true);

    console.log("MP envoyé via API");
  } catch (error) {
    console.error("Erreur appel API Discord :", error);

    setMessageDialogState({
      status: "error",
      memberName: member.name,
      discordId: member.discordId,
    });
    setMessageDialogOpen(true);
  }
};

const canDeleteDefense = (defense) => {
  if (!isAdmin || !defense) return false;

  return defense.guildCode === activeGuildCode;
};

const saveDefenseIdentity = async () => {
  if (!renameDefenseTarget?.id) return;

  const nextName = String(renameDefenseName || "").trim();
  const nextFaction = String(renameDefenseFaction || "").trim();

  if (!nextName) {
    alert("Le titre de la défense ne peut pas être vide.");
    return;
  }

  const { error } = await supabase
    .from("guild_defenses")
    .update({
      name: nextName,
      faction: nextFaction || null,
    })
    .eq("id", renameDefenseTarget.id);

  if (error) {
    console.error("Erreur mise à jour titre/faction défense:", error);
    alert(`Mise à jour impossible : ${error.message || "erreur inconnue"}`);
    return;
  }

  setDefenses((prev) =>
    prev.map((defense) =>
      defense.id === renameDefenseTarget.id
        ? {
            ...defense,
            name: nextName,
            faction: nextFaction,
          }
        : defense
    )
  );

  setRenameDefenseDialogOpen(false);
  setRenameDefenseTarget(null);
  setRenameDefenseName("");
  setRenameDefenseFaction("");
};

const deleteDefense = async (defense) => {
  if (!defense?.id) return;
  if (!canDeleteDefense(defense)) return;

  const confirmDelete = window.confirm(
    `Supprimer la défense "${defense.name}" ?`
  );

  if (!confirmDelete) return;

  try {
    const { data: blocks, error: blocksError } = await supabase
      .from("guild_defense_blocks")
      .select("id, block_type, content")
      .eq("defense_id", defense.id);

    if (blocksError) {
      console.error("Erreur chargement blocs avant suppression défense:", blocksError);
      return;
    }

    const storagePaths = [];

    const mainImagePath = getStoragePathFromPublicUrl(defense.image);
    if (mainImagePath) {
      storagePaths.push(mainImagePath);
    }

    (blocks || []).forEach((block) => {
      if (block.block_type === "image" && block.content) {
        const blockImagePath = getStoragePathFromPublicUrl(block.content);
        if (blockImagePath) {
          storagePaths.push(blockImagePath);
        }
      }
    });

    const uniqueStoragePaths = [...new Set(storagePaths)];

    if (uniqueStoragePaths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("defense-images")
        .remove(uniqueStoragePaths);

      if (storageError) {
        console.error("Erreur suppression images storage défense:", storageError);
        return;
      }
    }

    const { error: defenseError } = await supabase
      .from("guild_defenses")
      .delete()
      .eq("id", defense.id);

    if (defenseError) {
      console.error("Erreur suppression défense:", defenseError);
      return;
    }

    setDefenses((prev) => prev.filter((d) => d.id !== defense.id));

    if (String(conditionDefenseId) === String(defense.id)) {
      setConditionDefenseId("");
    }

    if (editingDefense?.id === defense.id) {
      setEditingDefense(null);
      setEditorOpen(false);
      setEditorBlocks([]);
    }
  } catch (error) {
    console.error("Erreur suppression complète défense:", error);
  }
};

    const openMetaCounterDialog = (counter) => {
    setSelectedMetaCounter(counter);
    setMetaCounterDialogOpen(true);
    };

const handleLogin = (data) => {
  const nextSession = {
    ...data,
    guildCode: data?.guild_code || null,
  };

  localStorage.setItem("guildDashboardSession", JSON.stringify(nextSession));
  setSession(nextSession);
  setSelectedId(nextSession?.memberId ?? null);

  const mustChangePassword = defaultPasswords.includes(nextSession?.password || "");
  setForcePasswordDialogOpen(mustChangePassword);
};

const handleLogout = () => {
  localStorage.removeItem("guildDashboardSession");
  setSession(null);
  setSelectedId(null);
};
const openTransferDialog = (member) => {
  if (!member) return;

  setMemberToTransfer(member);
  setTargetGuildCode(
    guildCodes.find((code) => code !== activeGuildCode) || ""
  );
  setTransferDialogOpen(true);
};



const transferMemberToGuild = async () => {
  if (!isAdmin) return;
  if (!memberToTransfer?.id) return;
  if (!targetGuildCode) return;
  if (targetGuildCode === activeGuildCode) return;

  const confirmTransfer = window.confirm(
    `Transférer ${memberToTransfer.name} vers ${targetGuildCode} ?`
  );

  if (!confirmTransfer) return;

  const { error } = await supabase
    .from("guild_members")
    .update({ guild_code: targetGuildCode })
    .eq("id", memberToTransfer.id);

  if (error) {
    console.error("Erreur transfert membre:", error);
    alert(`Transfert impossible : ${error.message || "erreur inconnue"}`);
    return;
  }

  setMembers((prev) => {
    const next = prev.filter((m) => m.id !== memberToTransfer.id);

    setSelectedId((currentSelectedId) => {
      if (currentSelectedId !== memberToTransfer.id) return currentSelectedId;
      return next[0]?.id ?? null;
    });

    return next;
  });

  setTransferDialogOpen(false);
  setMemberToTransfer(null);
  setTargetGuildCode("");
};

const moveIntersaisonAssignmentToDashboard = async (assignmentId, nextDashboardId) => {
  if (!isAdmin) return;
  if (!assignmentId || !nextDashboardId) return;

  const nextDashboard = intersaisonDashboards.find(
    (dashboard) => String(dashboard.id) === String(nextDashboardId)
  );

  if (!nextDashboard) return;

  const nextTargetGuildCode = nextDashboard.is_draft ? null : nextDashboard.code;
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("intersaison_assignments")
    .update({
      dashboard_id: nextDashboard.id,
      target_guild_code: nextTargetGuildCode,
      is_manually_confirmed: true,
      updated_at: nowIso,
    })
    .eq("id", assignmentId);

  if (error) {
    console.error("Erreur déplacement manuel intersaison:", error);
    alert(error.message || "Déplacement impossible.");
    return;
  }

  setIntersaisonAssignments((prev) =>
    prev.map((assignment) =>
      String(assignment.id) === String(assignmentId)
        ? {
            ...assignment,
            dashboard_id: nextDashboard.id,
            target_guild_code: nextTargetGuildCode,
            is_manually_confirmed: true,
            updated_at: nowIso,
          }
        : assignment
    )
  );
};

const copyIntersaisonTransferSummary = async () => {
  const summary = buildIntersaisonTransferSummary();
  setIntersaisonTransferSummary(summary);

  try {
    await navigator.clipboard.writeText(summary);
    alert("Résumé des transferts copié dans le presse-papiers.");
  } catch (error) {
    console.error("Erreur copie résumé intersaison:", error);
    alert(summary);
  }
};

const launchRealIntersaisonTransfers = async () => {
  if (!isAdmin) return;
  if (!intersaisonCampaign?.id) return;

  const unconfirmedAssignments = intersaisonAssignments.filter(
    (assignment) => !assignment.is_manually_confirmed
  );

  if (unconfirmedAssignments.length > 0) {
    alert(
      `Impossible de lancer les transferts réels : ${unconfirmedAssignments.length} joueur(s) ne sont pas encore validés.`
    );
    return;
  }

  const confirmedAssignments = intersaisonAssignments.filter(
    (assignment) =>
      assignment.is_manually_confirmed &&
      assignment.member_id &&
      assignment.target_guild_code
  );

  if (confirmedAssignments.length === 0) {
    alert("Aucun transfert réel à appliquer.");
    return;
  }

  const confirmLaunch = window.confirm(
    "Confirmer le lancement des transferts réels ? Cette action modifiera les dashboards actifs."
  );

  if (!confirmLaunch) return;

  try {
    for (const assignment of confirmedAssignments) {
      const { error } = await supabase
        .from("guild_members")
        .update({
          guild_code: assignment.target_guild_code,
        })
        .eq("id", assignment.member_id);

      if (error) {
        console.error("Erreur transfert réel membre:", error, assignment);
        alert(
          `Erreur pendant le transfert réel de ${assignment.watcher_name}. Opération interrompue.`
        );
        return;
      }
    }

    const campaignId = intersaisonCampaign.id;
    const assignmentIds = intersaisonAssignments
      .map((assignment) => assignment.id)
      .filter(Boolean);

    if (assignmentIds.length > 0) {
      const { error: notesError } = await supabase
        .from("intersaison_notes")
        .delete()
        .in("assignment_id", assignmentIds);

      if (notesError) {
        console.error("Erreur suppression notes après transferts réels:", notesError);
        alert(notesError.message || "Transferts faits, mais suppression des notes impossible.");
        return;
      }
    }

    const { error: assignmentsError } = await supabase
      .from("intersaison_assignments")
      .delete()
      .eq("campaign_id", campaignId);

    if (assignmentsError) {
      console.error("Erreur suppression assignations après transferts réels:", assignmentsError);
      alert(assignmentsError.message || "Transferts faits, mais suppression des assignations impossible.");
      return;
    }

    const { error: dashboardsError } = await supabase
      .from("intersaison_dashboards")
      .delete()
      .eq("campaign_id", campaignId);

    if (dashboardsError) {
      console.error("Erreur suppression dashboards après transferts réels:", dashboardsError);
      alert(dashboardsError.message || "Transferts faits, mais suppression des dashboards impossible.");
      return;
    }

    const { error: campaignError } = await supabase
      .from("intersaison_campaigns")
      .delete()
      .eq("id", campaignId);

    if (campaignError) {
      console.error("Erreur suppression campagne après transferts réels:", campaignError);
      alert(campaignError.message || "Transferts faits, mais suppression de la campagne impossible.");
      return;
    }

    setConfirmFinalizeIntersaisonDialogOpen(false);
    setIntersaisonCampaign(null);
    setIntersaisonDashboards([]);
    setIntersaisonAssignments([]);
    setIntersaisonNotes([]);
    setSelectedIntersaisonDashboardId("");
    setIntersaisonSearchQuery("");
    setIntersaisonAssignmentToMove(null);
    setSelectedIntersaisonMoveDashboardId("");
    setIntersaisonTransferSummary("");

    alert("Les transferts réels ont bien été appliqués et la campagne a été clôturée.");
  } catch (error) {
    console.error("Erreur lancement transferts réels:", error);
    alert("Une erreur est survenue pendant les transferts réels.");
  }
};

const buildIntersaisonTransferSummary = () => {
  if (!intersaisonDashboards.length || !intersaisonAssignments.length) {
    return "Aucune donnée intersaison disponible.";
  }

  const confirmedAssignments = intersaisonAssignments.filter(
    (assignment) => assignment.is_manually_confirmed
  );

  if (confirmedAssignments.length === 0) {
    return "Aucun transfert validé pour le moment.";
  }

  const lines = [];

  intersaisonDashboards
    .filter((dashboard) => !dashboard.is_draft)
    .forEach((dashboard) => {
      const arrivals = confirmedAssignments.filter(
        (assignment) =>
          String(assignment.dashboard_id) === String(dashboard.id)
      );

      const departures = confirmedAssignments.filter(
        (assignment) =>
          assignment.source_guild_code === dashboard.code &&
          assignment.target_guild_code !== dashboard.code
      );

      lines.push(`${dashboard.name}`);
      lines.push("");

      lines.push("Arrivées :");
      if (arrivals.length > 0) {
        arrivals.forEach((assignment) => {
          lines.push(
            `- ${assignment.watcher_name} (${assignment.source_guild_code || "—"} -> ${assignment.target_guild_code || "BROUILLON"})`
          );
        });
      } else {
        lines.push("- Aucune");
      }

      lines.push("");

      lines.push("Départs :");
      if (departures.length > 0) {
        departures.forEach((assignment) => {
          lines.push(
            `- ${assignment.watcher_name} (${assignment.source_guild_code || "—"} -> ${assignment.target_guild_code || "BROUILLON"})`
          );
        });
      } else {
        lines.push("- Aucun");
      }

      lines.push("");
      lines.push("— — —");
      lines.push("");
    });

  return lines.join("\n").trim();
};

const cancelActiveIntersaisonCampaign = async () => {
  if (!isAdmin) return;
  if (!intersaisonCampaign?.id) return;

  const confirmCancel = window.confirm(
    "Annuler complètement la campagne active d’intersaison ? Cette action supprimera tous les dashboards prévisionnels, les affectations et les notes."
  );

  if (!confirmCancel) return;

  try {
    const campaignId = intersaisonCampaign.id;

    const assignmentIds = intersaisonAssignments
      .map((assignment) => assignment.id)
      .filter(Boolean);

    if (assignmentIds.length > 0) {
      const { error: notesError } = await supabase
        .from("intersaison_notes")
        .delete()
        .in("assignment_id", assignmentIds);

      if (notesError) {
        console.error("Erreur suppression notes intersaison:", notesError);
        alert(notesError.message || "Suppression des notes impossible.");
        return;
      }
    }

    const { error: assignmentsError } = await supabase
      .from("intersaison_assignments")
      .delete()
      .eq("campaign_id", campaignId);

    if (assignmentsError) {
      console.error("Erreur suppression assignations intersaison:", assignmentsError);
      alert(assignmentsError.message || "Suppression des assignations impossible.");
      return;
    }

    const { error: dashboardsError } = await supabase
      .from("intersaison_dashboards")
      .delete()
      .eq("campaign_id", campaignId);

    if (dashboardsError) {
      console.error("Erreur suppression dashboards intersaison:", dashboardsError);
      alert(dashboardsError.message || "Suppression des dashboards impossible.");
      return;
    }

    const { error: campaignError } = await supabase
      .from("intersaison_campaigns")
      .delete()
      .eq("id", campaignId);

    if (campaignError) {
      console.error("Erreur suppression campagne intersaison:", campaignError);
      alert(campaignError.message || "Suppression de la campagne impossible.");
      return;
    }

    setConfirmFinalizeIntersaisonDialogOpen(false);
    setIntersaisonCampaign(null);
    setIntersaisonDashboards([]);
    setIntersaisonAssignments([]);
    setIntersaisonNotes([]);
    setSelectedIntersaisonDashboardId("");
    setIntersaisonSearchQuery("");
    setIntersaisonAssignmentToMove(null);
    setSelectedIntersaisonMoveDashboardId("");

    alert("La campagne active a bien été annulée.");
  } catch (error) {
    console.error("Erreur annulation campagne intersaison:", error);
    alert("Une erreur est survenue pendant l’annulation de la campagne.");
  }
};

const getIntersaisonNoteForAssignment = (assignmentId) => {
  return (
    intersaisonNotes.find(
      (note) => String(note.assignment_id) === String(assignmentId)
    ) || null
  );
};

const openIntersaisonNoteDialog = (row) => {
  const existingNote = getIntersaisonNoteForAssignment(row.id);

  setSelectedIntersaisonNoteRow(row);
  setIntersaisonNoteInput(existingNote?.note || "");
  setIntersaisonNoteDialogOpen(true);
};

const saveTestWish = async () => {
  if (!testWishRow?.id) return;

  const cleaned = [...new Set(testWishInput)].sort((a, b) =>
    a.localeCompare(b, "fr")
  );

  const { error } = await supabase
    .from("intersaison_assignments")
    .update({ wished_guild_codes: cleaned })
    .eq("id", testWishRow.id);

  if (error) {
    console.error("Erreur sauvegarde souhait:", error);
    alert(error.message || "Enregistrement impossible.");
    return;
  }

  setIntersaisonAssignments((prev) =>
    prev.map((assignment) =>
      String(assignment.id) === String(testWishRow.id)
        ? { ...assignment, wished_guild_codes: cleaned }
        : assignment
    )
  );

  setTestWishRow(null);
  setTestWishInput([]);
};

const saveIntersaisonNote = async () => {
  if (!selectedIntersaisonNoteRow?.id) return;
  if (!session?.memberId) return;

  const cleanNote = intersaisonNoteInput.trim();
  const existingNote = getIntersaisonNoteForAssignment(selectedIntersaisonNoteRow.id);

  if (!cleanNote) {
    if (!existingNote) {
      setIntersaisonNoteDialogOpen(false);
      setSelectedIntersaisonNoteRow(null);
      setIntersaisonNoteInput("");
      return;
    }

    const { error } = await supabase
      .from("intersaison_notes")
      .delete()
      .eq("id", existingNote.id);

    if (error) {
      console.error("Erreur suppression note intersaison:", error);
      alert(error.message || "Suppression impossible.");
      return;
    }

    setIntersaisonNotes((prev) =>
      prev.filter((note) => String(note.id) !== String(existingNote.id))
    );

    setIntersaisonNoteDialogOpen(false);
    setSelectedIntersaisonNoteRow(null);
    setIntersaisonNoteInput("");
    return;
  }

  const nowIso = new Date().toISOString();

  if (existingNote) {
    const { error } = await supabase
      .from("intersaison_notes")
      .update({
        note: cleanNote,
        updated_at: nowIso,
      })
      .eq("id", existingNote.id);

    if (error) {
      console.error("Erreur mise à jour note intersaison:", error);
      alert(error.message || "Enregistrement impossible.");
      return;
    }

    setIntersaisonNotes((prev) =>
      prev.map((note) =>
        String(note.id) === String(existingNote.id)
          ? {
              ...note,
              note: cleanNote,
              updated_at: nowIso,
            }
          : note
      )
    );
  } else {
    const { data, error } = await supabase
      .from("intersaison_notes")
      .insert({
        assignment_id: selectedIntersaisonNoteRow.id,
        note: cleanNote,
        created_by_member_id: session.memberId,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Erreur création note intersaison:", error);
      alert(error.message || "Création impossible.");
      return;
    }

    setIntersaisonNotes((prev) => [data, ...prev]);
  }

  setIntersaisonNoteDialogOpen(false);
  setSelectedIntersaisonNoteRow(null);
  setIntersaisonNoteInput("");
};

const toggleIntersaisonAssignmentConfirmation = async (assignmentId) => {
  if (!isAdmin) return;
  if (!assignmentId) return;

  const currentAssignment = intersaisonAssignments.find(
    (assignment) => String(assignment.id) === String(assignmentId)
  );

  if (!currentAssignment) return;

  const nextConfirmedValue = !currentAssignment.is_manually_confirmed;
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from("intersaison_assignments")
    .update({
      is_manually_confirmed: nextConfirmedValue,
      updated_at: nowIso,
    })
    .eq("id", assignmentId);

  if (error) {
    console.error("Erreur toggle validation intersaison:", error);
    alert(error.message || "Changement impossible.");
    return;
  }

  setIntersaisonAssignments((prev) =>
    prev.map((assignment) =>
      String(assignment.id) === String(assignmentId)
        ? {
            ...assignment,
            is_manually_confirmed: nextConfirmedValue,
            updated_at: nowIso,
          }
        : assignment
    )
  );
};

const removeMemberFromCluster = async () => {
  if (!isAdmin) return;
  if (!memberToTransfer?.id) return;

  const confirmDelete = window.confirm(
    `Retirer définitivement ${memberToTransfer.name} du cluster ? Cette action supprimera toutes ses données.`
  );

  if (!confirmDelete) return;

  try {
    const { data: intersaisonAssignments, error: intersaisonAssignmentsFetchError } = await supabase
      .from("intersaison_assignments")
      .select("id")
      .eq("member_id", memberToTransfer.id);

    if (intersaisonAssignmentsFetchError) {
      console.error(
        "Erreur chargement assignations intersaison membre:",
        intersaisonAssignmentsFetchError
      );
      alert(
        `Suppression impossible : ${
          intersaisonAssignmentsFetchError.message || "erreur inconnue"
        }`
      );
      return;
    }

    const intersaisonAssignmentIds = (intersaisonAssignments || [])
      .map((row) => row.id)
      .filter(Boolean);

    if (intersaisonAssignmentIds.length > 0) {
      const { error: intersaisonNotesError } = await supabase
        .from("intersaison_notes")
        .delete()
        .in("assignment_id", intersaisonAssignmentIds);

      if (intersaisonNotesError) {
        console.error("Erreur suppression notes intersaison membre:", intersaisonNotesError);
        alert(
          `Suppression impossible : ${
            intersaisonNotesError.message || "erreur inconnue"
          }`
        );
        return;
      }
    }

    const { error: intersaisonAssignmentsDeleteError } = await supabase
      .from("intersaison_assignments")
      .delete()
      .eq("member_id", memberToTransfer.id);

    if (intersaisonAssignmentsDeleteError) {
      console.error(
        "Erreur suppression assignations intersaison membre:",
        intersaisonAssignmentsDeleteError
      );
      alert(
        `Suppression impossible : ${
          intersaisonAssignmentsDeleteError.message || "erreur inconnue"
        }`
      );
      return;
    }

    const { error: awakeningsError } = await supabase
      .from("member_awakenings")
      .delete()
      .eq("member_id", memberToTransfer.id);

    if (awakeningsError) {
      console.error("Erreur suppression éveils membre:", awakeningsError);
      alert(`Suppression impossible : ${awakeningsError.message || "erreur inconnue"}`);
      return;
    }

    const { error: memberError } = await supabase
      .from("guild_members")
      .delete()
      .eq("id", memberToTransfer.id);

    if (memberError) {
      console.error("Erreur suppression membre:", memberError);
      alert(`Suppression impossible : ${memberError.message || "erreur inconnue"}`);
      return;
    }

    setMembers((prev) => {
      const next = prev.filter((m) => m.id !== memberToTransfer.id);

      setSelectedId((currentSelectedId) => {
        if (currentSelectedId !== memberToTransfer.id) return currentSelectedId;
        return next[0]?.id ?? null;
      });

      return next;
    });

    setTransferDialogOpen(false);
    setMemberToTransfer(null);
    setTargetGuildCode("");
  } catch (error) {
    console.error("Erreur suppression complète du joueur:", error);
    alert("Une erreur est survenue pendant la suppression.");
  }
};



const importDefenseToActiveGuild = async (sourceDefense) => {
  if (!isAdmin) return;
  if (!sourceDefense?.id) return;

  const rootId = getDefenseRootId(sourceDefense);

  if (activeDashboardDefenseRootIds.has(rootId)) {
    console.warn("Cette défense est déjà importée dans le dashboard actif.");
    return;
  }

  try {
    const { data: newDefenseRow, error: insertDefenseError } = await supabase
      .from("guild_defenses")
      .insert({
        name: sourceDefense.name,
        tier: sourceDefense.tier,
        type: sourceDefense.type,
        image_url: sourceDefense.image || null,
        guild_code: activeGuildCode,
        is_global: false,
        source_defense_id: rootId,
      })
      .select()
      .single();

    if (insertDefenseError) {
      console.error("Erreur import défense:", insertDefenseError);
      return;
    }

    const { data: championsData, error: championsError } = await supabase
      .from("champions")
      .select("id, name")
      .in("name", sourceDefense.slots);

    if (championsError) {
      console.error("Erreur récupération champions import défense:", championsError);
      return;
    }

    const championIdByName = new Map(
      (championsData || []).map((c) => [c.name, c.id])
    );

    const slotsRows = (sourceDefense.slots || []).map((heroName, index) => ({
      defense_id: newDefenseRow.id,
      champion_id: championIdByName.get(heroName),
      slot_index: index + 1,
    }));

    if (slotsRows.length > 0) {
      const { error: slotsError } = await supabase
        .from("guild_defense_slots")
        .insert(slotsRows);

      if (slotsError) {
        console.error("Erreur import slots défense:", slotsError);
        return;
      }
    }

    const conditionRequirements = getDefenseConditionRequirements(sourceDefense);

    if (conditionRequirements.length > 0) {
      const { data: conditionChampionsData, error: conditionChampionsError } = await supabase
        .from("champions")
        .select("id, name")
        .in(
          "name",
          conditionRequirements.map((condition) => condition.hero)
        );

      if (conditionChampionsError) {
        console.error("Erreur récupération champions conditions import:", conditionChampionsError);
        return;
      }

      const conditionChampionIdByName = new Map(
        (conditionChampionsData || []).map((c) => [c.name, c.id])
      );

      const conditionRows = conditionRequirements
        .map((condition) => {
          const championId = conditionChampionIdByName.get(condition.hero);
          if (!championId) return null;

          return {
            defense_id: newDefenseRow.id,
            champion_id: championId,
            min_awakening: condition.minAwakening,
          };
        })
        .filter(Boolean);

      if (conditionRows.length > 0) {
        const { error: conditionsError } = await supabase
          .from("guild_defense_conditions")
          .insert(conditionRows);

        if (conditionsError) {
          console.error("Erreur import conditions défense:", conditionsError);
          return;
        }
      }
    }

    const { data: sourceBlocks, error: blocksError } = await supabase
      .from("guild_defense_blocks")
      .select("block_type, content, sort_order")
      .eq("defense_id", sourceDefense.id)
      .order("sort_order", { ascending: true });

    if (blocksError) {
      console.error("Erreur chargement blocs source:", blocksError);
      return;
    }

    if ((sourceBlocks || []).length > 0) {
      const blockRows = sourceBlocks.map((block) => ({
        defense_id: newDefenseRow.id,
        block_type: block.block_type,
        content: block.content || "",
        sort_order: block.sort_order,
      }));

      const { error: insertBlocksError } = await supabase
        .from("guild_defense_blocks")
        .insert(blockRows);

      if (insertBlocksError) {
        console.error("Erreur import blocs défense:", insertBlocksError);
        return;
      }
    }

    const created = {
      id: newDefenseRow.id,
      name: newDefenseRow.name,
      tier: newDefenseRow.tier,
      type: newDefenseRow.type,
      guildCode: newDefenseRow.guild_code,
      isGlobal: newDefenseRow.is_global,
      sourceDefenseId: newDefenseRow.source_defense_id,
      slots: sourceDefense.slots || [],
      conditions: sourceDefense.conditions || [],
      image: newDefenseRow.image_url,
      usageCount: 0,
    };

    setDefenses((prev) => [...prev, created]);

    setDashboardCache((prev) => ({
      ...prev,
      [cacheGuildKey]: {
        ...prev[cacheGuildKey],
        clusterLibraryDefenses: prev[cacheGuildKey]?.clusterLibraryDefenses || clusterLibraryDefenses,
      },
    }));
  } catch (error) {
    console.error("Erreur import complet défense:", error);
  }
};

const setDefenseVote = async (defense, value) => {
  if (!session?.memberId) return;
  if (!defense) return;

  const targetDefenseId = getDefenseLikeTargetId(defense);
  if (!targetDefenseId) return;

  const existingVote = clusterDefenseLikes.find(
    (vote) =>
      String(vote.defenseId) === String(targetDefenseId) &&
      String(vote.memberId) === String(session.memberId)
  );

  if (existingVote) {
    if (existingVote.value === value) {
      const { error } = await supabase
        .from("cluster_defense_likes")
        .delete()
        .eq("id", existingVote.id);

      if (error) {
        console.error("Erreur suppression vote défense:", error);
        return;
      }

      let nextVotes = [];

      setClusterDefenseLikes((prev) => {
        nextVotes = prev.filter((vote) => vote.id !== existingVote.id);
        return nextVotes;
      });

      setDashboardCache((prev) => ({
        ...prev,
        [cacheGuildKey]: {
          ...prev[cacheGuildKey],
          clusterDefenseLikes: nextVotes,
        },
      }));

      return;
    }

    const { error } = await supabase
      .from("cluster_defense_likes")
      .update({ value })
      .eq("id", existingVote.id);

    if (error) {
      console.error("Erreur mise à jour vote défense:", error);
      return;
    }

    let nextVotes = [];

    setClusterDefenseLikes((prev) => {
      nextVotes = prev.map((vote) =>
        vote.id === existingVote.id ? { ...vote, value } : vote
      );
      return nextVotes;
    });

    setDashboardCache((prev) => ({
      ...prev,
      [cacheGuildKey]: {
        ...prev[cacheGuildKey],
        clusterDefenseLikes: nextVotes,
      },
    }));

    return;
  }

const { data, error } = await supabase
  .from("cluster_defense_likes")
  .upsert(
    {
      defense_id: targetDefenseId,
      member_id: session.memberId,
      value,
    },
    {
      onConflict: "defense_id,member_id",
    }
  )
  .select()
  .single();

  if (error) {
    console.error("Erreur ajout vote défense:", error);
    return;
  }

  const createdVote = {
    id: data.id,
    defenseId: data.defense_id,
    memberId: data.member_id,
    value: data.value,
    createdAt: data.created_at,
  };

  let nextVotes = [];

  setClusterDefenseLikes((prev) => {
    nextVotes = [...prev, createdVote];
    return nextVotes;
  });

  setDashboardCache((prev) => ({
    ...prev,
    [cacheGuildKey]: {
      ...prev[cacheGuildKey],
      clusterDefenseLikes: nextVotes,
    },
  }));
};

    const moveEditorBlock = async (blockId, direction) => {
    const index = editorBlocks.findIndex((item) => item.id === blockId);
    if (index === -1) return;

  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (targetIndex < 0 || targetIndex >= editorBlocks.length) return;

  const next = [...editorBlocks];
  const temp = next[index];
  next[index] = next[targetIndex];
  next[targetIndex] = temp;

  setEditorBlocks(next);

  const updates = next.map((item, sortOrder) => ({
    id: item.id,
    sort_order: sortOrder + 1,
  }));


  const results = await Promise.all(
    updates.map((item) =>
      supabase
        .from("guild_defense_blocks")
        .update({ sort_order: item.sort_order })
        .eq("id", item.id)
    )
  );

  const firstError = results.find((result) => result.error)?.error;

  if (firstError) {
    console.error("Erreur sauvegarde ordre blocs éditeur:", firstError);
    return;
  }

  console.log("Ordre des blocs sauvegardé avec succès");
};

const formatPbAverage = (value) => {
  if (!value || Number.isNaN(value)) return "—";
  return value.toFixed(1);
};

function isPbOutdated(date) {
  if (!date) return false;

  const now = new Date();
  const updated = new Date(date);

  const diffTime = now - updated;
  const diffDays = diffTime / (1000 * 60 * 60 * 24);

  return diffDays >= 30;
}

const removeConditionById = async (conditionId) => {
  if (!conditionId) return;

  const { error } = await supabase
    .from("guild_defense_conditions")
    .delete()
    .eq("id", conditionId);

  if (error) {
    console.error("Erreur suppression condition:", error);
    return;
  }

  setDefenses((prev) =>
    prev.map((defense) => ({
      ...defense,
      conditions: (defense.conditions || []).filter(
        (c) => String(c.id) !== String(conditionId)
      ),
    }))
  );
};

function getDisplayedPbValue(slot, member) {
  if (!slot) return 0;

  const raw = Number(slot.pbRaw || 0);

  if (slot.championLord !== "lord") {
    return raw;
  }

  const awakeningLevel =
    slot.championName && member?.awakenings
      ? Number(member.awakenings[slot.championName] ?? -1)
      : -1;

  if (awakeningLevel < 0) {
    return raw;
  }

  const multiplierMap = {
    0: 1.10,
    1: 1.11,
    2: 1.12,
    3: 1.13,
    4: 1.14,
    5: 1.15,
  };

  const multiplier = multiplierMap[awakeningLevel] ?? 1;

  return raw * multiplier;
}

if (!session) {
  return <LoginScreen onLogin={handleLogin} />;
}


const profileViewTabs = [
  
  { key: "admin_defenses", label: "Admin défenses", adminOnly: true },
  { key: "gestion_guildes", label: "Gestion de guildes" },

  { key: "awakening", label: "Éveils" },
  { key: "pb", label: "Tableur PB" },
  { key: "demon", label: "Monstre Démoniaque" },
  { key: "soulstones", label: "Pierre d’âme" },
  { key: "run_search", label: "Recherche de run" },
  { key: "run_add", label: "Ajout de run", adminOnly: true },
  { key: "run_edit", label: "Modification de run", adminOnly: true },
  { key: "gvg_current", label: "GVG en cours" },
  { key: "gvg_admin", label: "Admin GVG", adminOnly: true },
    { key: "gvg_panel", label: "GVG Panel", adminOnly: true },
  ...(isAdmin ? [{ key: "intersaison", label: "Intersaison" }] : []),
];

const profileLink = `https://unrepaid-maire-verbosely.ngrok-free.dev/dashboard/${activeGuildCode}`;
const discordMessage = selectedMember
  ? buildDiscordMessage(selectedMember, profileLink)
  : "";

const changePassword = async () => {
  if (!session?.memberId) return;

  if (currentPasswordInput !== (session.password || "")) {
    alert("Le mot de passe actuel est incorrect.");
    return;
  }

  if (!newPasswordInput.trim()) {
    alert("Le nouveau mot de passe est vide.");
    return;
  }

  if (newPasswordInput.length < 6) {
    alert("Le nouveau mot de passe doit faire au moins 6 caractères.");
    return;
  }

  if (newPasswordInput !== confirmNewPasswordInput) {
    alert("Les deux nouveaux mots de passe ne correspondent pas.");
    return;
  }

  if (defaultPasswords.includes(newPasswordInput)) {
    alert("Tu ne peux pas garder un mot de passe par défaut.");
    return;
  }

  try {
    setPasswordChangeLoading(true);

    const { error } = await supabase
      .from("guild_members")
      .update({ password: newPasswordInput })
      .eq("id", session.memberId);

    if (error) {
      console.error("Erreur changement mot de passe :", error);
      alert(`Changement impossible : ${error.message || "erreur inconnue"}`);
      return;
    }

    const updatedSession = {
      ...session,
      password: newPasswordInput,
    };

    localStorage.setItem("guildDashboardSession", JSON.stringify(updatedSession));
    setSession(updatedSession);

    setCurrentPasswordInput("");
    setNewPasswordInput("");
    setConfirmNewPasswordInput("");
    setForcePasswordDialogOpen(false);

    alert("Mot de passe modifié avec succès.");
  } catch (error) {
    console.error("Erreur changement mot de passe :", error);
    alert("Une erreur est survenue pendant le changement de mot de passe.");
  } finally {
    setPasswordChangeLoading(false);
  }
};
if (isExternal) {
  const externalTabs = [
    { key: "run_search", label: "Recherche de run" },
  ];

  const externalActiveTab =
    externalTabs.some((tab) => tab.key === activeProfileView)
      ? activeProfileView
      : "run_search";

  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3">
            {externalTabs.map((tab) => {
              const isActive = externalActiveTab === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveProfileView(tab.key)}
                  className={`rounded-2xl border px-5 py-2 text-sm font-medium transition ${
                    isActive
                      ? "border-zinc-500 bg-zinc-100 text-zinc-950"
                      : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleLogout}
            className="rounded-2xl border-zinc-700 text-zinc-200"
          >
            Déconnexion
          </Button>
        </div>

        {externalActiveTab === "run_search" && <RunSearchGrid />}

        <Dialog open={forcePasswordDialogOpen}>
          <DialogContent
            className="max-w-md rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100"
            onInteractOutside={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle>Changement de mot de passe requis</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
                Pour plus de sécurité, tu dois remplacer ton mot de passe par défaut.
              </div>

              <div className="space-y-2">
                <div className="text-sm text-zinc-400">Mot de passe actuel</div>
                <Input
                  type="password"
                  value={currentPasswordInput}
                  onChange={(e) => setCurrentPasswordInput(e.target.value)}
                  placeholder="Mot de passe actuel"
                  className="rounded-2xl border-zinc-700 bg-zinc-900"
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm text-zinc-400">Nouveau mot de passe</div>
                <Input
                  type="password"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                  placeholder="Nouveau mot de passe"
                  className="rounded-2xl border-zinc-700 bg-zinc-900"
                />
              </div>

              <div className="space-y-2">
                <div className="text-sm text-zinc-400">Confirmer le nouveau mot de passe</div>
                <Input
                  type="password"
                  value={confirmNewPasswordInput}
                  onChange={(e) => setConfirmNewPasswordInput(e.target.value)}
                  placeholder="Confirmer le nouveau mot de passe"
                  className="rounded-2xl border-zinc-700 bg-zinc-900"
                />
              </div>

              <div className="flex justify-end">
                <Button
                  className="rounded-2xl"
                  onClick={changePassword}
                  disabled={passwordChangeLoading}
                >
                  {passwordChangeLoading ? "Enregistrement..." : "Changer mon mot de passe"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
  return (
    <div className="min-h-screen bg-zinc-950 p-6 text-zinc-100">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Guild Box Manager</h1>
            <p className="mt-1 text-zinc-400">
              Prototype de base pour gérer les membres, leurs éveils et les héros méta.
            </p>
          </div>

                    <div className="flex flex-wrap gap-2">
                      <Dialog open={newMemberOpen} onOpenChange={setNewMemberOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="rounded-2xl border-zinc-700 bg-zinc-900" disabled={!isAdmin}>
                            <UserPlus className="mr-2 h-4 w-4" /> Ajouter un membre
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-xl rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
                          <DialogHeader>
                            <DialogTitle>Ajouter un membre</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <div className="text-sm text-zinc-400">Nom Watcheur du membre</div>
                              <Input

                          
                                value={newMember.name}
                                onChange={(e) => setNewMember((prev) => ({ ...prev, name: e.target.value }))}
                                placeholder="Ex: Elrion"
                                className="rounded-2xl border-zinc-700 bg-zinc-900"
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="text-sm text-zinc-400">ID Discord du joueur</div>
                              <Input
                                value={newMember.discordId}
                                onChange={(e) => setNewMember((prev) => ({ ...prev, discordId: e.target.value }))}
                                placeholder="Ex: 259417928569585665"
                                className="rounded-2xl border-zinc-700 bg-zinc-900"
                              />
                            </div>
                            <div className="space-y-2">
                                <div className="text-sm text-zinc-400">Lien du post forum personnel</div>
                                <Input
                                    value={newMember.forumPostUrl}
                                    onChange={(e) => setNewMember((prev) => ({ ...prev, forumPostUrl: e.target.value }))}
                                    placeholder="https://discord.com/channels/..."
                                    className="rounded-2xl border-zinc-700 bg-zinc-900"
                                />
                                </div>
                            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                              Par défaut, la box des héros méta du nouveau joueur sera créée avec <span className="text-red-300">✖ partout</span>.
                            </div>
                            <div className="flex justify-end">
                              <Button onClick={addMember} className="rounded-2xl">
                                <Plus className="mr-2 h-4 w-4" /> Confirmer
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                  {isAdmin ? (
                    <Dialog open={newExternalOpen} onOpenChange={setNewExternalOpen}>
                      <DialogTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-2xl border-zinc-700 text-zinc-200"
                        >
                          Ajouter un externe
                        </Button>
                      </DialogTrigger>

                      <DialogContent className="border-zinc-800 bg-zinc-950 text-zinc-100">
                        <DialogHeader>
                          <DialogTitle>Ajouter un membre externe</DialogTitle>
                        </DialogHeader>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-sm text-zinc-300">Nom watcher</label>
                            <Input
                              value={newExternalMember.name}
                              onChange={(e) =>
                                setNewExternalMember((prev) => ({
                                  ...prev,
                                  name: e.target.value,
                                }))
                              }
                              placeholder="Ex : Darius"
                              className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-sm text-zinc-300">ID Discord</label>
                            <Input
                              value={newExternalMember.discordId}
                              onChange={(e) =>
                                setNewExternalMember((prev) => ({
                                  ...prev,
                                  discordId: e.target.value,
                                }))
                              }
                              placeholder="Ex : 259417928569585665"
                              className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100"
                            />
                          </div>

                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setNewExternalOpen(false)}
                              className="rounded-2xl border-zinc-700 text-zinc-200"
                            >
                              Annuler
                            </Button>

                            <Button
                              type="button"
                              onClick={addExternalMember}
                              className="rounded-2xl"
                            >
                              Créer le compte externe
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                  ) : null}
                      <Dialog open={metaDialogOpen} onOpenChange={setMetaDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="rounded-2xl border-zinc-700 bg-zinc-900" disabled={!isAdmin}>
                            <Plus className="mr-2 h-4 w-4" /> Gérer héros méta
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
                          <DialogHeader>
                            <DialogTitle>Gérer les héros méta</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                              Seul Thanatos gère cette liste.
                            </div>
                            <Badge className="w-fit rounded-xl bg-emerald-500/15 text-emerald-300">
                              {metaHeroes.length} héros méta suivis
                            </Badge>
                            <Input
                              value={heroSearch}
                              onChange={(e) => setHeroSearch(e.target.value)}
                              placeholder="Rechercher un héros dans la base..."
                              className="rounded-2xl border-zinc-700 bg-zinc-900"
                            />

                            {heroesLoading && (
                              <div className="text-sm text-zinc-400">Chargement des héros...</div>
                            )}

                            {heroesError && (
                              <div className="text-sm text-red-400">Erreur : {heroesError}</div>
                            )}

                            <ScrollArea className="h-[320px] pr-3">
                              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                                {filteredAllHeroes.map((hero) => {
                                  const isMeta = metaHeroes.includes(hero);
                                  return (
                                    <div
                                      key={hero}
                                      className={`flex items-center justify-between rounded-2xl border p-3 ${
                                        isMeta ? "border-emerald-500/30 bg-emerald-500/10" : "border-zinc-800 bg-zinc-900"
                                      }`}
                                    >
                                      <div>
                                        <div className="font-medium text-zinc-50">{hero}</div>
                                        <div className="text-xs text-zinc-400">
                                          {isMeta ? "Actuellement dans les héros méta" : "Absent des héros méta"}
                                        </div>
                                      </div>
                                      <Button
                                        onClick={() => toggleMetaHero(hero)}
                                        variant={isMeta ? "outline" : "default"}
                                        className={isMeta ? "rounded-xl border-red-500/30 bg-transparent text-red-300 hover:bg-red-500/10" : "rounded-xl"}
                                      >
                                        {isMeta ? (
                                          <>
                                            <X className="mr-2 h-4 w-4" /> Retirer
                                          </>
                                        ) : (
                                          <>
                                            <Plus className="mr-2 h-4 w-4" /> Ajouter
                                          </>
                                        )}
                                      </Button>
                                    </div>
                                  );
                                })}
                              </div>
                            </ScrollArea>
                          </div>
                        </DialogContent>
                      </Dialog>

                      <Dialog open={newDefenseOpen} onOpenChange={setNewDefenseOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="rounded-2xl border-zinc-700 bg-zinc-900" disabled={!isAdmin}>
                            <Shield className="mr-2 h-4 w-4" /> Ajouter une défense
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-3xl rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
                          <DialogHeader>
                            <DialogTitle>Ajouter une défense</DialogTitle>
                          </DialogHeader>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                              <div className="text-sm text-zinc-400">Nom de la défense</div>
                              <Input
                                value={newDefense.name}
                                onChange={(e) => setNewDefense((prev) => ({ ...prev, name: e.target.value }))}
                                placeholder="Ex: Anti dive nord"
                                className="rounded-2xl border-zinc-700 bg-zinc-900"
                              />
                            </div>

                            <div className="space-y-2">
                              <div className="text-sm text-zinc-400">Catégorie</div>
                              <Select value={newDefense.tier} onValueChange={(value) => setNewDefense((prev) => ({ ...prev, tier: value }))}>
                                <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900">
                                  <SelectValue />
                                </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="meta_s">Meta S</SelectItem>
                            <SelectItem value="meta_a">Meta A</SelectItem>
                            <SelectItem value="secondaire">Secondaire</SelectItem>
                          </SelectContent>
                              </Select>
                            </div>
                          </div>
<div className="grid gap-4 md:grid-cols-2">
  <div className="space-y-2">
    <div className="text-sm text-zinc-400">Type</div>
    <Select value={newDefense.type} onValueChange={(value) => setNewDefense((prev) => ({ ...prev, type: value }))}>
      <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="Tour">Tour</SelectItem>
        <SelectItem value="Bastion">Bastion</SelectItem>
      </SelectContent>
    </Select>
  </div>

  <div className="space-y-2">
    <div className="text-sm text-zinc-400">Faction</div>
    <Select
      value={newDefense.faction}
      onValueChange={(value) =>
        setNewDefense((prev) => ({ ...prev, faction: value }))
      }
    >
      <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900">
        <SelectValue placeholder="Choisir une faction" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="nordiste">nordiste</SelectItem>
        <SelectItem value="cauchemar">cauchemar</SelectItem>
        <SelectItem value="sentinelle">sentinelle</SelectItem>
        <SelectItem value="esoterique">esoterique</SelectItem>
        <SelectItem value="perceur">perceur</SelectItem>
        <SelectItem value="chaotique">chaotique</SelectItem>
        <SelectItem value="cultiste">cultiste</SelectItem>
        <SelectItem value="infernal">infernal</SelectItem>
        <SelectItem value="innommable">innommable</SelectItem>
        <SelectItem value="arbitre">arbitre</SelectItem>
      </SelectContent>
    </Select>
  </div>
</div>

                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                            {newDefense.slots.map((slot, index) => {
                              const matches = allHeroes
                                .filter((hero) =>
                                  hero.toLowerCase().includes((slot || "").toLowerCase())
                                )
                                .slice(0, 8);

                              return (
                                <div key={index} className="space-y-2">
                                  <div className="text-sm text-zinc-400">Héros {index + 1}</div>

                                  <Input
                                    value={slot}
                                    onChange={(e) => setDefenseSlot(index, e.target.value)}
                                    placeholder={`Nom du héros ${index + 1}`}
                                    className="rounded-2xl border-zinc-700 bg-zinc-900"
                                  />

                                  {slot && matches.length > 0 && (
                                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-2">
                                      <div className="flex flex-wrap gap-2">
                                        {matches.map((hero) => (
                                          <button
                                            key={`${index}-${hero}`}
                                            type="button"
                                            onClick={() => setDefenseSlot(index, hero)}
                                            className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
                                          >
                                            {hero}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>

                          <div className="space-y-3">
                            <div className="text-sm text-zinc-400">Image de la défense</div>
                            <label className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-700 bg-zinc-900/60 p-6 text-center hover:border-zinc-500">
                              {newDefense.image ? (
                                <img src={newDefense.image} alt="Aperçu défense" className="max-h-[220px] w-full rounded-2xl object-cover" />
                              ) : (
                                <>
                                  <ImagePlus className="mb-3 h-10 w-10 text-zinc-400" />
                                  <div className="font-medium text-zinc-200">Ajouter une image ou la glisser ici</div>
                                  <div className="mt-1 text-sm text-zinc-500">PNG, JPG, WebP</div>
                                </>
                              )}
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleDefenseImage(e.target.files?.[0] ?? null)} />
                            </label>
                          </div>

                          <div className="flex justify-end">
                            <Button onClick={confirmNewDefense} className="rounded-2xl">
                              <Upload className="mr-2 h-4 w-4" /> Confirmer
                            </Button>
                          </div>
                        </DialogContent>
                      </Dialog>

                    <Button
                    variant="outline"
                    className="rounded-2xl border-zinc-700 bg-zinc-900"
                    onClick={resetAllStatuses}
                    disabled={!isAdmin}
                    >
                            Reset statuts
                      </Button>

                      <Button
                        variant="outline"
                        className="rounded-2xl border-zinc-700 bg-zinc-900"
                        onClick={handleLogout}
                        >
                        Déconnexion
                        </Button>
                    </div>
                  </div>
<div className="flex flex-wrap gap-3">
  {profileViewTabs
    .filter((tab) => !tab.adminOnly || isAdmin)
    .map((tab) => {
      const isActive = activeProfileView === tab.key;

      return (
        <button
          key={tab.key}
          type="button"
          onClick={() => setActiveProfileView(tab.key)}
          className={`rounded-2xl border px-5 py-2 text-sm font-medium transition ${
            isActive
              ? "border-zinc-500 bg-zinc-100 text-zinc-950"
              : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
          }`}
        >
          {tab.label}
        </button>
      );
    })}
</div>
        {activeProfileView === "defense" && (
  <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
          <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl xl:col-span-7">
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-zinc-50">
                    <Users className="h-5 w-5" /> Membres
                  </CardTitle>
                  <CardDescription>Vue bibliothèque / liste principale</CardDescription>
                </div>
                <div className="relative w-full max-w-sm">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                  <Input
                    value={clusterMemberSearchQuery}
                    onChange={(e) => setClusterMemberSearchQuery(e.target.value)}
                    placeholder="Rechercher un membre..."
                    className="rounded-2xl border-zinc-700 bg-zinc-950 pl-9"
                  />
                </div>
                {clusterMemberSearchQuery.trim() && (
  <div className="mt-2 space-y-2">
    {clusterMemberSearchResults.length > 0 ? (
      clusterMemberSearchResults.map((member) => (
        <button
          key={member.id}
          type="button"
          onClick={() => {
          setActiveGuildCode(member.guild_code);
          setClusterMemberSearchQuery("");
        }}
          className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-left hover:bg-zinc-800"
        >
          <div className="font-medium text-zinc-50">
            {member.watcher_name}
          </div>
          <div className="text-sm text-zinc-400">
            Guilde : {member.guild_code}
          </div>
        </button>
      ))
    ) : (
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-500">
        Aucun joueur trouvé.
      </div>
    )}
  </div>
)}
              </div>
            </CardHeader>
<CardContent>
  {memberLimitExceeded && (
    <div className="mb-4 rounded-2xl border border-red-500/40 bg-red-500/10 p-4">
      <div className="flex items-center gap-2 text-red-300">
        <AlertTriangle className="h-4 w-4" />
        <span className="font-medium">
          Alerte : ce dashboard contient plus de 30 membres.
        </span>
      </div>
    </div>
  )}

  <div className="overflow-hidden rounded-2xl border border-zinc-800">
    <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800 hover:bg-transparent">
                    <TableHead className="text-zinc-300 font-semibold">
  <button
    type="button"
    onClick={cycleMemberAssignmentSortMode}
    className="flex items-center gap-2 hover:text-emerald-300"
  >
    <span>Nom</span>

    <Badge className="rounded-xl bg-zinc-800 text-zinc-300 text-xs">
      {memberAssignmentSortMode === "alpha"
        ? "A → Z"
        : memberAssignmentSortMode === "tour_first"
        ? "Tours"
        : "Bastions"}
    </Badge>
  </button>
</TableHead>

                    <TableHead className="text-zinc-300 font-semibold">Statut</TableHead>
                    <TableHead className="text-zinc-300 font-semibold">Complétion</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead className="w-[120px] text-left pl-2">Éveils</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
{filteredMembers.map((member, index) => {
  const completion = trackedMetaDefense
    ? getMemberDefenseCompletion(member, trackedMetaDefense)
    : 0;
  return (
    <TableRow
      key={member.id}
      className={`cursor-pointer border-zinc-800 ${
        memberLimitExceeded && latestMember?.id === member.id
          ? "bg-red-500/20 hover:bg-red-500/25"
          : selectedId === member.id
          ? "bg-zinc-800/60"
          : "hover:bg-zinc-900"
      }`}
      onClick={() => setSelectedId(member.id)}
    >
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="rounded-2xl">
            <AvatarFallback className="rounded-2xl bg-zinc-800 text-zinc-200">
              {index + 1}
            </AvatarFallback>
          </Avatar>
<div>
  <div className="flex items-center gap-2">
    <div className="font-medium text-zinc-50">
      {member.name}
    </div>

    <Select
      value={member.assignment || "Tour"}
      onValueChange={(value) => setMemberAssignment(member.id, value)}
      disabled={!isAdmin}
    >
      <SelectTrigger
        className="h-6 w-[80px] rounded-lg border-zinc-700 bg-zinc-900 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <SelectValue />
      </SelectTrigger>

      <SelectContent onClick={(e) => e.stopPropagation()}>
        <SelectItem value="Tour">Tour</SelectItem>
        <SelectItem value="Bastion">Bastion</SelectItem>
        <SelectItem value="Bulle">Bulle</SelectItem>
      </SelectContent>
    </Select>
  </div>

  <div className="text-xs text-zinc-300">
    {member.defense1} / {member.defense2}
  </div>
</div>
                            </div>
                          </TableCell>

                          <TableCell>
                            <Badge
                            className={
                            member.status === "Validé"
                            ? "rounded-xl bg-emerald-500/15 text-emerald-300"
                            : member.status === "À vérifier"
                            ? "rounded-xl bg-amber-500/15 text-amber-300"
                            : "rounded-xl bg-red-500/15 text-red-300"
                            }
                            >
                            {member.status}
                            </Badge>
                          </TableCell>
                        <TableCell>
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-zinc-800">
                            <div
                                className={
                                completion === 100
                                    ? "h-full bg-emerald-400"
                                    : completion === 50
                                    ? "h-full bg-amber-400"
                                    : "h-full bg-zinc-600"
                                }
                                style={{ width: `${completion}%` }}
                            />
                            </div>
                            <span
                            className={
                                completion === 100
                                ? "text-sm font-medium text-emerald-300"
                                : completion === 50
                                ? "text-sm font-medium text-amber-300"
                                : "text-sm font-medium text-zinc-400"
                            }
                            >
                            {completion}%
                            </span>
                        </div>
                        </TableCell>
                        <TableCell>
  {trackedMetaDefense ? (() => {
    const score = getMemberTrackedDefenseScore(member, trackedMetaDefense);

    if (score === null) {
      return <span className="text-zinc-500">Null</span>;
    }

    return (
      <button
        type="button"
        onClick={() => {
          setScoreDetailMember(member);
          setScoreDetailDefense(trackedMetaDefense);
          setScoreDetailOpen(true);
        }}
        className="rounded-xl px-2 py-1 text-sm text-emerald-300 hover:bg-zinc-800"
      >
        {score}
      </button>
    );
  })() : (
    <span className="text-zinc-500">—</span>
  )}
</TableCell>
<TableCell className="w-[120px] pl-2">
  <div className="relative flex items-center justify-start">
    <Badge
      className={
        member.awakeningStatus === "OK"
          ? "rounded-xl bg-emerald-500/15 text-emerald-300"
          : "rounded-xl bg-sky-500/15 text-sky-300"
      }
    >
      {member.awakeningStatus === "OK" ? "OK" : "En attente"}
    </Badge>

<Button
  size="icon"
  variant="ghost"
  className="absolute right-0 rounded-xl text-amber-300 hover:text-amber-200"
  onClick={(e) => {
    e.preventDefault();
    e.stopPropagation();
    openTransferDialog(member);
  }}
  disabled={!isAdmin}
  title="Transférer ce joueur"
>
  <ArrowRightLeft className="h-4 w-4" />
</Button>
  </div>
</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card className="h-full rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl xl:col-span-5">
            <CardHeader>
              <CardTitle className="text-zinc-50">Profil sélectionné</CardTitle>
              <CardDescription>Édition rapide des éveils et aperçu du joueur</CardDescription>
            </CardHeader>
<CardContent className="flex flex-col gap-5">
  {!selectedMember ? (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-zinc-300">
        Aucun membre dans cette guilde pour le moment.
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
        Tu peux maintenant ajouter le premier membre de cette guilde avec le bouton
        "Ajouter un membre".
      </div>
    </div>
  ) : (
    <>
      <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Avatar className="h-14 w-14 rounded-2xl">
                    <AvatarFallback className="rounded-2xl bg-zinc-800 text-lg">
                        {selectedMember.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                    </Avatar>
                    <div>
                    <div className="text-xl font-semibold text-zinc-50">{selectedMember.name}</div>
                    <div className="text-sm text-zinc-300">{selectedMember.assignment}</div>

<div className="mt-2 space-y-2">
  <div className="text-xs text-zinc-400">Post forum personnel</div>

  <div className="flex gap-2">
        <Input
        value={forumPostUrlInput}
        onChange={(e) => setForumPostUrlInput(e.target.value)}
        placeholder="https://discord.com/channels/..."
        className="h-9 rounded-xl border-zinc-600 bg-zinc-800 text-zinc-100 placeholder:text-zinc-500"
        onClick={(e) => e.stopPropagation()}
        />

<Button
  size="sm"
  variant="outline"
  className="rounded-xl border-zinc-700 bg-zinc-900"
  onClick={() => savePersonalForumPostUrl(selectedMember.id)}
  disabled={!isAdmin}
>  
      Enregistrer
    </Button>
  </div>

        {selectedMember.personalForumPostUrl && (
            <div className="flex gap-2">
            <button
                type="button"
                className="text-xs text-sky-300 underline underline-offset-2 hover:text-sky-200"
                onClick={(e) => {
                e.stopPropagation();

                const appUrl = selectedMember.personalForumPostUrl.replace(
                    "https://discord.com/channels/",
                    "discord://-/channels/"
                );

                window.location.href = appUrl;
                }}
            >
                Ouvrir Discord
            </button>

            <a
                href={selectedMember.personalForumPostUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-zinc-400 underline underline-offset-2 hover:text-zinc-200"
                onClick={(e) => e.stopPropagation()}
            >
                Navigateur
            </a>
            </div>
        )}
        </div>
                    </div>
                </div>

                <div className="flex gap-2">

                <Button
                size="sm"
                className="rounded-xl bg-red-600 text-white hover:bg-red-500"
                onClick={() => setTodoMember(selectedMember.id)}
                disabled={!isAdmin}
                >
                À faire
                </Button>

                <Button
                size="sm"
                className="rounded-xl bg-amber-500 text-black hover:bg-amber-400"
                onClick={() => setVerifyMember(selectedMember.id)}
                disabled={!isAdmin}
                >
                À vérifier
                </Button>

                <Button
                size="sm"
                className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
                onClick={() => validateMember(selectedMember.id)}
                disabled={!isAdmin}
                >
                Valider
                </Button>

                </div>

                </div>
            

<Dialog open={messageDialogOpen} onOpenChange={setMessageDialogOpen}>
{false && (
  <Button
    className="w-fit rounded-2xl"
    onClick={() => requestAwakeningUpdate(selectedMember.id)}
    disabled={!isAdmin}
  >
    <Send className="mr-2 h-4 w-4" /> Demander les éveils
  </Button>
)}

{false && (
  <Button
    className="w-fit rounded-2xl"
    onClick={() => sendDefenseToMember(selectedMember.id)}
    disabled={!isAdmin || sendingDefense}
  >
    <Send className="mr-2 h-4 w-4" />
    {sendingDefense ? "Envoi en cours..." : "Envoyer défense"}
  </Button>
)}

  <DialogContent className="max-w-lg rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
        <DialogTitle>
        {messageDialogState.status === "loading"
            ? "Envoi en cours"
            : messageDialogState.status === "success"
            ? "Message Discord envoyé"
            : "Échec de l’envoi"}
        </DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div
        className={`rounded-2xl border p-4 ${
        messageDialogState.status === "success"
            ? "border-emerald-500/30 bg-emerald-500/10"
            : messageDialogState.status === "loading"
            ? "border-sky-500/30 bg-sky-500/10"
            : "border-red-500/30 bg-red-500/10"
        }`}
      >
        <div
        className={`text-sm font-medium ${
        messageDialogState.status === "success"
            ? "text-emerald-300"
            : messageDialogState.status === "loading"
            ? "text-sky-300"
            : "text-red-300"
        }`}
        >
            {messageDialogState.status === "loading"
            ? "Envoi en cours, veuillez patienter..."
            : messageDialogState.status === "success"
            ? "Le message privé a bien été envoyé sur Discord."
            : "Le message privé n’a pas pu être envoyé."}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="mb-2 text-sm text-zinc-400">Destinataire</div>
        <div className="font-medium text-zinc-50">
          {messageDialogState.memberName}
        </div>
        <div className="text-sm text-zinc-300">
          ID Discord : {messageDialogState.discordId}
        </div>
      </div>

      <div className="flex justify-end">
        <Button
        onClick={() => setMessageDialogOpen(false)}
        disabled={messageDialogState.status === "loading"}
        className="rounded-2xl"
        >
        Fermer
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>

                    <div className="grid grid-cols-2 gap-3">
                        <div className={`rounded-2xl border p-4 ${defense1Tone.card}`}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-xs text-zinc-400">Défense 1</div>
                            <Badge className={defense1Tone.badge}>
                            {selectedDefense1 ? defense1Tone.label : "Aucune"}
                            </Badge>
                        </div>

                        <div className="font-medium text-zinc-50">
                            {selectedDefense1?.name || "—"}
                        </div>

                        <div className="mt-1 text-xs text-zinc-400">
                            {selectedDefense1
                            ? `${selectedDefense1.tier} • ${selectedDefense1.type}`
                            : "Aucune défense assignée"}
                        </div>

            {selectedDefense1 && (
              <div className="mt-4 flex justify-between gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl border-zinc-700 bg-transparent"
                  onClick={() => openDefensePreview(selectedDefense1)}
                  disabled={!selectedDefense1?.image}
                  title="Voir l’image complète"
                >
                  👀
                </Button>

                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl border-zinc-700 bg-transparent"
                  onClick={() => clearAssignedDefense(1)}
                  disabled={!isAdmin}
                >
                  Retirer
                </Button>
              </div>
)}
                        </div>

                    <div className={`rounded-2xl border p-4 ${defense2Tone.card}`}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="text-xs text-zinc-400">Défense 2</div>
                        <Badge className={defense2Tone.badge}>
                        {selectedDefense2 ? defense2Tone.label : "Aucune"}
                        </Badge>
                    </div>

                    <div className="font-medium text-zinc-50">
                        {selectedDefense2?.name || "—"}
                    </div>

                    <div className="mt-1 text-xs text-zinc-400">
                        {selectedDefense2
                        ? `${selectedDefense2.tier} • ${selectedDefense2.type}`
                        : "Aucune défense assignée"}
                    </div>

{selectedDefense2 && (
  <div className="mt-4 flex justify-between gap-2">
    <Button
      size="sm"
      variant="outline"
      className="rounded-xl border-zinc-700 bg-transparent"
      onClick={() => openDefensePreview(selectedDefense2)}
      disabled={!selectedDefense2?.image}
      title="Voir l’image complète"
    >
      👀
    </Button>

    <Button
      size="sm"
      variant="outline"
      className="rounded-xl border-zinc-700 bg-transparent"
      onClick={() => clearAssignedDefense(2)}
      disabled={!isAdmin}
    >
      Retirer
    </Button>
  </div>
)}
                    </div>
                    </div>


                    <div className="flex flex-1 flex-col space-y-3 overflow-hidden">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div className="flex items-center gap-3">
                        <div className="font-medium text-zinc-50">Défenses compatibles</div>
                        <Badge className="rounded-xl bg-zinc-800 text-zinc-300">
                            {visibleCompatibleDefenses.filter((d) => d.analysis.isCompatible).length} / {visibleCompatibleDefenses.length}
                        </Badge>
                        </div>

<Select value={compatibleTierFilter} onValueChange={setCompatibleTierFilter}>
  <SelectTrigger className="w-[180px] rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
    <SelectValue placeholder="Filtrer par tier" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="Tous">Tous les tiers</SelectItem>
    <SelectItem value="meta_s">Meta S</SelectItem>
    <SelectItem value="meta_a">Meta A</SelectItem>
    <SelectItem value="secondaire">Secondaire</SelectItem>
  </SelectContent>
</Select>
                    </div>

                <ScrollArea className="flex-1 pr-3">
                  <div className="space-y-3">
                    {visibleCompatibleDefenses.map((defense) => (
                      <div
                        key={defense.id}
                        className={`rounded-2xl border p-4 ${
                          defense.analysis.isCompatible
                            ? "border-emerald-500/30 bg-emerald-500/10"
                            : "border-red-500/30 bg-red-500/10"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium text-zinc-50">{defense.name}</div>
                        <div className="text-sm text-zinc-300">
                        {defense.tier} • {defense.type} • Score éveils : {defense.awakeningScore}
                        </div>
                          </div>

                          <Badge
                            className={
                              defense.analysis.isCompatible
                                ? "rounded-xl bg-emerald-500/15 text-emerald-300"
                                : "rounded-xl bg-red-500/15 text-red-300"
                            }
                          >
                            {defense.analysis.isCompatible ? "Compatible" : "Incompatible"}
                          </Badge>
                        </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {defense.slots.map((slot) => {
                      const awakening = selectedMember?.awakenings?.[slot] ?? -1;

                      return (
                        <Badge
                          key={`${defense.id}-${slot}`}
                          variant="outline"
                          className="rounded-xl border-zinc-700 text-zinc-200"
                        >
                          {slot} {awakening >= 0 ? `A${awakening}` : ""}
                        </Badge>
                      );
                    })}
                  </div>

                        {!defense.analysis.isCompatible && (
                          <div className="mt-3 space-y-2 text-sm">
                            {defense.analysis.missingHeroes.length > 0 && (
                              <div className="text-red-300">
                                Héros manquants : {defense.analysis.missingHeroes.join(", ")}
                              </div>
                            )}

                            {defense.analysis.unmetConditions.length > 0 && (
                              <div className="text-amber-300">
                                Éveils insuffisants :{" "}
                                {defense.analysis.unmetConditions
                                  .map((c) => `${c.hero} A${c.minAwakening}`)
                                  .join(", ")}
                              </div>
                            )}
                          </div>
                        )}
<div className="mt-4 flex flex-wrap items-center gap-2">
  <Button
    size="sm"
    className="rounded-xl bg-zinc-950 text-zinc-100 hover:bg-zinc-900"
    onClick={() => assignDefense(1, defense)}
    disabled={!isAdmin}
  >
    Mettre en Défense 1
  </Button>

  <Button
    size="sm"
    className="rounded-xl bg-zinc-950 text-zinc-100 hover:bg-zinc-900"
    onClick={() => assignDefense(2, defense)}
    disabled={!isAdmin}
  >
    Mettre en Défense 2
  </Button>

  <Button
    size="sm"
    variant="outline"
    className="rounded-xl border-zinc-700 bg-transparent"
    onClick={() => openDefensePreview(defense)}
    disabled={!defense?.image}
    title="Voir l’image complète"
  >
    👀
  </Button>
</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </>
          )}
        </CardContent>
          </Card>
        </div>
)}

{activeProfileView === "run_search" && (
  <div className="p-4">
    <RunSearchGrid />
  </div>
)}
{activeProfileView === "gestion_guildes" && (
<GestionDefenseTab
  members={filteredMembers}
  allMembers={members}
  activeGuildCode={activeGuildCode}
  trackedMetaDefense={trackedMetaDefense}
  setTrackedMetaDefense={setSelectedMetaDefenseForCompletion}
  metaDefenseCounters={metaDefenseCounters}
  setTodoMember={setTodoMember}
  setVerifyMember={setVerifyMember}
  validateMember={validateMember}
  openTransferDialog={openTransferDialog}
  setTransferDialogOpen={setTransferDialogOpen}
  setMemberToTransfer={setMemberToTransfer}
  setTargetGuildCode={setTargetGuildCode}
  setMemberAssignment={setMemberAssignment}
  defenses={defenses}
  clearAssignedDefense={clearAssignedDefense}
  assignDefense={assignDefense}
  setSelectedId={setSelectedId}
  isAdmin={isAdmin}
  setDefenseVote={setDefenseVote}
defenseLikesCountByRootId={defenseLikesCountByRootId}
defenseDislikesCountByRootId={defenseDislikesCountByRootId}
defenseVoteByRootId={defenseVoteByRootId}
getDefenseLikeTargetId={getDefenseLikeTargetId}
/>
)}
{activeProfileView === "admin_defenses" && (
<AdminDefensesTab
  defenses={defenses}
  onEdit={(defense) => {
    setNewDefense({
      ...defense,
      slots: defense.slots || ["", "", "", "", ""],
      conditions: defense.conditions || [],
      image: defense.image || defense.image_url || "",
    });
    setNewDefenseOpen(true);
  }}
  onDelete={deleteDefense}
  onAdd={() => {
    setNewDefense({
      id: 0,
      name: "",
      tier: "meta_s",
      type: "Tour",
      faction: "",
      slots: ["", "", "", "", ""],
      conditions: [],
      image: "",
    });
    setNewDefenseOpen(true);
  }}
onAddCondition={(defense) => {
  setConditionDefenseId(String(defense.id));
  setConditionDialogOpen(true);
}}
/>
)}
{activeProfileView === "mon_suivi" && (
  <MonSuiviTab selectedMember={selectedMember} defenses={defenses} />
)}
{activeProfileView === "run_add" && <RunAddTab />}
{activeProfileView === "run_edit" && <RunEditTab />}
{activeProfileView === "gvg_current" && <GvgCurrentTab />}
{activeProfileView === "gvg_admin" && <GvgAdminTab />}
{activeProfileView === "gvg_panel" && <GvgPanelTab />}

{activeProfileView === "awakening" && (
  <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
    <CardContent className="p-0">
      {!selectedMember ? (
        <div className="p-8 text-zinc-400">
          Aucun membre sélectionné.
        </div>
      ) : (
        <div className="grid min-h-[780px] grid-cols-1 xl:grid-cols-[220px_1fr]">
          <div className="border-b border-zinc-800 p-5 xl:border-b-0 xl:border-r">
            <div className="mb-4">
              <div className="text-lg font-semibold text-zinc-50">Éveils</div>
              <div className="text-sm text-zinc-400">
                {selectedMember.name}
              </div>
            </div>

<div className="space-y-4">
  <div>
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
      Factions
    </div>

    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setAwakeningFactionFilter("Tous")}
        className={`w-full rounded-2xl border px-4 py-3 text-left font-medium transition ${
          awakeningFactionFilter === "Tous"
            ? "border-yellow-500 bg-yellow-400 text-black"
            : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
        }`}
      >
        Toutes
      </button>

      {heroFaction.map((faction) => (
        <button
          key={faction}
          type="button"
          onClick={() => setAwakeningFactionFilter(faction)}
          className={`w-full rounded-2xl border px-4 py-3 text-left font-medium capitalize transition ${
            awakeningFactionFilter === faction
              ? "border-yellow-500 bg-yellow-400 text-black"
              : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          {faction}
        </button>
      ))}
    </div>
  </div>

  <div className="border-t border-zinc-800 pt-4">
    <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
      Rôles
    </div>

    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setAwakeningRoleFilter("Tous")}
        className={`w-full rounded-2xl border px-4 py-3 text-left font-medium transition ${
          awakeningRoleFilter === "Tous"
            ? "border-cyan-500 bg-cyan-400 text-black"
            : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
        }`}
      >
        Tous
      </button>

      {availableHeroRoles.map((role) => (
        <button
          key={role}
          type="button"
          onClick={() => setAwakeningRoleFilter(role)}
          className={`w-full rounded-2xl border px-4 py-3 text-left font-medium capitalize transition ${
            awakeningRoleFilter === role
              ? "border-cyan-500 bg-cyan-400 text-black"
              : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
          }`}
        >
          {role}
        </button>
      ))}
    </div>
  </div>

  <div className="border-t border-zinc-800 pt-4">
    <Button
      type="button"
      variant="outline"
      onClick={resetAwakeningFilters}
      className="w-full rounded-2xl border-zinc-700 text-zinc-200"
    >
      Reset filtres
    </Button>
  </div>
</div>
          </div>

          <div className="p-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-zinc-50">
                  Box d’éveils
                </div>
                <div className="text-sm text-zinc-400">
                  {filteredMetaHeroes.length} héros affiché(s)
                </div>
              </div>

              <Button
                size="sm"
                className="rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
                onClick={() => confirmNoMoreAwakenings(selectedMember.id)}
                disabled={!canEditAwakenings}
              >
                Pas plus d’éveils
              </Button>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {filteredMetaHeroes.map((hero) => {
                const value = selectedMember.awakenings?.[hero] ?? -1;

                return (
                  <div
                    key={hero}
                    className="flex items-center justify-between gap-3 rounded-[26px] border border-zinc-800 bg-black px-4 py-3"
                    title={hero}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <img
                        src={getHeroImageUrl(hero)}
                        alt={hero}
                        className="h-16 w-16 rounded-full object-cover"
                      />
                    </div>

                    <Select
                      value={String(value)}
                      onValueChange={(v) => setAwakening(hero, Number(v))}
                      disabled={!canEditAwakenings}
                    >
                      <SelectTrigger
                        className={`h-12 w-[120px] rounded-[18px] border text-xl ${
                          value === 5
                            ? "border-yellow-500 bg-yellow-500/10 text-yellow-400"
                            : awakeningTone(value)
                        }`}
                      >
                        <SelectValue placeholder={awakeningLabel(value)} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="-1">✖</SelectItem>
                        <SelectItem value="0">0</SelectItem>
                        <SelectItem value="1">1</SelectItem>
                        <SelectItem value="2">2</SelectItem>
                        <SelectItem value="3">3</SelectItem>
                        <SelectItem value="4">4</SelectItem>
                        <SelectItem value="5">5</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </CardContent>
  </Card>
)}

{activeProfileView === "pb" && (
  <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
    <CardHeader className="pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={pbSortMode === "top1" ? "default" : "outline"}
          className="rounded-2xl"
          onClick={() => setPbSortMode("top1")}
        >
          Trier Top 1
        </Button>

        <Button
          type="button"
          variant={pbSortMode === "top3" ? "default" : "outline"}
          className="rounded-2xl"
          onClick={() => setPbSortMode("top3")}
        >
          Trier Top 3
        </Button>

        <Button
          type="button"
          variant={pbSortMode === "top5" ? "default" : "outline"}
          className="rounded-2xl"
          onClick={() => setPbSortMode("top5")}
        >
          Trier Top 5
        </Button>
      </div>
    </CardHeader>

<CardContent className="p-0">
  <div className="overflow-x-auto">
    <div className="min-w-[964px]">
      <div className="grid grid-cols-[160px_repeat(5,132px)_72px_72px_72px_72px] border-b border-zinc-800 bg-zinc-950/40">
            <div className="p-3 text-lg font-semibold text-zinc-50">Nom</div>
            <div className="p-3 text-center text-lg font-semibold text-zinc-50">Affi 1</div>
            <div className="p-3 text-center text-lg font-semibold text-zinc-50">Affi 2</div>
            <div className="p-3 text-center text-lg font-semibold text-zinc-50">Affi 3</div>
            <div className="p-3 text-center text-lg font-semibold text-zinc-50">Affi 4</div>
            <div className="p-3 text-center text-lg font-semibold text-zinc-50">Affi 5</div>
            <div className="p-2 text-center text-sm font-semibold text-zinc-50">Top 1</div>
            <div className="p-3 text-center text-sm font-semibold text-zinc-50">Top 3</div>
            <div className="p-3 text-center text-sm font-semibold text-zinc-50">Top 5</div>
            <div className="p-3 text-center text-sm font-semibold text-zinc-50">Date</div>
          </div>

          {pbRows.map((row, rowIndex) => {
            const member = members.find((m) => m.id === row.memberId);
            const isOutdated = isPbOutdated(row.updatedAt);
            const canEditPbRow = isAdmin || String(row.memberId) === String(session?.memberId);

            return (
<div
  key={row.memberId}
onClick={() => {
  setPbEditDialogOpen(false);
  setPbSlotToEdit(null);
  setPbSelectedMember(member);
  setPbRowDetailOpen(true);
}}
className={`grid grid-cols-[160px_repeat(5,132px)_72px_72px_72px_72px] cursor-pointer border-b border-zinc-800 transition ${
  isOutdated
    ? "bg-red-500/10"
    : rowIndex % 2 === 0
    ? "bg-[#0f172a]"
    : "bg-[#1e293b]"
} ${!isOutdated ? "hover:bg-[#334155]" : ""}`}
>
                <div className="flex items-center gap-2 p-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-800 text-base font-semibold text-zinc-200">
                    {rowIndex + 1}
                  </div>
                  <div className="truncate text-base font-medium text-zinc-50">
                    {row.memberName}
                  </div>
                </div>

                {row.slots.map((slot, slotIndex) => {
                  if (!slot) {
                    return (
                      <div key={`${row.memberId}-empty-${slotIndex}`} className="p-2">
                        <div className="flex h-[58px] items-center justify-center rounded-2xl border border-dashed border-zinc-700 bg-zinc-950 text-xs text-zinc-500">
                          Vide
                        </div>
                      </div>
                    );
                  }

                  const awakeningValue =
                    slot.championName && member?.awakenings
                      ? member.awakenings[slot.championName] ?? -1
                      : -1;

                  const isLord = slot.championLord === "lord";

                  return (
<div key={slot.id} className="p-2">
  <button
    type="button"
    disabled={!canEditPbRow}
    onClick={(e) => {
      e.stopPropagation();
      if (!canEditPbRow) return;
      setPbRowDetailOpen(false);
      setPbSelectedMember(null);
      openPbEditDialog(slot, row.memberId);
    }}
    className={`flex h-[52px] w-full items-center justify-between gap-1 rounded-xl border bg-zinc-950 px-2 text-left transition ${
      isLord
        ? "border-yellow-500/70 hover:bg-zinc-900"
        : "border-zinc-700 hover:bg-zinc-900"
    } ${!canEditPbRow ? "cursor-not-allowed opacity-70" : ""}`}
  >
<div className="shrink-0">
  {slot.championName ? (
    <img
      src={getHeroImageUrl(slot.championName)}
      alt={slot.championName}
      className="h-8 w-8 rounded-full object-cover"
    />
  ) : (
    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-500">
      ?
    </div>
  )}
</div>

<div className="flex flex-1 items-center justify-end pr-2">
  <div className="text-lg font-semibold text-white tracking-tight">
    {formatPbAverage(
      getDisplayedPbValue(
        slot,
        members.find((m) => m.id === row.memberId)
      )
    )}
  </div>
</div>
</button>
</div>
                  );
                })}


<div className="flex items-center justify-center p-2 text-xs font-semibold text-zinc-200">
  {formatPbAverage(row.top1)}
</div>
<div className="flex items-center justify-center p-3 text-sm font-semibold text-zinc-200">
  {formatPbAverage(row.top3)}
</div>
<div className="flex items-center justify-center p-3 text-sm font-semibold text-zinc-200">
  {formatPbAverage(row.top5)}
</div>
<div className="flex items-center justify-center p-2 text-xs text-zinc-300">
  {row.updatedAt
    ? new Date(row.updatedAt).toLocaleDateString("fr-FR", {
  day: "2-digit",
  month: "2-digit",
})
    : "—"}
</div>              </div>
            );
          })}
        </div>
      </div>
    </CardContent>
  </Card>
)}

{activeProfileView === "demon" && (
  <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
    <CardContent className="p-0">
      {!selectedMember ? (
        <div className="p-8 text-zinc-400">
          Aucun membre sélectionné.
        </div>
      ) : (
        <div className="grid min-h-[780px] grid-cols-1 xl:grid-cols-[220px_1fr]">
          <div className="border-b border-zinc-800 p-5 xl:border-b-0 xl:border-r">
            <div className="mb-4">
              <div className="text-lg font-semibold text-zinc-50">
                Monstres démoniaques
              </div>
              <div className="text-sm text-zinc-400">
                {selectedMember.name}
              </div>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setDemonRarityFilter("Tous")}
                className={`w-full rounded-2xl border px-4 py-3 text-left font-medium transition ${
                  demonRarityFilter === "Tous"
                    ? "border-yellow-500 bg-yellow-400 text-black"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                Tous
              </button>

              <button
                type="button"
                onClick={() => setDemonRarityFilter("mythique")}
                className={`w-full rounded-2xl border px-4 py-3 text-left font-medium transition ${
                  demonRarityFilter === "mythique"
                    ? "border-yellow-500 bg-yellow-400 text-black"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                Mythique
              </button>

              <button
                type="button"
                onClick={() => setDemonRarityFilter("legendaire")}
                className={`w-full rounded-2xl border px-4 py-3 text-left font-medium transition ${
                  demonRarityFilter === "legendaire"
                    ? "border-yellow-500 bg-yellow-400 text-black"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                Légendaire
              </button>

              <button
                type="button"
                onClick={() => setDemonRarityFilter("epique")}
                className={`w-full rounded-2xl border px-4 py-3 text-left font-medium transition ${
                  demonRarityFilter === "epique"
                    ? "border-yellow-500 bg-yellow-400 text-black"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                Épique
              </button>

              <button
                type="button"
                onClick={() => setDemonRarityFilter("rare")}
                className={`w-full rounded-2xl border px-4 py-3 text-left font-medium transition ${
                  demonRarityFilter === "rare"
                    ? "border-yellow-500 bg-yellow-400 text-black"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                Rare
              </button>
            </div>
          </div>

          <div className="p-5">
            <div className="mb-5">
              <div className="text-lg font-semibold text-zinc-50">
                Box monstres démoniaques
              </div>
              <div className="text-sm text-zinc-400">
                {demonicMonsterCards.length} monstre(s) affiché(s)
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
              {demonicMonsterCards.map((monster) => (
                <div
                  key={monster.id}
                  className="rounded-3xl border border-zinc-800 bg-zinc-950 p-4"
                >
                  <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-black">
                    <img
                      src={getDemonicMonsterImageUrl(monster.slug)}
                      alt={monster.name}
                      className={`h-[260px] w-full object-contain transition ${
                        monster.level > 0 ? "" : "grayscale opacity-40"
                      }`}
                    />

<button
  type="button"
  onClick={() => openDemonLevelDialog(monster)}
  disabled={!canEditDemonicMonsters}
  className={`absolute bottom-4 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full border-2 text-xl font-bold text-white shadow-lg transition ${
    canEditDemonicMonsters
      ? "border-zinc-500 bg-zinc-700 hover:scale-105 hover:bg-zinc-600"
      : "cursor-not-allowed border-zinc-700 bg-zinc-800 opacity-60"
  }`}
  title={
    canEditDemonicMonsters
      ? "Renseigner le niveau"
      : "Modification non autorisée"
  }
>
  {monster.level > 0 ? monster.level : "?"}
</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </CardContent>
  </Card>
)}
{activeProfileView === "soulstones" && (
  <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
    <CardContent className="p-8">
      {!selectedMember ? (
        <div className="text-zinc-400">Aucun membre sélectionné.</div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-zinc-50">
                Pierre d’âme
              </div>
              <div className="text-sm text-zinc-400">
                {selectedMember.name}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setSoulStoneView("mes-pierres")}
                className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                  soulStoneView === "mes-pierres"
                    ? "border-zinc-500 bg-zinc-100 text-zinc-950"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
                }`}
              >
                Mes pierres
              </button>

              <button
                type="button"
                onClick={() => setSoulStoneView("historique")}
                className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                  soulStoneView === "historique"
                    ? "border-zinc-500 bg-zinc-100 text-zinc-950"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
                }`}
              >
                Historique
              </button>

              <button
                type="button"
                onClick={() => setSoulStoneView("classement")}
                className={`rounded-2xl border px-4 py-2 text-sm font-medium transition ${
                  soulStoneView === "classement"
                    ? "border-zinc-500 bg-zinc-100 text-zinc-950"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
                }`}
              >
                Classement
              </button>
            </div>
          </div>

          {/* ✅ AJOUT ICI */}
          <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-200">
            <span className="font-semibold text-yellow-300">⚠️ Important :</span>{" "}
            Merci de renseigner le <span className="font-semibold">total réel</span> de vos pierres d’âme.
            <br />
            Cela comprend <span className="font-semibold">votre inventaire</span> 
            <span className="mx-1">+</span>
            les pierres déjà <span className="font-semibold">utilisées sur vos héros</span>.
          </div>

          {soulStonesLoading ? (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-400">
              Chargement des pierres d’âme...
            </div>
          ) : (
            <>
              {soulStoneView === "mes-pierres" && (
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                  <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-zinc-50">
                          Pierre Lord
                        </div>
                        <div className="text-sm text-zinc-400">
                          Total : {totalLordSoulStones}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-2xl border-zinc-700 bg-zinc-900"
                          onClick={() => removeLastSoulStone("lord")}
                          disabled={!canEditSoulStones}
                        >
                          -
                        </Button>

                        <Button
                          type="button"
                          className="rounded-2xl"
                          onClick={() => addSoulStone("lord")}
                          disabled={!canEditSoulStones}
                        >
                          +
                        </Button>
                      </div>
                    </div>

                    <div className="mb-4 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900">
                      <img
                        src="/soul-stones/lord.png"
                        alt="Pierre Lord"
                        className="h-[220px] w-full object-contain"
                      />
                    </div>

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
                      Dernière pierre d’âme reçue :{" "}
                      {lastLordSoulStoneDate
                        ? new Date(lastLordSoulStoneDate).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })
                        : "—"}
                    </div>
                  </div>

                  <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold text-zinc-50">
                          Pierre Brute
                        </div>
                        <div className="text-sm text-zinc-400">
                          Total : {totalBruteSoulStones}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-2xl border-zinc-700 bg-zinc-900"
                          onClick={() => removeLastSoulStone("brute")}
                          disabled={!canEditSoulStones}
                        >
                          -
                        </Button>

                        <Button
                          type="button"
                          className="rounded-2xl"
                          onClick={() => addSoulStone("brute")}
                          disabled={!canEditSoulStones}
                        >
                          +
                        </Button>
                      </div>
                    </div>

                    <div className="mb-4 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900">
                      <img
                        src="/soul-stones/brute.png"
                        alt="Pierre Brute"
                        className="h-[220px] w-full object-contain"
                      />
                    </div>

                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
                      Dernière pierre d’âme reçue :{" "}
                      {lastBruteSoulStoneDate
                        ? new Date(lastBruteSoulStoneDate).toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                          })
                        : "—"}
                    </div>
                  </div>
                </div>
              )}

              {soulStoneView === "historique" && (
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
                  <div className="mb-4 text-lg font-semibold text-zinc-50">
                    Historique
                  </div>

                  <div className="space-y-3">
                    {soulStones.length > 0 ? (
                      soulStones.map((stone) => (
                        <div
                          key={stone.id}
                          className="flex items-center justify-between rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
                        >
                          <div className="font-medium text-zinc-100">
                            {stone.type === "lord" ? "Pierre Lord" : "Pierre Brute"}
                          </div>

                          <div className="text-sm text-zinc-400">
                            {stone.createdAt
                              ? new Date(stone.createdAt).toLocaleDateString("fr-FR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                })
                              : "—"}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                        Aucun historique.
                      </div>
                    )}
                  </div>
                </div>
              )}

              {soulStoneView === "classement" && (
                <div className="rounded-3xl border border-zinc-800 bg-zinc-950 p-6">
                  <div className="mb-4 text-lg font-semibold text-zinc-50">
                    Classement du cluster
                  </div>

                  <div className="space-y-4">
<div className="grid grid-cols-[1fr_100px_100px_100px] gap-4 px-4 text-sm text-zinc-400">
  <div>Joueur</div>
  <div className="text-center">Lord</div>
  <div className="text-center">Brute</div>
  <div className="text-center">Total</div>
</div>

                    {clusterSoulStonesLoading ? (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                        Chargement du classement...
                      </div>
                    ) : clusterSoulStoneRows.length > 0 ? (
                      clusterSoulStoneRows.map((row, index) => (
                        <div
                          key={row.memberId}
                          className="grid grid-cols-[1fr_100px_100px_100px] items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
                        >
                          <div className="flex items-center gap-3">
                            <div className="text-sm text-zinc-500">
                              #{index + 1}
                            </div>
                            <div className="font-medium text-zinc-100">
                              {row.watcherName}
                            </div>
                          </div>

                          <div className="text-center font-semibold text-yellow-400">
                            {row.lord}
                          </div>

                          <div className="text-center font-semibold text-zinc-200">
                            {row.brute}
                          </div>

                          <div className="text-center font-bold text-emerald-400">
                            {row.total}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                        Aucun classement disponible.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </CardContent>
  </Card>
)}
            <Dialog open={metaCounterDialogOpen} onOpenChange={setMetaCounterDialogOpen}>
            <DialogContent className="max-w-2xl rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
                <DialogHeader>
                <DialogTitle>
                    {selectedMetaCounter
                    ? `${selectedMetaCounter.label} — ${selectedMetaCounter.name}`
                    : "Défense méta"}
                </DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                    <div className="text-sm text-zinc-400">Nombre de membres assignés</div>
                    <div className="mt-1 text-2xl font-semibold text-zinc-50">
                    {membersForSelectedMetaDefense.length}
                    </div>
                </div>

                {membersForSelectedMetaDefense.length > 0 ? (
                    <div className="space-y-3">
                    {membersForSelectedMetaDefense.map((member) => {
                        const inDefense1 = member.defense1 === selectedMetaCounter?.name;
                        const inDefense2 = member.defense2 === selectedMetaCounter?.name;

                        return (
                        <div
                            key={member.id}
                            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
                        >
                            <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="font-medium text-zinc-50">{member.name}</div>
                                <div className="text-sm text-zinc-400">{member.assignment}</div>
                            </div>

                            <div className="flex gap-2">
                                {inDefense1 && (
                                <Badge className="rounded-xl bg-emerald-500/15 text-emerald-300">
                                    Défense 1
                                </Badge>
                                )}
                                {inDefense2 && (
                                <Badge className="rounded-xl bg-emerald-500/15 text-emerald-300">
                                    Défense 2
                                </Badge>
                                )}
                            </div>
                            </div>
                        </div>
                        );
                    })}
                    </div>
                ) : (
                    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
                    Aucun membre n’a actuellement cette défense assignée.
                    </div>
                )}
                </div>
            </DialogContent>
            </Dialog>
        {activeProfileView === "defense" && (
  <Tabs defaultValue="workspace" className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="rounded-2xl border border-zinc-800 bg-zinc-900 p-1">
            <TabsTrigger
                value="workspace"
                className="rounded-xl px-4 py-2 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50 data-[state=active]:shadow-sm"
            >
                Liste des défenses
            </TabsTrigger>
<TabsTrigger
  value="library"
  className="rounded-xl px-4 py-2 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50 data-[state=active]:shadow-sm"
>
  Bibliothèque des défenses
</TabsTrigger>
            <TabsTrigger
                value="rules"
                disabled={!isAdmin}
                className="rounded-xl px-4 py-2 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50 data-[state=active]:shadow-sm"
            >
                Conditions
            </TabsTrigger>
            <TabsTrigger
  value="repro"
  className="rounded-xl px-4 py-2 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-zinc-100 data-[state=active]:bg-zinc-800 data-[state=active]:text-zinc-50 data-[state=active]:shadow-sm"
>
  Qui peut repro
</TabsTrigger>
</TabsList>

{/* 🔥 FILTRE META */}
<div className="mb-3 flex flex-wrap gap-2">
  <Button
    variant={metaCounterFilter === "all" ? "default" : "outline"}
    className="rounded-2xl"
    onClick={() => setMetaCounterFilter("all")}
  >
    Toutes
  </Button>

  <Button
    variant={metaCounterFilter === "meta_s" ? "default" : "outline"}
    className="rounded-2xl"
    onClick={() => setMetaCounterFilter("meta_s")}
  >
    Meta S
  </Button>

  <Button
    variant={metaCounterFilter === "meta_a" ? "default" : "outline"}
    className="rounded-2xl"
    onClick={() => setMetaCounterFilter("meta_a")}
  >
    Meta A
  </Button>
</div>

<div className="flex flex-wrap gap-2">
  {metaDefenseCounters.length ? (
    metaDefenseCounters.map((counter) => {
    const isTracked =
      String(selectedMetaDefenseForCompletion) === String(counter.id);

    return (
      <div
        key={counter.id}
        className={`min-w-[170px] rounded-2xl border px-4 py-3 transition ${
          isTracked
            ? "border-amber-400 bg-amber-500/10"
            : "border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-800/80"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => openMetaCounterDialog(counter)}
            className="flex-1 text-left"
          >
            <div className="text-xs text-zinc-500">{counter.label}</div>
            <div className="mt-1 text-lg font-semibold text-zinc-50">
              {counter.count}
            </div>
            <div className="truncate text-xs text-zinc-400">{counter.name}</div>
<div className="mt-1 text-[11px] text-zinc-500">
  {counter.tier === "meta_s" ? "Meta S" : "Meta A"}
</div>
          </button>

          <button
            type="button"
            onClick={() =>
              setSelectedMetaDefenseForCompletion((prev) =>
                String(prev) === String(counter.id) ? null : String(counter.id)
              )
            }
            className="rounded-xl p-1 hover:bg-zinc-800"
            title="Suivre cette défense"
          >
            <Star
              className={`h-4 w-4 ${
                isTracked
                  ? "fill-amber-400 text-amber-400"
                  : "text-zinc-500 hover:text-amber-300"
              }`}
            />
          </button>
        </div>
      </div>
    );
  })
) : (
  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-400">
    Aucune défense méta enregistrée.
  </div>
)}
            </div>
          </div>

<TabsContent value="workspace">


  
<div className="mb-4 flex flex-wrap justify-end gap-3">
  <Select value={defenseFactionFilter} onValueChange={setDefenseFactionFilter}>
    <SelectTrigger className="w-[220px] rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
      <SelectValue placeholder="Filtrer par faction" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="Tous">Toutes les factions</SelectItem>
      <SelectItem value="nordiste">nordiste</SelectItem>
      <SelectItem value="cauchemar">cauchemar</SelectItem>
      <SelectItem value="sentinelle">sentinelle</SelectItem>
      <SelectItem value="esoterique">esoterique</SelectItem>
      <SelectItem value="perceur">perceur</SelectItem>
      <SelectItem value="chaotique">chaotique</SelectItem>
      <SelectItem value="cultiste">cultiste</SelectItem>
      <SelectItem value="infernal">infernal</SelectItem>
      <SelectItem value="innommable">innommable</SelectItem>
      <SelectItem value="arbitre">arbitre</SelectItem>
    </SelectContent>
  </Select>

  {/* 🔥 NOUVEAU FILTRE TYPE */}
  <Select value={defenseTypeFilter} onValueChange={setDefenseTypeFilter}>
    <SelectTrigger className="w-[180px] rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
      <SelectValue placeholder="Filtrer par type" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="Tous">Tous les types</SelectItem>
      <SelectItem value="Tour">Tour</SelectItem>
      <SelectItem value="Bastion">Bastion</SelectItem>
    </SelectContent>
  </Select>
</div>

<DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
<SortableContext
  items={[...defenses]
  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  .filter((defense) => {
    const factionOk =
      defenseFactionFilter === "Tous"
        ? true
        : defense.faction === defenseFactionFilter;

    const typeOk =
      defenseTypeFilter === "Tous"
        ? true
        : defense.type === defenseTypeFilter;

    const tierOk =
      workspaceTierFilter === "Tous"
        ? true
        : normalizeDefenseTier(defense.tier) === workspaceTierFilter;

    return factionOk && typeOk && tierOk;
  })
  .map((d) => d.id)}
  strategy={verticalListSortingStrategy}
>
<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
{[...defenses]
  .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  .filter((defense) => {
    const factionOk =
      defenseFactionFilter === "Tous"
        ? true
        : defense.faction === defenseFactionFilter;

    const typeOk =
      defenseTypeFilter === "Tous"
        ? true
        : defense.type === defenseTypeFilter;

    const tierOk =
      workspaceTierFilter === "Tous"
        ? true
        : normalizeDefenseTier(defense.tier) === workspaceTierFilter;

    return factionOk && typeOk && tierOk;
  })
.map((defense) => (
  <SortableDefenseCard key={defense.id} defense={defense}>
    <Card
      
      className={`rounded-3xl border shadow-2xl ${
        normalizeDefenseTier(defense.tier) === "meta_s"
          ? "border-blue-500 bg-blue-900/35"
          : normalizeDefenseTier(defense.tier) === "meta_a"
          ? "border-emerald-500 bg-emerald-900/35"
          : "border-zinc-800 bg-zinc-900/70"
      }`}
    >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                    <div>
<CardTitle
  className="cursor-pointer text-lg text-zinc-50 hover:text-emerald-300"
  onClick={() => {
    setRenameDefenseTarget(defense);
    setRenameDefenseName(defense.name || "");
    setRenameDefenseFaction(defense.faction || "");
    setRenameDefenseDialogOpen(true);
  }}
>
  {defense.name}
</CardTitle>
<CardDescription>
  {defense.tier} • {defense.type}
  {defense.faction ? ` • ${defense.faction}` : ""}
</CardDescription>
                    </div>

<div className="flex items-center gap-2">
<div className="flex flex-col items-center gap-1">
<button
  type="button"
  onPointerDown={(e) => {
    e.stopPropagation();
  }}
  onClick={(e) => {
    e.stopPropagation();
    setDefenseVote(defense, 1);
  }}
  className={`rounded-lg border px-2 py-1 text-xs transition ${
    defenseVoteByRootId.get(getDefenseLikeTargetId(defense)) === 1
      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
  }`}
  title="Liker cette défense"
>
  👍 {defenseLikesCountByRootId.get(getDefenseLikeTargetId(defense)) || 0}
</button>

<button
  type="button"
  onPointerDown={(e) => {
    e.stopPropagation();
  }}
  onClick={(e) => {
    e.stopPropagation();
    setDefenseVote(defense, -1);
  }}
  className={`rounded-lg border px-2 py-1 text-xs transition ${
    defenseVoteByRootId.get(getDefenseLikeTargetId(defense)) === -1
      ? "border-red-500/40 bg-red-500/15 text-red-300"
      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
  }`}
  title="Disliker cette défense"
>
  👎 {defenseDislikesCountByRootId.get(getDefenseLikeTargetId(defense)) || 0}
</button>
</div>

  <Button
    size="icon"
    variant="ghost"
    className="rounded-xl text-zinc-400 hover:text-zinc-100"
    onClick={() => {
      setEditingDefense(defense);
      setEditorOpen(true);
    }}
  >
    <Pencil className="h-4 w-4" />
  </Button>

  <Button
    size="icon"
    variant="ghost"
    className="rounded-xl text-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
    onClick={() => {
  setDefenseToDelete(defense);
  setDeleteDefenseMode("local");
  setDeleteDefenseDialogOpen(true);
}}
    disabled={!canDeleteDefense(defense)}
    title={
      canDeleteDefense(defense)
        ? "Supprimer cette défense"
        : "Suppression impossible depuis ce dashboard"
    }
  >
    <Trash2 className="h-4 w-4" />
  </Button>

<Badge
  onClick={async () => {
    const currentTier = normalizeDefenseTier(defense.tier);
    const nextTier =
      currentTier === "meta_s"
        ? "meta_a"
        : currentTier === "meta_a"
        ? "secondaire"
        : "meta_s";

    const { error } = await supabase
      .from("guild_defenses")
      .update({ tier: nextTier })
      .eq("id", defense.id);

    if (!error) {
      setDefenses((prev) =>
        prev.map((d) =>
          d.id === defense.id ? { ...d, tier: nextTier } : d
        )
      );
    }
  }}
  className={`cursor-pointer rounded-xl ${
    normalizeDefenseTier(defense.tier) === "meta_s" ||
    normalizeDefenseTier(defense.tier) === "meta_a"
      ? "bg-yellow-500/15 text-yellow-300"
      : "bg-zinc-800 text-zinc-300"
  }`}
>
  {normalizeDefenseTier(defense.tier) === "meta_s"
    ? "Meta S"
    : normalizeDefenseTier(defense.tier) === "meta_a"
    ? "Meta A"
    : "Secondaire"}
</Badge>
</div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {defense.slots.map((slot) => (
                        <Badge key={slot} variant="outline" className="rounded-xl border-zinc-700 text-zinc-200">
                          {slot}
                        </Badge>
                      ))}
                    </div>
                    {defense.image ? (
                      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                        <img src={defense.image} alt={defense.name} className="h-40 w-full object-contain" />
                      </div>
                    ) : (
                      <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
                        Aucune image
                      </div>
                    )}
                    <div className="space-y-2">
{defense.conditions.map((condition, index) => (
  <div
    key={condition.id || condition.label || index}
    className="flex items-center gap-2 text-sm text-zinc-300"
  >
    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    {typeof condition === "string" ? condition : condition.label}
  </div>
))}
                    </div>
                  </CardContent>
                </Card>
              </SortableDefenseCard>
            ))}
          </div>

        </SortableContext>
      </DndContext>
            
          </TabsContent>
<TabsContent value="library">
  <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
    <CardHeader>
      <CardTitle className="text-zinc-50">Bibliothèque des défenses</CardTitle>
      <CardDescription>
        Toutes les défenses du cluster, avec import possible vers la guilde active.
      </CardDescription>
    </CardHeader>

    <CardContent>
<div className="mb-4 flex flex-wrap justify-end gap-3">
  <Select value={defenseFactionFilter} onValueChange={setDefenseFactionFilter}>
    <SelectTrigger className="w-[220px] rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
      <SelectValue placeholder="Filtrer par faction" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="Tous">Toutes les factions</SelectItem>
      <SelectItem value="nordiste">nordiste</SelectItem>
      <SelectItem value="cauchemar">cauchemar</SelectItem>
      <SelectItem value="sentinelle">sentinelle</SelectItem>
      <SelectItem value="esoterique">esoterique</SelectItem>
      <SelectItem value="perceur">perceur</SelectItem>
      <SelectItem value="chaotique">chaotique</SelectItem>
      <SelectItem value="cultiste">cultiste</SelectItem>
      <SelectItem value="infernal">infernal</SelectItem>
      <SelectItem value="innommable">innommable</SelectItem>
      <SelectItem value="arbitre">arbitre</SelectItem>
    </SelectContent>
  </Select>

  <Select value={defenseTypeFilter} onValueChange={setDefenseTypeFilter}>
    <SelectTrigger className="w-[180px] rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
      <SelectValue placeholder="Filtrer par type" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="Tous">Tous les types</SelectItem>
      <SelectItem value="Tour">Tour</SelectItem>
      <SelectItem value="Bastion">Bastion</SelectItem>
    </SelectContent>
  </Select>

  <Select value={workspaceTierFilter} onValueChange={setWorkspaceTierFilter}>
    <SelectTrigger className="w-[180px] rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
      <SelectValue placeholder="Filtrer par tier" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="Tous">Tous les tiers</SelectItem>
      <SelectItem value="meta_s">Meta S</SelectItem>
      <SelectItem value="meta_a">Meta A</SelectItem>
      <SelectItem value="secondaire">Secondaire</SelectItem>
    </SelectContent>
  </Select>
</div>
      {libraryLoading ? (
        <div className="text-sm text-zinc-400">Chargement de la bibliothèque...</div>
      ) : clusterLibraryDefenses.length === 0 ? (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
          Aucune défense disponible dans la bibliothèque.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
{[...clusterLibraryDefenses]
  .filter((defense) => !defense.sourceDefenseId)
  .filter((defense) =>
    defenseFactionFilter === "Tous"
      ? true
      : defense.faction === defenseFactionFilter
  )
  .sort((a, b) => {
    const aLikes =
      defenseLikesCountByRootId.get(getDefenseRootId(a)) || 0;
    const bLikes =
      defenseLikesCountByRootId.get(getDefenseRootId(b)) || 0;

    if (bLikes !== aLikes) return bLikes - aLikes;

    return a.name.localeCompare(b.name, "fr", {
      sensitivity: "base",
    });
  })
.map((defense) => {
  const alreadyImported = activeDashboardDefenseRootIds.has(
    getDefenseRootId(defense)
  );
  const normalizedTier = normalizeDefenseTier(defense.tier);

return (
  <Card
    key={`library-${defense.id}`}
    className={`rounded-3xl border shadow-2xl ${
      normalizedTier === "meta_s"
        ? "border-blue-500 bg-blue-900/35"
        : normalizedTier === "meta_a"
        ? "border-emerald-500 bg-emerald-900/35"
        : "border-zinc-800 bg-zinc-900/70"
    }`}
  >
    <CardHeader>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg text-zinc-50">
              {defense.name}
            </CardTitle>

      {(defenseLikesCountByRootId.get(getDefenseRootId(defense)) || 0) >= 5 && (
        <Badge className="rounded-xl bg-orange-500/15 text-orange-300">
          🔥 Top défense
        </Badge>
      )}
    </div>

<CardDescription>
  {defense.tier} • {defense.type}
  {defense.faction ? ` • ${defense.faction}` : ""}
  {" • "}
  {defense.guildCode || "Cluster"}
</CardDescription>
  </div>

<div className="flex flex-col items-end gap-2">
  <Badge
    className={
      alreadyImported
        ? "rounded-xl bg-amber-500/15 text-amber-300"
        : "rounded-xl bg-emerald-500/15 text-emerald-300"
    }
  >
    {alreadyImported ? "Déjà importée" : "Importable"}
  </Badge>

</div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {defense.slots.map((slot) => (
                      <Badge
                        key={`${defense.id}-${slot}`}
                        variant="outline"
                        className="rounded-xl border-zinc-700 text-zinc-200"
                      >
                        {slot}
                      </Badge>
                    ))}
                  </div>

                  {defense.image ? (
                    <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
                      <img
                        src={defense.image}
                        alt={defense.name}
                        className="h-40 w-full object-contain"
                      />
                    </div>
                  ) : (
                    <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
                      Aucune image
                    </div>
                  )}

                  <div className="space-y-2">
{(defense.conditions || []).map((condition, index) => (
  <div
    key={condition.id || condition.label || index}
    className="flex items-center gap-2 text-sm text-zinc-300"
  >
    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    {typeof condition === "string" ? condition : condition.label}
  </div>
))}
                  </div>

                  <div className="flex justify-end">
                    <Button
                      className="rounded-2xl"
                      disabled={!isAdmin || alreadyImported}
                      onClick={() => importDefenseToActiveGuild(defense)}
                    >
                      Importer
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </CardContent>
  </Card>
</TabsContent>
<TabsContent value="rules">
  <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
    <CardHeader>
      <CardTitle className="flex items-center gap-2 text-zinc-50">
        <AlertTriangle className="h-5 w-5 text-amber-400" />
        Conditions
      </CardTitle>
    </CardHeader>

    <CardContent className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          <div className="text-sm text-zinc-400">Défense à éditer</div>
          <Select value={conditionDefenseId} onValueChange={setConditionDefenseId}>
            <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
              <SelectValue placeholder="Choisir une défense" />
            </SelectTrigger>
            <SelectContent>
              {defenses.map((defense) => (
                <SelectItem key={defense.id} value={String(defense.id)}>
                  {defense.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedConditionDefense ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold text-zinc-50">
                  {selectedConditionDefense.name}
                </div>
                <div className="text-sm text-zinc-400">
                  {selectedConditionDefense.tier} • {selectedConditionDefense.type}
                </div>
              </div>

              <Badge
                className={
                  selectedConditionDefense.tier === "Meta"
                    ? "rounded-xl bg-emerald-500/15 text-emerald-300"
                    : "rounded-xl bg-zinc-800 text-zinc-300"
                }
              >
                {selectedConditionDefense.tier}
              </Badge>
            </div>

            <div className="mt-4">
              <div className="mb-2 text-sm text-zinc-400">Héros de la défense</div>
              <div className="flex flex-wrap gap-2">
                {selectedConditionDefense.slots.map((slot) => (
                  <Badge
                    key={`${selectedConditionDefense.id}-${slot}`}
                    variant="outline"
                    className="rounded-xl border-zinc-700 text-zinc-200"
                  >
                    {slot}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-500">
            Sélectionne une défense pour afficher et modifier ses conditions.
          </div>
        )}
      </div>

      {selectedConditionDefense && (
        <>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium text-zinc-50">Conditions actuelles</div>
                <div className="text-sm text-zinc-400">
                  Règles appliquées à cette défense
                </div>
              </div>

              <Badge className="rounded-xl bg-zinc-800 text-zinc-300">
                {(selectedConditionDefense.conditions || []).length} condition(s)
              </Badge>
            </div>

            {(selectedConditionDefense.conditions || []).length > 0 ? (
              <div className="space-y-3">
{selectedConditionDefense.conditions.map((condition, index) => {
  const label = typeof condition === "string" ? condition : condition.label || "";
  const match = label.match(/^(.+?) A(\d) minimum$/);
  const heroName = match?.[1] || label;
  const awakeningValue = match?.[2];

  return (
    <div
      key={condition.id || label || index}
                      className="flex flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className="rounded-xl bg-zinc-800 text-zinc-100">
                          {heroName}
                        </Badge>
                        {awakeningValue && (
                          <Badge className="rounded-xl bg-amber-500/15 text-amber-300">
                            A{awakeningValue} minimum
                          </Badge>
                        )}
                      </div>

 <Button
  size="sm"
  variant="outline"
  className="rounded-xl border-red-500/30 bg-transparent text-red-300 hover:bg-red-500/10 disabled:opacity-40"
onClick={() =>
  condition.id
    ? removeConditionById(condition.id)
    : removeCondition(selectedConditionDefense.id, condition)
}
  disabled={!canDeleteDefense(selectedConditionDefense)}
  title={
    canDeleteDefense(selectedConditionDefense)
      ? "Supprimer cette condition"
      : "Suppression impossible depuis ce dashboard"
  }
>
  <Trash2 className="mr-2 h-4 w-4" />
  Supprimer
</Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-500">
                Aucune condition enregistrée pour cette défense.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="mb-4">
              <div className="font-medium text-zinc-50">Ajouter une condition</div>
              <div className="text-sm text-zinc-400">
                Seuls les héros présents dans cette défense sont proposés.
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Select
                value={newCondition.hero}
                onValueChange={(value) =>
                  setNewCondition((prev) => ({ ...prev, hero: value }))
                }
              >
                <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
                  <SelectValue placeholder="Choisir un héros" />
                </SelectTrigger>
                <SelectContent>
                  {availableConditionHeroes.map((hero) => (
                    <SelectItem key={hero} value={hero}>
                      {hero}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={newCondition.minAwakening}
                onValueChange={(value) =>
                  setNewCondition((prev) => ({ ...prev, minAwakening: value }))
                }
              >
                <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
                  <SelectValue placeholder="Éveil requis" />
                </SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      A{n} minimum
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

<Button
  onClick={addCondition}
  className="rounded-2xl"
  disabled={!canDeleteDefense(selectedConditionDefense)}
  title={
    canDeleteDefense(selectedConditionDefense)
      ? "Ajouter une condition"
      : "Ajout impossible depuis ce dashboard"
  }
>
  <Plus className="mr-2 h-4 w-4" />
  Ajouter une condition
</Button>
            </div>
          </div>
        </>
      )}
    </CardContent>
  </Card>
</TabsContent>
<TabsContent value="repro">
  <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
<CardHeader className="flex flex-row items-start justify-between">
  <div>
    <CardTitle className="text-zinc-50">Qui peut repro</CardTitle>
    <CardDescription>
      Renseigne jusqu’à 5 héros et leur éveil minimum.
    </CardDescription>
  </div>

  <Button
    variant="outline"
    onClick={() => {
      setReproHeroes(["", "", "", "", ""]);
      setReproConditions([0, 0, 0, 0, 0]);
    }}
    className="rounded-xl border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-emerald-400"
  >
    ♻️ Réinitialiser
  </Button>
</CardHeader>

    <CardContent className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {reproHeroes.map((hero, index) => {
          const matches = allHeroes
            .filter((item) =>
              item.toLowerCase().includes((hero || "").toLowerCase())
            )
            .slice(0, 8);

          return (
            <div
              key={index}
              className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4"
            >
              <div className="text-sm text-zinc-400">Héros {index + 1}</div>

              <Input
                value={hero}
                onChange={(e) => setReproHero(index, e.target.value)}
                placeholder={`Nom du héros ${index + 1}`}
                className="rounded-2xl border-zinc-700 bg-zinc-900"
              />

              {hero && matches.length > 0 && (
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-2">
                  <div className="flex flex-wrap gap-2">
                    {matches.map((matchHero) => (
                      <button
                        key={`${index}-${matchHero}`}
                        type="button"
                        onClick={() => setReproHero(index, matchHero)}
                        className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
                      >
                        {matchHero}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-xs text-zinc-500">Éveil minimum</div>
                <Select
                  value={String(reproConditions[index])}
                  onValueChange={(value) => setReproCondition(index, value)}
                >
                  <SelectTrigger className="rounded-xl border-zinc-700 bg-zinc-900 text-zinc-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">0</SelectItem>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                    <SelectItem value="5">5</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </div>

<div className="flex justify-between items-center mt-4">
  

  <Button onClick={findReproMatches} className="rounded-2xl">
    Rechercher
  </Button>

</div>
    </CardContent>
  </Card>
</TabsContent>
<Dialog
  open={renameDefenseDialogOpen}
  onOpenChange={(open) => {
    setRenameDefenseDialogOpen(open);

    if (!open) {
      setRenameDefenseTarget(null);
      setRenameDefenseName("");
      setRenameDefenseFaction("");
    }
  }}
>
  <DialogContent className="max-w-md rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>Modifier le titre de la défense</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Titre</div>
        <Input
          value={renameDefenseName}
          onChange={(e) => setRenameDefenseName(e.target.value)}
          className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100"
          placeholder="Nom de la défense"
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Faction</div>
        <Select
          value={renameDefenseFaction || "none"}
          onValueChange={(value) =>
            setRenameDefenseFaction(value === "none" ? "" : value)
          }
        >
          <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
            <SelectValue placeholder="Choisir une faction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Aucune faction</SelectItem>
            <SelectItem value="nordiste">nordiste</SelectItem>
            <SelectItem value="cauchemar">cauchemar</SelectItem>
            <SelectItem value="sentinelle">sentinelle</SelectItem>
            <SelectItem value="esoterique">esoterique</SelectItem>
            <SelectItem value="perceur">perceur</SelectItem>
            <SelectItem value="chaotique">chaotique</SelectItem>
            <SelectItem value="cultiste">cultiste</SelectItem>
            <SelectItem value="infernal">infernal</SelectItem>
            <SelectItem value="innommable">innommable</SelectItem>
            <SelectItem value="arbitre">arbitre</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          className="rounded-2xl border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800"
          onClick={() => {
            setRenameDefenseDialogOpen(false);
            setRenameDefenseTarget(null);
            setRenameDefenseName("");
            setRenameDefenseFaction("");
          }}
        >
          Annuler
        </Button>

        <Button className="rounded-2xl" onClick={saveDefenseIdentity}>
          Enregistrer
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
{editorOpen && editingDefense && (
  <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
    <CardHeader>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle className="text-zinc-50">
            Édition de la défense : {editingDefense.name}
          </CardTitle>
          <CardDescription>
            Panneau d’édition avancée affiché sous toute la liste des défenses.
          </CardDescription>
        </div>

        <Button
          variant="outline"
          className="rounded-2xl border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
          onClick={() => {
            setEditorOpen(false);
            setEditingDefense(null);
          }}
        >
          Réduire
        </Button>
      </div>
    </CardHeader>

    <CardContent className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
        <div className="text-sm text-zinc-400">Défense sélectionnée</div>
        <div className="mt-1 text-lg font-semibold text-zinc-50">
          {editingDefense.name}
        </div>
        <div className="mt-1 text-sm text-zinc-400">
          {editingDefense.tier} • {editingDefense.type}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {editingDefense.slots.map((slot) => (
          <Badge
            key={`editor-${editingDefense.id}-${slot}`}
            variant="outline"
            className="rounded-xl border-zinc-700 text-zinc-200"
          >
            {slot}
          </Badge>
        ))}
      </div>

      {editingDefense.image ? (
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950">
          <img
            src={editingDefense.image}
            alt={editingDefense.name}
            className="max-h-[420px] w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 text-sm text-zinc-500">
          Aucune image pour cette défense
        </div>
      )}

<div className="space-y-4">
  <div className="flex flex-wrap gap-2">
<Button
  type="button"
  className="rounded-2xl bg-zinc-900 text-zinc-100 border border-zinc-700 hover:bg-emerald-600 hover:text-white transition"
  onClick={async () => {
    if (!editingDefense?.id) return;

    const nextOrder = editorBlocks.length;

    const { data, error } = await supabase
      .from("guild_defense_blocks")
      .insert({
        defense_id: editingDefense.id,
        block_type: "text",
        content: "",
        sort_order: nextOrder,
      })
      .select("id, block_type, content, sort_order")
      .single();

    if (error) {
      console.error("Erreur création bloc texte:", error);
      return;
    }

    setEditorBlocks((prev) => [
      ...prev,
      {
        id: data.id,
        type: data.block_type,
        content: data.content || "",
        url: "",
      },
    ]);
  }}
>
  <Plus className="mr-2 h-4 w-4" />
  Ajouter un commentaire
</Button>

<Button
  type="button"
  className="rounded-2xl bg-zinc-900 text-zinc-100 border border-zinc-700 hover:bg-emerald-600 hover:text-white transition"
  onClick={async () => {
    if (!editingDefense?.id) return;

    const nextOrder = editorBlocks.length;

    const { data, error } = await supabase
      .from("guild_defense_blocks")
      .insert({
        defense_id: editingDefense.id,
        block_type: "image",
        content: "",
        sort_order: nextOrder,
      })
      .select("id, block_type, content, sort_order")
      .single();

    if (error) {
      console.error("Erreur création bloc image:", error);
      return;
    }

    setEditorBlocks((prev) => [
      ...prev,
      {
        id: data.id,
        type: "image",
        url: "",
        content: "",
      },
    ]);
  }}
>
  <ImagePlus className="mr-2 h-4 w-4" />
  Ajouter une image
</Button>
  </div>

  {editorBlocks.length === 0 ? (
    <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-950 p-6 text-sm text-zinc-500">
      Aucun bloc ajouté pour le moment.
    </div>
  ) : (
    <div className="space-y-3">
      {editorBlocks.map((block, index) => (
        <div
          key={block.id}
          className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4"
        >
<div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
  <div className="text-sm text-zinc-400">
    Bloc {index + 1} — {block.type === "text" ? "Commentaire" : "Image"}
  </div>

  <div className="flex flex-wrap gap-2">
        <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-xl border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => moveEditorBlock(block.id, "up")}
        disabled={index === 0}
        >
        Monter
        </Button>

        <Button
        type="button"
        size="sm"
        variant="outline"
        className="rounded-xl border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
        onClick={() => moveEditorBlock(block.id, "down")}
        disabled={index === editorBlocks.length - 1}
        >
        Descendre
        </Button>

<Button
  type="button"
  size="sm"
  variant="outline"
  className="rounded-xl border-red-500/30 bg-transparent text-red-300 hover:bg-red-500/10"
onClick={async () => {
  const confirmDelete = window.confirm(
    `Supprimer définitivement ce bloc ${block.type === "image" ? "image" : "commentaire"} ?`
  );

  if (!confirmDelete) return;

  try {
    if (block.type === "image" && block.url) {
      const filePath = getStoragePathFromPublicUrl(block.url);

      if (filePath) {
        const { error: storageError } = await supabase.storage
          .from("defense-images")
          .remove([filePath]);

        if (storageError) {
          console.error("Erreur suppression image storage bloc:", storageError);
          return;
        }
      }
    }

    const { error } = await supabase
      .from("guild_defense_blocks")
      .delete()
      .eq("id", block.id);

    if (error) {
      console.error("Erreur suppression bloc éditeur:", error);
      return;
    }

    const next = editorBlocks.filter((item) => item.id !== block.id);
    setEditorBlocks(next);

    const updates = next.map((item, sortOrder) => ({
      id: item.id,
      sort_order: sortOrder + 1,
    }));

    if (updates.length > 0) {
      const results = await Promise.all(
        updates.map((item) =>
          supabase
            .from("guild_defense_blocks")
            .update({ sort_order: item.sort_order })
            .eq("id", item.id)
        )
      );

      const firstError = results.find((result) => result.error)?.error;

      if (firstError) {
        console.error("Erreur réorganisation après suppression bloc:", firstError);
      }
    }
  } catch (error) {
    console.error("Erreur suppression complète bloc éditeur:", error);
  }
}}
>
  <Trash2 className="mr-2 h-4 w-4" />
  Supprimer
</Button>
  </div>
</div>

        {block.type === "text" ? (
<textarea
  value={block.content}
  onChange={async (e) => {
    const newValue = e.target.value;

    setEditorBlocks((prev) =>
      prev.map((item) =>
        item.id === block.id
          ? { ...item, content: newValue }
          : item
      )
    );

    const { error } = await supabase
      .from("guild_defense_blocks")
      .update({ content: newValue })
      .eq("id", block.id);

    if (error) {
      console.error("Erreur sauvegarde commentaire bloc éditeur:", error);
    }
  }}
  placeholder="Écris ici ton commentaire, tes conseils de stuff, placement, ordre, remarques..."
  className="min-h-[120px] w-full rounded-2xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
/>
        ) : (
        <div className="space-y-3">
{block.url ? (
  <div className="space-y-3">
    <button
      type="button"
      className="w-full rounded-3xl border border-zinc-800 bg-zinc-950 p-3 text-left transition hover:border-emerald-500"
      onClick={() => {
        setPreviewImageUrl(block.url);
        setPreviewImageOpen(true);
      }}
    >
      <img
        src={block.url}
        alt={`Bloc ${index + 1}`}
        className="max-h-[260px] w-full rounded-2xl object-cover"
      />
      <div className="mt-3 text-sm text-zinc-400">
        Cliquer pour afficher l’image en grand
      </div>
    </button>

    <div className="flex justify-end">
      <Button
        type="button"
        size="sm"
        variant="outline"
            className="rounded-xl border-red-500/30 bg-transparent text-red-300 hover:bg-red-500/10"
    onClick={async () => {
    const confirmDelete = window.confirm(
        "Supprimer cette image du bloc sans supprimer le bloc ?"
    );

    if (!confirmDelete) return;

    try {
        const filePath = getStoragePathFromPublicUrl(block.url);

        if (filePath) {
        const { error: storageError } = await supabase.storage
            .from("defense-images")
            .remove([filePath]);

        if (storageError) {
            console.error("Erreur suppression image storage bloc:", storageError);
            return;
        }
        }

        const { error: updateError } = await supabase
        .from("guild_defense_blocks")
        .update({ content: "" })
        .eq("id", block.id);

        if (updateError) {
        console.error("Erreur suppression lien image bloc en base:", updateError);
        return;
        }

        setEditorBlocks((prev) =>
        prev.map((item) =>
            item.id === block.id
            ? { ...item, url: "", content: "" }
            : item
        )
        );
    } catch (error) {
        console.error("Erreur suppression image seule du bloc:", error);
    }
    }}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Supprimer l’image
      </Button>
    </div>
  </div>
) : (
            <label className="flex min-h-[180px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-zinc-700 bg-zinc-900/60 p-6 text-center transition hover:border-emerald-500">
                <ImagePlus className="mb-3 h-10 w-10 text-zinc-400" />
                <div className="font-medium text-zinc-200">
                Ajouter une image ou la glisser ici
                </div>
                <div className="mt-1 text-sm text-zinc-500">
                PNG, JPG, WebP
                </div>

                <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) =>
                    handleEditorBlockImage(block.id, e.target.files?.[0] ?? null)
                }
                />
            </label>
            )}
        </div>
        )}
        </div>
      ))}
    </div>
  )}
</div>
    </CardContent>
  </Card>
)}

{previewImageOpen && (
  <Dialog open={previewImageOpen} onOpenChange={setPreviewImageOpen}>
    <DialogContent className="w-[95vw] max-w-none sm:max-w-none rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
      <DialogHeader>
        <DialogTitle>Aperçu de l’image</DialogTitle>
      </DialogHeader>

      <div className="max-h-[85vh] overflow-auto rounded-2xl border border-zinc-800 bg-zinc-950">
        <img
          src={previewImageUrl}
          alt="Aperçu grand format"
          className="max-h-[80vh] w-full object-contain"
        />
      </div>
    </DialogContent>
  </Dialog>
)}
<Dialog open={scoreDetailOpen} onOpenChange={setScoreDetailOpen}>
  <DialogContent className="max-w-lg rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>
        Score éveil — {scoreDetailMember?.name}
      </DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      {scoreDetailDefense ? (
        <>
          <div className="text-sm text-zinc-400">
            Défense : {scoreDetailDefense.name}
          </div>

          <div className="space-y-2">
            {scoreDetailRows.map((row) => (
              <div
                key={row.hero}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-2"
              >
                <div className="text-zinc-200">{row.hero}</div>

                <div
                  className={`rounded-lg px-2 py-1 text-sm ${
                    row.awakening === -1
                      ? "bg-red-500/20 text-red-300"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  {row.awakening === -1 ? "✖" : `A${row.awakening}`}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="text-sm text-zinc-500">
          Aucune défense sélectionnée
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => setScoreDetailOpen(false)}
          className="rounded-2xl"
        >
          Fermer
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
<Dialog open={reproResultOpen} onOpenChange={setReproResultOpen}>
  <DialogContent className="max-w-2xl rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>Résultat repro</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      {reproMatches.length > 0 ? (
        <div className="space-y-3">
          {reproMatches.map((member) => (
            <div
              key={member.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
            >
              <div className="font-medium text-zinc-50">{member.name}</div>
              <div className="text-sm text-zinc-400">{member.assignment}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
          Désolé, aucun membre de la guilde ne peut faire cette repro.
        </div>
      )}

      <div className="flex justify-end">
        <Button
          onClick={() => setReproResultOpen(false)}
          className="rounded-2xl"
        >
          Fermer
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>



<Dialog open={deleteDefenseDialogOpen} onOpenChange={setDeleteDefenseDialogOpen}>
  <DialogContent className="max-w-md rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>Supprimer une défense</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-400">Défense sélectionnée</div>
        <div className="mt-1 font-medium text-zinc-50">
          {defenseToDelete?.name || "—"}
        </div>
        <div className="text-sm text-zinc-400">
          {defenseToDelete?.tier || "—"} • {defenseToDelete?.type || "—"}
        </div>
      </div>

      <div className="space-y-3">
<Button
  className="w-full rounded-2xl"
  onClick={async () => {
    if (!defenseToDelete?.id) return;

    await deleteDefense(defenseToDelete);

    setDeleteDefenseDialogOpen(false);
    setDefenseToDelete(null);
    setDeleteDefenseMode("local");
  }}
>
  Supprimer uniquement de ce dashboard
</Button>

        <Button
          variant="destructive"
          className="w-full rounded-2xl bg-red-700 text-white hover:bg-red-600"
onClick={async () => {
  if (!defenseToDelete) return;

  const rootId = getDefenseRootId(defenseToDelete);
  if (!rootId) return;

  try {
    // 1. récupérer toutes les défenses liées (racine + copies)
    const { data: relatedDefs, error: fetchError } = await supabase
      .from("guild_defenses")
      .select("id")
      .or(`id.eq.${rootId},source_defense_id.eq.${rootId}`);

    if (fetchError) {
      console.error("Erreur récupération défenses liées:", fetchError);
      return;
    }

    const idsToDelete = (relatedDefs || []).map((d) => d.id);

    if (idsToDelete.length === 0) return;

    // 2. supprimer toutes les défenses (cascade fera le reste)
    const { error: deleteError } = await supabase
      .from("guild_defenses")
      .delete()
      .in("id", idsToDelete);

    if (deleteError) {
      console.error("Erreur suppression cluster défense:", deleteError);
      return;
    }

    // 3. mettre à jour le state local
    setDefenses((prev) =>
      prev.filter(
        (d) => !idsToDelete.includes(d.id)
      )
    );

    // 4. mettre à jour la bibliothèque (important pour le cache)
    setClusterLibraryDefenses((prev) =>
      prev.filter(
        (d) => !idsToDelete.includes(d.id)
      )
    );

    setDeleteDefenseDialogOpen(false);
    setDefenseToDelete(null);
    setDeleteDefenseMode("local");
  } catch (error) {
    console.error("Erreur suppression complète cluster:", error);
  }
}}
        >
          Supprimer entièrement du cluster
        </Button>

        <Button
          variant="outline"
          className="w-full rounded-2xl border-zinc-700 bg-zinc-900"
          onClick={() => {
            setDeleteDefenseDialogOpen(false);
            setDefenseToDelete(null);
            setDeleteDefenseMode("local");
          }}
        >
          Retour
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
<Dialog open={forcePasswordDialogOpen}>
  <DialogContent
    className="max-w-md rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100"
    onInteractOutside={(e) => e.preventDefault()}
  >
    <DialogHeader>
      <DialogTitle>Changement de mot de passe requis</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        Pour plus de sécurité, tu dois remplacer ton mot de passe par défaut.
      </div>

      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Mot de passe actuel</div>
        <Input
          type="password"
          value={currentPasswordInput}
          onChange={(e) => setCurrentPasswordInput(e.target.value)}
          placeholder="Mot de passe actuel"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Nouveau mot de passe</div>
        <Input
          type="password"
          value={newPasswordInput}
          onChange={(e) => setNewPasswordInput(e.target.value)}
          placeholder="Nouveau mot de passe"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
        />
      </div>

      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Confirmer le nouveau mot de passe</div>
        <Input
          type="password"
          value={confirmNewPasswordInput}
          onChange={(e) => setConfirmNewPasswordInput(e.target.value)}
          placeholder="Confirmer le nouveau mot de passe"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
        />
      </div>

      <div className="flex justify-end">
        <Button
          className="rounded-2xl"
          onClick={changePassword}
          disabled={passwordChangeLoading}
        >
          {passwordChangeLoading ? "Enregistrement..." : "Changer mon mot de passe"}
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
        </Tabs>
      )}
      <Dialog

  open={transferDialogOpen}
  onOpenChange={(open) => {
    setTransferDialogOpen(open);

    if (!open) {
      setMemberToTransfer(null);
      setTargetGuildCode("");
    }
  }}
>
  <DialogContent className="max-w-md rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>Transférer un joueur</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-400">Joueur sélectionné</div>
        <div className="mt-1 font-medium text-zinc-50">
          {memberToTransfer?.name || "—"}
        </div>
        <div className="text-sm text-zinc-400">
          Guilde actuelle : {activeGuildCode}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Nouvelle guilde</div>
        <Select value={targetGuildCode} onValueChange={setTargetGuildCode}>
          <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
            <SelectValue placeholder="Choisir une guilde" />
          </SelectTrigger>
          <SelectContent>
            {availableTransferGuilds.map((code) => (
              <SelectItem key={code} value={code}>
                {code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

<div className="flex flex-col gap-3">
  <Button
    className="rounded-2xl"
    onClick={transferMemberToGuild}
    disabled={!targetGuildCode || targetGuildCode === activeGuildCode}
  >
    Confirmer le transfert
  </Button>

  <Button
    variant="destructive"
    className="rounded-2xl bg-red-700 text-white hover:bg-red-600"
    onClick={removeMemberFromCluster}
  >
    Quitte le cluster
  </Button>

  <Button
    variant="outline"
    className="rounded-2xl border-zinc-700 bg-zinc-900"
    onClick={() => setTransferDialogOpen(false)}
  >
    Annuler
  </Button>
</div>
    </div>
  </DialogContent>
</Dialog>
<Dialog open={demonLevelDialogOpen} onOpenChange={setDemonLevelDialogOpen}>
  <DialogContent className="max-w-md rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>Renseigner le niveau</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-400">Monstre sélectionné</div>
        <div className="mt-1 font-medium text-zinc-50">
          {selectedDemonMonster?.name || selectedDemonMonster?.slug || "—"}
        </div>
        <div className="text-sm text-zinc-400">
          Niveau actuel : {selectedDemonMonster?.level || 0}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Niveau du monstre</div>
        <Input
          type="number"
          min="0"
          max="20"
          value={demonLevelInput}
          onChange={(e) => setDemonLevelInput(e.target.value)}
          placeholder="Entre 0 et 20"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
          onClick={() => {
            setDemonLevelDialogOpen(false);
            setSelectedDemonMonster(null);
            setDemonLevelInput("");
          }}
          disabled={demonLevelSaving}
        >
          Annuler
        </Button>

        <Button
          className="rounded-2xl"
          onClick={saveDemonLevel}
          disabled={demonLevelSaving}
        >
          {demonLevelSaving ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
      <Dialog
  open={pbRowDetailOpen}
  onOpenChange={(open) => {
    setPbRowDetailOpen(open);
    if (!open) {
      setPbSelectedMember(null);
    }
  }}
>
 <DialogContent className="w-[95vw] !max-w-[1400px] rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>
        Détail PB — {pbSelectedMember?.name || "Membre"}
      </DialogTitle>
    </DialogHeader>

    <div className="space-y-6 w-full">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-400">Profil</div>
        <div className="mt-1 text-lg font-semibold text-zinc-50">
          {pbSelectedMember?.name || "—"}
        </div>
        <div className="text-sm text-zinc-400">
          {pbSelectedMember?.assignment || "—"}
        </div>
      </div>

<div className="space-y-4">
  <div className="text-sm font-medium text-zinc-300">
    Affis de {pbSelectedMember?.name || "ce joueur"}
  </div>

  <div className="grid w-full grid-cols-5 gap-6">
    {(pbRows.find((row) => String(row.memberId) === String(pbSelectedMember?.id))?.slots || []).map((slot, index) => {
      const awakeningValue =
        slot?.championName && pbSelectedMember?.awakenings
          ? pbSelectedMember.awakenings[slot.championName] ?? -1
          : -1;

      const awakeningRoman =
        awakeningValue === -1
          ? "✖"
          : awakeningValue === 0
          ? "0"
          : awakeningValue === 1
          ? "I"
          : awakeningValue === 2
          ? "II"
          : awakeningValue === 3
          ? "III"
          : awakeningValue === 4
          ? "IV"
          : "V";

      return (
        <div
          key={slot?.id || `detail-slot-${index}`}
          className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4"
        >
          <div className="mb-3 text-sm text-zinc-400">Affi {index + 1}</div>

          {slot?.championName ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <img
                    src={getHeroImageUrl(slot.championName)}
                    alt={slot.championName}
                    className="h-14 w-14 rounded-full object-cover"
                  />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-50">
                      {slot.championName}
                    </div>
                  </div>
                </div>

                <div className="shrink-0 text-xl font-bold text-yellow-400">
                  {awakeningRoman}
                </div>
              </div>

              <div className="mt-4 space-y-1 text-sm">
                <div className="text-zinc-400">
                  Brut :{" "}
                  <span className="font-semibold text-zinc-100">
                    {formatPbAverage(Number(slot.pbRaw || 0))}
                  </span>
                </div>
                <div className="text-zinc-400">
                  Calculé :{" "}
                  <span className="font-semibold text-zinc-100">
                    {formatPbAverage(
                      getDisplayedPbValue(slot, pbSelectedMember)
                    )}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-zinc-700 bg-zinc-950 text-lg text-zinc-500">
                    ?
                  </div>
                  <div className="text-sm text-zinc-500">Aucun héros</div>
                </div>

                <div className="shrink-0 text-xl font-bold text-red-400">
                  ✖
                </div>
              </div>

              <div className="mt-4 space-y-1 text-sm">
                <div className="text-zinc-500">Brut : —</div>
                <div className="text-zinc-500">Calculé : —</div>
              </div>
            </>
          )}
        </div>
      );
    })}
  </div>
</div>



      <div className="flex justify-end">
        <Button
          className="rounded-2xl"
          onClick={() => setPbRowDetailOpen(false)}
        >
          Fermer
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
<Dialog open={pbEditDialogOpen} onOpenChange={setPbEditDialogOpen}>
  <DialogContent className="max-w-xl rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>Modifier PB</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">

      {/* Choix héros */}
      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Héros</div>

        <Input
          value={pbHeroSearch}
          onChange={(e) => setPbHeroSearch(e.target.value)}
          placeholder="Rechercher un héros..."
          className="rounded-2xl border-zinc-700 bg-zinc-900"
        />

        <ScrollArea className="h-[220px] pr-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {filteredPbHeroResults.map((hero) => (
              <button
                key={hero}
                type="button"
                onClick={() => selectPbHero(hero)}
                className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-left hover:bg-zinc-800"
              >
                <img
                  src={getHeroImageUrl(hero)}
                  alt={hero}
                  className="h-10 w-10 rounded-full object-cover"
                />
                <div className="truncate text-zinc-100">{hero}</div>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* PB brut */}
      <div className="space-y-2">
        <div className="text-sm text-zinc-400">
          PB brut (valeur du jeu, sans bonus lord)
        </div>

        <Input
          type="number"
          value={pbRawInput}
          onChange={(e) => setPbRawInput(e.target.value)}
          placeholder="Ex: 125M"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-2">
        <Button
          variant="outline"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
          onClick={() => {
            setPbEditDialogOpen(false);
            setPbSlotToEdit(null);
          }}
        >
          Annuler
        </Button>

        <Button
          className="rounded-2xl"
          onClick={async () => {
            if (!pbSlotToEdit) return;

const raw = String(pbRawInput || "");

// 🛡 Si admin → on respecte sa saisie

if (isAdmin) {
  await updatePbRaw(pbSlotToEdit.entryId, raw);
} else {
  // 👤 Sinon → format automatique
  let digits = raw.replace(/\D/g, "");
  digits = digits.slice(0, 6);

  let formatted = digits;

  if (digits.length > 3) {
    formatted = digits.slice(0, 3) + "," + digits.slice(3);
  }

  await updatePbRaw(pbSlotToEdit.entryId, formatted);
}

// 🔥 TOUJOURS exécuté (admin ou joueur)
setPbEditDialogOpen(false);
setPbSlotToEdit(null);
setPbHeroSearch("");
setPbRawInput("");

// 👤 Sinon → format automatique
let digits = raw.replace(/\D/g, "");
digits = digits.slice(0, 6);

let formatted = digits;

if (digits.length > 3) {
  formatted = digits.slice(0, 3) + "," + digits.slice(3);
}

await updatePbRaw(pbSlotToEdit.entryId, formatted);

            setPbEditDialogOpen(false);
            setPbSlotToEdit(null);
            setPbHeroSearch("");
            setPbRawInput("");
          }}
        >
          Enregistrer
        </Button>
      </div>

    </div>
  </DialogContent>
</Dialog>
      <Dialog
  open={launchIntersaisonDialogOpen}
  onOpenChange={setLaunchIntersaisonDialogOpen}
>
  <DialogContent className="max-w-md rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>Lancer une intersaison</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Nombre de guildes prévues</div>
        <Input
          type="number"
          min="1"
          max="20"
          value={intersaisonGuildCountInput}
          onChange={(e) => setIntersaisonGuildCountInput(e.target.value)}
          className="rounded-2xl border-zinc-700 bg-zinc-900"
        />
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
        Cela créera les dashboards prévisionnels demandés, plus un dashboard brouillon.
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
          onClick={() => setLaunchIntersaisonDialogOpen(false)}
        >
          Annuler
        </Button>

        <Button
          className="rounded-2xl"
          onClick={async () => {
            const parsedGuildCount = Number(intersaisonGuildCountInput);

            if (
              !Number.isInteger(parsedGuildCount) ||
              parsedGuildCount < 1 ||
              parsedGuildCount > 20
            ) {
              alert("Le nombre de guildes doit être un entier entre 1 et 20.");
              return;
            }

            const { error } = await supabase.rpc("create_intersaison_campaign", {
              p_guild_count: parsedGuildCount,
              p_poll_channel_id: null,
            });

            if (error) {
              console.error("Erreur création campagne intersaison:", error);
              alert(error.message || "Création impossible.");
              return;
            }

            setLaunchIntersaisonDialogOpen(false);
            setActiveProfileView("intersaison");
            setIntersaisonCampaign(null);
            setIntersaisonDashboards([]);
            setIntersaisonAssignments([]);
            setIntersaisonNotes([]);
            setSelectedIntersaisonDashboardId("");
            setIntersaisonSearchQuery("");
            setIntersaisonAssignmentToMove(null);
            setSelectedIntersaisonMoveDashboardId("");
            setIntersaisonTransferSummary("");
          }}
        >
          Créer
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
<Dialog
  open={intersaisonNoteDialogOpen}
  onOpenChange={(open) => {
    setIntersaisonNoteDialogOpen(open);
    if (!open) {
      setSelectedIntersaisonNoteRow(null);
      setIntersaisonNoteInput("");
    }
  }}
>
  <DialogContent className="max-w-lg rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>Note joueur</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-400">Joueur sélectionné</div>
        <div className="mt-1 font-medium text-zinc-50">
          {selectedIntersaisonNoteRow?.watcher_name || "—"}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Message / note</div>
        <textarea
          value={intersaisonNoteInput}
          onChange={(e) => setIntersaisonNoteInput(e.target.value)}
          placeholder="Écris une note sur ce joueur..."
          className="min-h-[140px] w-full rounded-2xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
          onClick={() => {
            setIntersaisonNoteDialogOpen(false);
            setSelectedIntersaisonNoteRow(null);
            setIntersaisonNoteInput("");
          }}
        >
          Annuler
        </Button>

        <Button
          className="rounded-2xl"
          onClick={saveIntersaisonNote}
        >
          Enregistrer
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>

<Dialog
  open={intersaisonMoveDialogOpen}
  onOpenChange={(open) => {
    setIntersaisonMoveDialogOpen(open);
    if (!open) {
      setIntersaisonAssignmentToMove(null);
      setSelectedIntersaisonMoveDashboardId("");
    }
  }}
>
  <DialogContent className="max-w-md rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>Déplacer vers un autre dashboard</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-400">Joueur sélectionné</div>
        <div className="mt-1 font-medium text-zinc-50">
          {intersaisonAssignmentToMove?.watcher_name || "—"}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-sm text-zinc-400">Dashboard actuel</div>
        <div className="mt-1 font-medium text-zinc-50">
          {intersaisonDashboards.find(
            (dashboard) =>
              String(dashboard.id) ===
              String(intersaisonAssignmentToMove?.dashboard_id)
          )?.name || "—"}
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm text-zinc-400">Nouvelle destination</div>
        <Select
          value={selectedIntersaisonMoveDashboardId}
          onValueChange={setSelectedIntersaisonMoveDashboardId}
        >
          <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
            <SelectValue placeholder="Choisir un dashboard" />
          </SelectTrigger>
          <SelectContent>
            {intersaisonDashboards
              .filter(
                (dashboard) =>
                  String(dashboard.id) !==
                  String(intersaisonAssignmentToMove?.dashboard_id)
              )
              .map((dashboard) => (
                <SelectItem
                  key={dashboard.id}
                  value={String(dashboard.id)}
                >
                  {dashboard.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
          onClick={() => {
            setIntersaisonMoveDialogOpen(false);
            setIntersaisonAssignmentToMove(null);
            setSelectedIntersaisonMoveDashboardId("");
          }}
        >
          Annuler
        </Button>

        <Button
          className="rounded-2xl"
          onClick={async () => {
            if (!intersaisonAssignmentToMove?.id) return;
            if (!selectedIntersaisonMoveDashboardId) return;

            await moveIntersaisonAssignmentToDashboard(
              intersaisonAssignmentToMove.id,
              selectedIntersaisonMoveDashboardId
            );

            setIntersaisonMoveDialogOpen(false);
            setIntersaisonAssignmentToMove(null);
            setSelectedIntersaisonMoveDashboardId("");
          }}
          disabled={!selectedIntersaisonMoveDashboardId}
        >
          Confirmer le transfert
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
      <Dialog
  open={confirmFinalizeIntersaisonDialogOpen}
  onOpenChange={setConfirmFinalizeIntersaisonDialogOpen}
>
  <DialogContent className="max-w-2xl rounded-3xl border-zinc-800 bg-zinc-950 text-zinc-100">
    <DialogHeader>
      <DialogTitle>Valider les transferts intersaison</DialogTitle>
    </DialogHeader>

    <div className="space-y-4">
      <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
        Attention : cette étape met fin à la campagne active d’intersaison.
        Vérifie bien les validations avant de continuer.
      </div>

      <div className="grid gap-3 md:grid-cols-2">
<Button
  className="rounded-2xl"
  onClick={copyIntersaisonTransferSummary}
>
  Copier les infos de transfert
</Button>

<Button
  variant="outline"
  className="rounded-2xl border-amber-500/30 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20"
  onClick={cancelActiveIntersaisonCampaign}
>
  Annuler la campagne active
</Button>

<Button
  variant="destructive"
  className="rounded-2xl bg-red-700 text-white hover:bg-red-600 md:col-span-2"
  onClick={launchRealIntersaisonTransfers}
>
  Lancer les transferts réels
</Button>
      </div>

      <div className="flex justify-end">
        <Button
          variant="outline"
          className="rounded-2xl border-zinc-700 bg-zinc-900"
          onClick={() => setConfirmFinalizeIntersaisonDialogOpen(false)}
        >
          Fermer
        </Button>
      </div>
    </div>
  </DialogContent>
</Dialog>
      {activeProfileView === "intersaison" && isAdmin && (
        <Card className="rounded-3xl border-zinc-800 bg-zinc-900/70 shadow-2xl">
<CardHeader>
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <CardTitle className="text-zinc-50">Intersaison</CardTitle>
      <CardDescription>
        Dashboards prévisionnels sans impact sur les guildes réelles.
      </CardDescription>
    </div>

    <div className="flex flex-col items-end gap-3">
<Button
  className="rounded-2xl"
  onClick={() => {
    setIntersaisonGuildCountInput("7");
    setLaunchIntersaisonDialogOpen(true);
  }}
>
  Lancer une intersaison
</Button>

      {intersaisonCampaign && (
        <div className="max-w-md rounded-2xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          Attention : valider les transferts mettra fin à la campagne active
          et pourra déclencher les mouvements sur les dashboards actifs.
        </div>
      )}

      {intersaisonCampaign && (
        <Button
          variant="destructive"
          className="rounded-2xl bg-red-700 text-white hover:bg-red-600"
          onClick={() => setConfirmFinalizeIntersaisonDialogOpen(true)}
        >
          Valider les transferts
        </Button>
      )}
    </div>
  </div>
</CardHeader>

          <CardContent className="space-y-6">
            {intersaisonLoading ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
                Chargement de l’intersaison...
              </div>
            ) : !intersaisonCampaign ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
                Aucune campagne intersaison active.
              </div>
            ) : (
              <>
<div className="grid gap-4 md:grid-cols-[1fr_260px]">
  <div className="space-y-4">
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="text-sm text-zinc-400">Campagne active</div>
      <div className="mt-1 text-lg font-semibold text-zinc-50">
        {intersaisonCampaign.label}
      </div>
      <div className="text-sm text-zinc-400">
        {intersaisonCampaign.guild_count} guilde(s) prévues
      </div>
    </div>

    <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="mb-2 text-sm text-zinc-400">Recherche rapide joueur</div>

      <Input
        value={intersaisonSearchQuery}
        onChange={(e) => setIntersaisonSearchQuery(e.target.value)}
        placeholder="Rechercher un joueur..."
        className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100"
      />

      {intersaisonSearchQuery.trim() && (
        <div className="mt-3 space-y-2">
          {intersaisonSearchResults.length > 0 ? (
            intersaisonSearchResults.map((row) => {
              const dashboard = intersaisonDashboards.find(
                (item) => String(item.id) === String(row.dashboard_id)
              );

              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => {
                setSelectedIntersaisonDashboardId(String(row.dashboard_id));
                setHighlightedIntersaisonRowId(String(row.id));
                setIntersaisonSearchQuery("");
              }}
                  className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-left hover:bg-zinc-800"
                >
                  <div className="font-medium text-zinc-50">
                    {row.watcher_name}
                  </div>
                  <div className="text-sm text-zinc-400">
                    Dashboard : {dashboard?.name || "—"}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-500">
              Aucun joueur trouvé.
            </div>
          )}
        </div>
      )}
    </div>
  </div>

  <div className="space-y-2">
    <div className="text-sm text-zinc-400">Dashboard affiché</div>
    <Select
      value={selectedIntersaisonDashboardId}
      onValueChange={setSelectedIntersaisonDashboardId}
    >
      <SelectTrigger className="rounded-2xl border-zinc-700 bg-zinc-900 text-zinc-100">
        <SelectValue placeholder="Choisir un dashboard" />
      </SelectTrigger>
      <SelectContent>
        {intersaisonDashboards.map((dashboard) => (
          <SelectItem key={dashboard.id} value={String(dashboard.id)}>
            {dashboard.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
</div>

<div className="rounded-2xl border border-zinc-800 bg-zinc-950">
  <div className="grid grid-cols-[70px_minmax(220px,1fr)_140px_140px_180px_120px_120px] items-center border-b border-zinc-800 bg-zinc-900/50 px-4 py-3 text-sm font-semibold text-zinc-300">
    <div>N°</div>
<div>Joueur</div>
<div className="relative flex items-center justify-center gap-1 text-center">
  <span>Provenance</span>
  <button
    type="button"
    className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
    onClick={() => setIntersaisonSourceMenuOpen((prev) => !prev)}
    title="Filtrer par provenance"
  >
    ▾
  </button>

  {intersaisonSourceMenuOpen && (
    <div className="absolute left-1/2 top-full z-20 mt-2 w-36 -translate-x-1/2 rounded-2xl border border-zinc-800 bg-zinc-950 p-2 shadow-2xl">
      <button
        type="button"
        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
        onClick={() => {
  setIntersaisonSourceFilter("Tous");
  setIntersaisonSourceMenuOpen(false);
}}
      >
        Tous
      </button>

      {guildCodes.map((code) => (
        <button
          key={code}
          type="button"
          className="block w-full rounded-xl px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-800"
          onClick={() => {
              setIntersaisonSourceFilter(code);
              setIntersaisonSourceMenuOpen(false);
            }}
        >
          {code}
        </button>
      ))}
    </div>
  )}
</div>
<div className="text-center">Destination</div>
<div className="text-center">Souhait</div>
<div className="text-center">Validation</div>
<div className="text-center">Transfert</div>
  </div>

  {selectedIntersaisonRows.length > 0 ? (
    selectedIntersaisonRows.map((row, index) => (
      <div
        key={row.id}
                onClick={() => {
          if (String(highlightedIntersaisonRowId) === String(row.id)) {
            setHighlightedIntersaisonRowId(null);
          }
        }}
        className={`grid grid-cols-[70px_minmax(220px,1fr)_140px_140px_180px_120px_120px] items-center border-b border-zinc-800 px-4 py-3 text-sm last:border-b-0 ${
          String(highlightedIntersaisonRowId) === String(row.id)
            ? "bg-sky-500/20 ring-1 ring-sky-400"
            : row.is_manually_confirmed
            ? "bg-emerald-500/10"
            : "bg-red-500/10"
        }`}
      >

<div className="text-center font-semibold text-zinc-400">
  {index + 1}
</div>

<button
  type="button"
  onClick={() => openIntersaisonNoteDialog(row)}
  className="flex items-center gap-2 text-left font-medium text-zinc-100 hover:text-sky-300"
>
  <span>{row.watcher_name}</span>
  {getIntersaisonNoteForAssignment(row.id) && (
    <span
      className="rounded-lg px-2 py-1 text-sm text-sky-300"
      title="Une note existe pour ce joueur"
    >
      💬
    </span>
  )}
</button>

        <div className="flex justify-center">
          <div className="w-full text-center text-zinc-300">
            {row.source_guild_code || "—"}
          </div>
        </div>

        <div className="flex justify-center">
          <div className="w-full text-center text-zinc-300">
            {row.target_guild_code || "BROUILLON"}
          </div>
        </div>
<div className="flex justify-center">
  <button
    type="button"
    onClick={() => {
  setTestWishRow(row);
  setTestWishInput(row.wished_guild_codes || []);
}}
    className="flex min-h-[42px] min-w-[120px] flex-wrap items-center justify-center gap-2 rounded-2xl border border-zinc-700 bg-zinc-900 px-3 py-2 hover:bg-zinc-800"
  >
    {(row.wished_guild_codes || []).length > 0 ? (
      row.wished_guild_codes.map((code) => (
        <Badge
          key={`${row.id}-${code}`}
          className="rounded-xl bg-sky-500/15 text-sky-300"
        >
          {code}
        </Badge>
      ))
    ) : (
      <span className="text-zinc-500">—</span>
    )}
  </button>
</div>
<div className="flex justify-center">
  <Button
    size="sm"
    className={
      row.is_manually_confirmed
        ? "rounded-xl bg-red-600 text-white hover:bg-red-500"
        : "rounded-xl bg-emerald-600 text-white hover:bg-emerald-500"
    }
    onClick={() => toggleIntersaisonAssignmentConfirmation(row.id)}
  >
    {row.is_manually_confirmed ? "Annuler" : "Valider"}
  </Button>
</div>

        <div className="flex justify-center">
          <div className="flex items-center justify-center">
            <button
              type="button"
              className="rounded-xl p-2 text-amber-300 hover:bg-zinc-800 hover:text-amber-200"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIntersaisonAssignmentToMove(row);
                setSelectedIntersaisonMoveDashboardId(
                  String(row.dashboard_id || "")
                );
                setIntersaisonMoveDialogOpen(true);
              }}
              title="Transférer ce joueur vers un autre dashboard prévisionnel"
            >
              <ArrowRightLeft className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    ))
  ) : (
    <div className="px-4 py-6 text-sm text-zinc-500">
      Aucun joueur dans ce dashboard prévisionnel.
    </div>
  )}
</div>
{testWishRow && (
  <div className="fixed bottom-4 right-4 z-50 rounded-xl bg-zinc-900 p-4 text-white shadow-xl">
    <div className="text-sm text-zinc-400">Test souhait</div>
    <div className="font-bold">{testWishRow.watcher_name}</div>
<div className="mt-2 flex flex-wrap gap-2">
  {guildCodes.map((code) => {
    const active = testWishInput.includes(code);


    return (
      <button
        key={code}
        onClick={() => {
          setTestWishInput((prev) =>
            prev.includes(code)
              ? prev.filter((c) => c !== code)
              : [...prev, code]
          );
        }}
        className={`rounded-lg px-3 py-1 text-sm ${
          active
            ? "bg-sky-500 text-white"
            : "bg-zinc-700 text-zinc-200"
        }`}
      >
        {code}
      </button>
    );
  })}
</div>

<div className="mt-2 text-xs text-zinc-400">
  sélection : {testWishInput.join(", ") || "aucun"}
</div>

<div className="mt-3 flex gap-2">
  <button
    className="rounded bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-500"
    onClick={saveTestWish}
  >
    enregistrer
  </button>

  <button
    className="rounded bg-red-500 px-2 py-1 text-xs"
    onClick={() => setTestWishRow(null)}
  >
    fermer
  </button>
</div>
  </div>
)}
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={conditionDialogOpen} onOpenChange={setConditionDialogOpen}>
        <DialogContent className="max-w-xl border-zinc-800 bg-zinc-950 text-white">
          <DialogHeader>
            <DialogTitle>Gérer les conditions</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="text-sm text-zinc-400">
              Défense sélectionnée :{" "}
              <span className="font-semibold text-white">
                {defenses.find((d) => String(d.id) === String(conditionDefenseId))
                  ?.name || "Aucune"}
              </span>
            </div>

            <div className="space-y-2">
              {(defenses.find((d) => String(d.id) === String(conditionDefenseId))
                ?.conditions || []).length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-sm text-zinc-500">
                  Aucune condition pour cette défense.
                </div>
              ) : (
                defenses
                  .find((d) => String(d.id) === String(conditionDefenseId))
                  ?.conditions?.map((condition) => (
                    <div
                      key={condition.id || condition.label}
                      className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3 text-sm"
                    >
<span>{typeof condition === "string" ? condition : condition.label}</span>

<button
  type="button"
  onClick={() => removeConditionById(condition.id)}
                        className="rounded-lg border border-red-900/60 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                      >
                        Supprimer
                      </button>
                    </div>
                  ))
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <select
                value={newCondition.hero}
                onChange={(e) =>
                  setNewCondition((prev) => ({ ...prev, hero: e.target.value }))
                }
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
              >
                <option value="">Héros</option>
                {(defenses.find((d) => String(d.id) === String(conditionDefenseId))
                  ?.slots || [])
                  .filter(Boolean)
                  .map((hero) => (
                    <option key={hero} value={hero}>
                      {hero}
                    </option>
                  ))}
              </select>

              <select
                value={newCondition.minAwakening}
                onChange={(e) =>
                  setNewCondition((prev) => ({
                    ...prev,
                    minAwakening: e.target.value,
                  }))
                }
                className="rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
              >
                <option value="">Éveil minimum</option>
                {[0, 1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    A{value}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={addCondition}
              className="w-full rounded-xl border border-emerald-700 bg-emerald-950/50 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-900/50"
            >
              Ajouter la condition
            </button>
          </div>
        </DialogContent>
      </Dialog>

      </div>
    </div>
  );
}