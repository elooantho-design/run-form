import React, { useMemo, useState } from "react";
import { Shield, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

export default function AdminDefensesTab({
  defenses = [],
  onEdit,
  onDelete,
  onAdd,
  onAddCondition,
}) {
  const [typeFilter, setTypeFilter] = useState("all");
const [blocksModalOpen, setBlocksModalOpen] = useState(false);
const [selectedDefenseForBlocks, setSelectedDefenseForBlocks] = useState(null);
const [defenseBlocks, setDefenseBlocks] = useState([]);
const [blocksLoading, setBlocksLoading] = useState(false);
const [newTextBlock, setNewTextBlock] = useState("");

const openDefenseBlocksModal = async (defense) => {
  setSelectedDefenseForBlocks(defense);
  setBlocksModalOpen(true);
  setBlocksLoading(true);

  const { data, error } = await supabase
    .from("guild_defense_blocks")
    .select("id, defense_id, block_type, content, sort_order")
    .eq("defense_id", defense.id)
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Erreur chargement blocs défense:", error);
    setDefenseBlocks([]);
  } else {
    setDefenseBlocks(data || []);
  }

  setBlocksLoading(false);
};

  const displayedDefenses = useMemo(() => {
    return [...defenses]
      .filter((defense) => {
        if (typeFilter === "all") return true;

        return (
          String(defense.type || "")
            .trim()
            .toLowerCase() === typeFilter
        );
      })
      .sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "fr", {
          sensitivity: "base",
        })
      );
  }, [defenses, typeFilter]);

  const filterButtonClass = (value) =>
    `rounded-xl border px-3 py-1.5 text-sm ${
      typeFilter === value
        ? "border-emerald-600 bg-emerald-950/50 text-emerald-200"
        : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
    }`;

const defenseCardClass = (tier) => {
  const normalizedTier = String(tier || "").trim().toLowerCase();

  if (normalizedTier === "meta_s") {
    return "border-4 border-sky-400 bg-sky-500/35 shadow-[0_0_22px_rgba(56,189,248,0.45)]";
  }

  return "border-4 border-lime-300 bg-lime-500/35 shadow-[0_0_22px_rgba(163,230,53,0.45)]";
};

const moveBlock = async (index, direction) => {
  const next = [...defenseBlocks];
  const targetIndex = direction === "up" ? index - 1 : index + 1;

  if (targetIndex < 0 || targetIndex >= next.length) return;

  [next[index], next[targetIndex]] = [next[targetIndex], next[index]];

  const updated = next.map((block, i) => ({
    ...block,
    sort_order: i + 1,
  }));

  setDefenseBlocks(updated);

  await Promise.all(
    updated.map((block) =>
      supabase
        .from("guild_defense_blocks")
        .update({ sort_order: block.sort_order })
        .eq("id", block.id)
    )
  );
};

const deleteBlock = async (block) => {
  const confirmDelete = window.confirm("Supprimer ce bloc ?");
  if (!confirmDelete) return;

  // 🔥 si c’est une image → supprimer du storage
  if (block.block_type === "image" && block.content) {
    try {
      const url = new URL(block.content);
      const filePath = url.pathname.split("/defense-images/")[1];

      if (filePath) {
        const { error: storageError } = await supabase.storage
          .from("defense-images")
          .remove([filePath]);

        if (storageError) {
          console.error("Erreur suppression image storage:", storageError);
        }
      }
    } catch (e) {
      console.error("Erreur parsing URL image:", e);
    }
  }

  // 🔥 suppression DB
  const { error } = await supabase
    .from("guild_defense_blocks")
    .delete()
    .eq("id", block.id);

  if (error) {
    console.error("Erreur suppression bloc:", error);
    return;
  }

  setDefenseBlocks((prev) => prev.filter((b) => b.id !== block.id));
};

const addTextBlock = async () => {
  if (!selectedDefenseForBlocks?.id) return;

  const cleanText = newTextBlock.trim();
  if (!cleanText) return;

  const nextSortOrder = defenseBlocks.length + 1;

  const { data, error } = await supabase
    .from("guild_defense_blocks")
    .insert({
      defense_id: selectedDefenseForBlocks.id,
      block_type: "text",
      content: cleanText,
      sort_order: nextSortOrder,
    })
    .select("id, defense_id, block_type, content, sort_order")
    .single();

  if (error) {
    console.error("Erreur ajout bloc texte:", error);
    return;
  }

  setDefenseBlocks((prev) => [...prev, data]);
  setNewTextBlock("");
};

const compressImageFile = (file, maxWidth = 1400, quality = 0.82) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = () => {
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement("canvas");

        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Compression image impossible"));
              return;
            }

            resolve(
              new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), {
                type: "image/webp",
              })
            );
          },
          "image/webp",
          quality
        );
      };

      img.onerror = reject;
      img.src = reader.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const addImageBlock = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";

  if (!file || !selectedDefenseForBlocks?.id) return;

  try {
    const compressedFile = await compressImageFile(file);
    const filePath = `editor-block-${Date.now()}-${crypto.randomUUID()}.webp`;

    const { error: uploadError } = await supabase.storage
      .from("defense-images")
      .upload(filePath, compressedFile, {
        contentType: "image/webp",
        upsert: false,
      });

    if (uploadError) {
      console.error("Erreur upload image bloc:", uploadError);
      return;
    }

    const { data: publicData } = supabase.storage
      .from("defense-images")
      .getPublicUrl(filePath);

    const imageUrl = publicData.publicUrl;
    const nextSortOrder = defenseBlocks.length + 1;

    const { data, error } = await supabase
      .from("guild_defense_blocks")
      .insert({
        defense_id: selectedDefenseForBlocks.id,
        block_type: "image",
        content: imageUrl,
        sort_order: nextSortOrder,
      })
      .select("id, defense_id, block_type, content, sort_order")
      .single();

    if (error) {
      console.error("Erreur ajout bloc image:", error);
      return;
    }

    setDefenseBlocks((prev) => [...prev, data]);
  } catch (error) {
    console.error("Erreur compression/upload image bloc:", error);
  }
};

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <Shield className="h-5 w-5" />
            Admin défenses
          </h2>
          <p className="text-sm text-zinc-400">
            Gestion des défenses disponibles dans Mes défenses.
          </p>
        </div>

        <button
          type="button"
          onClick={onAdd}
          className="flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-800"
        >
          <Plus className="h-4 w-4" />
          Ajouter une défense
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTypeFilter("all")}
          className={filterButtonClass("all")}
        >
          Toutes
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter("tour")}
          className={filterButtonClass("tour")}
        >
          Tour
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter("bastion")}
          className={filterButtonClass("bastion")}
        >
          Bastion
        </button>
      </div>

      <div className="grid gap-3">
        {displayedDefenses.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
            Aucune défense chargée.
          </div>
        ) : (
          displayedDefenses.map((defense) => {
            const imageSrc = defense.image || defense.image_url || "";

            return (
              <div
                key={defense.id}
                className={`grid min-h-[220px] grid-cols-[1fr_300px_auto] gap-5 rounded-2xl p-4 ${defenseCardClass(
                  defense.tier
                )}`}
              >
                <div className="flex flex-col">
                  <div>
                    <div className="font-semibold text-white">
                      {defense.name}
                    </div>
                    <div className="mt-1 text-xs text-zinc-300">
                      {defense.tier} · {defense.type}
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-zinc-200">
                    Héros :{" "}
                    {(defense.slots || []).filter(Boolean).join(", ") ||
                      "Non renseigné"}
                  </div>

                  <div className="mt-2 text-sm text-zinc-300">
                    Conditions :
                    {(defense.conditions || []).length === 0 ? (
                      <span className="ml-2 text-zinc-400">Aucune</span>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {defense.conditions.slice(0, 5).map((cond, i) => (
                          <li
                            key={cond.id || cond.label || i}
                            className="text-xs text-zinc-200"
                          >
                            • {typeof cond === "string" ? cond : cond.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="flex h-[180px] items-center justify-center overflow-hidden rounded-xl border border-black/30 bg-zinc-950/80">
                  {imageSrc ? (
                    <img
                      src={imageSrc}
                      alt={defense.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="text-xs text-zinc-500">Aucune image</div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => onEdit?.(defense)}
                    className="rounded-xl border border-zinc-700 bg-zinc-950/40 p-2 text-zinc-200 hover:bg-zinc-800"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onDelete?.(defense)}
                    className="rounded-xl border border-red-900/60 bg-zinc-950/40 p-2 text-red-300 hover:bg-red-950/40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onAddCondition?.(defense)}
                    className="rounded-xl border border-zinc-700 bg-zinc-950/40 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    + Condition
                  </button>
                  <button
  type="button"
  onClick={() => openDefenseBlocksModal(defense)}
  className="rounded-xl border border-blue-700 bg-blue-900/30 px-2 py-1 text-xs text-blue-300 hover:bg-blue-800/50"
>
  💬 Infos
</button>
                </div>
              </div>
            );
          })
        )}
      </div>
 {blocksModalOpen && selectedDefenseForBlocks && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
    <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-zinc-800 bg-zinc-950 p-5 text-white">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold">Infos défense</div>
          <div className="text-sm text-zinc-400">
            {selectedDefenseForBlocks.name}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setBlocksModalOpen(false)}
          className="rounded-xl border border-zinc-700 px-3 py-1 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          Fermer
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto rounded-xl border border-dashed border-zinc-700 p-4 text-sm text-zinc-400">
        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
          <div className="mb-2 text-sm font-semibold text-zinc-200">
            Ajouter un bloc texte
          </div>

          <textarea
            value={newTextBlock}
            onChange={(e) => setNewTextBlock(e.target.value)}
            rows={4}
            placeholder="Écris ton commentaire ici..."
            className="w-full resize-none rounded-xl border border-zinc-700 bg-zinc-950 p-3 text-sm text-white outline-none focus:border-blue-500"
          />

<div className="mt-2 flex flex-wrap gap-2">
  <button
    type="button"
    onClick={addTextBlock}
    className="rounded-xl border border-emerald-700 bg-emerald-900/30 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-800/50"
  >
    Enregistrer le texte
  </button>

  <label className="cursor-pointer rounded-xl border border-blue-700 bg-blue-900/30 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-800/50">
    Ajouter un fichier
    <input
      type="file"
      accept="image/*"
      onChange={addImageBlock}
      className="hidden"
    />
  </label>
</div>
        </div>

        {blocksLoading ? (
          "Chargement..."
        ) : defenseBlocks.length === 0 ? (
          "Aucun bloc pour cette défense."
        ) : (
          <div className="space-y-2">
            {defenseBlocks.map((block, index) => (
              <div
                key={block.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wide text-zinc-500">
                    {block.block_type === "image" ? "Image" : "Texte"}
                  </div>

                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => moveBlock(index, "up")}
                      disabled={index === 0}
                      className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 disabled:opacity-30"
                    >
                      ↑
                    </button>

                    <button
                      type="button"
                      onClick={() => moveBlock(index, "down")}
                      disabled={index === defenseBlocks.length - 1}
                      className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300 disabled:opacity-30"
                    >
                      ↓
                    </button>

                    <button
                      type="button"
                      onClick={() => deleteBlock(block)}
                      className="rounded-lg border border-red-800 px-2 py-1 text-xs text-red-300 hover:bg-red-950/40"
                    >
                      Supprimer
                    </button>
                  </div>
                </div>

                {block.block_type === "image" ? (
                  <div className="overflow-hidden rounded-xl border border-zinc-800 bg-black">
                    <img
                      src={block.content}
                      alt="Bloc défense"
                      className="max-h-[320px] w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap rounded-xl bg-zinc-950/70 p-3 text-sm text-zinc-200">
                    {block.content}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
)}
    </div>
  );
}