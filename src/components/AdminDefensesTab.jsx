import React, { useMemo, useState } from "react";
import { Shield, Plus, Pencil, Trash2 } from "lucide-react";

export default function AdminDefensesTab({
  defenses = [],
  onEdit,
  onDelete,
  onAdd,
  onAddCondition,
}) {
  const [typeFilter, setTypeFilter] = useState("all");

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
                className="grid min-h-[220px] grid-cols-[1fr_300px_auto] gap-5 rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4"
              >
                <div className="flex flex-col">
                  <div>
                    <div className="font-semibold text-white">
                      {defense.name}
                    </div>
                    <div className="mt-1 text-xs text-zinc-400">
                      {defense.tier} · {defense.type}
                    </div>
                  </div>

                  <div className="mt-3 text-sm text-zinc-300">
                    Héros :{" "}
                    {(defense.slots || []).filter(Boolean).join(", ") ||
                      "Non renseigné"}
                  </div>

                  <div className="mt-2 text-sm text-zinc-400">
                    Conditions :
                    {(defense.conditions || []).length === 0 ? (
                      <span className="ml-2 text-zinc-500">Aucune</span>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {defense.conditions.slice(0, 5).map((cond, i) => (
                          <li
                            key={cond.id || cond.label || i}
                            className="text-xs text-zinc-300"
                          >
                            • {typeof cond === "string" ? cond : cond.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="flex h-[180px] items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
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
                    className="rounded-xl border border-zinc-700 p-2 text-zinc-200 hover:bg-zinc-800"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onDelete?.(defense)}
                    className="rounded-xl border border-red-900/60 p-2 text-red-300 hover:bg-red-950/40"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => onAddCondition?.(defense)}
                    className="rounded-xl border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                  >
                    + Condition
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}