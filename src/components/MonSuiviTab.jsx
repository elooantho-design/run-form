import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function badgeClass(value) {
  if (value <= 0) return "hidden";
  return "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-bold text-white";
}

function typeClass(type) {
  if (type === "META S") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }
  if (type === "META A") {
    return "border-sky-500/30 bg-sky-500/10 text-sky-300";
  }
  return "border-white/10 bg-white/5 text-zinc-300";
}

function commentCardClass(isOwn) {
  return isOwn
    ? "ml-auto max-w-[88%] rounded-2xl border border-sky-500/20 bg-sky-500/10 p-3"
    : "mr-auto max-w-[88%] rounded-2xl border border-white/10 bg-white/5 p-3";
}

function getYoutubeEmbedUrl(url) {
  if (!url) return null;

  const trimmed = url.trim();

  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&]+)/,
    /(?:youtu\.be\/)([^?&]+)/,
    /(?:youtube\.com\/embed\/)([^?&]+)/,
    /(?:youtube\.com\/shorts\/)([^?&]+)/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return `https://www.youtube.com/embed/${match[1]}`;
    }
  }

  return null;
}

function extractMentions(text) {
  if (!text) return [];

  const matches = text.match(/@([a-zA-Z0-9_À-ÿ-]+)/g) || [];

  return [...new Set(matches.map((item) => item.slice(1)))];
}

function StatBlock({ label, value }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

async function compressImage(file, maxWidth = 800, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = (e) => {
      img.src = e.target.result;
    };

    reader.onerror = () => {
      reject(new Error("Impossible de lire le fichier image."));
    };

    img.onload = () => {
      const canvas = document.createElement("canvas");

      const scale = Math.min(maxWidth / img.width, 1);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Impossible de créer le canvas de compression."));
        return;
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("Impossible de compresser l'image."));
            return;
          }
          resolve(blob);
        },
        "image/jpeg",
        quality
      );
    };

    img.onerror = () => {
      reject(new Error("Le fichier sélectionné n'est pas une image valide."));
    };

    reader.readAsDataURL(file);
  });
}

export default function MonSuiviTab({ selectedMember, defenses = [] }) {
const initialThreads = [];

const player = {
  id: selectedMember?.id ?? 1,
  name: selectedMember?.name ?? "Joueur",
};

  const [selectedDefenseId, setSelectedDefenseId] = useState(null);
  const [threads, setThreads] = useState([]);
  const [tabUnread, setTabUnread] = useState(0);
  const [mentionUnread, setMentionUnread] = useState(0);
  const [draftComment, setDraftComment] = useState("");
  const [draftYoutube, setDraftYoutube] = useState("");
  const [draftImage, setDraftImage] = useState(null);

const selectedDefense = useMemo(() => {
  if (!threads.length) return null;
  return threads.find((item) => item.id === selectedDefenseId) || threads[0] || null;
}, [selectedDefenseId, threads]);

  const totalWins = threads.reduce((sum, item) => sum + item.wins, 0);
  const totalLosses = threads.reduce((sum, item) => sum + item.losses, 0);

const openDefenseThread = (defenseId) => {
  setSelectedDefenseId(defenseId);

  let nextThreads = [];

  setThreads((prev) => {
    nextThreads = prev.map((item) =>
      item.id === defenseId ? { ...item, unread: 0 } : item
    );
    return nextThreads;
  });

  setTabUnread(nextThreads.reduce((sum, item) => sum + item.unread, 0));

  const isUuid =
    typeof defenseId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(defenseId);

  if (!isUuid) return;

  loadMessagesForThread(defenseId);
  markThreadAsRead(defenseId);
};

  const openMentions = () => {
    setMentionUnread(0);
  };

const handleImageSelect = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const compressedBlob = await compressImage(file);

    const compressedFile = new File(
      [compressedBlob],
      `compressed_${file.name.replace(/\.[^/.]+$/, "")}.jpg`,
      { type: "image/jpeg" }
    );

    const previewUrl = URL.createObjectURL(compressedFile);

    setDraftImage({
      file: compressedFile,
      preview: previewUrl,
      name: compressedFile.name,
    });
  } catch (error) {
    console.error("Erreur compression image :", error);
  }
};

const addTextComment = async () => {
  const content = draftComment.trim();
  if (!content || !selectedDefenseId || !selectedMember?.id) return;

  const isUuid =
    typeof selectedDefenseId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      selectedDefenseId
    );

  if (!isUuid) {
    console.warn("⛔ thread_id invalide, on bloque :", selectedDefenseId);
    return;
  }

  const mentions = extractMentions(content);

  const { data: insertedMessage, error } = await supabase
    .from("member_defense_messages")
    .insert({
      thread_id: selectedDefenseId,
      author_member_id: selectedMember.id,
      author_name: player.name,
      kind: "text",
      content,
    })
    .select()
    .single();

  if (error) {
    console.error("Erreur ajout message texte :", error);
    return;
  }

  if (mentions.length > 0 && insertedMessage?.id) {
    const resolvedMembers = await resolveMentionedMembers(mentions);

    const mentionRows = resolvedMembers.map((member) => ({
      message_id: insertedMessage.id,
      mentioned_member_id: member.id,
      mentioned_name: member.name,
    }));

    if (mentionRows.length > 0) {
      const { error: mentionError } = await supabase
        .from("member_defense_message_mentions")
        .insert(mentionRows);

      if (mentionError) {
        console.error("Erreur ajout mentions :", mentionError);
      }
    }

    if (mentions.includes(player.name)) {
      setMentionUnread((prev) => prev + 1);
    }
  }

  setDraftComment("");
  await loadMessagesForThread(selectedDefenseId);
};

const addYoutubeComment = async () => {
  const content = draftYoutube.trim();
  if (!content || !selectedDefenseId || !selectedMember?.id) return;

  const isUuid =
    typeof selectedDefenseId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      selectedDefenseId
    );

  if (!isUuid) {
    console.warn("⛔ thread_id invalide, on bloque :", selectedDefenseId);
    return;
  }

  const { error } = await supabase
    .from("member_defense_messages")
    .insert({
      thread_id: selectedDefenseId,
      author_member_id: selectedMember.id,
      author_name: player.name,
      kind: "youtube",
      content,
      youtube_url: content,
    });

  if (error) {
    console.error("Erreur ajout message youtube :", error);
    return;
  }

  setDraftYoutube("");
  await loadMessagesForThread(selectedDefenseId);
};

const addImageComment = async () => {
  if (!draftImage?.file || !selectedDefenseId || !selectedMember?.id) return;

  const publicUrl = await uploadImageToSupabase(draftImage.file);
  if (!publicUrl) return;

  const { error } = await supabase
    .from("member_defense_messages")
    .insert({
      thread_id: selectedDefenseId,
      author_member_id: selectedMember.id,
      author_name: player.name,
      kind: "image",
      content: publicUrl,
      image_path: publicUrl,
    });

  if (error) {
    console.error("Erreur ajout message image :", error);
    return;
  }

  setDraftImage(null);
  await loadMessagesForThread(selectedDefenseId);
};

const loadOrCreateThreads = async () => {
  const defensesReady =
    !!selectedMember?.id &&
    selectedMember?.defense1 !== undefined &&
    selectedMember?.defense2 !== undefined;

  if (!defensesReady) return;

  const slots = ["defense1", "defense2"];
  let resultThreads = [];

  const normalizeDefenseName = (value) => {
    if (!value || value === "--" || value === "—") {
      return "Aucune défense";
    }
    return value;
  };

  for (const slot of slots) {
    const defenseName = normalizeDefenseName(
      slot === "defense1"
        ? selectedMember.defense1
        : selectedMember.defense2
    );

    const { data: existing, error } = await supabase
      .from("member_defense_threads")
      .select("*")
      .eq("member_id", selectedMember.id)
      .eq("slot", slot)
      .maybeSingle();

    if (error) {
      console.error("Erreur lecture thread :", slot, error);
      continue;
    }

if (existing) {
  if (defenseName === "Aucune défense") {
    resultThreads.push(existing);
    continue;
  }

  if (existing.defense_name !== defenseName) {
    const { data: updated, error: updateError } = await supabase
      .from("member_defense_threads")
      .update({
        defense_name: defenseName,
        wins: 0,
        losses: 0,
      })
      .eq("id", existing.id)
      .select()
      .single();

    if (updateError) {
      console.error("Erreur update thread :", slot, updateError);
      resultThreads.push(existing);
    } else {
      const { error: deleteMessagesError } = await supabase
        .from("member_defense_messages")
        .delete()
        .eq("thread_id", existing.id);

      if (deleteMessagesError) {
        console.error("Erreur suppression anciens messages :", deleteMessagesError);
      }

      resultThreads.push({
        ...(updated || existing),
        comments: [],
      });
    }
  } else {
    resultThreads.push(existing);
  }

  continue;
}

    const { data: created, error: createError } = await supabase
      .from("member_defense_threads")
      .insert({
        member_id: selectedMember.id,
        slot,
        defense_name: defenseName,
      })
      .select()
      .single();

    if (createError) {
      console.error("Erreur création thread :", slot, createError);
      continue;
    }

    if (created) {
      resultThreads.push(created);
    }
  }

  const currentDefense1 =
    selectedMember?.defense1 &&
    selectedMember.defense1 !== "--" &&
    selectedMember.defense1 !== "—"
      ? selectedMember.defense1
      : "Aucune défense";

  const currentDefense2 =
    selectedMember?.defense2 &&
    selectedMember.defense2 !== "--" &&
    selectedMember.defense2 !== "—"
      ? selectedMember.defense2
      : "Aucune défense";

  console.log("RESULT THREADS", resultThreads);

const formatted = resultThreads.map((thread) => {
  console.log("THREAD DEF:", thread.defense_name);
console.log("DEFENSES:", defenses.map(d => d.name));
  const normalize = (str) =>
    str?.toLowerCase().trim();

  const tier = defenses.find(
    (defense) =>
      normalize(defense.name) === normalize(thread.defense_name)
  )?.tier;

  return {
    id: thread.id,
    slot: thread.slot === "defense1" ? "Défense 1" : "Défense 2",
    title: thread.slot === "defense1" ? currentDefense1 : currentDefense2,
    type:
      tier === "meta_s"
        ? "META S"
        : tier === "meta_a"
          ? "META A"
          : "Secondaire",
    wins: thread.wins ?? 0,
    losses: thread.losses ?? 0,
    unread: 0,
    comments: [],
  };
});

  if (formatted.length === 0) {
    console.warn("⚠️ Threads vides → on ne touche pas au state");
    return;
  }

  const threadsWithUnread = await computeUnreadCounts(formatted);

  setThreads(threadsWithUnread);
  setTabUnread(
    threadsWithUnread.reduce((sum, item) => sum + item.unread, 0)
  );
  setSelectedDefenseId(threadsWithUnread[0].id);
};

const loadMessagesForThread = async (threadId) => {
  if (!threadId) return;

  const { data, error } = await supabase
    .from("member_defense_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Erreur chargement messages :", error);
    return;
  }

const messageIds = (data || []).map((message) => message.id);

let mentionsMap = {};

if (messageIds.length > 0) {
  const { data: mentionsData, error: mentionsError } = await supabase
    .from("member_defense_message_mentions")
    .select("message_id, mentioned_name")
    .in("message_id", messageIds);

  if (mentionsError) {
    console.error("Erreur chargement mentions :", mentionsError);
  } else {
    mentionsMap = (mentionsData || []).reduce((acc, item) => {
      if (!acc[item.message_id]) {
        acc[item.message_id] = [];
      }
      acc[item.message_id].push(item.mentioned_name);
      return acc;
    }, {});
  }
}

const formattedMessages = (data || []).map((message) => ({
  id: message.id,
  author: message.author_name,
  kind: message.kind,
  content: message.content,
  createdAt: message.created_at,
  isOwn: String(message.author_member_id) === String(selectedMember?.id),
  mentions: mentionsMap[message.id] || [],
}));

setThreads((prev) =>
  prev.map((thread) =>
    thread.id === threadId
      ? { ...thread, comments: formattedMessages }
      : thread
  )
);
};

useEffect(() => {
  const isUuid =
    typeof selectedDefenseId === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedDefenseId);

  if (isUuid) {
    loadMessagesForThread(selectedDefenseId);
  }
}, [selectedDefenseId]);

const resolveMentionedMembers = async (mentionNames) => {
  if (!mentionNames.length) return [];

  const { data, error } = await supabase
    .from("guild_members")
    .select("*"); // 👈 on prend tout

  if (error) {
    console.error("Erreur résolution mentions :", error);
    return [];
  }

  // ⚠️ adapte ici le champ réel du nom
  const members = data || [];

  const resolved = members
    .filter((member) =>
      mentionNames.includes(
        (member.name || member.username || member.display_name || "").trim()
      )
    )
    .map((member) => ({
      id: member.id,
      name: member.name || member.username || member.display_name,
    }));

  return resolved;
};

const uploadImageToSupabase = async (file) => {
  if (!file) return null;

  const fileExt = file.name.split(".").pop();
  const fileName = `${selectedMember.id}_${Date.now()}.${fileExt}`;
  const filePath = `threads/${fileName}`;

  const { error: uploadError } = await supabase.storage
    .from("member-defense-media")
    .upload(filePath, file);

  if (uploadError) {
    console.error("Erreur upload image :", uploadError);
    return null;
  }

  const { data } = supabase.storage
    .from("member-defense-media")
    .getPublicUrl(filePath);

  return data?.publicUrl || null;
};

const markThreadAsRead = async (threadId) => {
  if (!threadId || !selectedMember?.id) return;

  const { error } = await supabase
    .from("member_defense_thread_reads")
    .upsert(
      {
        thread_id: threadId,
        member_id: selectedMember.id,
        last_read_at: new Date().toISOString(),
      },
      {
        onConflict: "thread_id,member_id",
      }
    );

  if (error) {
    console.error("Erreur markThreadAsRead :", error);
  }
};

const computeUnreadCounts = async (threadsList) => {
  if (!threadsList.length || !selectedMember?.id) return threadsList;

  const threadIds = threadsList.map((t) => t.id);

  // 1. récupérer last_read
  const { data: reads } = await supabase
    .from("member_defense_thread_reads")
    .select("thread_id, last_read_at")
    .eq("member_id", selectedMember.id)
    .in("thread_id", threadIds);

  const readMap = {};
  (reads || []).forEach((r) => {
    readMap[r.thread_id] = r.last_read_at;
  });

  // 2. récupérer les messages
  const { data: messages } = await supabase
    .from("member_defense_messages")
    .select("thread_id, created_at")
    .in("thread_id", threadIds);

  const messagesByThread = {};
  (messages || []).forEach((m) => {
    if (!messagesByThread[m.thread_id]) {
      messagesByThread[m.thread_id] = [];
    }
    messagesByThread[m.thread_id].push(m);
  });

  // 3. calcul unread
  const updatedThreads = threadsList.map((thread) => {
    const lastRead = readMap[thread.id];
    const msgs = messagesByThread[thread.id] || [];

    const unreadCount = msgs.filter((msg) => {
      if (!lastRead) return true;
      return new Date(msg.created_at) > new Date(lastRead);
    }).length;

    return {
      ...thread,
      unread: unreadCount,
    };
  });

  return updatedThreads;
};

useEffect(() => {
  setThreads([]);
  setSelectedDefenseId(null);
  setTabUnread(0);
  setMentionUnread(0);

  if (!selectedMember?.id) return;

  loadOrCreateThreads();
}, [
  selectedMember?.id,
  selectedMember?.defense1,
  selectedMember?.defense2,
  defenses.length,
]);

const updateThreadScore = async (threadId, field, value) => {
  const numericValue = Math.max(0, Number(value) || 0);

  setThreads((prev) =>
    prev.map((thread) =>
      thread.id === threadId
        ? { ...thread, [field]: numericValue }
        : thread
    )
  );

  const { error } = await supabase
    .from("member_defense_threads")
    .update({ [field]: numericValue })
    .eq("id", threadId);

  if (error) {
    console.error("Erreur update score :", error);
  }
};

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-5 shadow-2xl">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <StatBlock label="Victoires totales" value={totalWins} />
          <StatBlock label="Défaites totales" value={totalLosses} />
          <StatBlock label="Défenses suivies" value={threads.length} />
          <StatBlock label="Messages non lus" value={tabUnread} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="space-y-4">
            {threads.map((defense) => (
              <button
                key={defense.id}
                type="button"
                onClick={() => openDefenseThread(defense.id)}
                className={`w-full rounded-[24px] border p-4 text-left transition ${
                  selectedDefenseId === defense.id
                    ? "border-sky-400/40 bg-sky-500/10"
                    : "border-zinc-800 bg-zinc-950/40 hover:bg-zinc-900"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                      {defense.slot}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-white">
                      {defense.title}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <div className="text-zinc-500">Victoires</div>
                  <input
                    type="number"
                    min="0"
                    value={defense.wins}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      updateThreadScore(defense.id, "wins", e.target.value)
                    }
                    className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-1 font-semibold text-white"
                  />
                  </div>

                  <div className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2">
                    <div className="text-zinc-500">Défaites</div>
                    <input
                      type="number"
                      min="0"
                      value={defense.losses}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        updateThreadScore(defense.id, "losses", e.target.value)
                      }
                      className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-2 py-1 font-semibold text-white"
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div className="text-sm text-zinc-400">
                    Commentaires et médias liés à cette défense
                  </div>

<div className="relative flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
<span>💬</span>
<span>Messages</span>
<span className={badgeClass(defense.unread || 0)}>
  {defense.unread || 0}
</span>
</div>
                </div>
              </button>
            ))}
          </aside>

          <main className="rounded-[24px] border border-zinc-800 bg-zinc-950/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-800 pb-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
                  Chat de défense
                </div>
                <div className="mt-1 text-2xl font-semibold text-white">
                  {selectedDefense ? selectedDefense.title : "Aucune défense"}
                </div>
                <div className="mt-1 text-sm text-zinc-400">
                  Espace de commentaires partagé entre les membres. Images,
                  captures et liens YouTube autorisés.
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={openMentions}
                  className="relative flex items-center gap-2 rounded-2xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-sm text-violet-100"
                >
                  <span>@</span>
                  <span>Mentions</span>
                  <span className={badgeClass(mentionUnread)}>
                    {mentionUnread}
                  </span>
                </button>

                <div className="relative flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200">
                  <span>💬</span>
                  <span>Messages</span>
                  <span className={badgeClass(selectedDefense?.unread || 0)}>
                    {selectedDefense ? selectedDefense.unread : 0}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-3">
                {!selectedDefense || selectedDefense.comments.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/40 p-6 text-sm text-zinc-500">
                    Aucun commentaire pour cette défense pour le moment.
                  </div>
                ) : (
                  (selectedDefense?.comments || []).map((comment) => (
                    <div key={comment.id} className={commentCardClass(comment.isOwn)}>
                      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-zinc-400">
                        <span>{comment.author}</span>
                        <span>{comment.createdAt}</span>
                      </div>

                      {comment.kind === "text" && (
                        <div className="text-sm text-zinc-100">
                          {comment.content}
                        </div>
                      )}

                      {comment.mentions?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {comment.mentions.map((mention) => (
                            <span
                              key={mention}
                              className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[11px] text-violet-200"
                            >
                              @{mention}
                            </span>
                          ))}
                        </div>
                      )}

                      {comment.kind === "image" && (
                        <div className="space-y-2">
                          <img
                            src={comment.content}
                            alt="uploaded"
                            className="max-h-[200px] rounded-2xl border border-zinc-800 object-cover"
                          />

                          <div className="break-all text-xs text-zinc-400">
                            {comment.content}
                          </div>
                        </div>
                      )}

                      {comment.kind === "youtube" && (
                        <div className="space-y-2">
                          {getYoutubeEmbedUrl(comment.content) ? (
                            <div className="overflow-hidden rounded-2xl border border-red-500/20 bg-black">
                              <iframe
                                src={getYoutubeEmbedUrl(comment.content)}
                                title="YouTube video preview"
                                className="h-[200px] w-full"
                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                allowFullScreen
                              />
                            </div>
                          ) : (
                            <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-100">
                              Lien YouTube invalide
                            </div>
                          )}

                          <div className="break-all text-xs text-zinc-400">
                            {comment.content}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

<aside className="space-y-4 rounded-[22px] border border-zinc-800 bg-zinc-900 p-4">
  <div>
    <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">
      Nouvelle entrée
    </div>

    <textarea
      value={draftComment}
      onChange={(e) => setDraftComment(e.target.value)}
      placeholder="Écrire un commentaire sur cette défense..."
      className="mt-2 min-h-[120px] w-full rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
    />

    <input
      type="text"
      value={draftYoutube}
      onChange={(e) => setDraftYoutube(e.target.value)}
      placeholder="Coller un lien YouTube..."
      className="mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
    />

    {/* 👇 INPUT IMAGE DOIT ÊTRE ICI */}
    <input
      type="file"
      accept="image/*"
      onChange={handleImageSelect}
      className="mt-2 w-full text-sm text-zinc-400 file:mr-3 file:rounded-xl file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:text-zinc-100 hover:file:bg-zinc-700"
    />
    {draftImage && (
  <img
    src={draftImage.preview}
    alt="preview"
    className="mt-2 max-h-[150px] rounded-xl border border-zinc-800 object-cover"
  />
)}
  </div>

                <div className="grid gap-2">
              <button
                type="button"
                onClick={addTextComment}
                className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm hover:bg-zinc-800"
              >
                Ajouter un commentaire
              </button>

                  <button
                    type="button"
                    className="rounded-2xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-left text-sm text-violet-100 hover:bg-violet-500/15"
                  >
                    Mentionner un utilisateur
                  </button>

                <button
                  type="button"
                  onClick={addImageComment}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm hover:bg-zinc-800"
                >
                  Envoyer l’image
                </button>

                <button
                  type="button"
                  onClick={addYoutubeComment}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-left text-sm hover:bg-zinc-800"
                >
                  Ajouter un lien YouTube
                </button>
                </div>

                <div className="space-y-3 rounded-[20px] border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                  <div className="font-semibold">Règles de gestion</div>
                  <div>• Toute image est compressée avant upload en base.</div>
                  <div>
                    • Si la défense du joueur change, le chat et les fichiers liés
                    à cette défense sont supprimés en cascade.
                  </div>
                  <div>
                    • Le badge rouge sur “Mon suivi” et sur 💬 disparaît quand le
                    joueur concerné ouvre et lit le fil associé.
                  </div>
                  <div>
                    • Une mention @utilisateur crée une notification même si ce
                    n’est pas la défense de ce joueur.
                  </div>
                </div>
              </aside>
            </div>
          </main>
        </div>
      </section>
    </div>
  );
}