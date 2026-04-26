import React from "react";
import { Shield, Plus, Pencil, Trash2 } from "lucide-react";

export default function AdminDefensesTab({
  defenses = [],
  onEdit,
  onDelete,
  onAdd,
  onAddCondition,
}) {
  

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

      <div className="grid gap-3">
        {defenses.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4 text-sm text-zinc-400">
            Aucune défense chargée.
          </div>
        ) : (
          defenses.map((defense) => (
            <div
              key={defense.id}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-semibold text-white">{defense.name}</div>
                  <div className="mt-1 text-xs text-zinc-400">
                    {defense.tier} · {defense.type}
                  </div>
                </div>

                <div className="flex gap-2">
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
{defense.conditions.map((cond, i) => (
  <li key={cond.id || i} className="text-xs text-zinc-300">
    • {typeof cond === "string" ? cond : cond.label}
  </li>
))}
                  </ul>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}