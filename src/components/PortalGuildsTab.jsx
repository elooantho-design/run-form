import React, { useEffect, useMemo, useState } from "react";
import { Building2, CheckCircle2, Crown, Plus, RefreshCw, Shield, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { logPortalActivity } from "@/lib/portalActivity";
import {
  PALADIN_CLUSTER_GUILD_CODES,
  PALADIN_SPACE_KEY,
  getGuildSpaceKey,
  getGuildSpaceLabel,
  isPaladinGuildCode,
  isLeaderSession,
  normalizeGuildCode,
  normalizeGuildCodeKey,
} from "@/lib/guildScope";

const EMPTY_DEFENSE = "--";
const DEFAULT_PASSWORD = "motdepassemembre";
const ROLE_OPTIONS = [
  { value: "member", label: "Membre" },
  { value: "officier", label: "Officier" },
  { value: "admin", label: "Admin Paladin" },
];

function normalizeText(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeSpaceInput(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toUpperCase();
}

function mapMember(row) {
  return {
    id: row.id,
    name: row.watcher_name || row.discord_id || "Joueur",
    discordId: row.discord_id || "",
    guildCode: row.guild_code || "",
    role: row.role || "member",
  };
}

function buildGuildRows(members) {
  const grouped = new Map();

  members.forEach((member) => {
    const guildCode = normalizeGuildCode(member.guildCode || "Sans guilde");
    const key = normalizeGuildCodeKey(guildCode);

    if (!grouped.has(key)) {
      const spaceKey = getGuildSpaceKey(guildCode);

      grouped.set(key, {
        key,
        guildCode,
        spaceKey,
        spaceLabel: getGuildSpaceLabel(guildCode),
        isPaladin: spaceKey === PALADIN_SPACE_KEY,
        members: [],
      });
    }

    grouped.get(key).members.push(member);
  });

  return [...grouped.values()]
    .map((row) => {
      const officers = row.members.filter((member) => normalizeText(member.role).includes("officier")).length;
      const admins = row.members.filter((member) => {
        const role = normalizeText(member.role);
        return role.includes("admin") || role.includes("leader");
      }).length;

      return {
        ...row,
        memberCount: row.members.length,
        officers,
        admins,
      };
    })
    .sort((a, b) => {
      if (a.isPaladin !== b.isPaladin) return a.isPaladin ? -1 : 1;
      if (a.spaceLabel !== b.spaceLabel) return a.spaceLabel.localeCompare(b.spaceLabel, "fr");
      return a.guildCode.localeCompare(b.guildCode, "fr", { numeric: true });
    });
}

function summarizeSpaces(guildRows) {
  const grouped = new Map();

  guildRows.forEach((guild) => {
    if (!grouped.has(guild.spaceKey)) {
      grouped.set(guild.spaceKey, {
        key: guild.spaceKey,
        label: guild.spaceLabel,
        isPaladin: guild.isPaladin,
        guildCount: 0,
        memberCount: 0,
      });
    }

    const space = grouped.get(guild.spaceKey);
    space.guildCount += 1;
    space.memberCount += guild.memberCount;
  });

  return [...grouped.values()].sort((a, b) => {
    if (a.isPaladin !== b.isPaladin) return a.isPaladin ? -1 : 1;
    return a.label.localeCompare(b.label, "fr");
  });
}

export default function PortalGuildsTab({ session }) {
  const [members, setMembers] = useState([]);
  const [selectedGuildCode, setSelectedGuildCode] = useState("G1");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [newGuild, setNewGuild] = useState({
    spaceName: "",
    guildCode: "",
    firstMemberName: "",
    firstMemberDiscordId: "",
    firstMemberRole: "officier",
  });
  const [newMember, setNewMember] = useState({
    name: "",
    discordId: "",
    role: "member",
  });

  const isLeader = isLeaderSession(session);

  const guildRows = useMemo(() => buildGuildRows(members), [members]);
  const spaceRows = useMemo(() => summarizeSpaces(guildRows), [guildRows]);
  const selectedGuild = useMemo(
    () => guildRows.find((guild) => normalizeGuildCodeKey(guild.guildCode) === normalizeGuildCodeKey(selectedGuildCode)) || guildRows[0] || null,
    [guildRows, selectedGuildCode],
  );
  const selectedMembers = selectedGuild?.members || [];
  const paladinMemberCount = spaceRows.find((space) => space.key === PALADIN_SPACE_KEY)?.memberCount || 0;
  const externalSpaceCount = spaceRows.filter((space) => !space.isPaladin).length;
  const externalMemberCount = spaceRows
    .filter((space) => !space.isPaladin)
    .reduce((total, space) => total + space.memberCount, 0);

  async function loadMembers() {
    setLoading(true);
    setErrorMessage("");

    const { data, error } = await supabase
      .from("guild_members")
      .select("id, role, discord_id, watcher_name, guild_code")
      .order("guild_code", { ascending: true })
      .order("watcher_name", { ascending: true });

    if (error) {
      console.error("Erreur chargement guildes:", error);
      setErrorMessage(error.message || "Impossible de charger les guildes.");
      setLoading(false);
      return;
    }

    const mapped = (data || []).map(mapMember);
    setMembers(mapped);
    setSelectedGuildCode((current) => {
      if (current && mapped.some((member) => normalizeGuildCodeKey(member.guildCode) === normalizeGuildCodeKey(current))) {
        return current;
      }

      return mapped.find((member) => isPaladinGuildCode(member.guildCode))?.guildCode || mapped[0]?.guildCode || "G1";
    });
    setLoading(false);
  }

  useEffect(() => {
    if (!isLeader) return;
    void loadMembers();
  }, [isLeader]);

  async function initializeMemberData(memberId, memberName) {
    let warnings = [];
    const { data: champions, error: championsError } = await supabase
      .from("champions")
      .select("id, name")
      .order("name", { ascending: true });

    if (championsError) {
      console.error("Erreur chargement champions:", championsError);
      warnings = [...warnings, "eveils non initialises"];
    } else {
      const awakeningRows = (champions || [])
        .filter((champion) => champion.id)
        .map((champion) => ({
          member_id: memberId,
          champion_id: champion.id,
          awakening_level: -1,
        }));

      if (awakeningRows.length > 0) {
        const { error } = await supabase.from("member_awakenings").insert(awakeningRows);
        if (error) {
          console.error("Erreur creation eveils:", error);
          warnings = [...warnings, "eveils non initialises"];
        }
      }
    }

    const pbRows = [1, 2, 3, 4, 5].map((slotIndex) => ({
      member_id: memberId,
      member_name: memberName,
      slot_index: slotIndex,
      pb_raw: 0,
      champion_id: null,
    }));

    const { error: pbError } = await supabase.from("member_pb_entries").insert(pbRows);
    if (pbError) {
      console.error("Erreur creation PB:", pbError);
      warnings = [...warnings, "PB non initialises"];
    }

    return warnings;
  }

  async function createOrAttachMember({ name, discordId, guildCode, role }) {
    const cleanName = String(name || "").trim();
    const cleanDiscordId = String(discordId || "").trim();
    const cleanGuildCode = normalizeGuildCode(guildCode);
    const cleanRole = String(role || "member").trim() || "member";

    if (!cleanName || !cleanDiscordId || !cleanGuildCode) {
      throw new Error("Nom, ID Discord et guild code sont obligatoires.");
    }

    const { data: existingMember, error: existingError } = await supabase
      .from("guild_members")
      .select("id, watcher_name, discord_id, guild_code")
      .eq("discord_id", cleanDiscordId)
      .maybeSingle();

    if (existingError) {
      throw new Error(existingError.message || "Verification du joueur impossible.");
    }

    if (existingMember?.guild_code && normalizeGuildCodeKey(existingMember.guild_code) !== normalizeGuildCodeKey(cleanGuildCode)) {
      throw new Error(`Ce joueur existe deja dans ${existingMember.guild_code}.`);
    }

    if (existingMember) {
      const { data, error } = await supabase
        .from("guild_members")
        .update({
          watcher_name: cleanName,
          guild_code: cleanGuildCode,
          role: cleanRole,
        })
        .eq("id", existingMember.id)
        .select("id, role, discord_id, watcher_name, guild_code")
        .single();

      if (error) throw new Error(error.message || "Rattachement impossible.");
      return { member: mapMember(data), warnings: [], attached: true };
    }

    const { data, error } = await supabase
      .from("guild_members")
      .insert([
        {
          watcher_name: cleanName,
          discord_id: cleanDiscordId,
          guild_code: cleanGuildCode,
          role: cleanRole,
          password: DEFAULT_PASSWORD,
          assignment: "Tour",
          status: "A faire",
          awakening_status: "En attente",
          defense_1: EMPTY_DEFENSE,
          defense_2: EMPTY_DEFENSE,
        },
      ])
      .select("id, role, discord_id, watcher_name, guild_code")
      .single();

    if (error) throw new Error(error.message || "Creation du joueur impossible.");

    const warnings = await initializeMemberData(data.id, data.watcher_name || cleanName);
    return { member: mapMember(data), warnings, attached: false };
  }

  async function handleCreateGuild(event) {
    event.preventDefault();
    if (saving) return;

    const spaceKey = normalizeSpaceInput(newGuild.spaceName);
    const guildCode = normalizeGuildCode(newGuild.guildCode || (spaceKey ? `${spaceKey} G1` : ""));

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { member, warnings, attached } = await createOrAttachMember({
        name: newGuild.firstMemberName,
        discordId: newGuild.firstMemberDiscordId,
        guildCode,
        role: newGuild.firstMemberRole,
      });

      setMembers((previous) => [
        ...previous.filter((item) => String(item.id) !== String(member.id)),
        member,
      ]);
      setSelectedGuildCode(member.guildCode);
      setNewGuild({
        spaceName: "",
        guildCode: "",
        firstMemberName: "",
        firstMemberDiscordId: "",
        firstMemberRole: "officier",
      });
      setMessage(
        `${member.guildCode} cree avec ${member.name}${attached ? " rattache" : ""}. Mot de passe initial : ${DEFAULT_PASSWORD}.${
          warnings.length ? ` Attention : ${warnings.join(", ")}.` : ""
        }`,
      );
      void logPortalActivity(session, {
        targetMemberId: member.id,
        targetName: member.name,
        actionType: "guild_external_create",
        entityType: "guild_members",
        entityId: String(member.id),
        summary: `${member.guildCode} cree via l'onglet Guildes`,
        metadata: { guildCode: member.guildCode, role: member.role },
      });
    } catch (error) {
      setErrorMessage(error?.message || "Creation impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddMember(event) {
    event.preventDefault();
    if (saving || !selectedGuild?.guildCode) return;

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      const { member, warnings, attached } = await createOrAttachMember({
        name: newMember.name,
        discordId: newMember.discordId,
        guildCode: selectedGuild.guildCode,
        role: newMember.role,
      });

      setMembers((previous) => [
        ...previous.filter((item) => String(item.id) !== String(member.id)),
        member,
      ]);
      setNewMember({ name: "", discordId: "", role: "member" });
      setMessage(
        `${member.name} ${attached ? "rattache" : "ajoute"} a ${member.guildCode}. Mot de passe initial : ${DEFAULT_PASSWORD}.${
          warnings.length ? ` Attention : ${warnings.join(", ")}.` : ""
        }`,
      );
      void logPortalActivity(session, {
        targetMemberId: member.id,
        targetName: member.name,
        actionType: "guild_member_create",
        entityType: "guild_members",
        entityId: String(member.id),
        summary: `${member.name} ajoute a ${member.guildCode}`,
        metadata: { guildCode: member.guildCode, role: member.role },
      });
    } catch (error) {
      setErrorMessage(error?.message || "Ajout impossible.");
    } finally {
      setSaving(false);
    }
  }

  async function updateMember(member, patch) {
    if (!member?.id || saving) return;

    setSaving(true);
    setMessage("");
    setErrorMessage("");

    const payload = {};
    if (patch.role) payload.role = patch.role;
    if (patch.guildCode) payload.guild_code = normalizeGuildCode(patch.guildCode);

    const { data, error } = await supabase
      .from("guild_members")
      .update(payload)
      .eq("id", member.id)
      .select("id, role, discord_id, watcher_name, guild_code")
      .single();

    if (error) {
      setErrorMessage(error.message || "Modification impossible.");
      setSaving(false);
      return;
    }

    const nextMember = mapMember(data);
    setMembers((previous) =>
      previous.map((item) => (String(item.id) === String(nextMember.id) ? nextMember : item)),
    );
    setSelectedGuildCode(nextMember.guildCode || selectedGuildCode);
    setMessage(`${nextMember.name} mis a jour.`);
    setSaving(false);
  }

  if (!isLeader) {
    return (
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-xl font-semibold text-zinc-50">Guildes</h2>
        <p className="mt-2 text-sm text-zinc-400">Cet onglet est reserve au role leader.</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-amber-300" />
              <h2 className="text-xl font-semibold text-zinc-50">Guildes</h2>
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
              Gestion des espaces Paladin et des guildes externes. Les codes G1 a G7 restent dans Paladin ; un code comme MAD G1 cree un espace MAD separe.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="w-fit rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
            onClick={loadMembers}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Actualiser
          </Button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Paladin</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-50">{paladinMemberCount}</div>
            <div className="text-sm text-zinc-500">membres G1-G7</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Externes</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-50">{externalSpaceCount}</div>
            <div className="text-sm text-zinc-500">espaces separes</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Comptes externes</div>
            <div className="mt-1 text-2xl font-semibold text-zinc-50">{externalMemberCount}</div>
            <div className="text-sm text-zinc-500">visibles au leader</div>
          </div>
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-emerald-200">
              <CheckCircle2 className="h-4 w-4" />
              Isolation active
            </div>
            <div className="mt-1 text-sm text-emerald-100">Les joueurs externes voient leur espace uniquement.</div>
          </div>
        </div>
      </div>

      {message ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {message}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {errorMessage}
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <Card className="rounded-lg border-zinc-800 bg-zinc-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-zinc-50">
              <Building2 className="h-5 w-5 text-sky-300" />
              Guildes declarees
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <div className="grid min-w-[780px] grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.8fr_1fr] bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-400">
                <div>Espace</div>
                <div>Guild code</div>
                <div>Type</div>
                <div>Membres</div>
                <div>Officiers</div>
                <div>Portail</div>
              </div>
              <div className="max-h-[420px] overflow-auto">
                {guildRows.map((guild) => {
                  const selected = normalizeGuildCodeKey(guild.guildCode) === normalizeGuildCodeKey(selectedGuild?.guildCode);

                  return (
                    <button
                      key={guild.key}
                      type="button"
                      onClick={() => setSelectedGuildCode(guild.guildCode)}
                      className={`grid min-w-[780px] grid-cols-[1.1fr_1fr_0.8fr_0.8fr_0.8fr_1fr] border-t border-zinc-800 px-4 py-3 text-left text-sm transition ${
                        selected ? "bg-emerald-500/10 text-zinc-50" : "text-zinc-300 hover:bg-zinc-900"
                      }`}
                    >
                      <div className="font-medium">{guild.spaceLabel}</div>
                      <div>{guild.guildCode}</div>
                      <div>
                        <Badge
                          className={
                            guild.isPaladin
                              ? "rounded-md border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                              : "rounded-md border-sky-500/30 bg-sky-500/10 text-sky-200"
                          }
                        >
                          {guild.isPaladin ? "Paladin" : "Externe"}
                        </Badge>
                      </div>
                      <div>{guild.memberCount}</div>
                      <div>{guild.officers + guild.admins}</div>
                      <div>{guild.spaceLabel} Control</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
              <div className="text-sm font-medium text-zinc-100">Espaces</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {spaceRows.map((space) => (
                  <Badge
                    key={space.key}
                    className={
                      space.isPaladin
                        ? "rounded-md border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                        : "rounded-md border-sky-500/30 bg-sky-500/10 text-sky-200"
                    }
                  >
                    {space.label} : {space.guildCount} guilde(s), {space.memberCount} compte(s)
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="rounded-lg border-zinc-800 bg-zinc-950">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-zinc-50">
                <Plus className="h-5 w-5 text-emerald-300" />
                Nouvelle guilde externe
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreateGuild} className="space-y-3">
                <label className="block">
                  <span className="text-sm text-zinc-400">Nom espace</span>
                  <Input
                    value={newGuild.spaceName}
                    onChange={(event) => {
                      const value = event.target.value;
                      const spaceKey = normalizeSpaceInput(value);
                      setNewGuild((previous) => ({
                        ...previous,
                        spaceName: value,
                        guildCode: previous.guildCode || (spaceKey ? `${spaceKey} G1` : ""),
                      }));
                    }}
                    placeholder="MAD"
                    className="mt-2 rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
                  />
                </label>
                <label className="block">
                  <span className="text-sm text-zinc-400">Guild code</span>
                  <Input
                    value={newGuild.guildCode}
                    onChange={(event) => setNewGuild((previous) => ({ ...previous, guildCode: event.target.value }))}
                    placeholder="MAD G1"
                    className="mt-2 rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
                  />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm text-zinc-400">Premier compte</span>
                    <Input
                      value={newGuild.firstMemberName}
                      onChange={(event) => setNewGuild((previous) => ({ ...previous, firstMemberName: event.target.value }))}
                      placeholder="Nom joueur"
                      className="mt-2 rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-zinc-400">ID Discord</span>
                    <Input
                      value={newGuild.firstMemberDiscordId}
                      onChange={(event) => setNewGuild((previous) => ({ ...previous, firstMemberDiscordId: event.target.value }))}
                      placeholder="123456789"
                      className="mt-2 rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="text-sm text-zinc-400">Role initial</span>
                  <select
                    value={newGuild.firstMemberRole}
                    onChange={(event) => setNewGuild((previous) => ({ ...previous, firstMemberRole: event.target.value }))}
                    className="mt-2 h-9 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none"
                  >
                    <option value="officier">Officier</option>
                    <option value="member">Membre</option>
                  </select>
                </label>
                <Button type="submit" className="w-full rounded-lg bg-emerald-500 text-zinc-950 hover:bg-emerald-400" disabled={saving}>
                  Creer la session externe
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="rounded-lg border-zinc-800 bg-zinc-950">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-zinc-50">
                <Shield className="h-5 w-5 text-violet-300" />
                Regles appliquees
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-zinc-400">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                G1 a G7 restent dans le cluster Paladin et affichent Paladin Control.
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                MAD G1, MAD G2, etc. partagent le meme espace MAD et affichent MAD Control.
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
                Les onglets leader restent reserves a ton compte leader Paladin.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="rounded-lg border-zinc-800 bg-zinc-950">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-zinc-50">
            <Users className="h-5 w-5 text-emerald-300" />
            Membres de {selectedGuild?.guildCode || "la guilde"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedGuild ? (
            <form onSubmit={handleAddMember} className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-900 p-4 lg:grid-cols-[1fr_1fr_180px_auto]">
              <Input
                value={newMember.name}
                onChange={(event) => setNewMember((previous) => ({ ...previous, name: event.target.value }))}
                placeholder="Nom joueur"
                className="rounded-lg border-zinc-700 bg-zinc-950 text-zinc-100"
              />
              <Input
                value={newMember.discordId}
                onChange={(event) => setNewMember((previous) => ({ ...previous, discordId: event.target.value }))}
                placeholder="ID Discord"
                className="rounded-lg border-zinc-700 bg-zinc-950 text-zinc-100"
              />
              <select
                value={newMember.role}
                onChange={(event) => setNewMember((previous) => ({ ...previous, role: event.target.value }))}
                className="h-9 rounded-lg border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none"
              >
                <option value="member">Membre</option>
                <option value="officier">Officier</option>
              </select>
              <Button type="submit" className="rounded-lg" disabled={saving}>
                Ajouter
              </Button>
            </form>
          ) : null}

          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <div className="grid min-w-[760px] grid-cols-[1.2fr_1.1fr_1fr_1fr] bg-zinc-900 px-4 py-3 text-sm font-medium text-zinc-400">
              <div>Joueur</div>
              <div>ID Discord</div>
              <div>Guild code</div>
              <div>Role</div>
            </div>
            <div className="max-h-[460px] overflow-auto">
              {selectedMembers.length > 0 ? (
                selectedMembers
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }))
                  .map((member) => (
                    <div
                      key={member.id}
                      className="grid min-w-[760px] grid-cols-[1.2fr_1.1fr_1fr_1fr] items-center border-t border-zinc-800 px-4 py-3 text-sm"
                    >
                      <div className="font-medium text-zinc-100">{member.name}</div>
                      <div className="text-zinc-400">{member.discordId || "-"}</div>
                      <select
                        value={member.guildCode || ""}
                        onChange={(event) => updateMember(member, { guildCode: event.target.value })}
                        className="mr-3 h-8 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none"
                        disabled={saving}
                      >
                        {[...new Set([...PALADIN_CLUSTER_GUILD_CODES, ...guildRows.map((guild) => guild.guildCode)])].map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </select>
                      <select
                        value={member.role || "member"}
                        onChange={(event) => updateMember(member, { role: event.target.value })}
                        className="h-8 rounded-lg border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none"
                        disabled={saving || normalizeText(member.role) === "leader"}
                      >
                        {ROLE_OPTIONS
                          .filter((role) => role.value !== "admin" || isPaladinGuildCode(member.guildCode))
                          .map((role) => (
                            <option key={role.value} value={role.value}>
                              {role.label}
                            </option>
                          ))}
                        {normalizeText(member.role) === "leader" ? <option value="leader">Leader</option> : null}
                      </select>
                    </div>
                  ))
              ) : (
                <div className="px-4 py-6 text-sm text-zinc-500">Aucun membre dans cette guilde.</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
