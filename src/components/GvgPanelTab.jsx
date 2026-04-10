import React, { useEffect, useMemo, useState } from "react";

function getApiBase() {
  if (typeof window === "undefined") return "";

  const { hostname } = window.location;

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://localhost:3000";
  }

  return "";
}

export default function GvgPanelTab() {
  const apiBase = useMemo(() => getApiBase(), []);
const [guild, setGuild] = useState("G1");
const [items, setItems] = useState([]);
const [loading, setLoading] = useState(false);
const [message, setMessage] = useState("");
const [commentModal, setCommentModal] = useState(null);
const [commentValue, setCommentValue] = useState("");
const [attackModal, setAttackModal] = useState(null);
const [attackValue, setAttackValue] = useState("");
const [returnModal, setReturnModal] = useState(null);

  async function load() {
    try {
      setLoading(true);
      setMessage("");

      const response = await fetch(
        `${apiBase}/api/gvg-data?guild=${encodeURIComponent(guild)}`
      );

      const rawText = await response.text();
      let data = null;

      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        setMessage(`Réponse non JSON gvg-panel-list (${response.status})`);
        setItems([]);
        return;
      }

      if (!response.ok) {
        setMessage(`Erreur chargement panel : ${data?.error || "erreur inconnue"}`);
        setItems([]);
        return;
      }

      const opened = (data?.items || []).filter(
        (d) => d.record_status !== null && d.record_status !== undefined
      );

      setItems(opened);
    } catch (error) {
      console.error("load panel error:", error);
      setMessage(`Erreur chargement panel : ${error?.message || "erreur inconnue"}`);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [guild]);
  function buildSlotLabel(bastion, type, tower, team) {
    if (type === "fortress") {
      return `B${bastion}_F_T${team}`;
    }

    return `B${bastion}_T${tower}_T${team}`;
  }

  function getDefenseForSlot(bastion, type, tower, team) {
    return (
      items.find(
        (d) =>
          Number(d.bastion) === Number(bastion) &&
          d.type === type &&
          Number(d.team) === Number(team) &&
          (type === "fortress" || Number(d.tower) === Number(tower))
      ) || null
    );
  }
  async function toggleRecord(defense) {
  try {
    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: defense.id,
        action: "record_toggle",
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage("Erreur réponse toggle");
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur toggle");
      return;
    }

    load(); // refresh
  } catch (e) {
    console.error(e);
    setMessage("Erreur toggle");
  }
}

function openCommentModal(defense) {
  setCommentModal(defense);
  setCommentValue(defense.record_comment || "");
}

function openAttackModal(defense) {
  setAttackModal(defense);
  setAttackValue(defense.attack_code || "");
}

function openReturnModal(defense) {
  setReturnModal(defense);
}

async function saveComment() {
  if (!commentModal) return;

  try {
    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: commentModal.id,
        action: "panel_update_fields",
        record_comment: commentValue,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage("Erreur JSON commentaire");
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur sauvegarde commentaire");
      return;
    }

    setCommentModal(null);
    load();
  } catch (e) {
    console.error(e);
    setMessage("Erreur commentaire");
  }
}

async function saveAttackCode() {
  if (!attackModal) return;

  try {
    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: attackModal.id,
        action: "panel_update_fields",
        attack_code: attackValue,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage("Erreur JSON code d'attaque");
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur sauvegarde code d'attaque");
      return;
    }

    setAttackModal(null);
    load();
  } catch (e) {
    console.error(e);
    setMessage("Erreur code d'attaque");
  }
}

function buildAhkCommand() {
  const selected = items
    .filter((d) => d.record_status === "a_record")
    .sort((a, b) => {
      if (a.bastion !== b.bastion) return a.bastion - b.bastion;
      if (a.type !== b.type) return a.type === "tower" ? -1 : 1;
      if ((a.tower || 0) !== (b.tower || 0)) return (a.tower || 0) - (b.tower || 0);
      return a.team - b.team;
    });

  if (!selected.length) {
    setMessage("Aucune défense à record");
    return;
  }

  const shots = selected
    .map((d) => {
      if (d.type === "fortress") {
        return `b${d.bastion}_fort_team${d.team}`;
      }

      return `b${d.bastion}_t${d.tower}_team${d.team}`;
    })
    .join("|");

  const command = `& "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe" \`
  "C:\\Users\\athon\\OneDrive\\Bureau\\Bot Zizi\\Bot-Paladin\\record_run_with_req.ahk" \`
  --shots "${shots}"`;

  navigator.clipboard.writeText(command);
  setMessage("Commande copiée !");
}

async function markRecordOk() {
  try {
    setMessage("");

    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "record_ok",
        guild,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Réponse non JSON record_ok (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur Record OK");
      return;
    }

    setMessage(`${data?.updated || 0} défense(s) passée(s) en record`);
    load();
  } catch (error) {
    console.error("markRecordOk error:", error);
    setMessage(`Erreur Record OK : ${error?.message || "erreur inconnue"}`);
  }
}

async function pushToBase() {
  try {
    setMessage("");

    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "push_to_base",
        guild,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Réponse non JSON push_to_base (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur Push en base");
      return;
    }

    setMessage(`${data?.pushed || 0} défense(s) poussée(s) en base`);
    load();
  } catch (error) {
    console.error("pushToBase error:", error);
    setMessage(`Erreur Push en base : ${error?.message || "erreur inconnue"}`);
  }
}

async function confirmReturnToCurrent() {
  if (!returnModal) return;

  try {
    setMessage("");

    const response = await fetch(`${apiBase}/api/gvg-data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "panel_return",
        id: returnModal.id,
      }),
    });

    const rawText = await response.text();
    let data = null;

    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      setMessage(`Réponse non JSON panel_return (${response.status})`);
      return;
    }

    if (!response.ok) {
      setMessage(data?.error || "Erreur retour vers GVG en cours");
      return;
    }

    setReturnModal(null);
    setMessage("Défense renvoyée dans GVG en cours");
    load();
  } catch (error) {
    console.error("confirmReturnToCurrent error:", error);
    setMessage(`Erreur retour GVG : ${error?.message || "erreur inconnue"}`);
  }
}

  return (
    <div className="space-y-4">
<div className="flex flex-wrap items-center gap-2">
  <button
    onClick={() => setGuild("G1")}
    className={`px-3 py-1 rounded ${
      guild === "G1" ? "bg-white text-black" : "bg-zinc-800 text-white"
    }`}
  >
    G1
  </button>

  <button
    onClick={() => setGuild("G2")}
    className={`px-3 py-1 rounded ${
      guild === "G2" ? "bg-white text-black" : "bg-zinc-800 text-white"
    }`}
  >
    G2
  </button>

  <button
    onClick={buildAhkCommand}
    className="rounded bg-green-600 px-3 py-1 text-sm text-white"
  >
    🎬 Record
  </button>

  <button
    onClick={markRecordOk}
    className="rounded bg-blue-600 px-3 py-1 text-sm text-white"
  >
    ✅ Record OK
  </button>

  <button
    onClick={pushToBase}
    className="rounded bg-amber-600 px-3 py-1 text-sm text-white"
  >
    📦 Push en base
  </button>
</div>

      {message ? (
        <div className="text-sm text-red-400">{message}</div>
      ) : null}

      {loading && <div>Chargement…</div>}

      {!loading && !message && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-4">
          {[1, 2, 3, 4].map((bastion) => (
            <div key={bastion} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="mb-3 text-sm font-semibold text-zinc-100">
                Bastion {bastion}
              </div>

              <div className="space-y-2">
                {[
                { type: "fortress", tower: null, team: 1 },
                { type: "fortress", tower: null, team: 2 },
                ...[1, 2, 3, 4, 5].flatMap((tower) =>
                    [1, 2].map((team) => ({
                    type: "tower",
                    tower,
                    team,
                    }))
                ),
                ].map((slot, index) => {
                  const defense = getDefenseForSlot(
                    bastion,
                    slot.type,
                    slot.tower,
                    slot.team
                  );

                  return (
                    <div
                      key={`${bastion}-${slot.type}-${slot.tower ?? "F"}-${slot.team}-${index}`}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 transition
                            ${
                                defense?.record_status === "push"
                                ? "bg-purple-600/30 border-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.4)]"
                                : "border-zinc-800 bg-zinc-950/60"
                            }
                            `}
                    >
                    <button
                    type="button"
                    onClick={() => defense && openReturnModal(defense)}
                    className={`text-left text-xs ${
                        defense
                        ? "text-zinc-100 underline underline-offset-4 hover:text-white"
                        : "text-zinc-200"
                    }`}
                    disabled={!defense}
                    title={defense ? "Renvoyer dans GVG en cours" : ""}
                    >
                    {buildSlotLabel(bastion, slot.type, slot.tower, slot.team)}
                    </button>

                <div className="flex items-center gap-1 shrink-0">
                  {!defense ? (
                    <span className="text-xs text-zinc-600">—</span>
                  ) : (
<>
  <button
    onClick={() => toggleRecord(defense)}
    className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs transition ${
      defense.record_status === "a_record"
        ? "border-green-500 bg-green-500/15"
        : defense.record_status === "pas_record"
        ? "border-red-500 bg-red-500/15"
        : "border-zinc-600 bg-zinc-800/40 cursor-not-allowed opacity-60"
    }`}
    disabled={
      defense.record_status === "record" ||
      defense.record_status === "push"
    }
    title="Toggle record"
  >
    📹
  </button>

  <button
    onClick={() => openCommentModal(defense)}
    className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs transition ${
      defense.record_comment
        ? "border-green-500 bg-green-500/15"
        : "border-red-500 bg-red-500/15"
    }`}
    title="Commentaire"
  >
    💬
  </button>

  <button
    onClick={() => openAttackModal(defense)}
    className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs transition ${
      defense.attack_code
        ? "border-green-500 bg-green-500/15"
        : "border-red-500 bg-red-500/15"
    }`}
    title="Code d'attaque"
  >
    ⚔️
  </button>

  <button
    type="button"
    className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs transition cursor-default ${
      defense.record_status === "record" || defense.record_status === "push"
        ? "border-green-500 bg-green-500/15"
        : "border-red-500 bg-red-500/15"
    }`}
    title="Statut record"
  >
    ✅
  </button>


<button
  type="button"
  className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs transition cursor-default ${
    defense.status === "strat" || defense.record_status === "push"
      ? "border-green-500 bg-green-500/15"
      : "border-red-500 bg-red-500/15"
  }`}
  title="Strat active ou en base"
>
  👍
</button>
</>
                  )}
                </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {commentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-2 text-sm text-zinc-200">
              Commentaire · {buildSlotLabel(
                commentModal.bastion,
                commentModal.type,
                commentModal.tower,
                commentModal.team
              )}
            </div>

            <textarea
              value={commentValue}
              onChange={(e) => setCommentValue(e.target.value)}
              className="h-28 w-full rounded bg-zinc-800 p-2 text-sm text-white outline-none"
              placeholder="Saisis ton commentaire..."
            />

            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setCommentModal(null)}
                className="rounded bg-zinc-700 px-3 py-1 text-sm text-white"
              >
                Annuler
              </button>

              <button
                onClick={saveComment}
                className="rounded bg-green-600 px-3 py-1 text-sm text-white"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {attackModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-2 text-sm text-zinc-200">
              Code d'attaque · {buildSlotLabel(
                attackModal.bastion,
                attackModal.type,
                attackModal.tower,
                attackModal.team
              )}
            </div>

            <textarea
              value={attackValue}
              onChange={(e) => setAttackValue(e.target.value)}
              className="h-28 w-full rounded bg-zinc-800 p-2 text-sm text-white outline-none"
              placeholder="Saisis le code d'attaque..."
            />

            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setAttackModal(null)}
                className="rounded bg-zinc-700 px-3 py-1 text-sm text-white"
              >
                Annuler
              </button>

              <button
                onClick={saveAttackCode}
                className="rounded bg-green-600 px-3 py-1 text-sm text-white"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {returnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <div className="mb-2 text-sm text-zinc-200">
              Renvoyer dans GVG en cours
            </div>

            <div className="text-sm text-zinc-300">
              Veux-tu renvoyer la défense{" "}
              <span className="font-semibold text-white">
                {buildSlotLabel(
                  returnModal.bastion,
                  returnModal.type,
                  returnModal.tower,
                  returnModal.team
                )}
              </span>{" "}
              dans GVG en cours ?
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setReturnModal(null)}
                className="rounded bg-zinc-700 px-3 py-1 text-sm text-white"
              >
                Annuler
              </button>

              <button
                onClick={confirmReturnToCurrent}
                className="rounded bg-red-600 px-3 py-1 text-sm text-white"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
