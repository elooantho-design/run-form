import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Lock, Save, UserRound, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ProfileAvatar from "@/components/ProfileAvatar";
import { usePortalLanguage } from "@/lib/portalLanguage";

function getApiBase() {
  if (typeof window === "undefined") return "";
  const configuredBase = import.meta.env?.VITE_API_BASE_URL;
  if (configuredBase) return configuredBase.replace(/\/$/, "");
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "";
}

function normalizeCosmeticId(value) {
  return String(value || "").trim();
}

function buildAssetMap(assets = []) {
  return new Map((assets || []).map((asset) => [String(asset.id), asset]));
}

function CosmeticChoice({ asset, selected, locked, children, onClick }) {
  return (
    <button
      type="button"
      disabled={locked}
      onClick={onClick}
      className={`relative rounded-lg border bg-zinc-950 p-3 text-left transition ${
        selected
          ? "border-cyan-300/70 shadow-[0_0_0_2px_rgba(103,232,249,0.18)]"
          : "border-zinc-800 hover:border-zinc-600"
      } ${locked ? "cursor-not-allowed opacity-55" : ""}`}
    >
      <div className="flex items-center justify-center">{children}</div>
      <div className="mt-3 flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium text-zinc-100">{asset?.displayName || ""}</span>
        {locked ? <Lock className="h-4 w-4 shrink-0 text-zinc-500" /> : null}
      </div>
    </button>
  );
}

export default function ProfileCosmeticsTab({
  session,
  cosmeticsState,
  loading = false,
  onCosmeticsStateChange,
}) {
  const { t } = usePortalLanguage();
  const apiBase = useMemo(() => getApiBase(), []);
  const catalog = cosmeticsState?.catalog || {};
  const selection = cosmeticsState?.selection || {};
  const assetsById = useMemo(() => buildAssetMap(catalog.assets), [catalog.assets]);
  const [draftAvatarId, setDraftAvatarId] = useState("");
  const [draftFrameId, setDraftFrameId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    setDraftAvatarId(normalizeCosmeticId(selection.selectedAvatarId));
    setDraftFrameId(normalizeCosmeticId(selection.selectedFrameId));
    setMessage("");
    setErrorMessage("");
  }, [selection.selectedAvatarId, selection.selectedFrameId]);

  const draftAvatar = draftAvatarId ? assetsById.get(draftAvatarId) || null : null;
  const draftFrame = draftFrameId && draftAvatar ? assetsById.get(draftFrameId) || null : null;
  const hasChanges =
    normalizeCosmeticId(selection.selectedAvatarId) !== draftAvatarId ||
    normalizeCosmeticId(selection.selectedFrameId) !== draftFrameId;
  const displayName = session?.watcherName || session?.name || t("common.player", "Joueur");

  function resetDraft() {
    setDraftAvatarId(normalizeCosmeticId(selection.selectedAvatarId));
    setDraftFrameId(normalizeCosmeticId(selection.selectedFrameId));
    setMessage("");
    setErrorMessage("");
  }

  async function saveSelection() {
    setSaving(true);
    setMessage("");
    setErrorMessage("");

    try {
      const response = await fetch(`${apiBase}/api/portal-cosmetics`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          selectedAvatarId: draftAvatarId || null,
          selectedFrameId: draftAvatar ? draftFrameId || null : null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || t("profile.saveError", "Sauvegarde impossible."));
      }
      onCosmeticsStateChange?.(payload);
      setMessage(t("profile.saved", "Profil enregistre."));
    } catch (error) {
      setErrorMessage(error?.message || t("profile.saveError", "Sauvegarde impossible."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-sky-400/25 bg-sky-400/10 text-sky-200">
              <UserRound className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-300">
                {t("profile.customization", "Personnalisation")}
              </p>
              <h2 className="mt-1 text-2xl font-semibold text-zinc-50">{t("profile.title", "Mon profil")}</h2>
              <p className="mt-1 text-sm text-zinc-500">{displayName}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-lg border-zinc-700 bg-zinc-900 text-zinc-100 hover:bg-zinc-800"
              onClick={resetDraft}
              disabled={!hasChanges || saving}
            >
              <XCircle className="mr-2 h-4 w-4" />
              {t("profile.cancel", "Annuler")}
            </Button>
            <Button
              type="button"
              className="rounded-lg bg-cyan-500 text-zinc-950 hover:bg-cyan-400"
              onClick={saveSelection}
              disabled={!hasChanges || saving || loading}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {saving ? t("profile.saving", "Enregistrement...") : t("profile.save", "Enregistrer")}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="mt-5 flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading", "Chargement...")}
          </div>
        ) : null}
        {!loading && cosmeticsState && !cosmeticsState.schemaReady ? (
          <div className="mt-5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            {t("profile.schemaMissing", "Les tables de personnalisation ne sont pas encore installees.")}
          </div>
        ) : null}
        {message ? <div className="mt-5 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">{message}</div> : null}
        {errorMessage ? <div className="mt-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">{errorMessage}</div> : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
            {t("profile.preview", "Apercu")}
          </p>
          <div className="mt-5 flex flex-col items-center text-center">
            <ProfileAvatar avatar={draftAvatar} frame={draftFrame} name={displayName} size={220} />
            <div className="mt-4 text-lg font-semibold text-zinc-50">{displayName}</div>
            <p className="mt-1 text-sm text-zinc-500">
              {draftAvatar ? draftAvatar.displayName : t("profile.noAvatarSelected", "Aucun avatar selectionne")}
            </p>
            {draftFrame ? (
              <Badge className="mt-3 rounded-full border-cyan-400/30 bg-cyan-400/10 text-cyan-100">
                {draftFrame.displayName}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                  {t("profile.basicCollection", "Collection Basique")}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-50">{t("profile.avatars", "Avatars")}</h3>
              </div>
              <span className="text-xs text-zinc-500">{catalog.avatars?.length || 0} / 5</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {(catalog.avatars || []).map((avatar) => (
                <CosmeticChoice
                  key={avatar.id}
                  asset={avatar}
                  selected={draftAvatarId === String(avatar.id)}
                  locked={avatar.locked}
                  onClick={() => {
                    setDraftAvatarId(String(avatar.id));
                    setErrorMessage("");
                  }}
                >
                  <ProfileAvatar avatar={avatar} frame={draftFrame} name={displayName} size={88} />
                </CosmeticChoice>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-zinc-500">
                  {t("profile.basicCollection", "Collection Basique")}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-zinc-50">{t("profile.frames", "Cadres")}</h3>
              </div>
              <span className="text-xs text-zinc-500">{catalog.frames?.length || 0} / 5</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <button
                type="button"
                onClick={() => setDraftFrameId("")}
                className={`rounded-lg border bg-zinc-950 p-3 text-left transition ${
                  !draftFrameId ? "border-cyan-300/70 shadow-[0_0_0_2px_rgba(103,232,249,0.18)]" : "border-zinc-800 hover:border-zinc-600"
                }`}
              >
                <div className="flex h-[88px] items-center justify-center rounded-full border border-dashed border-zinc-700 text-xs text-zinc-500">
                  {t("profile.noFrame", "Aucun cadre")}
                </div>
                <div className="mt-3 truncate text-sm font-medium text-zinc-100">{t("profile.noFrame", "Aucun cadre")}</div>
              </button>

              {(catalog.frames || []).map((frame) => (
                <CosmeticChoice
                  key={frame.id}
                  asset={frame}
                  selected={draftFrameId === String(frame.id)}
                  locked={frame.locked || !draftAvatar}
                  onClick={() => {
                    if (!draftAvatar) return;
                    setDraftFrameId(String(frame.id));
                    setErrorMessage("");
                  }}
                >
                  <ProfileAvatar avatar={draftAvatar} frame={frame} name={displayName} size={88} />
                </CosmeticChoice>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
