/**
 * Fonctions de calcul et utilitaires pour le Dashboard de Guilde
 */

export function buildDefaultAwakenings(metaHeroes) {
  return Object.fromEntries(metaHeroes.map((hero) => [hero, -1]));
}

export function awakeningLabel(value) {
  return value === -1 ? "✖" : String(value);
}

export function awakeningTone(value) {
  if (value === -1) return "bg-red-500/20 text-red-300 border-red-500/40";
  return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
}

export function getDefenseConditionRequirements(defense) {
  return (defense.conditions || [])
    .map((condition) => {
      const label =
        typeof condition === "string" ? condition : condition?.label || "";

      const match = label.match(/^(.+?) A(\d) minimum$/);
      if (!match) return null;

      return {
        hero: match[1],
        minAwakening: Number(
          typeof condition === "string"
            ? match[2]
            : condition?.minAwakening ?? match[2]
        ),
      };
    })
    .filter(Boolean);
}

export function getMemberDefenseCompletion(member, defense) {
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

export function getDefenseAwakeningScore(member, defense) {
  if (!member || !defense) return 0;

  return (defense.slots || []).reduce((total, hero) => {
    const value = member.awakenings?.[hero] ?? -1;

    // héros absent = 0 point
    if (value < 0) return total;

    // héros présent = on ajoute son éveil réel
    return total + value;
  }, 0);
}

export function getMemberTrackedDefenseScore(member, defense) {
  if (!member || !defense) return null;

  const completion = getMemberDefenseCompletion(member, defense);

  if (completion === 0) {
    return null;
  }

  return getDefenseAwakeningScore(member, defense);
}

export function buildDiscordMessage(member, profileLink) {
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

export function formatDefenseCounterLabel(index) {
  return `Def méta ${index + 1}`;
}

export function normalizeDefenseTier(tier) {
  const value = String(tier || "").trim().toLowerCase();

  if (value === "meta_s" || value === "meta s") return "meta_s";
  if (value === "meta_a" || value === "meta a") return "meta_a";
  if (value === "meta") return "meta";
  if (value === "secondaire") return "secondaire";

  return value;
}

export function getMetaDefenseCounters(defenses, members, metaFilter = "all") {
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

export function analyzeDefenseCompatibility(member, defense) {
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

export function getAssignedDefenseTone(defense, member) {
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

export function getDefenseConflict(defenseA, defenseB) {
  if (!defenseA || !defenseB) return [];

  const slotsA = defenseA.slots || [];
  const slotsB = defenseB.slots || [];

  return [...new Set(slotsA.filter((hero) => slotsB.includes(hero)))];
}

export function getDefenseRootId(defense) {
  return defense?.sourceDefenseId || defense?.id || null;
}

export function canShowDefenseForMember(defense, assignedDefense1, assignedDefense2) {
  if (!defense) return false;

  if (assignedDefense1?.name === defense.name || assignedDefense2?.name === defense.name) {
    return true;
  }

  const conflictsWithDef1 = getDefenseConflict(defense, assignedDefense1);
  if (conflictsWithDef1.length > 0) return false;

  const conflictsWithDef2 = getDefenseConflict(defense, assignedDefense2);
  if (conflictsWithDef2.length > 0) return false;

  return true;
}

export function normalizeHeroImageName(heroName) {
  return (heroName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function getHeroImageUrl(heroName) {
  return `/heroes/${normalizeHeroImageName(heroName)}.png`;
}

export function getDemonicMonsterImageUrl(slug) {
  return `/demonic-monsters/${slug}.png`;
}

export function extractGuildCodeFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean).map((part) => part.toUpperCase());
  const guildPart = parts.find((part) => /^G[1-9]\d*$/.test(part));
  return guildPart || "G1";
}

export function formatPbAverage(value) {
  if (!value || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

export function isPbOutdated(date) {
  if (!date) return false;
  const now = new Date();
  const updated = new Date(date);
  const diffTime = now - updated;
  const diffDays = diffTime / (1000 * 60 * 60 * 24);
  return diffDays >= 30;
}

export function getDisplayedPbValue(slot, member) {
  if (!slot) return 0;
  const raw = Number(slot.pbRaw || 0);
  if (slot.championLord !== "lord") return raw;
  const awakeningLevel =
    slot.championName && member?.awakenings
      ? Number(member.awakenings[slot.championName] ?? -1)
      : -1;
  if (awakeningLevel < 0) return raw;
  const multiplierMap = { 0: 1.10, 1: 1.11, 2: 1.12, 3: 1.13, 4: 1.14, 5: 1.15 };
  const multiplier = multiplierMap[awakeningLevel] ?? 1;
  return raw * multiplier;
}

export function getDefenseLikeTargetId(defense) {
  return getDefenseRootId(defense);
}